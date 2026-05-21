/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Bell, 
  Search, 
  Home as HomeIcon, 
  Plus,
  PlusCircle, 
  BarChart2, 
  User as UserIcon, 
  ChevronLeft, 
  Share2, 
  Bookmark, 
  CheckCircle2, 
  Check,
  Star,
  MapPin, 
  ShieldCheck,
  Phone, 
  MessageCircle,
  MessageSquare,
  Camera,
  LogOut,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  X,
  CreditCard,
  Shield,
  CheckCircle,
  Package,
  Clock,
  HelpCircle,
  LogOut as LogOutIcon,
  Globe,
  Mail,
  Pencil,
  Trash2,
  Heart,
  Facebook,
  Twitter,
  Maximize,
  Images,
  Archive,
  Trash,
  MoreVertical,
  MoreHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, signInAnonymously, updateProfile, RecaptchaVerifier, signInWithPhoneNumber, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp, 
  where,
  orderBy,
  limit,
  setDoc,
  deleteDoc,
  getDocs,
  getDoc,
  increment
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { AppScreen, Listing, Category, Conversation, Message as ChatMessage, Language, Review } from './types';
import { PRIMARY_GREEN, CATEGORIES, DISTRICTS, LOCATION_DATA } from './constants';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const App = () => {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('prefLanguage');
    return (saved as Language) || 'en';
  });
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('Home');
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const activeConversationRef = useRef<Conversation | null>(null);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSubDistrict, setActiveSubDistrict] = useState<string | null>(() => localStorage.getItem('selectedLocation'));
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRole, setPendingRole] = useState<'buy' | 'sell' | null>(() => {
    const saved = localStorage.getItem('pendingRole');
    return (saved === 'sell' || saved === 'buy') ? saved as any : null;
  });
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  
  const [listings, setListings] = useState<Listing[]>([]);
  const [mandiPrices, setMandiPrices] = useState<any[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [inAppNotification, setInAppNotification] = useState<{ title: string, body: string, unreadCount?: number, isTyping?: boolean, data?: any } | null>(null);
  const notificationTimeoutRef = useRef<any>(null);
  const lastProfileSubDistrictRef = useRef<string | null>(null);
  const lastConversationsStateRef = useRef<Map<string, { lastMessage: string, unreadCount: number, isTyping: boolean }>>(new Map());

  // Persist pendingRole & language
  useEffect(() => {
    if (pendingRole) {
      localStorage.setItem('pendingRole', pendingRole);
    } else {
      localStorage.removeItem('pendingRole');
    }
  }, [pendingRole]);

  useEffect(() => {
    localStorage.setItem('prefLanguage', language);
  }, [language]);

  // Auth & Initial Data Fetching
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setIsLoggedIn(true);
        requestNotificationPermission();
      } else {
        setUser(null);
        setIsLoggedIn(false);
        // If we are on a screen that requires auth, move to Home
        setCurrentScreen(prev => {
          const authRequiredScreens: AppScreen[] = ['SellerDashboard', 'Post', 'ChatList', 'ChatRoom', 'Wishlist', 'Onboarding', 'Profile', 'Orders', 'Notifications'];
          if (authRequiredScreens.includes(prev)) return 'Login';
          return prev;
        });
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // User Profile Sync & Screen Transition Logic
  useEffect(() => {
    if (!isLoggedIn || !auth.currentUser) return;

    const userRef = doc(db, 'users', auth.currentUser.uid);
    let unsubscribeUser: (() => void) | null = null;
    let isTerminated = false;

    // 1. Set up real-time sync listener (purely read operations)
    unsubscribeUser = onSnapshot(userRef, (snap) => {
      if (isTerminated) return;

      if (!snap.exists()) {
        const initialLocalData = {
          uid: auth.currentUser!.uid,
          name: auth.currentUser!.displayName || '',
          isVerified: false,
          location: '',
          district: '',
          subDistrict: '',
          state: 'Tamil Nadu',
          photoEmoji: '👨‍🌾',
          phone: auth.currentUser!.phoneNumber || '',
          memberSince: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        };
        setUser(initialLocalData);
        setCurrentScreen('Onboarding');
        setLoading(false);
        return;
      }

      const data = snap.data();
      const userData = { uid: auth.currentUser!.uid, ...data };
      setUser(userData);
      
      // Sync local language state via user profile
      if (data.language && data.language !== language) {
        setLanguage(data.language);
      }
      
      if (data.subDistrict && lastProfileSubDistrictRef.current !== data.subDistrict) {
        setActiveSubDistrict(data.subDistrict);
        lastProfileSubDistrictRef.current = data.subDistrict;
      }
      
      // Completeness check - ensure all required profile fields are present
      const isProfileComplete = !!(data.name && data.state && data.district && data.subDistrict && data.phone);
      
      setCurrentScreen(prev => {
        const protectedScreens: AppScreen[] = [
          'Home', 'SellerDashboard', 'Detail', 'Search', 'Profile', 
          'Orders', 'Chat', 'Analytics', 'ProductForm', 
          'ManageListings', 'Negotiations'
        ];
        
        if (protectedScreens.includes(prev as any)) {
          return prev;
        }

        if (!isProfileComplete) return 'Onboarding';
        
        // If we are on a setup/auth screen, transition to the correct dashboard
        if (prev === 'Login' || prev === 'Onboarding' || prev === 'RoleSelection') {
          return pendingRole === 'sell' ? 'SellerDashboard' : 'Home';
        }
        return prev;
      });
      setLoading(false);
    }, (err) => {
      console.error("User profile sync error:", err);
      if (!isTerminated) setLoading(false);
    });

    return () => {
      isTerminated = true;
      if (unsubscribeUser) {
        unsubscribeUser();
      }
    };
  }, [isLoggedIn, pendingRole, language]); 



  // Track current user's online and active status
  useEffect(() => {
    if (!isLoggedIn || !auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const userRef = doc(db, 'users', uid);

    const updateStatus = async (online: boolean) => {
      try {
        await updateDoc(userRef, {
          isOnline: online,
          lastActive: Date.now()
        });
      } catch (e) {
        console.warn("Could not update online status:", e);
      }
    };

    // Mark online on mount / login
    updateStatus(true);

    // Set up periodic heartbeat update every 25 seconds
    const interval = setInterval(() => {
      updateStatus(true);
    }, 25000);

    // Tab visibility handling
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        updateStatus(false);
      } else {
        updateStatus(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Handle unload / beforeunload or tab close
    const handleUnload = () => {
      updateStatus(false);
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleUnload);
      updateStatus(false);
    };
  }, [isLoggedIn]);

  // Real-time Data Listeners
  useEffect(() => {
    // PUBLIC LISTENERS - These run even if not logged in
    // Listen to Listings
    const listingsQuery = query(collection(db, 'listings'), orderBy('createdAt', 'desc'), limit(50));
    const unsubscribeListings = onSnapshot(listingsQuery, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setListings(docs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'listings'));

    // Listen to Mandi Prices
    const pricesQuery = query(collection(db, 'mandiPrices'));
    const unsubscribePrices = onSnapshot(pricesQuery, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setMandiPrices(docs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'mandiPrices'));

    // PRIVATE LISTENERS - These only run if logged in
    let unsubscribeWishlist = () => {};
    let unsubscribeConvos = () => {};

    if (isLoggedIn && auth.currentUser) {
      // Listen to Wishlist
      const wishlistQuery = query(collection(db, 'users', auth.currentUser.uid, 'wishlist'));
      unsubscribeWishlist = onSnapshot(wishlistQuery, (snapshot) => {
        setWishlist(snapshot.docs.map(doc => doc.id));
      }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${auth.currentUser?.uid}/wishlist`));

      // Listen to Conversations
      const convosQuery = query(
        collection(db, 'conversations'), 
        where('participants', 'array-contains', auth.currentUser.uid),
        orderBy('updatedAt', 'desc')
      );
      unsubscribeConvos = onSnapshot(convosQuery, (snapshot) => {
        const currentUserId = auth.currentUser?.uid;
        
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          const convoId = change.doc.id;
          const otherParticipantId = data.participants.find((p: string) => p !== currentUserId);
          const typingTime = data.typing?.[otherParticipantId] || 0;
          const currentlyTyping = Date.now() - typingTime < 5000;

          if (change.type === 'modified') {
            const pState = lastConversationsStateRef.current.get(convoId);
            const prevUnreadCount = pState?.unreadCount ?? 0;
            const prevLastMessage = pState?.lastMessage ?? '';
            const prevIsTyping = pState?.isTyping ?? false;

            const isFromOther = data.lastMessageSenderId !== currentUserId;
            const isNotActiveRoom = activeConversationRef.current?.id !== convoId;
            const isHidden = document.visibilityState === 'hidden';

            if (otherParticipantId && (isNotActiveRoom || isHidden)) {
              const senderName = data.participantNames?.[otherParticipantId] || (language === 'ta' ? 'பயனர்' : 'User');
              const avatar = data.participantAvatars?.[otherParticipantId] || '🌱';
              
              const isNewMessage = isFromOther && (
                data.unreadCount > prevUnreadCount || 
                (data.lastMessage !== prevLastMessage && data.lastMessageSenderId === otherParticipantId)
              );

              if (isNewMessage) {
                // Actual message received
                triggerNotification(senderName, data.lastMessage || 'New message', {
                  id: convoId,
                  participantName: senderName,
                  participantAvatar: avatar,
                  ...data
                }, false, data.unreadCount);
              } else if (currentlyTyping) {
                // If they are typing (and haven't sent the last message yet)
                triggerNotification(senderName, language === 'ta' ? 'தட்டச்சு செய்கிறது...' : 'typing...', {
                  id: convoId,
                  participantName: senderName,
                  participantAvatar: avatar,
                  ...data
                }, true, data.unreadCount);
              } else if (prevIsTyping && !currentlyTyping) {
                // Not typing and no news
                setInAppNotification(prev => (prev?.isTyping && prev?.data?.id === convoId) ? null : prev);
              }
            }
          }

          // Always persist the state of this conversation
          lastConversationsStateRef.current.set(convoId, {
            unreadCount: data.unreadCount || 0,
            lastMessage: data.lastMessage || '',
            isTyping: currentlyTyping
          });
        });

        const docs = snapshot.docs.map(doc => {
          const data = doc.data();
          const otherParticipantId = data.participants.find((p: string) => p !== auth.currentUser?.uid);
          return { 
            id: doc.id, 
            participantName: data.participantNames?.[otherParticipantId] || 'User',
            participantAvatar: data.participantAvatars?.[otherParticipantId] || '🌱',
            ...data 
          } as any;
        });
        setConversations(docs);
      }, (err) => handleFirestoreError(err, OperationType.LIST, 'conversations'));
    } else {
      setWishlist([]);
      setConversations([]);
    }

    return () => {
      unsubscribeListings();
      unsubscribePrices();
      unsubscribeWishlist();
      unsubscribeConvos();
    };
  }, [isLoggedIn]);

  // Cleanup wishlist items if listings are deleted
  useEffect(() => {
    if (!isLoggedIn || !auth.currentUser || listings.length === 0 || wishlist.length === 0) return;
    
    // Only cleanup if we have real listings (not just samples)
    const hasRealListings = listings.some(l => !l.id.startsWith('crops-') && !l.id.startsWith('equip-'));
    if (!hasRealListings) return;

    // Filter IDs that are in wishlist but not in current listings
    const deadIds = wishlist.filter(wishId => 
      !listings.some(l => l.id === wishId) && 
      !wishId.startsWith('crops-') && !wishId.startsWith('equip-')
    );

    if (deadIds.length > 0) {
      deadIds.forEach(async (id) => {
        try {
          await deleteDoc(doc(db, 'users', auth.currentUser!.uid, 'wishlist', id));
        } catch (e) {
          console.error("Error cleaning up wishlist item:", id, e);
        }
      });
    }
  }, [listings, wishlist, isLoggedIn]);

  const toggleWishlist = async (listingId: string) => {
    if (!isLoggedIn || !auth.currentUser) {
      setCurrentScreen('Login');
      return;
    }

    const isFavorited = wishlist.includes(listingId);
    const wishRef = doc(db, 'users', auth.currentUser.uid, 'wishlist', listingId);

    try {
      if (isFavorited) {
        await deleteDoc(wishRef);
      } else {
        await setDoc(wishRef, {
          userId: auth.currentUser.uid,
          listingId: listingId,
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, isFavorited ? OperationType.DELETE : OperationType.WRITE, wishRef.path);
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // Force account selection to ensure a "complete" logout/login cycle
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        return;
      }
      console.error("Login failed", err);
      // Fallback to anonymous login if popup is blocked or fails in iframe
      if (err.code === 'auth/popup-blocked' || err.message?.includes('assertion')) {
        try {
          await signInAnonymously(auth);
        } catch (anonErr) {
          console.error("Anonymous login fallback failed", anonErr);
        }
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // Explicitly reset all user-related states
      setUser(null);
      setIsLoggedIn(false);
      setWishlist([]);
      setConversations([]);
      setActiveConversation(null);
      setViewingUserId(null);
      setInAppNotification(null);
      setEditingListing(null);
      localStorage.removeItem('pendingRole');
      setPendingRole(null);
      // Move to Login immediately
      setCurrentScreen('Login');
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const unreadMessagesCount = useMemo(() => {
    return conversations.reduce((acc, c) => {
      if (c.lastMessageSenderId !== auth.currentUser?.uid) {
        return acc + (c.unreadCount || 0);
      }
      return acc;
    }, 0);
  }, [conversations, auth.currentUser?.uid]);

  const t = (en: string, ta: string) => {
    if (language === 'ta') return ta;
    return en;
  };

  const navLabels: any = {
    buy: { en: 'Buy', ta: 'வாங்க' },
    sell: { en: 'Sell', ta: 'விற்க' },
    chats: { en: 'Chats', ta: 'செய்திகள்' },
    prices: { en: 'Prices', ta: 'விலை' },
    profile: { en: 'Profile', ta: 'சுயவிவரம்' }
  };

  const getNavLabel = (key: keyof typeof navLabels) => {
    return (navLabels[key] as any)[language] || navLabels[key].en;
  };

  const navigateTo = (screen: AppScreen, data: any = null) => {
    // Guards for auth required screens
    const authRequiredScreens: AppScreen[] = ['SellerDashboard', 'Post', 'ChatList', 'ChatRoom', 'Profile', 'Orders', 'Wishlist', 'Notifications'];
    if (!isLoggedIn && authRequiredScreens.includes(screen)) {
      // If it's Profile, we might allow viewing OTHER profiles even if not logged in
      // but let's stick to the user's request for now.
      if (screen === 'Profile' && data && data !== auth.currentUser?.uid) {
        // Viewing other profile is okay? Let's check listing views
      } else {
        setCurrentScreen('Login');
        return;
      }
    }

    if (screen === 'Detail') {
      setSelectedListing(data);
    } else if (screen === 'Profile') {
      setViewingUserId(data); // data is userId
    } else if (screen !== 'ChatRoom' && screen !== 'Post') {
      // If we're not going to detail, clear selected listing
      setSelectedListing(null);
      setEditingListing(null);
    }

    if (screen === 'Post') {
      setEditingListing(data); // Clear if data is null, set if data is listing
    }

    if (screen === 'ChatRoom') {
      setActiveConversation(data);
      // Mark as read in local state first, real update happens via firestore update eventually
      setConversations(prev => prev.map(c => c.id === data.id ? { ...c, unreadCount: 0 } : c));
    } else {
      // If we're not going to chat room, clear active convo
      setActiveConversation(null);
    }

    setCurrentScreen(screen);
    window.scrollTo(0, 0);
  };

  const startChat = async (listing: Listing) => {
    console.log("startChat: Called with listing", listing.id, "farmer", listing.farmerId);
    if (!isLoggedIn || !auth.currentUser) {
      console.warn("startChat: User not logged in, redirecting to login");
      navigateTo('Login');
      return;
    }

    const currentUserId = auth.currentUser.uid;

    if (listing.farmerId === currentUserId) {
      alert(language === 'ta' ? 'உங்கள் சொந்தப் பதிவுக்கு உரையாடல் முடியாது!' : 'You cannot chat with yourself!');
      return;
    }

    try {
      // Fetch latest farmer name to be safe
      let farmerName = listing.farmerName || 'User';
      try {
        const farmerSnap = await getDoc(doc(db, 'users', listing.farmerId));
        if (farmerSnap.exists()) {
          farmerName = farmerSnap.data().name || farmerName;
        }
      } catch (e) {
        console.warn("Could not fetch latest farmer name:", e);
      }

      if (!listing.farmerId) {
        console.error("startChat: Missing farmer info:", listing);
        alert(language === 'ta' ? 'விவசாயி தகவல் கிடைக்கவில்லை' : 'Farmer information is missing');
        return;
      }

      // Check if conversation already exists
      console.log("startChat: Querying conversations for user", currentUserId);
      const q = query(
        collection(db, 'conversations'),
        where('participants', 'array-contains', currentUserId)
      );
      const querySnapshot = await getDocs(q);
      
      console.log("startChat: Found", querySnapshot.size, "conversations for user");
      
      let existingConvo = querySnapshot.docs.find(doc => {
        const data = doc.data();
        return (data.participants as string[] || []).includes(listing.farmerId);
      });

      const initialMsg = language === 'ta' 
        ? `வணக்கம், உங்கள் விளம்பரத்தில் எனக்கு ஆர்வம் உள்ளது: ${listing.titleTa}`
        : `Hi, I am interested in your listing: ${listing.titleEn}`;

      if (existingConvo) {
        console.log("startChat: Found existing conversation", existingConvo.id);
        const data = existingConvo.data();
        const otherParticipantId = data.participants.find((p: string) => p !== currentUserId);
        navigateTo('ChatRoom', { 
          id: existingConvo.id, 
          participantName: data.participantNames?.[otherParticipantId] || listing.farmerName || 'User',
          participantAvatar: data.participantAvatars?.[otherParticipantId] || '🌱',
          initialMessage: initialMsg,
          ...data 
        });
      } else {
        console.log("startChat: Creating new conversation with farmer", listing.farmerId);
        // Create new conversation
        const docRef = await addDoc(collection(db, 'conversations'), {
          participants: [currentUserId, listing.farmerId],
          participantNames: {
            [currentUserId]: user?.name || auth.currentUser.displayName || 'User',
            [listing.farmerId]: farmerName
          },
          participantAvatars: {
            [currentUserId]: '👨‍🌾',
            [listing.farmerId]: '🌱'
          },
          lastMessage: 'Starting conversation...',
          lastMessageTime: 'Just now',
          updatedAt: serverTimestamp(),
          unreadCount: 0
        });
        
        console.log("startChat: Successfully created conversation", docRef.id);
        
        const newConvo = {
          id: docRef.id,
          participants: [currentUserId, listing.farmerId],
          participantName: farmerName,
          participantAvatar: '🌱',
          initialMessage: initialMsg
        };
        navigateTo('ChatRoom', newConvo);
      }
    } catch (err) {
      console.error("Error in startChat:", err);
      let errorMsg = language === 'ta' ? 'உரையாடலைத் தொடங்குவதில் சிக்கல்' : 'Failed to start conversation';
      
      if (err instanceof Error) {
        if (err.message.includes('permission-denied')) {
          errorMsg = language === 'ta' ? 'அனுமதி மறுக்கப்பட்டது. தயவுசெய்து மீண்டும் உள்நுழையவும்.' : 'Permission denied. Please try logging in again.';
        }
      }
      
      alert(errorMsg);
      
      try {
        handleFirestoreError(err, OperationType.WRITE, 'conversations');
      } catch (e) {
        // We already handled the alert, so we can just log the specific error
        console.error("Firestore error details:", e);
      }
    }
  };

  const handleSendMessage = async (convoId: string, text: string) => {
    try {
      const msgRef = collection(db, 'conversations', convoId, 'messages');
      await addDoc(msgRef, {
        senderId: auth.currentUser?.uid,
        text,
        isRead: false,
        isDelivered: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: serverTimestamp(),
        archivedForUsers: {},
        deletedForUsers: {}
      });

      await updateDoc(doc(db, 'conversations', convoId), {
        lastMessage: text,
        lastMessageTime: 'Just now',
        lastMessageSenderId: auth.currentUser?.uid,
        unreadCount: increment(1),
        updatedAt: serverTimestamp(),
        deletedUsers: {}
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `conversations/${convoId}/messages`);
    }
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  };

  const triggerNotification = (title: string, body: string, data?: any, isTyping = false, unreadCount = 0) => {
    // Web Notification API
    if ('Notification' in window && Notification.permission === 'granted' && !isTyping) {
      const n = new Notification(title, { 
        body, 
        icon: 'https://cdn-icons-png.flaticon.com/512/1147/1147560.png'
      });
      n.onclick = () => {
        window.focus();
        if (data) navigateTo('ChatRoom', data);
        else navigateTo('ChatList');
      };
    }
    
    // Clear existing timeout
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }

    // Show in-app toast
    setInAppNotification({ title, body, data, isTyping, unreadCount });
    
    // Auto hide after 5 seconds if not typing, or 8 seconds if typing
    notificationTimeoutRef.current = setTimeout(() => {
      setInAppNotification(null);
    }, isTyping ? 3000 : 5000);
  };

  if (loading) {
    return (
      <div className="mobile-container flex items-center justify-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center"
        >
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-4xl">🌾</span>
          </div>
          <h1 className="text-2xl font-bold text-primary">AgriMarket</h1>
          <p className="text-gray-500 mt-2">விவசாயிகளுக்காக, விவசாயிகளால்</p>
          <div className="mt-8 w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mobile-container overflow-x-hidden">
      {/* In-App Notification Pop-up */}
      <AnimatePresence>
        {inAppNotification && (
          <motion.div 
            initial={{ y: -120, opacity: 0, scale: 0.9 }}
            animate={{ y: 20, opacity: 1, scale: 1 }}
            exit={{ y: -120, opacity: 0, scale: 0.9 }}
            drag="y"
            dragConstraints={{ top: -100, bottom: 20 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y < -40 || info.velocity.y < -500) {
                setInAppNotification(null);
              }
            }}
            onClick={() => {
              if (inAppNotification.data) navigateTo('ChatRoom', inAppNotification.data);
              else navigateTo('ChatList');
              setInAppNotification(null);
            }}
            className="fixed top-0 left-4 right-4 z-[100] bg-white/95 backdrop-blur-md rounded-[28px] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-gray-100 flex items-center gap-4 cursor-pointer active:scale-95 transition-transform select-none"
          >
            <div className="relative">
              <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-2xl shrink-0 overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent opacity-50" />
                <span className="relative z-10">{inAppNotification.data?.participantAvatar || '📩'}</span>
              </div>
              {inAppNotification.unreadCount! > 0 && (
                <div className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-lg animate-bounce">
                  {inAppNotification.unreadCount}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-black text-gray-900 text-sm truncate">{inAppNotification.title}</h4>
                {inAppNotification.isTyping && (
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                )}
              </div>
              <p className={`text-xs truncate mt-0.5 font-bold ${inAppNotification.isTyping ? 'text-primary' : 'text-gray-500'}`}>
                {inAppNotification.body}
              </p>
            </div>
            {!inAppNotification.isTyping && (
              <div className="text-[10px] font-black text-primary uppercase tracking-widest bg-primary/5 px-3 py-1.5 rounded-xl border border-primary/10 shrink-0">
                {language === 'ta' ? 'பதிலளி' : 'Reply'}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={currentScreen}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="flex-1 pb-32"
        >
          {currentScreen === 'Login' && (
            <LoginScreen 
              onLogin={handleLogin} 
              onSkip={() => navigateTo('Home')}
              language={language} 
              setLanguage={setLanguage} 
            />
          )}
          {currentScreen === 'Home' && (
            <HomeScreen 
              user={user}
              activeSubDistrict={activeSubDistrict}
              setActiveSubDistrict={setActiveSubDistrict}
              activeCategory={activeCategory}
              setActiveCategory={setActiveCategory}
              onNavigate={navigateTo} 
              onSearch={() => navigateTo('Search')}
              language={language}
              listings={listings}
              mandiPrices={mandiPrices}
              unreadCount={unreadMessagesCount}
              wishlist={wishlist}
              toggleWishlist={toggleWishlist}
            />
          )}
          {currentScreen === 'Onboarding' && (
            <OnboardingScreen 
              user={user} 
              language={language} 
              setLanguage={setLanguage}
              onComplete={() => {
                setCurrentScreen(pendingRole === 'sell' ? 'SellerDashboard' : 'Home');
              }}
            />
          )}
          {currentScreen === 'Search' && (
            <SearchScreen 
              onBack={() => navigateTo('Home')} 
              onNavigate={navigateTo}
              activeSubDistrict={activeSubDistrict}
              setActiveSubDistrict={setActiveSubDistrict}
              activeCategory={activeCategory}
              setActiveCategory={setActiveCategory}
              query={searchQuery}
              language={language}
              listings={listings}
              user={user}
              wishlist={wishlist}
              toggleWishlist={toggleWishlist}
            />
          )}
          {currentScreen === 'RoleSelection' && (
            <RoleSelectionScreen 
              onSelect={(mode: 'buy' | 'sell') => {
                setPendingRole(mode);
                if (!isLoggedIn) {
                   navigateTo('Login');
                } else {
                   if (mode === 'buy') navigateTo('Home');
                   else navigateTo('SellerDashboard');
                }
              }}
              language={language}
            />
          )}
          {currentScreen === 'SellerDashboard' && (
            <SellerDashboardScreen 
              onNavigate={navigateTo}
              language={language}
              userId={user?.uid}
              user={user}
              listings={listings}
            />
          )}
          {currentScreen === 'Post' && (
            <PostScreen 
              onBack={() => navigateTo(currentScreen === 'SellerDashboard' ? 'SellerDashboard' : 'Home')} 
              onDone={() => navigateTo('SellerDashboard')} 
              language={language} 
              userId={user?.uid} 
              userProfile={user}
              listingToEdit={editingListing}
            />
          )}
          {currentScreen === 'Prices' && <PricesScreen language={language} mandiPrices={mandiPrices} user={user} />}
          {currentScreen === 'Profile' && (
            <ProfileScreen 
              user={user} 
              viewingUserId={viewingUserId}
              onLogout={handleLogout} 
              onNavigate={navigateTo} 
              language={language} 
              setLanguage={setLanguage} 
              setUser={setUser} 
            />
          )}
          {currentScreen === 'Notifications' && (
            <NotificationsScreen 
              onBack={() => navigateTo('Home')} 
              language={language}
            />
          )}
          {currentScreen === 'ChatList' && (
            <ChatListScreen 
              conversations={conversations} 
              onNavigate={navigateTo} 
              onBack={() => navigateTo('Home')} 
              language={language}
            />
          )}
          {currentScreen === 'Wishlist' && (
            <WishlistScreen 
              listings={listings}
              wishlist={wishlist}
              onBack={() => navigateTo('Profile')}
              onNavigate={navigateTo}
              language={language}
              toggleWishlist={toggleWishlist}
            />
          )}
          {currentScreen === 'ChatRoom' && activeConversation && (
            <ChatRoomScreen 
              conversation={activeConversation} 
              onSendMessage={(text) => handleSendMessage(activeConversation.id, text)}
              onBack={() => navigateTo('ChatList')} 
              onViewProfile={(uid) => navigateTo('Profile', uid)}
              language={language}
            />
          )}
          {currentScreen === 'Detail' && selectedListing && (
            <DetailScreen 
              listing={selectedListing} 
              onBack={() => navigateTo('Home')} 
              onLogin={() => navigateTo('Login')}
              language={language}
              onViewProfile={(uid) => navigateTo('Profile', uid)}
              onStartChat={() => startChat(selectedListing)}
              wishlist={wishlist}
              toggleWishlist={toggleWishlist}
              isLoggedIn={isLoggedIn}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Bottom Navigation */}
      {(currentScreen !== 'Login' && currentScreen !== 'Onboarding' && currentScreen !== 'RoleSelection' && currentScreen !== 'Detail') && (
        <nav className="fixed bottom-0 w-full max-w-[430px] bg-white border-t border-gray-100 h-20 flex items-center z-50 pb-2 left-1/2 -translate-x-1/2 shadow-lg">
          <NavItem 
            isActive={currentScreen === 'Home'} 
            onClick={() => navigateTo('Home')} 
            icon={<HomeIcon size={22} />} 
            label={getNavLabel('buy')}
            subLabel="Buy / வாங்க"
          />
          <NavItem 
            isActive={currentScreen === 'SellerDashboard'} 
            onClick={() => navigateTo('SellerDashboard')} 
            icon={<BarChart2 size={22} />} 
            label={getNavLabel('sell')}
            subLabel="Sell / விற்க"
          />
          
          <div className="flex-1 flex justify-center -mt-12 relative group">
            {/* Face-recognition style spinning rings - Only active on hover */}
            <motion.div
              initial={{ rotate: 0 }}
              whileHover={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
              className="absolute w-18 h-18 border-2 border-dashed border-primary/30 rounded-full -top-1 opacity-0 group-hover:opacity-100 transition-opacity"
            />
            <motion.div
              initial={{ rotate: 0 }}
              whileHover={{ rotate: -360 }}
              transition={{ repeat: Infinity, duration: 5, ease: "linear" }}
              className="absolute w-16 h-16 border border-primary/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            />
            
            <button 
              onClick={() => navigateTo('Post')}
              className="relative w-14 h-14 flex items-center justify-center z-50 active:scale-90 transition-transform"
            >
              {/* Outer glow effect */}
              <div className="absolute inset-0 bg-primary/10 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              
              <div className="bg-primary w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-primary/40 relative z-10 border border-white/20">
                <Plus size={30} strokeWidth={3} />
              </div>
            </button>
          </div>
 
          <NavItem 
            isActive={currentScreen === 'ChatList' || currentScreen === 'ChatRoom'} 
            onClick={() => navigateTo('ChatList')} 
            icon={<MessageSquare size={22} />} 
            label={getNavLabel('chats')}
            subLabel="Chats / செய்திகள்"
            badge={unreadMessagesCount > 0 ? unreadMessagesCount : undefined}
          />
          <NavItem 
            isActive={currentScreen === 'Profile'} 
            onClick={() => navigateTo('Profile')} 
            icon={<UserIcon size={22} />} 
            label={getNavLabel('profile')}
            subLabel="Profile / சுயவிவரம்"
          />
        </nav>
      )}
    </div>
  );
};

// --- Components ---

const NavItem = ({ isActive, onClick, icon, label, subLabel, badge }: any) => (
  <button 
    onClick={onClick}
    className={`flex-1 flex flex-col items-center justify-center transition-colors px-1 py-1 rounded-lg relative ${isActive ? 'text-primary' : 'text-gray-400'}`}
  >
    {icon}
    {badge && (
      <div className="absolute top-1 right-2 bg-red-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border-2 border-white">
        {badge}
      </div>
    )}
    <span className="text-[9px] mt-0.5 font-bold leading-tight uppercase tracking-tighter">
      {label}
    </span>
    <span className="text-[8px] opacity-70 font-black leading-none mt-0.5">
      {subLabel}
    </span>
  </button>
);

const SectionHeader = ({ 
  title = "AgriMarket", 
  subtitle, 
  onNotify, 
  onWishlist,
  badge,
  wishlistCount
}: { 
  title?: string, 
  subtitle?: string, 
  onNotify?: () => void, 
  onWishlist?: () => void,
  badge?: number,
  wishlistCount?: number
}) => (
  <div className="bg-primary text-white p-6 pt-10 shadow-lg relative overflow-hidden">
    {/* Decorative background elements */}
    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl" />
    <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/5 rounded-full -ml-12 -mb-12 blur-xl" />
    
    <div className="flex justify-between items-start relative z-10">
      <div className="flex-1 min-w-0 pr-4">
        <h1 className="text-3xl font-black leading-tight tracking-tight text-white drop-shadow-sm truncate">{title}</h1>
        {subtitle && <p className="text-[13px] text-white/90 font-bold uppercase tracking-widest mt-1 opacity-80 truncate">{subtitle}</p>}
      </div>
      <div className="flex gap-2 shrink-0">
        {onWishlist && (
          <button 
            onClick={onWishlist}
            className="bg-white/20 w-12 h-12 rounded-2xl backdrop-blur-md flex items-center justify-center shadow-lg border border-white/10 transition-transform active:scale-95 relative"
          >
            <Heart size={24} className="text-white" />
            {wishlistCount && wishlistCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-white text-primary text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-primary shadow-sm">
                {wishlistCount > 9 ? '9+' : wishlistCount}
              </span>
            )}
          </button>
        )}
        <button 
          onClick={onNotify}
          className="bg-white/20 w-12 h-12 rounded-2xl backdrop-blur-md flex items-center justify-center shadow-lg border border-white/10 transition-transform active:scale-95 relative"
        >
          <Bell size={24} className="text-white" />
          {badge && badge > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-primary shadow-sm animate-in zoom-in duration-300">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </button>
      </div>
    </div>
  </div>
);

const UserName = ({ userId, fallback, className, type = 'name' }: { userId: string, fallback: string, className?: string, type?: 'name' | 'initial' | 'emoji' }) => {
  const [name, setName] = useState(fallback);
  const [emoji, setEmoji] = useState('👨‍🌾');
  
  useEffect(() => {
    if (!userId || userId.startsWith('farmer')) return;
    const unsub = onSnapshot(doc(db, 'users', userId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.name) setName(data.name);
        if (data.photoEmoji) setEmoji(data.photoEmoji);
      }
    }, () => {});
    return () => unsub();
  }, [userId]);
  
  if (type === 'initial') return <span className={className}>{name.charAt(0) || '?'}</span>;
  if (type === 'emoji') return <span className={className}>{emoji}</span>;
  return <span className={className}>{name}</span>;
};

const HomeScreen = ({ 
  user, 
  onNavigate, 
  onSearch, 
  language, 
  listings, 
  mandiPrices, 
  unreadCount,
  activeSubDistrict,
  setActiveSubDistrict,
  activeCategory,
  setActiveCategory,
  wishlist = [],
  toggleWishlist
}: any) => {
  
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [customLocationInput, setCustomLocationInput] = useState('');

  // Persist selected location to localStorage whenever it changes
  useEffect(() => {
    if (activeSubDistrict) {
      localStorage.setItem('selectedLocation', activeSubDistrict);
    } else {
      localStorage.removeItem('selectedLocation');
    }
  }, [activeSubDistrict]);

  const subDistricts = useMemo(() => {
    let selectedLoc = activeSubDistrict || user?.subDistrict || user?.location || user?.district || user?.state || '';
    if (selectedLoc.includes(',')) {
      selectedLoc = selectedLoc.split(',')[0].trim();
    }

    const userState = user?.state || 'Tamil Nadu';
    const userDistrict = user?.district || (userState === 'Karnataka' ? 'Bangalore' : 'Erode');
    const stateData = LOCATION_DATA.find(s => s.state === userState);
    
    let baseList = ['Gobichettipalayam', 'Erode', 'Bhavani', 'Coimbatore', 'Salem'];
    if (stateData) {
      const districtData = stateData.districts.find(d => d.name === userDistrict);
      if (districtData) {
        baseList = [...districtData.subDistricts];
      }
    }

    let list = [...baseList];
    if (selectedLoc) {
      const normalizedSel = selectedLoc.trim();
      if (normalizedSel) {
        // Find if an existing item matches (case insensitive check)
        const existingIdx = list.findIndex(item => item.toLowerCase() === normalizedSel.toLowerCase());
        if (existingIdx > -1) {
          // Remove the existing item
          const [matched] = list.splice(existingIdx, 1);
          // Insert at the beginning of the list
          list.unshift(matched);
        } else {
          // Prepend the new selected location
          list.unshift(normalizedSel);
        }
      }
    }

    // Keep unique values, preserving order
    return Array.from(new Set(list));
  }, [user?.state, user?.district, user?.subDistrict, user?.location, user?.district, user?.state, activeSubDistrict]);



  const rawListings = listings as any[];
  const displayPrices = mandiPrices;
  
  const displayListings = useMemo(() => {
    return rawListings.filter((l: any) => {
      const matchesLocation = !activeSubDistrict || l.location?.toLowerCase().includes(activeSubDistrict.toLowerCase());
      const matchesCategory = !activeCategory || l.category === activeCategory;
      return matchesLocation && matchesCategory;
    });
  }, [rawListings, activeSubDistrict, activeCategory]);

  const getSubDistrictLabel = (name: string, lang: 'ta' | 'en') => {
    if (lang === 'en') return name;
    const mapping: Record<string, string> = {
      'Gobichettipalayam': 'கோபிசெட்டிபாளையம்',
      'Kollam': 'கொல்லம்',
      'Perundurai': 'பெருந்துறை',
      'Bhavani': 'பவானி',
      'Sathyamangalam': 'சத்தியமங்கலம்',
      'Anthiyur': 'அந்திவூர்',
      'Kodumudi': 'கொடுமுடி',
      'Modakkurichi': 'மொடக்குறிச்சி',
      'Erode': 'ஈரோடு',
      'Coimbatore': 'கோயம்புத்தூர்',
      'Salem': 'சேலம்'
    };
    return mapping[name] || name;
  };

  const currentSubDistrictDisplay = activeSubDistrict || user?.subDistrict || 'Gobichettipalayam';
  const currentSubDistrictDisplayLabel = getSubDistrictLabel(currentSubDistrictDisplay, language);

  const subDistrictName = activeSubDistrict || user?.subDistrict || (language === 'ta' ? 'அனைத்தும்' : 'Select Location');

  return (
    <div id="home-screen">
      <SectionHeader 
        title={language === 'ta' ? 'அக்ரி மார்க்கெட்' : 'AgriMarket'} 
        subtitle={language === 'ta' ? `விவசாய சந்தை - ${currentSubDistrictDisplayLabel}` : `Agri Market - ${currentSubDistrictDisplay}`} 
        onNotify={() => onNavigate('Notifications')}
        onWishlist={() => onNavigate('Wishlist')}
        wishlistCount={wishlist.length}
        badge={0}
      />
      
      <div className="p-4 bg-white sticky top-0 z-40 space-y-3 shadow-sm border-b border-gray-100">
        <div 
          onClick={onSearch}
          className="flex items-center gap-3 bg-gray-100 p-3 rounded-xl border border-gray-200 cursor-pointer"
        >
          <Search size={20} className="text-gray-400" />
          <span className="text-gray-400">{language === 'ta' ? 'பயிர்கள், கருவிகள் தேடுக...' : 'Search crops, equipment, seeds...'}</span>
        </div>

        <div className="flex overflow-x-auto no-scrollbar gap-2 py-1 items-center">
          <button 
            onClick={() => setActiveSubDistrict(null)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeSubDistrict === null ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-gray-50 text-gray-400 border border-gray-100'}`}
          >
            {language === 'ta' ? 'அனைத்தும்' : 'All'}
          </button>
          {subDistricts.map(sd => (
            <button 
              key={sd}
              onClick={() => setActiveSubDistrict(sd)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeSubDistrict === sd ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-gray-50 text-gray-400 border border-gray-100'}`}
            >
              {sd}
            </button>
          ))}
          <button 
            onClick={() => setShowLocationModal(true)}
            className="shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100 flex items-center gap-1 active:scale-95"
          >
            <MapPin size={10} />
            {language === 'ta' ? 'இடம் திருத்து' : 'Edit Location'}
          </button>
        </div>
      </div>

      <div className="px-4 py-2 mt-2">
        <div className="flex overflow-x-auto no-scrollbar gap-4 pb-2">
          <button 
            className="flex flex-col items-center gap-1 shrink-0"
            onClick={() => setActiveCategory(null)}
          >
            <div className={`w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center text-2xl shadow-inner transition-transform active:scale-95 ${activeCategory === null ? 'ring-4 ring-primary ring-offset-2' : ''}`}>
              📦
            </div>
            <span className={`text-[10px] font-black leading-none mt-1 ${activeCategory === null ? 'text-primary' : 'text-gray-700'}`}>{language === 'ta' ? 'அனைத்தும்' : 'All'}</span>
            <span className="text-[9px] text-gray-400 font-bold">ALL</span>
          </button>
          {CATEGORIES.map(cat => (
            <button 
              key={cat.id} 
              className="flex flex-col items-center gap-1 shrink-0"
              onClick={() => setActiveCategory(prev => prev === cat.id ? null : cat.id)}
            >
              <div className={`w-14 h-14 ${cat.bgColor} rounded-2xl flex items-center justify-center text-2xl shadow-inner transition-transform active:scale-95 ${activeCategory === cat.id ? 'ring-4 ring-primary ring-offset-2' : ''}`}>
                {cat.emoji}
              </div>
              <span className={`text-[10px] font-black leading-none mt-1 ${activeCategory === cat.id ? 'text-primary' : 'text-gray-700'}`}>{language === 'ta' ? cat.labelTa : cat.labelEn}</span>
              <span className="text-[9px] text-gray-400 font-bold">{language === 'ta' ? cat.labelEn : cat.labelTa}</span>
            </button>
          ))}
        </div>
      </div>

      {displayPrices && displayPrices.length > 0 && (
        <div className="bg-green-50 border-y border-green-100 py-2 overflow-hidden relative">
          <div className="animate-marquee whitespace-nowrap flex gap-8 items-center px-4 text-[11px] font-black text-green-800 uppercase tracking-wide">
            {displayPrices.map((price: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <span>{language === 'ta' ? price.cropTa : price.cropEn}</span>
                <span className="text-green-600">₹{price.modal?.toLocaleString()}</span>
                {price.change > 0 ? (
                  <span className="text-green-600">↑</span>
                ) : (
                  <span className="text-red-500">↓</span>
                )}
              </div>
            ))}
            <span className="opacity-30 text-xs">|</span>
            {displayPrices.map((price: any, i: number) => (
               <div key={`dup-${i}`} className="flex items-center gap-2">
               <span>{language === 'ta' ? price.cropTa : price.cropEn}</span>
               <span className="text-green-600">₹{price.modal?.toLocaleString()}</span>
               {price.change > 0 ? (
                 <span className="text-green-600">↑</span>
               ) : (
                 <span className="text-red-500">↓</span>
               )}
             </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 space-y-4">
        <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest px-1">
          {language === 'ta' ? 'சிறப்பம்சங்கள் / Featured' : 'Featured / சிறப்பம்சங்கள்'}
        </h2>
        
        {displayListings.length > 0 ? displayListings.map((listing: any) => (
          <motion.div 
            key={listing.id}
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate('Detail', listing)}
            className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden p-3"
          >
            <div className="flex gap-4">
              <div className="w-24 h-24 bg-gradient-to-br from-green-50 to-green-100 rounded-3xl flex items-center justify-center text-4xl shadow-inner shrink-0 overflow-hidden relative">
                {listing.imageUrl ? (
                  <img src={listing.imageUrl} alt={listing.titleEn} className="w-full h-full object-cover" />
                ) : (
                  listing.photoEmoji
                )}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWishlist(listing.id);
                  }}
                  className="absolute top-1 right-1 w-7 h-7 bg-white/90 rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform"
                >
                  <Heart size={14} className={wishlist.includes(listing.id) ? 'fill-red-500 text-red-500' : 'text-gray-400'} />
                </button>
              </div>
              <div className="flex-1 flex flex-col pt-1">
                <div className="flex justify-between items-start">
                  <h3 className="font-black text-gray-800 leading-tight">
                    {language === 'ta' ? listing.titleTa : listing.titleEn}
                    <span className="text-[10px] font-medium text-gray-400 block mt-0.5">
                      {language === 'ta' ? listing.titleEn : listing.titleTa}
                    </span>
                  </h3>
                  {listing.isVerified && (
                    <span className="bg-blue-100 text-blue-700 text-[9px] font-black px-2 py-0.5 rounded-full uppercase shrink-0 flex items-center gap-1">
                      <ShieldCheck size={10} />
                      VERIFIED
                    </span>
                  )}
                </div>
                <p className="text-xl font-black text-primary mt-1">₹{listing.price}/{listing.unit}</p>
                <div className="mt-auto flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-gray-800">
                      <UserName userId={listing.farmerId} fallback={listing.farmerName} /> • {listing.location}
                    </span>
                    <span className="text-[10px] font-bold text-gray-400">Qty: {listing.quantity}</span>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate('Detail', listing);
                    }}
                    className="bg-primary text-white text-[10px] font-black px-4 py-2 rounded-xl shadow-lg shadow-primary/20 uppercase tracking-wide"
                  >
                    {language === 'ta' ? 'தொடர்பு' : 'Contact'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )) : (
          <div className="py-20 text-center space-y-4">
            <div className="text-6xl grayscale opacity-20">🚜</div>
            <div className="space-y-1">
              <h3 className="text-lg font-black text-gray-900">
                {language === 'ta' ? 'தயாரிப்புகள் இல்லை' : 'No products found'}
              </h3>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest px-10 leading-relaxed">
                {language === 'ta' 
                  ? `தற்போது ${activeSubDistrict || ''} பகுதியில் தயாரிப்புகள் ஏதுமில்லை. பிற பகுதிகளைச் சரிபார்க்கவும்.` 
                  : `Currently no active listings in ${activeSubDistrict || 'your area'}. Try checking nearby areas.`}
              </p>
            </div>
          </div>
        )}
      </div>

      {showLocationModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-55 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-[32px] p-6 max-w-sm w-full shadow-2xl border border-gray-100 flex flex-col gap-4 text-left"
          >
            <div className="flex justify-between items-center">
              <h3 className="font-black text-gray-900 text-sm uppercase tracking-wider">
                {language === 'ta' ? 'இடத்தைத் தேர்ந்தெடுக்கவும்' : 'Select Location'}
              </h3>
              <button 
                onClick={() => setShowLocationModal(false)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors font-black text-xs"
              >
                ✕
              </button>
            </div>

            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              {language === 'ta' ? 'உதாரணங்கள் / அடிக்கடி தேர்ந்தெடுப்பவை:' : 'Examples / Presets:'}
            </p>

            <div className="flex flex-col gap-2">
              {[
                { name: 'Kollam', labelTa: 'கொல்லம்' },
                { name: 'Gobichettipalayam', labelTa: 'கோபிசெட்டிபாளையம்' },
                { name: 'Perundurai', labelTa: 'பெருந்துறை' }
              ].map(preset => (
                <button
                  key={preset.name}
                  onClick={() => {
                    const finalName = preset.name;
                    setActiveSubDistrict(finalName);
                    setShowLocationModal(false);
                  }}
                  className={`flex justify-between items-center p-3 rounded-2xl border transition-all text-xs font-black uppercase tracking-wider ${
                    (activeSubDistrict && activeSubDistrict.toLowerCase() === preset.name.toLowerCase())
                      ? 'bg-primary/10 border-primary text-primary font-black' 
                      : 'bg-gray-50 border-gray-100 hover:bg-gray-100 text-gray-700 font-black'
                  }`}
                >
                  <span>{language === 'ta' ? preset.labelTa : preset.name}</span>
                  <MapPin size={12} className={(activeSubDistrict && activeSubDistrict.toLowerCase() === preset.name.toLowerCase()) ? 'text-primary' : 'text-gray-400'} />
                </button>
              ))}
            </div>

            <div className="border-t border-gray-100 my-1"></div>

            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2">
                {language === 'ta' ? 'வேறு இடம் உள்ளிடவும்:' : 'Or enter other location:'}
              </p>
              <div className="flex gap-2">
                <input 
                  type="text"
                  placeholder={language === 'ta' ? 'எ-கா: ஈரோடு' : 'e.g. Erode'}
                  value={customLocationInput}
                  onChange={(e) => setCustomLocationInput(e.target.value)}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-xs font-black outline-none focus:border-primary transition-all text-gray-800"
                />
                <button
                  onClick={() => {
                    if (customLocationInput.trim()) {
                      const finalName = customLocationInput.trim();
                      setActiveSubDistrict(finalName);
                      setShowLocationModal(false);
                      setCustomLocationInput('');
                    }
                  }}
                  className="bg-primary text-white font-black text-xs uppercase tracking-wider px-4 py-3 rounded-2xl active:scale-95 transition-transform shrink-0"
                >
                  {language === 'ta' ? 'அமை' : 'Set'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const WishlistScreen = ({ listings, wishlist, onBack, onNavigate, language, toggleWishlist }: { listings: Listing[], wishlist: string[], onBack: () => void, onNavigate: any, language: 'ta' | 'en', toggleWishlist: (id: string) => void }) => {
  const savedListings = listings.filter(l => wishlist.includes(l.id));

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="bg-primary text-white p-6 pt-10 shadow-lg relative overflow-hidden">
        <div className="flex justify-between items-start relative z-10">
          <button onClick={onBack} className="bg-white/20 p-2 rounded-full backdrop-blur-sm">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-black text-center flex-1 uppercase tracking-[0.2em]">
            {language === 'ta' ? 'சேமிக்கப்பட்டவை' : 'Saved Items'}
          </h1>
          <div className="w-10"></div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {savedListings.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {savedListings.map((listing: any) => (
              <motion.div 
                key={listing.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => onNavigate('Detail', listing)}
                className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden p-3"
              >
                <div className="flex gap-4">
                  <div className="w-20 h-20 bg-gradient-to-br from-green-50 to-green-100 rounded-3xl flex items-center justify-center text-3xl shadow-inner shrink-0 overflow-hidden relative">
                    {listing.imageUrl ? (
                      <img src={listing.imageUrl} alt={listing.titleEn} className="w-full h-full object-cover" />
                    ) : (
                      listing.photoEmoji
                    )}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWishlist(listing.id);
                      }}
                      className="absolute top-1 right-1 w-6 h-6 bg-white/90 rounded-full flex items-center justify-center shadow-sm"
                    >
                      <Heart size={12} className="fill-red-500 text-red-500" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <h3 className="font-black text-gray-800 text-sm truncate">
                      {language === 'ta' ? listing.titleTa : listing.titleEn}
                    </h3>
                    <p className="text-primary font-black text-lg">₹{listing.price}</p>
                    <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase tracking-tight">
                      <MapPin size={10} /> {listing.location}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center space-y-4 opacity-30">
            <Bookmark size={64} className="mx-auto text-gray-300" />
            <div className="space-y-1">
              <p className="text-xs font-black uppercase tracking-widest text-gray-900">
                {language === 'ta' ? 'சேமிக்கப்பட்டவை எதுவுமில்லை' : 'No saved items'}
              </p>
              <p className="text-[10px] font-bold text-gray-500">
                {language === 'ta' ? 'விருப்பமான பொருட்களை இங்கே சேமிக்கவும்' : 'Items you favorite will appear here'}
              </p>
            </div>
            <button 
              onClick={() => onNavigate('Home')}
              className="px-6 py-3 bg-primary text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20"
            >
              {language === 'ta' ? 'பொருட்களை பார்' : 'Explore Items'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const NotificationsScreen = ({ onBack, language }: { onBack: () => void, language: string }) => {
  const notifications = [
    {
      id: '1',
      title: language === 'ta' ? 'புதிய விவசாய சந்தை புதுப்பிப்பு' : 'New AgriMarket Update',
      body: language === 'ta' ? 'உங்கள் பகுதியில் புதிய விலைப் பட்டியல்கள் வந்துள்ளன.' : 'New price listings are available in your area.',
      time: '2h ago',
      icon: '🌾',
      type: 'info'
    },
    {
      id: '2',
      title: language === 'ta' ? 'அகநிறுவன அறிவிப்பு' : 'System Maintenance',
      body: language === 'ta' ? 'நாளை காலை 2 மணி முதல் 4 மணி வரை செயலி பராமரிப்பில் இருக்கும்.' : 'App will be under maintenance tomorrow from 2 AM to 4 AM.',
      time: '1d ago',
      icon: '⚙️',
      type: 'warning'
    },
    {
      id: '3',
      title: language === 'ta' ? 'ஆதார் சரிபார்ப்பு வெற்றி' : 'Aadhaar Verification Success',
      body: language === 'ta' ? 'உங்கள் கணக்கு இப்போது உறுதிப்படுத்தப்பட்டது.' : 'Your account is now verified.',
      time: '2d ago',
      icon: '✅',
      type: 'success'
    }
  ];

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="bg-primary text-white p-6 pt-10 shadow-lg relative overflow-hidden">
        <div className="flex justify-between items-start relative z-10">
          <button onClick={onBack} className="bg-white/20 p-2 rounded-full backdrop-blur-sm">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-black text-center flex-1 uppercase tracking-[0.2em]">
            {language === 'ta' ? 'அறிவிப்புகள்' : 'Notifications'}
          </h1>
          <div className="w-10"></div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {notifications.map(notif => (
          <div key={notif.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex gap-4">
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-2xl shrink-0">
              {notif.icon}
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-start">
                <h3 className="font-black text-gray-900 text-sm">{notif.title}</h3>
                <span className="text-[10px] font-bold text-gray-400">{notif.time}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 font-medium leading-relaxed">{notif.body}</p>
            </div>
          </div>
        ))}

        <div className="py-20 text-center space-y-2 opacity-30">
          <Bell size={48} className="mx-auto text-gray-300" />
          <p className="text-xs font-black uppercase tracking-widest text-gray-900">
            {language === 'ta' ? 'இனி கூடுதல் அறிவிப்புகள் இல்லை' : 'No more notifications'}
          </p>
        </div>
      </div>
    </div>
  );
};

const DetailScreen = ({ listing, onBack, onLogin, language, onStartChat, onViewProfile, wishlist = [], toggleWishlist, isLoggedIn }: { listing: Listing, onBack: () => void, onLogin: () => void, language: 'ta' | 'en', onStartChat: () => Promise<void>, onViewProfile: (userId: string) => void, wishlist?: string[], toggleWishlist?: (id: string) => void, isLoggedIn: boolean }) => {
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showFullscreen, setShowFullscreen] = useState(false);

  const images = (listing.images && listing.images.length > 0) ? listing.images : (listing.imageUrl ? [listing.imageUrl] : []);

  const shareTitle = language === 'ta' ? listing.titleTa : listing.titleEn;
  const shareUrl = window.location.href;
  const shareText = `${shareTitle} - Check this out on AgriMarket: ${shareUrl}`;

  const shareLinks = {
    whatsapp: `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`
  };

  const getWaLink = () => {
    if (!listing.phone) return "#";
    const cleanPhone = listing.phone.replace(/\D/g, '');
    // Assume India (91) if it's 10 digits
    const phone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const message = encodeURIComponent(language === 'ta' 
      ? `வணக்கம், உங்கள் விளம்பரம் குறித்து நான் பேச விழைகிறேன்: ${listing.titleTa}` 
      : `Hi, I am interested in your listing: ${listing.titleEn}`);
    return `https://wa.me/${phone}?text=${message}`;
  };

  return (
    <div className="bg-white px-6">
      <div className="fixed top-0 w-full max-w-[430px] p-4 flex justify-between items-center z-50 left-1/2 -translate-x-1/2">
        <button onClick={onBack} className="bg-white/80 p-2 rounded-full shadow-md backdrop-blur-md">
          <ChevronLeft size={24} />
        </button>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowShareSheet(true)}
            className="bg-white/80 p-2 rounded-full shadow-md backdrop-blur-md active:scale-95 transition-transform"
          >
            <Share2 size={20} />
          </button>
          <button 
            onClick={() => toggleWishlist?.(listing.id)}
            className="bg-white/80 p-2 rounded-full shadow-md backdrop-blur-md active:scale-90 transition-transform"
          >
            <Heart size={20} className={wishlist.includes(listing.id) ? 'fill-red-500 text-red-500' : 'text-gray-400'} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showShareSheet && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowShareSheet(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] cursor-pointer"
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white rounded-t-[40px] z-[101] p-8 shadow-2xl space-y-8"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto" />
              <div className="text-center space-y-1">
                <h3 className="text-xl font-black text-gray-900 leading-tight">
                  {language === 'ta' ? 'விளம்பரத்தை பகிரவும்' : 'Share Listing'}
                </h3>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  {language === 'ta' ? 'தகவல் தொழில்நுட்ப தளங்களைப் பயன்படுத்தவும்' : 'Choose a platform'}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <a 
                  href={shareLinks.whatsapp} 
                  target="_blank" 
                  rel="noreferrer"
                  className="flex flex-col items-center gap-2 group"
                >
                  <div className="w-16 h-16 bg-[#25D366] text-white rounded-[24px] flex items-center justify-center shadow-lg shadow-green-500/20 active:scale-90 transition-transform group-hover:bg-[#20bd5a]">
                    <MessageCircle size={32} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">WhatsApp</span>
                </a>
                <a 
                  href={shareLinks.facebook} 
                  target="_blank" 
                  rel="noreferrer"
                  className="flex flex-col items-center gap-2 group"
                >
                  <div className="w-16 h-16 bg-[#1877F2] text-white rounded-[24px] flex items-center justify-center shadow-lg shadow-blue-500/20 active:scale-90 transition-transform group-hover:bg-[#156adb]">
                    <Facebook size={32} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Facebook</span>
                </a>
                <a 
                  href={shareLinks.twitter} 
                  target="_blank" 
                  rel="noreferrer"
                  className="flex flex-col items-center gap-2 group"
                >
                  <div className="w-16 h-16 bg-[#1DA1F2] text-white rounded-[24px] flex items-center justify-center shadow-lg shadow-sky-500/20 active:scale-90 transition-transform group-hover:bg-[#1a91da]">
                    <Twitter size={32} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Twitter</span>
                </a>
              </div>

              <button 
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  alert(language === 'ta' ? 'இணைப்பு நகலெடுக்கப்பட்டது' : 'Link copied to clipboard');
                }}
                className="w-full bg-gray-50 text-gray-900 py-5 px-6 rounded-3xl font-black text-xs uppercase tracking-widest border border-gray-100 flex items-center justify-center gap-3 active:scale-[0.98] transition-transform"
              >
                <Globe size={18} className="text-primary" />
                {language === 'ta' ? 'இணைப்பை நகலெடு' : 'Copy link'}
              </button>
              
              <button 
                onClick={() => setShowShareSheet(false)}
                className="w-full text-gray-400 font-black text-[10px] uppercase tracking-[0.2em] pt-2"
              >
                {language === 'ta' ? 'மூடு' : 'Close'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFullscreen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col"
          >
            <div className="absolute top-6 left-6 z-10">
              <button 
                onClick={() => setShowFullscreen(false)}
                className="bg-white/10 hover:bg-white/20 p-3 rounded-2xl backdrop-blur-md text-white transition-colors"
                id="close-fullscreen"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="flex-1 relative flex items-center justify-center overflow-hidden">
               <motion.div
                key={currentImageIndex}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                onDragEnd={(_, info) => {
                  if (info.offset.x > 100 && images.length > 1) {
                    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
                  } else if (info.offset.x < -100 && images.length > 1) {
                    setCurrentImageIndex((prev) => (prev + 1) % images.length);
                  }
                }}
                className="w-full h-full flex items-center justify-center p-4 touch-none"
              >
                <img 
                  src={images[currentImageIndex]} 
                  alt="Fullscreen" 
                  className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
                />
              </motion.div>
            </div>
            
            <div className="p-10 flex flex-col items-center gap-4">
              <div className="flex gap-2">
                {images.map((_, i) => (
                  <div 
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === currentImageIndex ? 'w-8 bg-white' : 'w-2 bg-white/20'}`}
                  />
                ))}
              </div>
              <p className="text-white/40 text-[10px] font-black uppercase tracking-[0.2em]">
                {currentImageIndex + 1} / {images.length} • {language === 'ta' ? 'நகர்த்த இடது/வலது பக்கம் இழுக்கவும்' : 'Swipe left/right to browse'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative -mx-6 overflow-hidden bg-gray-100 group">
        <div 
          className="w-full aspect-square bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center text-9xl overflow-hidden relative cursor-pointer"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentImageIndex}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="w-full h-full"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.x > 50 && images.length > 1) {
                  setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
                } else if (info.offset.x < -50 && images.length > 1) {
                  setCurrentImageIndex((prev) => (prev + 1) % images.length);
                }
              }}
              onTap={() => {
                setShowFullscreen(true);
              }}
            >
              {images.length > 0 ? (
                <img 
                  src={images[currentImageIndex]} 
                  alt={listing.titleEn} 
                  className="w-full h-full object-cover" 
                />
              ) : (
                listing.photoEmoji
              )}
            </motion.div>
          </AnimatePresence>
          
          {images.length > 1 && (
            <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-4 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
                }}
                className="p-3 bg-black/30 backdrop-blur-md rounded-2xl text-white pointer-events-auto hover:bg-black/50 transition-colors"
                id="prev-image"
              >
                <ChevronLeft size={20} />
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentImageIndex((prev) => (prev + 1) % images.length);
                }}
                className="p-3 bg-black/30 backdrop-blur-md rounded-2xl text-white pointer-events-auto hover:bg-black/50 transition-colors"
                id="next-image"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}

          <div 
            className="absolute top-4 right-4 bg-white/20 backdrop-blur-md p-2 rounded-xl text-white opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => setShowFullscreen(true)}
          >
            <Maximize size={18} />
          </div>
        </div>
        
        {images.length > 0 && (
          <div className="absolute bottom-4 right-4 bg-black/60 text-white text-[10px] font-black px-3 py-1.5 rounded-full backdrop-blur-md uppercase tracking-widest z-10">
            {currentImageIndex + 1} / {images.length}
          </div>
        )}
        
        {/* Thumbnails */}
        {images.length > 1 && (
          <div className="absolute bottom-4 left-6 flex gap-2 z-10">
            {images.map((_, i) => (
              <div 
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === currentImageIndex ? 'w-8 bg-white shadow-sm' : 'w-2 bg-white/40'}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="p-5 space-y-6 pb-40">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight leading-tight">
            {language === 'ta' ? listing.titleTa : listing.titleEn}
            <span className="text-sm font-medium text-gray-400 block mt-1">
              {language === 'ta' ? listing.titleEn : listing.titleTa}
            </span>
          </h1>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-4xl font-black text-primary tracking-tighter">₹{listing.price}/{listing.unit}</span>
            <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-wide">
              {language === 'ta' ? 'விலை பேசி குறைக்கலாம்' : 'Negotiable'}
            </span>
          </div>
          <div className="mt-4 flex gap-2">
            <span className="bg-primary/10 text-primary text-[10px] px-3 py-1.5 rounded-xl font-black uppercase tracking-wide">
               {listing.quantity} {language === 'ta' ? 'இருப்பில் உள்ளது' : 'available'}
            </span>
            <span className="text-gray-400 text-[10px] font-bold py-1.5 uppercase tracking-widest">Posted {listing.postedDate} • {listing.views} views</span>
          </div>
        </div>

        <div 
          onClick={() => isLoggedIn ? onViewProfile(listing.farmerId) : onLogin()}
          className="flex items-center gap-4 p-5 bg-gray-50 rounded-[32px] border border-gray-100 shadow-sm active:scale-[0.98] transition-transform cursor-pointer"
        >
          <div className="w-14 h-14 bg-primary text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg shadow-primary/20">
            <UserName userId={listing.farmerId} fallback={listing.farmerName} type="initial" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <h4 className="font-black text-gray-900 leading-none">
                <UserName userId={listing.farmerId} fallback={listing.farmerName} />
              </h4>
              <CheckCircle2 size={16} className="text-blue-500 fill-blue-500 text-white" />
              {listing.isVerified && (
                <div className="bg-blue-500/20 text-blue-500 text-[10px] font-black px-2 py-1 rounded-lg uppercase tracking-widest flex items-center gap-1">
                  <ShieldCheck size={12} />
                  Verified
                </div>
              )}
            </div>
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-tighter mt-1">
              {language === 'ta' ? 'உறுப்பாளர் விவரம்' : 'View Seller Profile'}
            </p>
            <div className="flex items-center gap-1 mt-1">
               <div className="flex text-yellow-500">
                 {[...Array(5)].map((_, i) => (
                   <Star 
                     key={i} 
                     size={10} 
                     fill={i < Math.floor(listing.farmerRating || 4) ? 'currentColor' : 'none'} 
                     className={i < Math.floor(listing.farmerRating || 4) ? 'text-yellow-500' : 'text-gray-300'}
                   />
                 ))}
               </div>
               <span className="text-[10px] font-black text-gray-400 opacity-60 italic">
                 {listing.farmerRating || '4.0'} ({listing.farmerReviewCount || 0} {language === 'ta' ? 'மதிப்பாய்வுகள்' : 'reviews'})
               </span>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <ChevronRight size={20} className="text-gray-300" />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-3">
             {language === 'ta' ? 'பதிவு விவரம் / Detailed Information' : 'Detailed Information / பதிவு விவரம்'}
          </h3>
          <div className="bg-gray-50 rounded-[32px] p-6 border border-gray-100 space-y-6">
            <div className="space-y-4">
              <p className="text-gray-600 leading-relaxed font-medium whitespace-pre-line">
                {listing.description || (language === 'ta' ? 'விவரம் எதுவும் வழங்கப்படவில்லை' : 'No description provided')}
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-y-6 gap-x-4 pt-6 border-t border-gray-200/50">
              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 bg-blue-100 rounded-md flex items-center justify-center text-blue-600">
                    <CheckCircle size={12} />
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">
                    {language === 'ta' ? 'தரம்' : 'Quality Grade'}
                  </p>
                </div>
                <p className="font-black text-gray-800 text-xs px-1">{listing.qualityGrade || 'Grade A'}</p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 bg-orange-100 rounded-md flex items-center justify-center text-orange-600">
                    <Maximize size={12} />
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">
                    {language === 'ta' ? 'குறைந்தபட்ச ஆர்டர்' : 'Min. Order'}
                  </p>
                </div>
                <p className="font-black text-gray-800 text-xs px-1">{listing.minOrderQty || `1 ${listing.unit}`}</p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 bg-green-100 rounded-md flex items-center justify-center text-green-600">
                    <Clock size={12} />
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">
                    {language === 'ta' ? 'அறுவடை தேதி' : 'Harvest Date'}
                  </p>
                </div>
                <p className="font-black text-gray-800 text-xs px-1">{listing.harvestDate || 'Freshly Harvested'}</p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 bg-purple-100 rounded-md flex items-center justify-center text-purple-600">
                    <Shield size={12} />
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">
                    {language === 'ta' ? 'பயிரிடும் முறை' : 'Farming Type'}
                  </p>
                </div>
                <p className="font-black text-gray-800 text-xs px-1">
                  {listing.organic 
                    ? (language === 'ta' ? 'இயற்கை / Organic' : '100% Organic') 
                    : (language === 'ta' ? 'மாமூல் / Conventional' : 'Conventional')}
                </p>
              </div>

              <div className="space-y-1 col-span-2 bg-white/50 p-3 rounded-2xl border border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 bg-amber-100 rounded-md flex items-center justify-center text-amber-600">
                    <Package size={12} />
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">
                    {language === 'ta' ? 'சேமிப்பு முறை' : 'Storage / Packaging'}
                  </p>
                </div>
                <p className="font-black text-gray-800 text-xs px-1">{listing.storageType || 'Standard Packaging'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 bg-blue-50/50 rounded-[32px] border border-blue-100 flex items-center gap-5">
           <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 shadow-inner">
             <MapPin size={28} />
           </div>
           <div>
             <h4 className="font-black text-gray-900 uppercase tracking-wide text-xs">Location / இடம்</h4>
             <p className="text-[13px] text-gray-500 font-medium">{listing.location || (language === 'ta' ? 'இடம் தெரியவில்லை' : 'Location unknown')}</p>
           </div>
        </div>
      </div>

      <div className="fixed bottom-0 w-full max-w-[430px] p-4 bg-white/95 backdrop-blur-xl border-t border-gray-100 flex flex-col gap-3 z-[60] pb-8 left-1/2 -translate-x-1/2 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
        <div className="flex gap-2">
          <a 
            href={isLoggedIn && listing.phone ? `tel:${listing.phone}` : '#'}
            onClick={(e) => {
              if (!isLoggedIn) {
                e.preventDefault();
                onLogin();
                return;
              }
              if (!listing.phone) {
                e.preventDefault();
                alert(language === 'ta' ? 'தொலைபேசி எண் வழங்கப்படவில்லை' : 'Phone number not provided');
              }
            }}
            className="flex-1 bg-primary text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 shadow-xl shadow-primary/30 uppercase tracking-widest text-[11px] no-underline active:scale-95 transition-transform"
          >
            <Phone size={18} />
            {language === 'ta' ? 'அழைக்கவும்' : 'Call Farmer'}
          </a>
          <button 
            disabled={isStartingChat}
            onClick={async () => {
              if (!isLoggedIn) {
                onLogin();
                return;
              }
              if (!listing.farmerId) {
                alert(language === 'ta' ? 'விவசாயி தகவல் கிடைக்கவில்லை' : 'Farmer information is missing');
                return;
              }
              setIsStartingChat(true);
              try {
                await onStartChat();
              } catch (err) {
                console.error("DetailScreen: onStartChat failed", err);
              } finally {
                setIsStartingChat(false);
              }
            }}
            className="flex-1 bg-white text-primary border-2 border-primary py-4 rounded-2xl font-black flex items-center justify-center gap-2 uppercase tracking-widest text-[11px] active:scale-95 transition-transform disabled:opacity-50"
          >
            {isStartingChat ? (
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <>
                <MessageSquare size={18} />
                {language === 'ta' ? 'சாட் செய்ய' : 'Live Chat'}
              </>
            )}
          </button>
        </div>
          <a 
            href={isLoggedIn ? getWaLink() : '#'}
            target={isLoggedIn ? "_blank" : "_self"}
            rel="noreferrer"
            onClick={(e) => {
              if (!isLoggedIn) {
                e.preventDefault();
                onLogin();
                return;
              }
              if (!listing.phone) {
                e.preventDefault();
                alert(language === 'ta' ? 'தொலைபேசி எண் வழங்கப்படவில்லை' : 'Phone number not provided');
              }
            }}
            className="w-full bg-[#25D366] hover:bg-[#20ba5a] text-white py-5 rounded-[22px] font-black flex items-center justify-center gap-3 shadow-[0_8px_30px_rgb(37_211_102_/_30%)] uppercase tracking-[0.1em] text-[12px] no-underline active:scale-[0.98] transition-all relative overflow-hidden"
          >
            <div className="shrink-0 flex items-center justify-center w-6 h-6 z-10">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full drop-shadow-md">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .011 5.403.01 12.039c0 2.12.553 4.189 1.603 6.006L0 24l6.149-1.613a11.815 11.815 0 005.9 1.564h.005c6.635 0 12.037-5.405 12.04-12.04.001-3.214-1.248-6.234-3.513-8.5l-.001-.001z" />
              </svg>
            </div>
            <span className="z-10">{language === 'ta' ? 'வாட்ஸ்அப் மூலம் கேட்கவும்' : 'Contact via WhatsApp'}</span>
          </a>
      </div>
    </div>
  );
};

const PostScreen = ({ onBack, onDone, language, userId, userProfile, listingToEdit }: { onBack: () => void, onDone: () => void, language: 'ta' | 'en', userId: string, userProfile: any, listingToEdit?: Listing | null }) => {
  const browseInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [showImageSourcePicker, setShowImageSourcePicker] = useState(false);
  const [activeImageSlot, setActiveImageSlot] = useState<number | null>(null);
  const [step, setStep] = useState<'category' | 'details'>(listingToEdit ? 'details' : 'category');
  const [formData, setFormData] = useState({
    title: listingToEdit ? (language === 'ta' ? listingToEdit.titleTa : listingToEdit.titleEn) : '',
    category: listingToEdit?.category || '',
    price: listingToEdit?.price.toString() || '',
    unit: listingToEdit?.unit || 'kg',
    quantity: listingToEdit?.quantity || '',
    phone: listingToEdit?.phone || userProfile?.phone || '',
    description: listingToEdit?.description || '',
    photoEmoji: listingToEdit?.photoEmoji || '📦',
    images: listingToEdit?.images || (listingToEdit?.imageUrl ? [listingToEdit.imageUrl] : []),
    qualityGrade: listingToEdit?.qualityGrade || 'Grade A',
    harvestDate: listingToEdit?.harvestDate || new Date().toISOString().split('T')[0],
    organic: listingToEdit?.organic || false,
    minOrderQty: listingToEdit?.minOrderQty || '',
    storageType: listingToEdit?.storageType || (language === 'ta' ? 'அறை வெப்பநிலை' : 'Room Temperature')
  });
  const [errors, setErrors] = useState<any>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCategorySelect = (catId: string) => {
    const cat = CATEGORIES.find(c => c.id === catId);
    setFormData({ 
      ...formData, 
      category: catId,
      photoEmoji: cat?.emoji || '📦'
    });
    setStep('details');
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const processFile = (file: File, index: number, targetSlot: number | null) => {
      if (file.size > 1024 * 1024 * 2) { 
        alert(language === 'ta' ? `படம் ${index + 1} 2MB-க்கும் குறைவாக இருக்க வேண்டும்` : `Image ${index + 1} size must be less than 2MB`);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => {
          const newImages = [...prev.images];
          if (targetSlot !== null) {
            newImages[targetSlot] = reader.result as string;
          } else {
            // Find first empty slot or append
            const emptyIdx = newImages.findIndex(img => !img);
            if (emptyIdx !== -1 && emptyIdx < 4) {
              newImages[emptyIdx] = reader.result as string;
            } else if (newImages.length < 4) {
              newImages.push(reader.result as string);
            }
          }
          return { ...prev, images: newImages };
        });
      };
      reader.readAsDataURL(file);
    };

    const currentSlot = activeImageSlot;
    if (currentSlot !== null && files[0]) {
      processFile(files[0], 0, currentSlot);
      setActiveImageSlot(null);
    } else if (files) {
      // Handle multiple selection
      const fileArray = Array.from(files) as File[];
      fileArray.slice(0, 4 - formData.images.filter(Boolean).length).forEach((file, idx) => {
        processFile(file, idx, null);
      });
    }
    
    // Reset input
    e.target.value = '';
  };

  const removeImage = (idx: number) => {
    const newImages = [...formData.images];
    newImages.splice(idx, 1);
    setFormData({ ...formData, images: newImages });
  };

  const handleSubmit = async () => {
    const newErrors: any = {};
    if (!formData.title) newErrors.title = true;
    if (!formData.price) newErrors.price = true;
    if (!formData.phone) newErrors.phone = true;
    
    const filteredImages = formData.images.filter(img => !!img);
    if (filteredImages.length === 0) {
      alert(language === 'ta' ? 'குறைந்தபட்சம் ஒரு படத்தையாவது பதிவேற்றவும்' : 'Please upload at least one image');
      return;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    if (!userId) {
      alert(language === 'ta' ? 'நீங்கள் உள்நுழையவில்லை!' : 'You are not logged in!');
      return;
    }

    setIsSubmitting(true);
    try {
      const filteredImages = formData.images.filter(img => !!img);
      const listingData = {
        titleEn: language === 'en' ? formData.title : (listingToEdit?.titleEn || formData.title),
        titleTa: language === 'ta' ? formData.title : (listingToEdit?.titleTa || formData.title),
        category: formData.category,
        price: parseFloat(formData.price),
        unit: formData.unit,
        quantity: formData.quantity,
        phone: formData.phone,
        description: formData.description,
        qualityGrade: formData.qualityGrade,
        harvestDate: formData.harvestDate,
        organic: formData.organic,
        minOrderQty: formData.minOrderQty,
        storageType: formData.storageType,
        location: listingToEdit?.location || (userProfile?.location || 'Tamil Nadu'),
        district: listingToEdit?.district || (userProfile?.district || ''),
        subDistrict: listingToEdit?.subDistrict || (userProfile?.subDistrict || ''),
        photoEmoji: formData.photoEmoji,
        images: filteredImages,
        imageUrl: filteredImages[0] || '',
        farmerId: userId,
        farmerName: userProfile?.name || auth.currentUser?.displayName || listingToEdit?.farmerName || 'User',
        isVerified: listingToEdit?.isVerified || false,
        postedDate: listingToEdit ? listingToEdit.postedDate : 'Just now',
        views: listingToEdit?.views || 0,
        updatedAt: serverTimestamp(),
        createdAt: listingToEdit?.createdAt || serverTimestamp()
      };

      const { farmerId, createdAt, ...updateData } = listingData;
      if (listingToEdit) {
        await updateDoc(doc(db, 'listings', listingToEdit.id), {
          ...updateData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'listings'), {
          ...listingData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      onDone();
    } catch (err) {
      handleFirestoreError(err, listingToEdit ? OperationType.UPDATE : OperationType.CREATE, 'listings');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white min-h-screen">
      <div className="bg-primary text-white p-4 flex items-center gap-4">
        <button onClick={step === 'details' && !listingToEdit ? () => setStep('category') : onBack}><ChevronLeft size={24} /></button>
        <h1 className="text-xl font-bold">
          {step === 'category' 
            ? (language === 'ta' ? 'வகையைத் தேர்ந்தெடுக்கவும்' : 'Choose Category') 
            : (listingToEdit ? (language === 'ta' ? 'பதிவை மாற்ற' : 'Edit Listing') : (language === 'ta' ? 'புதிய பதிவு' : 'New Listing'))}
        </h1>
      </div>

      <AnimatePresence mode="wait">
        {step === 'category' ? (
          <motion.div 
            key="category-step"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="p-5"
          >
            <p className="text-[10px] font-black text-gray-400 mb-6 uppercase tracking-widest leading-none">
              {language === 'ta' ? 'நீங்கள் என்ன விற்கிறீர்கள்?' : 'What are you selling?'}
            </p>
            <div className="grid grid-cols-2 gap-4">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCategorySelect(cat.id)}
                  className="flex flex-col items-center gap-3 p-6 rounded-3xl border-2 border-gray-100 bg-white hover:border-primary/40 hover:shadow-lg transition-all active:scale-95 group"
                >
                  <div className={`w-16 h-16 ${cat.bgColor} rounded-2xl flex items-center justify-center text-3xl shadow-inner group-hover:scale-110 transition-transform`}>
                    {cat.emoji}
                  </div>
                  <span className="font-black text-[10px] text-gray-700 uppercase tracking-widest text-center leading-tight">
                    {language === 'ta' ? cat.labelTa : cat.labelEn}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="details-step"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="p-5 space-y-6"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">
                  {language === 'ta' ? 'தேர்ந்தெடுக்கப்பட்ட வகை' : 'Selected Category'}
                </p>
                {!listingToEdit && (
                  <button 
                    onClick={() => setStep('category')}
                    className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-1"
                  >
                    {language === 'ta' ? 'மாற்ற' : 'Change'} <ChevronRight size={12} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-2xl border border-primary/10">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-xl shadow-sm border border-primary/10">
                  {CATEGORIES.find(c => c.id === formData.category)?.emoji || '📦'}
                </div>
                <div className="font-black text-[10px] text-primary uppercase tracking-widest">
                  {language === 'ta' 
                    ? CATEGORIES.find(c => c.id === formData.category)?.labelTa 
                    : CATEGORIES.find(c => c.id === formData.category)?.labelEn}
                </div>
              </div>
            </div>

            <div className="space-y-4">
            <div className="flex items-center justify-between">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">
              {language === 'ta' ? 'படங்கள் (அதிகபட்சம் 4)' : 'Images (Max 4)'}
            </p>
            <button 
              onClick={() => {
                setActiveImageSlot(null);
                setShowImageSourcePicker(true);
              }}
              className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-1"
            >
              {language === 'ta' ? 'ஒரே நேரத்தில் சேர்க்க' : 'Add Multiple'} <Plus size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((idx) => (
              <div 
                key={idx}
                onClick={() => {
                  setActiveImageSlot(idx);
                  setShowImageSourcePicker(true);
                }}
                className={`relative aspect-square border-2 border-dashed rounded-[24px] flex flex-col items-center justify-center gap-2 overflow-hidden cursor-pointer transition-all ${
                  formData.images[idx] 
                    ? 'border-primary/20 bg-gray-50' 
                    : 'border-gray-200 bg-gray-50 hover:border-primary/40'
                }`}
              >
                {formData.images[idx] ? (
                  <>
                    <img src={formData.images[idx]} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImage(idx);
                      }}
                      className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-lg backdrop-blur-md"
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center text-gray-300 shadow-sm">
                      <Camera size={20} strokeWidth={1.5} />
                    </div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      {idx === 0 ? (language === 'ta' ? 'முதன்மை' : 'Main') : (language === 'ta' ? 'கூடுதல்' : 'More')}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
          
          <input 
            type="file" 
            ref={browseInputRef} 
            className="hidden" 
            accept="image/*" 
            multiple={activeImageSlot === null}
            onChange={handleImageChange} 
          />
          <input 
            type="file" 
            ref={cameraInputRef} 
            className="hidden" 
            accept="image/*" 
            capture="environment"
            onChange={handleImageChange} 
          />

          <AnimatePresence>
            {showImageSourcePicker && (
              <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm px-4 pb-8" onClick={() => setShowImageSourcePicker(false)}>
                <motion.div 
                  initial={{ y: 200, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 200, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-[400px] bg-white rounded-[32px] p-6 pb-2 space-y-4 shadow-2xl"
                >
                  <div className="w-12 h-1 bg-gray-100 rounded-full mx-auto mb-4" />
                  <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest text-center mb-6">
                    {language === 'ta' ? 'படத்தைச் சேர்க்கவும்' : 'Add Image / படத்தைச் சேர்க்கவும்'}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => {
                        cameraInputRef.current?.click();
                        setShowImageSourcePicker(false);
                      }}
                      className="flex flex-col items-center gap-3 p-5 rounded-3xl bg-blue-50/50 border-2 border-blue-100 hover:border-blue-400 hover:bg-blue-50 transition-all active:scale-95 group"
                    >
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-blue-600 shadow-sm group-hover:scale-110 transition-transform">
                        <Camera size={24} />
                      </div>
                      <div className="text-center">
                        <span className="block font-black text-[10px] uppercase tracking-widest text-blue-900">
                          {language === 'ta' ? 'கேமரா' : 'Camera'}
                        </span>
                        <span className="block text-[7px] font-bold text-blue-400 uppercase tracking-tight mt-0.5">Live Photo</span>
                      </div>
                    </button>
                    <button 
                      onClick={() => {
                        browseInputRef.current?.click();
                        setShowImageSourcePicker(false);
                      }}
                      className="flex flex-col items-center gap-3 p-5 rounded-3xl bg-primary/5 border-2 border-primary/10 hover:border-primary/30 hover:bg-primary/10 transition-all active:scale-95 group"
                    >
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-primary shadow-sm group-hover:scale-110 transition-transform">
                        <Images size={24} />
                      </div>
                      <div className="text-center">
                        <span className="block font-black text-[10px] uppercase tracking-widest text-primary">
                          {language === 'ta' ? 'உலாவுக' : 'Browse'}
                        </span>
                        <span className="block text-[7px] font-bold text-primary/40 uppercase tracking-tight mt-0.5">Gallery</span>
                      </div>
                    </button>
                  </div>
                  <button 
                    onClick={() => setShowImageSourcePicker(false)}
                    className="w-full py-6 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {language === 'ta' ? 'ரத்துசெய்' : 'Cancel'}
                  </button>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'விளம்பரத் தலைப்பு' : 'Listing Title'}</label>
                <input 
                  type="text" 
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder={language === 'ta' ? 'உதாரணம்: பொன்னி அரிசி' : 'e.g., Ponni Rice'} 
                  className={`w-full bg-gray-50 border-2 ${errors.title ? 'border-red-200' : 'border-gray-100'} p-4 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all`}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'விலை' : 'Price'}</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                    <input 
                      type="number" 
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      placeholder="0" 
                      className={`w-full bg-gray-50 border-2 ${errors.price ? 'border-red-200' : 'border-gray-100'} p-4 pl-8 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all`}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'அலகு' : 'Unit'}</label>
                  <select 
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full bg-gray-50 border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all appearance-none"
                  >
                    <option value="kg">kg / கிலோ</option>
                    <option value="ton">ton / டன்</option>
                    <option value="piece">piece / துண்டு</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'அளவு' : 'Available Quantity'}</label>
                <input 
                  type="text" 
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  placeholder={language === 'ta' ? 'உதாரணம்: 50 கிலோ' : 'e.g., 50 kg'} 
                  className="w-full bg-gray-50 border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'தொலைபேசி எண்' : 'Phone Number'}</label>
                <input 
                  type="tel" 
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder={language === 'ta' ? 'உங்கள் 10 இலக்க எண்' : 'Your 10-digit number'} 
                  className={`w-full bg-gray-50 border-2 ${errors.phone ? 'border-red-200' : 'border-gray-100'} p-4 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all`}
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'விளக்கம்' : 'Description'}</label>
                <textarea 
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  placeholder={language === 'ta' ? 'பொருளைப் பற்றிய கூடுதல் தகவலை இங்கே சேர்க்கவும்...' : 'Tell buyer more about your item...'} 
                  className="w-full bg-gray-50 border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all resize-none"
                ></textarea>
              </div>

              <div className="bg-gray-50 p-6 rounded-[32px] border border-gray-100 space-y-6">
                <p className="text-[10px] font-black text-primary uppercase tracking-widest leading-none text-center">
                  {language === 'ta' ? 'கூடுதல் விவரங்கள் (விருப்பமானது)' : 'Additional Details (Optional)'}
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'பொருளின் தரம்' : 'Quality Grade'}</label>
                    <select 
                      value={formData.qualityGrade}
                      onChange={(e) => setFormData({ ...formData, qualityGrade: e.target.value })}
                      className="w-full bg-white border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all"
                    >
                      <option value="Grade A">Grade A / முதல் தரம்</option>
                      <option value="Grade B">Grade B / இரண்டாம் தரம்</option>
                      <option value="Premium">Premium / உயர்தரம்</option>
                      <option value="Standard">Standard / சாதாரண தரம்</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'அறுவடை தேதி' : 'Harvest Date'}</label>
                      <input 
                        type="date"
                        value={formData.harvestDate}
                        onChange={(e) => setFormData({ ...formData, harvestDate: e.target.value })}
                        className="w-full bg-white border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'குறைந்தபட்ச ஆர்டர்' : 'Min Order'}</label>
                      <input 
                        type="text"
                        value={formData.minOrderQty}
                        onChange={(e) => setFormData({ ...formData, minOrderQty: e.target.value })}
                        placeholder="e.g. 10 kg"
                        className="w-full bg-white border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 leading-none">{language === 'ta' ? 'சேமிப்பு முறை' : 'Storage / Packaging'}</label>
                    <input 
                      type="text"
                      value={formData.storageType}
                      onChange={(e) => setFormData({ ...formData, storageType: e.target.value })}
                      placeholder="e.g. Cold Storage, Gunny Bags"
                      className="w-full bg-white border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-primary font-bold text-sm transition-all"
                    />
                  </div>

                  <label className="flex items-center gap-3 p-4 bg-white rounded-2xl border-2 border-gray-100 cursor-pointer active:scale-[0.98] transition-all">
                    <input 
                      type="checkbox"
                      checked={formData.organic}
                      onChange={(e) => setFormData({ ...formData, organic: e.target.checked })}
                      className="w-5 h-5 accent-primary"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-black text-gray-800">{language === 'ta' ? 'இது இயற்கை விவசாயமா?' : 'Is this Organic?'}</p>
                      <p className="text-[10px] text-gray-400 font-medium">{language === 'ta' ? '100% இயற்கை முறை என்றால் தேர்வு செய்யவும்' : 'Select if 100% chemical-free'}</p>
                    </div>
                  </label>
                </div>
              </div>

              <button 
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full bg-primary text-white py-5 rounded-[28px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 flex items-center justify-center gap-3 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Plus size={20} />
                    {listingToEdit ? (language === 'ta' ? 'மாற்றங்களைச் சேமி' : 'Save Changes') : (language === 'ta' ? 'விளம்பரத்தை வெளியிடுக' : 'Post AD Now')}
                  </>
                )}
              </button>
              <div className="pb-10"></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const PricesScreen = ({ language, mandiPrices, user }: { language: 'ta' | 'en', mandiPrices: any[], user: any }) => {
  const [activeTab, setActiveTab] = useState(user?.subDistrict || 'Gobichettipalayam');
  const tabs = useMemo(() => {
    const userState = user?.state || 'Tamil Nadu';
    const stateData = LOCATION_DATA.find(s => s.state === userState);
    if (stateData) {
      // Get all sub-districts from user's current district as tabs
      const districtData = stateData.districts.find(d => d.name === (user?.district || 'Erode'));
      if (districtData) return districtData.subDistricts;
    }
    return ['Gobichettipalayam', 'Erode', 'Bhavani', 'Coimbatore', 'Salem'];
  }, [user]);

  useEffect(() => {
    if (user?.subDistrict && !tabs.includes(activeTab)) {
      setActiveTab(user.subDistrict);
    }
  }, [user, tabs]);

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const displayPrices = mandiPrices;

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="bg-primary text-white p-6 pt-10 shadow-lg">
        <h1 className="text-3xl font-black leading-tight tracking-tight">
          {language === 'ta' ? 'சந்தை விலை' : 'Market Prices'}
        </h1>
        <p className="text-sm opacity-90 font-medium">
          {language === 'ta' ? `${activeTab} சந்தை நிலவரம்` : `${activeTab} Market Prices`} • {today}
        </p>
      </div>

      <div className="bg-white border-b border-gray-100 px-4">
        <div className="flex overflow-x-auto no-scrollbar gap-6 py-3">
            {tabs.map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`shrink-0 text-sm font-black pb-2 border-b-2 transition-all ${activeTab === tab ? 'text-primary border-primary' : 'text-gray-400 border-transparent'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-gray-50/50 p-3 flex justify-between items-center border-b border-gray-100 px-5">
             <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                {language === 'ta' ? 'பயிர் / Crop' : 'Crop / பயிர்'}
             </span>
             <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                {language === 'ta' ? 'விலை / Price' : 'Price / விலை'}
             </span>
          </div>
          {displayPrices.map((price: any, i: number) => (
            <div key={i} className={`p-4 px-5 flex justify-between items-center ${i !== displayPrices.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div>
                <h4 className="font-black text-gray-900 leading-tight">
                   {language === 'ta' ? price.cropTa : price.cropEn}
                </h4>
                <p className="text-[10px] text-gray-500 uppercase font-black tracking-tighter">
                   {language === 'ta' ? price.cropEn : price.cropTa} • Grade A
                </p>
              </div>
              <div className="text-right">
                <span className="text-xl font-black text-gray-900 leading-none">₹{price.modal?.toLocaleString()}</span>
                <div className={`text-[10px] font-black flex items-center justify-end gap-1 mt-0.5 ${price.change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                   {price.change > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                   {Math.abs(price.change)} {price.change > 0 ? (language === 'ta' ? 'அதிகம்' : 'Up') : (language === 'ta' ? 'குறைவு' : 'Down')}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 p-6 bg-gradient-to-br from-primary to-[#147a5a] rounded-[40px] text-white shadow-xl shadow-primary/20">
           <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-2xl font-black tracking-tight">
                   {language === 'ta' ? 'விலை நிலவரம்' : 'Price Trends'}
                </h3>
                <p className="text-xs opacity-75 font-medium">Last 7 days in {activeTab} Market</p>
              </div>
              <div className="bg-white/20 p-2 rounded-2xl">
                <TrendingUp size={24} />
              </div>
           </div>
           
           <div className="h-24 flex items-end justify-between gap-2 mt-6">
             {[40, 60, 45, 70, 85, 80, 95].map((h, i) => (
               <div key={i} className="flex-1 flex flex-col items-center gap-2">
                 <div className="w-full bg-white/30 rounded-t-xl transition-all hover:bg-white/50" style={{ height: `${h}%` }}></div>
                 <span className="text-[8px] font-black opacity-60">D-{6-i}</span>
               </div>
             ))}
           </div>
        </div>

        <button className="mt-6 w-full p-4 border-2 border-dashed border-gray-300 rounded-[32px] flex items-center justify-center gap-3 text-gray-400 hover:bg-white hover:text-primary hover:border-primary transition-all group">
          <PlusCircle size={24} className="group-hover:scale-110 transition-transform" />
          <span className="font-black text-sm uppercase tracking-wide">
             {language === 'ta' ? 'விலை அறிவிப்பைச் சேர்க்க' : 'Add Price Alert'}
          </span>
        </button>
      </div>
    </div>
  );
};

const ProfileScreen = ({ user, viewingUserId, onLogout, onNavigate, language, setLanguage, setUser }: any) => {
  const targetUserId = viewingUserId || user?.uid;
  const isOwnProfile = targetUserId === user?.uid;
  
  const [isEditing, setIsEditing] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [newReview, setNewReview] = useState({ rating: 5, comment: '' });
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  const [editForm, setEditForm] = useState({
    name: '',
    location: '',
    state: '',
    district: '',
    subDistrict: '',
    phone: '',
    photoEmoji: '👨‍🌾'
  });
  const [isSaving, setIsSaving] = useState(false);

  const availableDistricts = useMemo(() => {
    const stateData = LOCATION_DATA.find(s => s.state === editForm.state);
    return stateData ? stateData.districts : [];
  }, [editForm.state]);

  const availableSubDistricts = useMemo(() => {
    const districtData = availableDistricts.find(d => d.name === editForm.district);
    return districtData ? districtData.subDistricts : [];
  }, [editForm.district, availableDistricts]);

  useEffect(() => {
    if (!targetUserId) return;

    const fetchProfile = async () => {
      setLoading(true);
      try {
        const userRef = doc(db, 'users', targetUserId);
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setProfileData(data);
          if (isOwnProfile) {
            const defaultSubDistrict = data.subDistrict || (data.location ? data.location.split(',')[0].trim() : 'Gobichettipalayam');
            const defaultDistrict = data.district || 'Erode';
            const defaultState = data.state || 'Tamil Nadu';
            setEditForm({
              name: data.name || user.name || '',
              location: data.location || `${defaultSubDistrict}, ${defaultDistrict}`,
              state: defaultState,
              district: defaultDistrict,
              subDistrict: defaultSubDistrict,
              phone: data.phone || '',
              photoEmoji: data.photoEmoji || '👨‍🌾'
            });
          }
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();

    // Fetch reviews
    const reviewsQuery = query(
      collection(db, `users/${targetUserId}/reviews`), 
      orderBy('createdAt', 'desc')
    );
    const unsubReviews = onSnapshot(reviewsQuery, 
      (snap) => {
        const reviewList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Review));
        setReviews(reviewList);
      },
      (err) => {
        console.error("Error listening to reviews:", err);
        // Don't throw here to avoid crashing the whole ProfileScreen, but log it properly
        try {
          handleFirestoreError(err, OperationType.GET, `users/${targetUserId}/reviews`);
        } catch (e) {
          console.error(e);
        }
      }
    );

    return () => unsubReviews();
  }, [targetUserId, isOwnProfile]);

  const handleSubmitReview = async () => {
    if (!user || !targetUserId) return;
    setIsSubmittingReview(true);
    try {
      const reviewData = {
        fromUserId: user.uid,
        fromUserName: user.name || 'Anonymous',
        toUserId: targetUserId,
        rating: newReview.rating,
        comment: newReview.comment,
        createdAt: serverTimestamp()
      };
      await addDoc(collection(db, `users/${targetUserId}/reviews`), reviewData);
      
      // Update aggregate rating (simple average for now)
      const allReviews = [...reviews, { ...reviewData, createdAt: new Date() } as unknown as Review];
      const avgRating = allReviews.reduce((acc, r) => acc + r.rating, 0) / allReviews.length;
      
      await updateDoc(doc(db, 'users', targetUserId), {
        rating: Number(avgRating.toFixed(1)),
        reviewCount: allReviews.length
      });

      setShowReviewForm(false);
      setNewReview({ rating: 5, comment: '' });
    } catch (err) {
      console.error("Error submitting review:", err);
      handleFirestoreError(err, OperationType.CREATE, `users/${targetUserId}/reviews`);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleSave = async () => {
    if (!user?.uid) return;
    setIsSaving(true);
    try {
      // Update Firebase Auth Display Name
      await updateProfile(auth.currentUser!, {
        displayName: editForm.name
      });

      // Update Firestore User Document
      const finalLocation = `${editForm.subDistrict}, ${editForm.district}`;
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        name: editForm.name,
        state: editForm.state,
        district: editForm.district,
        subDistrict: editForm.subDistrict,
        location: finalLocation,
        phone: editForm.phone,
        photoEmoji: editForm.photoEmoji,
        updatedAt: serverTimestamp()
      });

      setProfileData({
        ...profileData,
        ...editForm,
        location: finalLocation
      });

      // Also update name in all listings by this user
      const listingsQuery = query(collection(db, 'listings'), where('farmerId', '==', user.uid));
      const listingsSnap = await getDocs(listingsQuery);
      const listingUpdates = listingsSnap.docs.map(d => updateDoc(doc(db, 'listings', d.id), { 
        farmerName: editForm.name,
        location: finalLocation,
        district: editForm.district,
        subDistrict: editForm.subDistrict,
        phone: editForm.phone,
        updatedAt: serverTimestamp()
      }));
      
      // Also update name in all conversations participantNames
      const convosQuery = query(collection(db, 'conversations'), where('participants', 'array-contains', user.uid));
      const convosSnap = await getDocs(convosQuery);
      const convoUpdates = convosSnap.docs.map(d => updateDoc(doc(db, 'conversations', d.id), { 
        [`participantNames.${user.uid}`]: editForm.name,
        updatedAt: serverTimestamp() 
      }));

      try {
        await Promise.all([...listingUpdates, ...convoUpdates]);
      } catch (err) {
        console.error("Error updating related documents:", err);
        // We'll catch this but not necessarily block the whole profile update if it succeeded
      }

      // Update global user state in App.tsx
      if (setUser) {
        setUser((prev: any) => ({
          ...prev,
          ...editForm,
          location: finalLocation
        }));
      }
      
      setIsEditing(false);
    } catch (err) {
      console.error("Error saving profile:", err);
      // We don't know exactly which updateDoc failed if we use catch-all, 
      // but the primary one was users
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-10">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const languages: Language[] = ['en', 'ta', 'te', 'kn', 'ml'];
  const languageNames: Record<Language, string> = {
    en: 'English',
    ta: 'தமிழ் (Tamil)',
    te: 'తెలుగు (Telugu)',
    kn: 'ಕನ್ನಡ (Kannada)',
    ml: 'മലയാളം (Malayalam)'
  };

  return (
    <div className="bg-gray-50 min-h-screen pb-10">
      <div className="bg-primary text-white p-6 pt-10 shadow-lg relative overflow-hidden">
        {/* Abstract background elements */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>

        <div className="flex justify-between items-start relative z-10">
           <button onClick={() => isOwnProfile ? onLogout() : onNavigate('Home')} className="bg-white/20 p-2 rounded-full backdrop-blur-sm hover:bg-white/30 transition-colors">
             {isOwnProfile ? <LogOut size={20} /> : <ChevronLeft size={20} />}
           </button>
           <h1 className="text-xl font-black uppercase tracking-[0.2em]">
             {isOwnProfile ? (language === 'ta' ? 'எனது விவரம்' : 'My Profile') : (language === 'ta' ? 'விவசாயி விவரம்' : 'Seller Profile')}
           </h1>
           <div className="w-10"></div>
        </div>
        
        <div className="mt-8 flex items-center gap-6 relative z-10">
          <div className="relative">
            <div className="w-24 h-24 bg-white/20 rounded-[32px] flex items-center justify-center border-2 border-white/30 text-4xl shadow-xl backdrop-blur-sm">
               {profileData?.photoEmoji || '👨‍🌾'}
            </div>
            {profileData?.isVerified && (
              <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white p-1.5 rounded-xl border-4 border-primary shadow-lg">
                <ShieldCheck size={16} fill="currentColor" />
              </div>
            )}
            {isEditing && (
              <button 
                onClick={() => {
                  const emojis = ['👨‍🌾', '👩‍🌾', '🚜', '🌱', '🌳', '🌽', '🍎', '🥕'];
                  const currentIdx = emojis.indexOf(editForm.photoEmoji);
                  setEditForm({...editForm, photoEmoji: emojis[(currentIdx + 1) % emojis.length]});
                }}
                className="absolute -top-2 -right-2 bg-white text-primary p-1.5 rounded-xl shadow-lg border-2 border-primary/10"
              >
                <PlusCircle size={16} />
              </button>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-black">{profileData?.name || user?.name}</h2>
              {profileData?.isVerified && (
                <span className="bg-blue-400 text-white text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tighter flex items-center gap-1">
                  <ShieldCheck size={8} /> Verified
                </span>
              )}
            </div>
            <p className="text-xs opacity-75 font-bold uppercase tracking-widest mt-1 flex items-center gap-1">
              <MapPin size={10} /> {profileData?.location || 'Gobichettipalayam'}
            </p>
            <p className="text-[10px] opacity-50 font-medium mt-1">
              {language === 'ta' ? 'உறுப்பினர் செப்டம்பர் 2023 முதல்' : `Member since ${profileData?.memberSince || 'May 2026'}`}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6 -mt-4 relative z-20">
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: language === 'ta' ? 'பதிவுகள்' : 'Listings', value: profileData?.activeListings || '0', icon: <BarChart2 size={16} /> },
            { label: language === 'ta' ? 'மதிப்பீடு' : 'Rating', value: profileData?.rating || '0.0', icon: <Star size={16} />, sub: `(${reviews.length})` },
          ].map((stat, i) => (
            <div key={i} className="bg-white p-4 rounded-[32px] border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
               <div className="text-primary mb-1 opacity-40">{stat.icon}</div>
               <p className="text-2xl font-black text-gray-900 leading-none">{stat.value}</p>
               <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-2">{stat.label} {stat.sub && <span className="opacity-50">{stat.sub}</span>}</p>
            </div>
          ))}
        </div>

        {isEditing ? (
          <div className="bg-white p-6 rounded-[40px] border border-gray-100 shadow-xl space-y-5">
            <div className="flex justify-between items-center mb-2">
               <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">
                 {language === 'ta' ? 'சுயவிவரத்தை மாற்றுக' : 'Edit Profile'}
               </h3>
               <button onClick={() => setIsEditing(false)} className="text-gray-400 underline text-[10px] font-bold">
                 {language === 'ta' ? 'ரத்து' : 'Cancel'}
               </button>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'ta' ? 'பெயர்' : 'FullName'}</label>
                <div className="relative">
                  <UserIcon size={16} className="absolute left-3 top-3 text-gray-300" />
                  <input 
                    type="text" 
                    className="w-full p-3 pl-10 bg-gray-50 border border-gray-100 rounded-2xl outline-primary font-bold text-sm"
                    value={editForm.name}
                    onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                  />
                </div>
              </div>

              {/* Location Fields */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'ta' ? 'மாநிலம்' : 'State'}</label>
                  <select 
                    className="w-full p-3 bg-gray-50 border border-gray-100 rounded-2xl outline-primary font-bold text-sm"
                    value={editForm.state}
                    onChange={(e) => setEditForm({...editForm, state: e.target.value, district: '', subDistrict: '', location: ''})}
                  >
                    <option value="">Select State</option>
                    {LOCATION_DATA.map(s => <option key={s.state} value={s.state}>{s.state}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'ta' ? 'மாவட்டம்' : 'District'}</label>
                  <select 
                    className="w-full p-3 bg-gray-50 border border-gray-100 rounded-2xl outline-primary font-bold text-sm disabled:opacity-50"
                    disabled={!editForm.state}
                    value={editForm.district}
                    onChange={(e) => setEditForm({...editForm, district: e.target.value, subDistrict: '', location: ''})}
                  >
                    <option value="">Select District</option>
                    {availableDistricts.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'ta' ? 'வட்டம்' : 'Sub-District'}</label>
                  <select 
                    className="w-full p-3 bg-gray-50 border border-gray-100 rounded-2xl outline-primary font-bold text-sm disabled:opacity-50"
                    disabled={!editForm.district}
                    value={editForm.subDistrict}
                    onChange={(e) => {
                      const nextSub = e.target.value;
                      setEditForm({
                        ...editForm,
                        subDistrict: nextSub,
                        location: nextSub ? `${nextSub}, ${editForm.district}` : ''
                      });
                    }}
                  >
                    <option value="">Select Area</option>
                    {availableSubDistricts.map(sd => <option key={sd} value={sd}>{sd}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'ta' ? 'தொலைபேசி' : 'Phone'}</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-3 text-gray-300" />
                  <input 
                    type="tel" 
                    placeholder="9876543210"
                    className="w-full p-3 pl-10 bg-gray-50 border border-gray-100 rounded-2xl outline-primary font-bold text-sm"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                  />
                </div>
              </div>

              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="w-full bg-primary text-white py-4 rounded-3xl font-black shadow-lg shadow-primary/20 uppercase tracking-widest text-sm flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <ShieldCheck size={18} />
                    {language === 'ta' ? 'சேமிக்கவும்' : 'Save Profile'}
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Reviews Section */}
            <div className="space-y-4">
               <div className="flex justify-between items-center px-1">
                 <h3 className="font-black text-gray-900 italic uppercase tracking-wider text-xs">
                   {language === 'ta' ? 'மதிப்பாய்வுகள்' : 'Reviews'} 
                   <span className="ml-2 text-gray-400 font-normal">({reviews.length})</span>
                 </h3>
                 {!isOwnProfile && !showReviewForm && (
                   <button 
                     onClick={() => setShowReviewForm(true)}
                     className="text-primary font-black text-[10px] uppercase tracking-widest flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-full"
                   >
                     <PlusCircle size={12} /> {language === 'ta' ? 'மதிப்பாய்வைச் சேர்' : 'Add Review'}
                   </button>
                 )}
               </div>

               {showReviewForm && (
                 <div className="bg-white p-5 rounded-[32px] border border-primary/20 shadow-xl space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Rate your experience</span>
                      <button onClick={() => setShowReviewForm(false)} className="text-gray-400"><X size={16} /></button>
                    </div>
                    <div className="flex justify-center gap-2">
                       {[1, 2, 3, 4, 5].map((s) => (
                         <button 
                           key={s} 
                           onClick={() => setNewReview({...newReview, rating: s})}
                           className={`p-2 rounded-xl transition-all ${newReview.rating >= s ? 'text-yellow-500 bg-yellow-50' : 'text-gray-300 bg-gray-50'}`}
                         >
                           <Star size={24} fill={newReview.rating >= s ? 'currentColor' : 'none'} />
                         </button>
                       ))}
                    </div>
                    <textarea 
                      placeholder={language === 'ta' ? 'உங்கள் கருத்தை இங்கே பதிவிடவும்...' : 'Tell us about your experience...'}
                      className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-primary font-medium text-sm min-h-[100px]"
                      value={newReview.comment}
                      onChange={(e) => setNewReview({...newReview, comment: e.target.value})}
                    />
                    <button 
                      disabled={isSubmittingReview}
                      onClick={handleSubmitReview}
                      className="w-full bg-primary text-white py-4 rounded-2xl font-black shadow-lg shadow-primary/20 uppercase tracking-widest text-xs flex items-center justify-center gap-2"
                    >
                      {isSubmittingReview ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Submit Review'}
                    </button>
                 </div>
               )}

               {reviews.length === 0 ? (
                 <div className="bg-white p-8 rounded-[32px] border border-dashed border-gray-200 text-center">
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No reviews yet</p>
                 </div>
               ) : (
                 <div className="space-y-3">
                    {reviews.map(r => (
                      <div key={r.id} className="bg-white p-4 rounded-[32px] border border-gray-100 shadow-sm space-y-2">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-primary/10 rounded-xl flex items-center justify-center font-black text-primary text-xs uppercase">
                              {r.fromUserName?.charAt(0) || 'U'}
                            </div>
                            <span className="text-xs font-black text-gray-900">{r.fromUserName}</span>
                          </div>
                          <div className="flex text-yellow-500">
                            {[...Array(5)].map((_, i) => (
                              <Star key={i} size={12} fill={i < r.rating ? 'currentColor' : 'none'} className={i < r.rating ? 'text-yellow-500' : 'text-gray-200'} />
                            ))}
                          </div>
                        </div>
                        {r.comment && <p className="text-xs text-gray-600 leading-relaxed font-medium">{r.comment}</p>}
                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-[0.2em] mt-1">
                          {new Date(r.createdAt?.toDate?.() || r.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                 </div>
               )}
            </div>

            {isOwnProfile && (
              <div className="space-y-3">
                <div className="flex justify-between items-center px-1">
                  <h3 className="font-black text-gray-900 italic">
                    {language === 'ta' ? 'அமைப்புகள்' : 'Settings'}
                  </h3>
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="text-primary font-black text-[10px] uppercase tracking-widest flex items-center gap-1"
                  >
                    <Pencil size={12} /> {language === 'ta' ? 'மாற்ற' : 'Edit'}
                  </button>
                </div>
                <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">

                   <button 
                      onClick={() => onNavigate('SellerDashboard')}
                      className="w-full p-5 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-50"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
                          <BarChart2 size={20} />
                        </div>
                        <div className="text-left">
                          <span className="text-sm font-black text-gray-900 block leading-none">
                            {language === 'ta' ? 'விற்பனையாளர் பக்கம்' : 'Seller Dashboard'}
                          </span>
                          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1 block">My active listings</span>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-gray-300" />
                    </button>
                  {[
                    { icon: <MessageSquare size={20} />, label: language === 'ta' ? 'செய்திகள்' : 'Messages', id: 'chats', sub: language === 'ta' ? 'உரையாடல்கள்' : 'Alerts & news' },
                    { icon: <Bookmark size={20} />, label: language === 'ta' ? 'சேமித்தவை' : 'Saved', id: 'saved', sub: 'Watchlist' },
                    { icon: <Globe size={20} />, label: language === 'ta' ? 'மொழி / Language' : 'Language Selection', id: 'language', sub: languageNames[language] },
                    { icon: <HelpCircle size={20} />, label: language === 'ta' ? 'உதவி' : 'Help center', id: 'help', sub: 'Contact support' },
                  ].map((item, i, arr) => (
                    <button 
                      key={i} 
                      onClick={() => {
                        if (item.id === 'chats') onNavigate('ChatList');
                        if (item.id === 'saved') onNavigate('Wishlist');
                        if (item.id === 'language') {
                          const nextLang = languages[(languages.indexOf(language) + 1) % languages.length];
                          setLanguage(nextLang);
                          if (isOwnProfile && user?.uid) {
                            const userRef = doc(db, 'users', user.uid);
                            updateDoc(userRef, { language: nextLang }).catch(err => console.error("Error setting language in profile:", err));
                          }
                        }
                      }}
                      className={`w-full p-5 flex items-center justify-between hover:bg-gray-50 transition-colors ${i !== arr.length - 1 ? 'border-b border-gray-50' : ''}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-gray-50 border border-gray-100 rounded-xl flex items-center justify-center text-gray-400">
                          {item.icon}
                        </div>
                        <div className="text-left">
                          <span className="text-sm font-black text-gray-900 block leading-none">{item.label}</span>
                          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1 block">{item.sub}</span>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-gray-300" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isOwnProfile && !isEditing && (
          <button 
            onClick={onLogout}
            className="w-full p-5 bg-red-50 text-red-600 rounded-[40px] font-black uppercase tracking-[0.2em] text-[10px] shadow-sm shadow-red-100 flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <LogOut size={16} />
            {language === 'ta' ? 'வெளியேறு' : 'Logout System'}
          </button>
        )}
      </div>
    </div>
  );
};

const SearchScreen = ({ 
  onBack, 
  onNavigate, 
  query, 
  language, 
  listings, 
  user,
  activeSubDistrict,
  setActiveSubDistrict,
  activeCategory,
  setActiveCategory,
  wishlist = [],
  toggleWishlist
}: any) => {
  const [localQuery, setLocalQuery] = useState(query || '');

  const subDistricts = useMemo(() => {
    let selectedLoc = activeSubDistrict || user?.subDistrict || user?.location || user?.district || user?.state || '';
    if (selectedLoc.includes(',')) {
      selectedLoc = selectedLoc.split(',')[0].trim();
    }

    const userState = user?.state || 'Tamil Nadu';
    const userDistrict = user?.district || (userState === 'Karnataka' ? 'Bangalore' : 'Erode');
    const stateData = LOCATION_DATA.find(s => s.state === userState);
    
    let baseList = ['Gobichettipalayam', 'Erode', 'Bhavani', 'Coimbatore', 'Salem'];
    if (stateData) {
      const districtData = stateData.districts.find(d => d.name === userDistrict);
      if (districtData) {
        baseList = [...districtData.subDistricts];
      }
    }

    let list = [...baseList];
    if (selectedLoc) {
      const normalizedSel = selectedLoc.trim();
      if (normalizedSel) {
        // Find if an existing item matches (case insensitive check)
        const existingIdx = list.findIndex(item => item.toLowerCase() === normalizedSel.toLowerCase());
        if (existingIdx > -1) {
          // Remove the existing item
          const [matched] = list.splice(existingIdx, 1);
          // Insert at the beginning of the list
          list.unshift(matched);
        } else {
          // Prepend the new selected location
          list.unshift(normalizedSel);
        }
      }
    }

    // Keep unique values, preserving order
    return Array.from(new Set(list));
  }, [user?.state, user?.district, user?.subDistrict, user?.location, user?.district, user?.state, activeSubDistrict]);

  const results = listings.filter((l: any) => {
      const q = localQuery.toLowerCase();
      const matchesText = (l.titleEn?.toLowerCase().includes(q) || l.titleTa?.toLowerCase().includes(q));
      const matchesSubDistrict = !activeSubDistrict || l.location?.toLowerCase().includes(activeSubDistrict.toLowerCase());
      const matchesCategory = !activeCategory || l.category === activeCategory;
      
      return matchesText && matchesSubDistrict && matchesCategory;
  }) || [];

  const displayResults = results;

  return (
    <div className="bg-white min-h-screen">
      <div className="bg-white border-b border-gray-100 p-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors"><ChevronLeft size={24} /></button>
          <div className="flex-1 flex items-center gap-2 bg-gray-100 p-3 rounded-2xl border border-gray-200 focus-within:border-primary transition-all">
             <Search size={18} className="text-primary" />
             <input 
               autoFocus 
               placeholder={language === 'ta' ? 'தேடுக...' : 'Search...'} 
               className="bg-transparent outline-none flex-1 text-sm font-black" 
               value={localQuery}
               onChange={(e) => setLocalQuery(e.target.value)}
             />
          </div>
          <button onClick={onBack} className="text-primary font-black text-xs uppercase tracking-wider">
            {language === 'ta' ? 'ரத்து' : 'Cancel'}
          </button>
        </div>
      </div>

      <div className="px-4 py-3 bg-white border-b border-gray-100 sticky top-[73px] z-40 space-y-3">
        {/* Sub District Selector */}
        <div className="flex overflow-x-auto no-scrollbar gap-2 py-1">
          <button 
            onClick={() => setActiveSubDistrict(null)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeSubDistrict === null ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-gray-50 text-gray-400 border border-gray-100'}`}
          >
            {language === 'ta' ? 'அனைத்தும்' : 'All'}
          </button>
          {subDistricts.map(sd => (
            <button 
              key={sd}
              onClick={() => setActiveSubDistrict(sd)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeSubDistrict === sd ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-gray-50 text-gray-400 border border-gray-100'}`}
            >
              {sd}
            </button>
          ))}
        </div>

        {/* Category Selector */}
        <div className="flex overflow-x-auto no-scrollbar gap-2 py-1">
          <button 
            onClick={() => setActiveCategory(null)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeCategory === null ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-gray-50 text-gray-400 border border-gray-100'}`}
          >
            {language === 'ta' ? 'அனைத்தும்' : 'All'}
          </button>
          {CATEGORIES.map(cat => (
            <button 
              key={cat.id}
              onClick={() => setActiveCategory(prev => prev === cat.id ? null : cat.id)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeCategory === cat.id ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-gray-50 text-gray-400 border border-gray-100'}`}
            >
              {cat.emoji} {language === 'ta' ? cat.labelTa : cat.labelEn}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 bg-gray-50/30">
         <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 ml-1">
           {language === 'ta' ? `${displayResults.length} பொருத்தங்கள்` : `${displayResults.length} results found`}
         </p>
         
         <div className="grid grid-cols-2 gap-4">
            {displayResults.map((listing: any, i: number) => (
              <motion.div 
                key={`${listing.id}-${i}`}
                whileTap={{ scale: 0.98 }}
                onClick={() => onNavigate('Detail', listing)}
                className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col group p-2 pb-3"
              >
                <div className="aspect-square bg-gradient-to-br from-green-50 to-green-100 rounded-3xl flex items-center justify-center text-4xl relative shadow-inner overflow-hidden">
                   <motion.div 
                     whileHover={{ scale: 1.1 }}
                     className="w-full h-full flex items-center justify-center"
                   >
                     {listing.imageUrl ? (
                       <img src={listing.imageUrl} alt={listing.titleEn} className="w-full h-full object-cover" />
                     ) : (
                       listing.photoEmoji
                     )}
                   </motion.div>
                   <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWishlist(listing.id);
                      }}
                      className="absolute top-2 right-2 w-7 h-7 bg-white/90 rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform z-10"
                    >
                      <Heart size={14} className={wishlist.includes(listing.id) ? 'fill-red-500 text-red-500' : 'text-gray-400'} />
                    </button>
                   <div className="absolute top-2 left-2 bg-white/90 p-1.5 rounded-xl backdrop-blur-md shadow-sm border border-white">
                     <CheckCircle2 size={12} className="text-blue-500 fill-blue-500 text-white" />
                   </div>
                </div>
                <div className="p-2 space-y-1">
                   <h3 className="font-black text-gray-800 text-[11px] leading-tight line-clamp-1">{listing.titleTa} / {listing.titleEn}</h3>
                   <p className="text-primary font-black text-sm">₹{listing.price + (i * 2)}/kg</p>
                   <div className="flex items-center gap-1 text-[9px] font-black text-gray-400 uppercase tracking-tighter">
                     <MapPin size={10} /> {listing.location}
                   </div>
                   <p className="text-[8px] text-gray-400 font-bold mt-1">2 hours ago</p>
                </div>
              </motion.div>
            ))}
         </div>

         <button className="mt-10 w-full py-4 border-2 border-primary rounded-[32px] text-primary font-black uppercase tracking-widest text-xs hover:bg-primary/5 transition-all">
           அதிகம் காட்டு / Load More
         </button>
      </div>
    </div>
  );
};

const getMessageDate = (timestamp: any): Date => {
  if (!timestamp) return new Date();
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  if (timestamp.seconds) {
    return new Date(timestamp.seconds * 1000);
  }
  if (timestamp instanceof Date) {
    return timestamp;
  }
  const d = new Date(timestamp);
  if (!isNaN(d.getTime())) return d;
  return new Date();
};

const formatPreciseDateTime = (timestamp: any, lang: 'en' | 'ta' = 'en'): string => {
  const date = getMessageDate(timestamp);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const dDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const isToday = dDate.getTime() === today.getTime();
  const isYesterday = dDate.getTime() === yesterday.getTime();

  if (isToday) {
    return lang === 'ta' ? `இன்று, ${timeStr}` : `Today, ${timeStr}`;
  } else if (isYesterday) {
    return lang === 'ta' ? `நேற்று, ${timeStr}` : `Yesterday, ${timeStr}`;
  } else {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (date.getFullYear() !== now.getFullYear()) {
      options.year = 'numeric';
    }
    const dateStr = date.toLocaleDateString(lang === 'ta' ? 'ta-IN' : 'en-US', options);
    return `${dateStr}, ${timeStr}`;
  }
};

const formatMessageTime = (msg: any): string => {
  if (!msg.createdAt) {
    return msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const date = getMessageDate(msg.createdAt);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const getFriendlyDateBanner = (timestamp: any, lang: 'en' | 'ta' = 'en'): string => {
  const date = getMessageDate(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const dDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dDate.getTime() === today.getTime()) {
    return lang === 'ta' ? 'இன்று' : 'Today';
  } else if (dDate.getTime() === yesterday.getTime()) {
    return lang === 'ta' ? 'நேற்று' : 'Yesterday';
  } else {
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString(lang === 'ta' ? 'ta-IN' : 'en-US', options);
  }
};

const ChatListScreen = ({ conversations, onNavigate, onBack, language }: { conversations: Conversation[], onNavigate: any, onBack: () => void, language: 'ta' | 'en' }) => {
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Global click-listener to close convo dropdown on any outside click
  useEffect(() => {
    if (!activeMenuId) return;
    const handleGlobalClickConvo = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) {
        return;
      }
      setActiveMenuId(null);
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', handleGlobalClickConvo);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleGlobalClickConvo);
    };
  }, [activeMenuId]);

  const currentUserId = auth.currentUser?.uid || '';

  // 1. Filter out deleted conversations
  const filteredConvos = conversations.filter(convo => !convo.deletedUsers?.[currentUserId]);

  // 2. Separate active vs archived
  const activeConvos = filteredConvos.filter(convo => !convo.archivedUsers?.[currentUserId]);
  const archivedConvos = filteredConvos.filter(convo => convo.archivedUsers?.[currentUserId] === true);

  // 3. Selection based on activeTab
  const tabConvos = activeTab === 'active' ? activeConvos : archivedConvos;

  // 4. Sort: Important (Starred) chats float to top, then sorted by updatedAt desc
  const sortedConvos = [...tabConvos].sort((a, b) => {
    const aImp = a.importantUsers?.[currentUserId] || a.isPinned || false;
    const bImp = b.importantUsers?.[currentUserId] || b.isPinned || false;

    if (aImp && !bImp) return -1;
    if (!aImp && bImp) return 1;

    const aTime = getMessageDate(a.updatedAt).getTime();
    const bTime = getMessageDate(b.updatedAt).getTime();
    return bTime - aTime;
  });

  // Toggle Important (float to top)
  const handleToggleImportant = async (convo: any) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const isImp = convo.importantUsers?.[uid] || convo.isPinned || false;
    try {
      await updateDoc(doc(db, 'conversations', convo.id), {
        [`importantUsers.${uid}`]: !isImp
      });
      setActiveMenuId(null);
    } catch (e) {
      console.error("Error toggling important:", e);
    }
  };

  // Toggle Archive
  const handleToggleArchive = async (convo: any) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const isArch = convo.archivedUsers?.[uid] || false;
    try {
      await updateDoc(doc(db, 'conversations', convo.id), {
        [`archivedUsers.${uid}`]: !isArch
      });
      setActiveMenuId(null);
    } catch (e) {
      console.error("Error toggling archive:", e);
    }
  };

  // Confirm delete conversation (marks as deleted for this user)
  const handleConfirmDelete = async (convo: any) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    try {
      await updateDoc(doc(db, 'conversations', convo.id), {
        [`deletedUsers.${uid}`]: true
      });
      setConfirmDeleteId(null);
      setActiveMenuId(null);
    } catch (e) {
      console.error("Error deleting conversation:", e);
    }
  };

  // Mark all incoming messages as delivered when the list is viewed
  useEffect(() => {
    if (!auth.currentUser) return;
    
    conversations.forEach(async (convo) => {
      if (convo.unreadCount > 0 && convo.lastMessageSenderId !== auth.currentUser?.uid) {
        // Find messages in this conversation that are not delivered
        const qMessages = query(
          collection(db, 'conversations', convo.id, 'messages'),
          where('senderId', '!=', auth.currentUser?.uid),
          where('isDelivered', '==', false)
        );
        
        try {
          const snap = await getDocs(qMessages);
          snap.docs.forEach(messageDoc => {
            updateDoc(doc(db, 'conversations', convo.id, 'messages', messageDoc.id), {
              isDelivered: true
            });
          });
        } catch (e) {
          console.error("Error marking as delivered in list:", e);
        }
      }
    });
  }, [conversations]);

  return (
    <div className="bg-gray-50 min-h-screen relative">
      <AnimatePresence>
        {activeMenuId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setActiveMenuId(null);
              setConfirmDeleteId(null);
            }}
            className="fixed inset-0 bg-black/40 backdrop-blur-md z-20 pointer-events-auto"
            style={{ willChange: 'opacity, backdrop-filter' }}
          />
        )}
      </AnimatePresence>

      <div className="bg-primary text-white p-6 pt-10 shadow-lg flex items-center gap-4">
        <button onClick={onBack} className="bg-white/20 p-2 rounded-full backdrop-blur-sm">
          <ChevronLeft size={24} />
        </button>
        <div>
          <h1 className="text-2xl font-black tracking-tight">{language === 'ta' ? 'எனது உரையாடல்கள்' : 'My Conversations'}</h1>
          <p className="text-xs opacity-90 font-medium">{language === 'ta' ? 'அரட்டைகள் மற்றும் செய்திகள்' : 'Chats & Messages'}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-4">
        <div className="flex bg-gray-100 p-1 rounded-2xl w-full">
          <button 
            onClick={() => {
              setActiveTab('active');
              setActiveMenuId(null);
            }}
            className={`flex-1 py-2 px-4 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'active' 
                ? 'bg-white text-primary shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span>{language === 'ta' ? 'அரட்டைகள்' : 'Active Chats'}</span>
            {activeConvos.length > 0 && (
              <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-bold">
                {activeConvos.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => {
              setActiveTab('archived');
              setActiveMenuId(null);
            }}
            className={`flex-1 py-2 px-4 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'archived' 
                ? 'bg-white text-primary shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span>{language === 'ta' ? 'காப்பகப்படுத்தப்பட்டவை' : 'Archived'}</span>
            {archivedConvos.length > 0 && (
              <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
                {archivedConvos.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="p-4 pt-0 space-y-3">
        {sortedConvos.length === 0 ? (
          <div className="p-10 text-center space-y-4">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-300">
              <MessageCircle size={40} />
            </div>
            <p className="text-gray-500 font-bold">
              {activeTab === 'archived'
                ? (language === 'ta' ? 'காப்பகப்படுத்தப்பட்ட அரட்டைகள் இல்லை' : 'No archived chats!')
                : (language === 'ta' ? 'உரையாடல்கள் இல்லை' : 'No active chats yet!')}
            </p>
          </div>
        ) : (
          sortedConvos.map(convo => {
            const isStarred = convo.importantUsers?.[currentUserId] || convo.isPinned || false;
            return (
              <motion.div 
                key={convo.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => onNavigate('ChatRoom', convo)}
                className={`bg-white p-4 rounded-[32px] border shadow-sm flex items-center gap-4 relative ${
                  activeMenuId === convo.id ? 'z-30 shadow-md' : 'z-10'
                } ${
                  isStarred ? 'border-amber-200 bg-amber-50/20' : 'border-gray-100'
                }`}
              >
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center font-black text-primary text-xl relative shrink-0">
                  <UserName 
                    userId={convo.participants?.find(p => p !== auth.currentUser?.uid) || ''} 
                    fallback={convo.participantAvatar} 
                    type="emoji"
                  />
                  {isStarred && (
                    <div className="absolute -top-1 -right-1 bg-amber-400 text-white p-0.5 rounded-full shadow-sm">
                      <Star size={10} className="fill-white text-white" />
                    </div>
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center gap-1">
                    <h4 className="font-black text-gray-900 truncate flex items-center gap-1">
                      {convo.participants && auth.currentUser ? (
                        <UserName 
                          userId={convo.participants.find(p => p !== auth.currentUser?.uid) || ''} 
                          fallback={convo.participantName} 
                        />
                      ) : (
                        convo.participantName
                      )}
                    </h4>
                    <span className="text-[10px] text-gray-400 font-bold shrink-0">{formatPreciseDateTime(convo.updatedAt, language)}</span>
                  </div>
                  {(() => {
                    const otherUid = convo.participants?.find(p => p !== auth.currentUser?.uid);
                    const typingTime = convo.typing?.[otherUid || ''];
                    const isTyping = typingTime && (Date.now() - typingTime < 5000);
                    
                    return isTyping ? (
                      <p className="text-xs text-primary font-black animate-pulse flex items-center gap-1 mt-1">
                        {language === 'ta' ? 'தட்டச்சு செய்கிறது...' : 'Typing...'}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 truncate mt-1 leading-tight">{convo.lastMessage}</p>
                    );
                  })()}
                </div>

                {convo.unreadCount > 0 && convo.lastMessageSenderId !== auth.currentUser?.uid && (
                  <div className="w-5 h-5 bg-primary text-white text-[10px] font-black rounded-full flex items-center justify-center shrink-0">
                    {convo.unreadCount}
                  </div>
                )}

                {/* Dropdown Options dots */}
                <div className="relative z-20 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button 
                    onClick={() => {
                      setConfirmDeleteId(null);
                      setActiveMenuId(activeMenuId === convo.id ? null : convo.id);
                    }}
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <MoreVertical size={18} />
                  </button>
                  {activeMenuId === convo.id && (
                    <div ref={menuRef} className="absolute right-0 mt-2 w-48 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 p-2 text-sm font-bold text-gray-700">
                      {confirmDeleteId === convo.id ? (
                          <div className="p-2 space-y-2 text-center">
                            <p className="text-xs text-red-600 font-bold">
                              {language === 'ta' ? 'இந்த அரட்டையை அழிக்கவா?' : 'Delete this chat?'}
                            </p>
                            <div className="flex gap-2 justify-center">
                              <button 
                                onClick={() => handleConfirmDelete(convo)}
                                className="bg-red-500 text-white px-3 py-1.5 rounded-xl text-xs hover:bg-red-600 transition-colors"
                              >
                                {language === 'ta' ? 'ஆம்' : 'Yes'}
                              </button>
                              <button 
                                onClick={() => {
                                  setConfirmDeleteId(null);
                                  setActiveMenuId(null);
                                }}
                                className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-xl text-xs hover:bg-gray-200 transition-colors"
                              >
                                {language === 'ta' ? 'இல்லை' : 'No'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            {/* Star / Important toggle option */}
                            <button 
                              onClick={() => handleToggleImportant(convo)}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 text-left transition-colors"
                            >
                              <Star size={16} className={isStarred ? "fill-amber-400 text-amber-500" : "text-gray-400"} />
                              <span>
                                {isStarred 
                                  ? (language === 'ta' ? 'முக்கியமற்றதாக்கு' : 'Unmark Important') 
                                  : (language === 'ta' ? 'முக்கியமானதாக்கு' : 'Mark as Important')}
                              </span>
                            </button>

                            {/* Archive toggle option */}
                            <button 
                              onClick={() => handleToggleArchive(convo)}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 text-left transition-colors"
                            >
                              <Archive size={16} className="text-gray-400" />
                              <span>
                                {activeTab === 'archived'
                                  ? (language === 'ta' ? 'மீட்டமை' : 'Unarchive')
                                  : (language === 'ta' ? 'காப்பகப்படுத்து' : 'Archive')}
                              </span>
                            </button>

                            {/* Delete option trigger */}
                            <button 
                              onClick={() => setConfirmDeleteId(convo.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-red-50 text-red-600 text-left transition-colors border-t border-gray-100/60 mt-0.5"
                            >
                              <Trash size={16} />
                              <span>{language === 'ta' ? 'அழிக்கவும்' : 'Delete Chat'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                  )}
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
};

const ChatRoomScreen = ({ conversation, onSendMessage, onBack, onViewProfile, language }: { 
  conversation: Conversation, 
  onSendMessage: (text: string) => void,
  onBack: () => void,
  onViewProfile?: (userId: string) => void,
  language: 'ta' | 'en'
}) => {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [otherUserStatus, setOtherUserStatus] = useState<{ isOnline?: boolean, lastActive?: any } | null>(null);
  const [activeMessageMenuId, setActiveMessageMenuId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [confirmHeaderDelete, setConfirmHeaderDelete] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const skipNextTypingUpdate = useRef(false);
  const isUserTyping = useRef(false);
  
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);

  // Clear typing status on unmount
  useEffect(() => {
    return () => {
      if (conversation.id && auth.currentUser) {
        const convoDocRef = doc(db, 'conversations', conversation.id);
        updateDoc(convoDocRef, {
          [`typing.${auth.currentUser.uid}`]: null
        }).catch((e) => console.warn("Could not clear typing status on unmount", e));
      }
    };
  }, [conversation.id]);

  // Global click-listener to close message dropdown on any outside click
  useEffect(() => {
    if (!activeMessageMenuId) return;
    const handleGlobalClickMessage = (e: MouseEvent) => {
      if (messageMenuRef.current && messageMenuRef.current.contains(e.target as Node)) {
        return;
      }
      setActiveMessageMenuId(null);
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', handleGlobalClickMessage);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleGlobalClickMessage);
    };
  }, [activeMessageMenuId]);

  // Global click-listener to close header dropdown on any outside click In Chat Room
  useEffect(() => {
    if (!headerMenuOpen) return;
    const handleGlobalClickHeader = (e: MouseEvent) => {
      if (headerMenuRef.current && headerMenuRef.current.contains(e.target as Node)) {
        return;
      }
      setHeaderMenuOpen(false);
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', handleGlobalClickHeader);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleGlobalClickHeader);
    };
  }, [headerMenuOpen]);

  useEffect(() => {
    if (conversation.initialMessage) {
      setInputText(conversation.initialMessage);
    }
  }, [conversation.initialMessage]);

  // Real-time listener for the other user's online and active status
  useEffect(() => {
    const otherParticipantId = conversation.participants?.find(p => p !== auth.currentUser?.uid);
    if (!otherParticipantId) return;

    const unsubscribeStatus = onSnapshot(doc(db, 'users', otherParticipantId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setOtherUserStatus({
          isOnline: data.isOnline,
          lastActive: data.lastActive
        });
      }
    }, (err) => {
      console.warn("Could not load other user status:", err);
    });

    return () => unsubscribeStatus();
  }, [conversation.id, conversation.participants]);

  // Determine if the user is currently online (heartbeat within 60 seconds)
  const isOnline = useMemo(() => {
    if (!otherUserStatus) return false;
    if (otherUserStatus.isOnline !== true) return false;
    if (!otherUserStatus.lastActive) return false;
    
    let lastActiveMs = 0;
    const la = otherUserStatus.lastActive;
    if (la.toDate) {
      lastActiveMs = la.toDate().getTime();
    } else if (la.seconds) {
      lastActiveMs = la.seconds * 1000;
    } else {
      lastActiveMs = Number(la);
    }
    
    if (isNaN(lastActiveMs)) return false;
    
    // Deem active if the last active timestamp is less than 60 seconds old
    return (Date.now() - lastActiveMs) < 60000;
  }, [otherUserStatus]);

  // Helper function to format the last active timestamp precisely
  const formatLastSeen = (timestamp: any, lang: 'en' | 'ta' = 'en'): string => {
    if (!timestamp) return lang === 'ta' ? 'ஆஃப்லைனில்' : 'Offline';
    const date = getMessageDate(timestamp);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const dDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (dDate.getTime() === today.getTime()) {
      return lang === 'ta' ? `இன்று, ${timeStr}` : `Active today at ${timeStr}`;
    } else if (dDate.getTime() === yesterday.getTime()) {
      return lang === 'ta' ? `நேற்று, ${timeStr}` : `Active yesterday at ${timeStr}`;
    } else {
      const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
      if (date.getFullYear() !== now.getFullYear()) {
        options.year = 'numeric';
      }
      const dateStr = date.toLocaleDateString(lang === 'ta' ? 'ta-IN' : 'en-US', options);
      return lang === 'ta' ? `${dateStr}, ${timeStr}` : `last active ${dateStr} at ${timeStr}`;
    }
  };

  // Filter out messages that have been deleted or archived by the current user
  const visibleMessages = useMemo(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return messages;
    return messages.filter(msg => !msg.deletedForUsers?.[uid] && !msg.archivedForUsers?.[uid]);
  }, [messages]);

  // Read Receipts & Messages Subscription
  useEffect(() => {
    if (!conversation.id || !auth.currentUser) return;

    // Reset unread count for this conversation
    const resetUnread = async () => {
      try {
        const convoRef = doc(db, 'conversations', conversation.id);
        const snap = await getDoc(convoRef);
        if (snap.exists() && snap.data().unreadCount > 0 && snap.data().lastMessageSenderId !== auth.currentUser?.uid) {
          await updateDoc(convoRef, { unreadCount: 0 });
        }
      } catch (e) {
        console.error("Error resetting unread count:", e);
      }
    };
    resetUnread();

    const msgsQuery = query(
      collection(db, 'conversations', conversation.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(msgsQuery, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setMessages(docs);
      
      // Mark unseen messages from other participant as delivered and read
      docs.forEach(async (msg) => {
        if (msg.senderId !== auth.currentUser?.uid) {
          const updates: any = {};
          if (!msg.isDelivered) updates.isDelivered = true;
          if (!msg.isRead) updates.isRead = true;
          
          if (Object.keys(updates).length > 0) {
            try {
              await updateDoc(doc(db, 'conversations', conversation.id!, 'messages', msg.id), updates);
            } catch (e) {
              console.error("Error updating message status:", e);
            }
          }
        }
      });

      // Auto scroll to bottom
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 100);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `conversations/${conversation.id}/messages`));

    return () => unsubscribe();
  }, [conversation.id]);

  // Send typing trigger only if input has content and was typed by user
  useEffect(() => {
    if (!conversation.id || !auth.currentUser || skipNextTypingUpdate.current) {
      skipNextTypingUpdate.current = false;
      return;
    }

    if (!isUserTyping.current) return;

    const setTyping = async (isTyping: boolean) => {
      try {
        await updateDoc(doc(db, 'conversations', conversation.id!), {
          [`typing.${auth.currentUser?.uid}`]: isTyping ? Date.now() : null
        });
      } catch (e) {
        console.error("Error setting typing status:", e);
      }
    };

    if (inputText.length > 0) {
      setTyping(true);
      const timeout = setTimeout(() => setTyping(false), 3000);
      return () => clearTimeout(timeout);
    } else {
      setTyping(false);
    }
  }, [inputText, conversation.id]);

  const send = () => {
    if (inputText.trim()) {
      onSendMessage(inputText);
      skipNextTypingUpdate.current = true;
      isUserTyping.current = false;
      setInputText('');
      // Explicitly clear typing status upon sending
      try {
        const convoDocRef = doc(db, 'conversations', conversation.id);
        updateDoc(convoDocRef, {
          [`typing.${auth.currentUser?.uid}`]: null
        }).catch((e) => console.warn("Could not clear typing on send", e));
      } catch (e) {
        console.warn(e);
      }
    }
  };

  const handleToggleMessageArchive = async (msgId: string) => {
    if (!conversation.id || !auth.currentUser) return;
    try {
      const msgRef = doc(db, 'conversations', conversation.id, 'messages', msgId);
      await updateDoc(msgRef, {
        [`archivedForUsers.${auth.currentUser.uid}`]: true
      });
    } catch (e) {
      console.error("Error archiving message:", e);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!conversation.id || !auth.currentUser) return;
    try {
      const msgRef = doc(db, 'conversations', conversation.id, 'messages', msgId);
      await updateDoc(msgRef, {
        [`deletedForUsers.${auth.currentUser.uid}`]: true
      });
    } catch (e) {
      console.error("Error deleting message:", e);
    }
  };

  // Typing Indicator Logic
  useEffect(() => {
    if (!conversation.id || !auth.currentUser) return;

    const convoRef = doc(db, 'conversations', conversation.id);
    const unsubscribe = onSnapshot(convoRef, (snapshot) => {
      const data = snapshot.data();
      if (data?.typing) {
        const otherParticipantId = conversation.participants.find(p => p !== auth.currentUser?.uid);
        if (otherParticipantId && data.typing[otherParticipantId]) {
          const typingTime = data.typing[otherParticipantId];
          const isRecentlyTyping = Date.now() - typingTime < 5000;
          setOtherUserTyping(isRecentlyTyping);
        } else {
          setOtherUserTyping(false);
        }
      }
    });

    return () => unsubscribe();
  }, [conversation.id]);

  return (
    <div className="bg-white min-h-screen flex flex-col">
      <div className="bg-white/80 backdrop-blur-xl border-b border-gray-100 p-4 sticky top-0 z-50 flex items-center gap-4">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors">
          <ChevronLeft size={24} />
        </button>
        <button 
          onClick={() => {
            const otherParticipantId = conversation.participants?.find(p => p !== auth.currentUser?.uid);
            if (otherParticipantId && onViewProfile) {
              onViewProfile(otherParticipantId);
            }
          }}
          className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity focus:outline-none"
        >
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center font-black text-primary overflow-hidden relative">
             <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent opacity-50" />
            <span className="relative z-10">
              <UserName 
                userId={conversation.participants?.find(p => p !== auth.currentUser?.uid) || ''} 
                fallback={conversation.participantAvatar || '👤'} 
                type="emoji"
              />
            </span>
          </div>
          <div>
            <h1 className="text-sm font-black text-gray-900 leading-none">
              {conversation.participants && auth.currentUser ? (
                <UserName 
                  userId={conversation.participants.find(p => p !== auth.currentUser?.uid) || ''} 
                  fallback={conversation.participantName} 
                />
              ) : (
                conversation.participantName
              )}
            </h1>
            <AnimatePresence mode="wait">
              {otherUserTyping ? (
                <motion.p 
                  key="typing"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="text-[10px] text-primary font-black mt-1 uppercase tracking-widest flex items-center gap-1"
                >
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                  {language === 'ta' ? 'தட்டச்சு செய்கிறது...' : 'typing...'}
                </motion.p>
              ) : isOnline ? (
                <motion.p 
                  key="online"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="text-[10px] text-green-500 font-black mt-1 uppercase tracking-widest"
                >
                  {language === 'ta' ? 'ஆன்லைனில்' : 'Online'}
                </motion.p>
              ) : (
                <motion.p 
                  key="offline"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="text-[9px] text-gray-400 font-medium mt-1 uppercase tracking-wider"
                >
                  {formatLastSeen(otherUserStatus?.lastActive, language)}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </button>

        {/* Top-right menu inside Chat Room */}
        <div className="ml-auto relative" ref={headerMenuRef}>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setHeaderMenuOpen(!headerMenuOpen);
              setConfirmHeaderDelete(false);
            }} 
            className="p-2 rounded-full hover:bg-gray-150 transition-colors text-gray-400 hover:text-gray-700"
          >
            <MoreVertical size={20} />
          </button>
          
          {headerMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-150 rounded-2xl shadow-xl z-50 p-2 text-sm font-bold text-gray-700">
              {confirmHeaderDelete ? (
                <div className="p-2 space-y-2 text-center">
                  <p className="text-xs text-red-600 font-bold">
                    {language === 'ta' ? 'இந்த அரட்டையை அழிக்கவா?' : 'Delete this chat?'}
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button 
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!auth.currentUser) return;
                        const uid = auth.currentUser.uid;
                        try {
                          await updateDoc(doc(db, 'conversations', conversation.id), {
                            [`deletedUsers.${uid}`]: true
                          });
                          setHeaderMenuOpen(false);
                          onBack();
                        } catch (err) {
                          console.error("Error deleting conversation in room:", err);
                        }
                      }}
                      className="bg-red-500 text-white px-3 py-1.5 rounded-xl text-xs hover:bg-red-600 transition-colors font-bold"
                    >
                      {language === 'ta' ? 'ஆம்' : 'Yes'}
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmHeaderDelete(false);
                      }}
                      className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-xl text-xs hover:bg-gray-200 transition-colors font-bold"
                    >
                      {language === 'ta' ? 'இல்லை' : 'No'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {/* Place Star / Important toggle option */}
                  <button 
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!auth.currentUser) return;
                      const uid = auth.currentUser.uid;
                      const isImp = conversation.importantUsers?.[uid] || conversation.isPinned || false;
                      try {
                        await updateDoc(doc(db, 'conversations', conversation.id), {
                          [`importantUsers.${uid}`]: !isImp
                        });
                        setHeaderMenuOpen(false);
                      } catch (err) {
                        console.error("Error toggling important in room:", err);
                      }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 text-left transition-colors"
                  >
                    <Star size={16} className={(conversation.importantUsers?.[auth.currentUser?.uid || ''] || conversation.isPinned) ? "fill-amber-400 text-amber-500" : "text-gray-400"} />
                    <span>
                      {(conversation.importantUsers?.[auth.currentUser?.uid || ''] || conversation.isPinned)
                        ? (language === 'ta' ? 'முக்கியமற்றதாக்கு' : 'Unmark Important')
                        : (language === 'ta' ? 'முக்கியமானதாக்கு' : 'Mark as Important')}
                    </span>
                  </button>

                  {/* Archive option inside Room */}
                  <button 
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!auth.currentUser) return;
                      const uid = auth.currentUser.uid;
                      const isArch = conversation.archivedUsers?.[uid] || false;
                      try {
                        await updateDoc(doc(db, 'conversations', conversation.id), {
                          [`archivedUsers.${uid}`]: !isArch
                        });
                        setHeaderMenuOpen(false);
                        onBack();
                      } catch (err) {
                        console.error("Error toggling archive in room:", err);
                      }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 text-left transition-colors border-t border-gray-100/60 mt-0.5"
                  >
                    <Archive size={16} className="text-gray-400" />
                    <span>
                      {conversation.archivedUsers?.[auth.currentUser?.uid || '']
                        ? (language === 'ta' ? 'மீட்டமை' : 'Unarchive')
                        : (language === 'ta' ? 'காப்பகப்படுத்து' : 'Archive')}
                    </span>
                  </button>

                  {/* Delete option inside Room */}
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmHeaderDelete(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-red-50 text-red-650 text-left transition-colors border-t border-gray-100/60 mt-0.5"
                  >
                    <Trash size={16} />
                    <span>{language === 'ta' ? 'அழிக்கவும்' : 'Delete Chat'}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto pb-24 scroll-smooth" ref={scrollRef}>
        {visibleMessages.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-xs font-bold font-sans">
            {language === 'ta' ? 'செய்திகள் எதுவும் இல்லை' : 'No messages here yet.'}
          </div>
        ) : (
          visibleMessages.map((msg, idx) => {
            const isOwn = msg.senderId === auth.currentUser?.uid;
            
            // Determine if we need to show a date header
            const msgDate = getMessageDate(msg.createdAt);
            const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
            const prevMsgDate = prevMsg ? getMessageDate(prevMsg.createdAt) : null;
            
            const showDateHeader = !prevMsgDate || 
              msgDate.getFullYear() !== prevMsgDate.getFullYear() ||
              msgDate.getMonth() !== prevMsgDate.getMonth() ||
              msgDate.getDate() !== prevMsgDate.getDate();

            return (
              <div key={msg.id} className="space-y-4">
                {showDateHeader && (
                  <div className="text-center py-4">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] bg-gray-50 px-3 py-1 rounded-full border border-gray-100">
                      {getFriendlyDateBanner(msg.createdAt, language)}
                    </span>
                  </div>
                )}
                
                <div className={`flex items-end gap-2 relative group ${
                  activeMessageMenuId === msg.id ? 'z-30' : 'z-10'
                } ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="max-w-[75%] space-y-1 font-sans"
                  >
                    <div className={`relative px-4 py-3 text-sm font-bold shadow-sm transition-all hover:shadow-md ${
                      isOwn 
                        ? 'bg-primary text-white rounded-[24px] rounded-br-none' 
                        : 'bg-gray-100 text-gray-800 rounded-[24px] rounded-bl-none border border-gray-200'
                    }`}>
                      {msg.text}
                      <div className={`text-[10px] mt-1 opacity-70 flex items-center gap-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                        {formatMessageTime(msg)}
                        {isOwn && (
                          <span className="flex">
                            {msg.isRead ? (
                              <>
                                <Check size={12} className="text-sky-300" />
                                <Check size={12} className="-ml-1.5 text-sky-300" />
                              </>
                            ) : msg.isDelivered ? (
                              <>
                                <Check size={12} className="text-white/70" />
                                <Check size={12} className="-ml-1.5 text-white/70" />
                              </>
                            ) : (
                              <Check size={12} className="text-white/50" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>

                  {/* Message Dots Actions */}
                  <div className="relative shrink-0 self-center">
                    <button 
                      onClick={() => setActiveMessageMenuId(activeMessageMenuId === msg.id ? null : msg.id)}
                      className="p-1.5 text-gray-300 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors opacity-40 group-hover:opacity-100"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {activeMessageMenuId === msg.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setActiveMessageMenuId(null)} />
                        <div ref={messageMenuRef} className={`absolute ${isOwn ? 'right-0' : 'left-0'} mt-1 w-32 bg-white border border-gray-100 rounded-xl shadow-xl z-50 p-1 text-xs font-bold text-gray-700`}>
                          {/* Archive option */}
                          <button 
                            onClick={() => {
                              handleToggleMessageArchive(msg.id);
                              setActiveMessageMenuId(null);
                            }}
                            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-left transition-colors"
                          >
                            <Archive size={12} className="text-gray-400" />
                            <span>{language === 'ta' ? 'காப்பகம்' : 'Archive'}</span>
                          </button>
                          {/* Delete option */}
                          <button 
                            onClick={() => {
                              handleDeleteMessage(msg.id);
                              setActiveMessageMenuId(null);
                            }}
                            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-red-50 text-red-600 text-left transition-colors border-t border-gray-50/65 mt-0.5"
                          >
                            <Trash size={12} />
                            <span>{language === 'ta' ? 'அழி' : 'Delete'}</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="p-4 border-t border-gray-100 bg-white/100 backdrop-blur-xl sticky bottom-0 z-50">
        <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-[28px] border-2 border-gray-100 focus-within:border-primary focus-within:bg-white transition-all shadow-inner">
          <input 
            type="text"
            placeholder={language === 'ta' ? 'செய்தி...' : 'Type a message...'}
            className="flex-1 bg-transparent px-4 py-2 outline-none text-sm font-bold placeholder:text-gray-400"
            value={inputText}
            onChange={(e) => {
              isUserTyping.current = true;
              setInputText(e.target.value);
            }}
            onKeyPress={(e) => e.key === 'Enter' && send()}
          />
          <button 
            onClick={send}
            disabled={!inputText.trim()}
            className="w-10 h-10 bg-primary text-white rounded-[20px] flex items-center justify-center shadow-lg shadow-primary/20 disabled:grayscale disabled:opacity-50 active:scale-95 transition-transform"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

const LoginScreen = ({ onLogin, onSkip, language, setLanguage }: { onLogin: () => void, onSkip: () => void, language: Language, setLanguage: (l: Language) => void }) => {
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const getFriendlyErrorMessage = (err: any) => {
    const code = err.code || (err.message && err.message.includes('auth/') ? err.message.match(/auth\/[a-z-]+/)?.[0] : null);

    if (code === 'auth/operation-not-allowed') {
      return language === 'ta' 
        ? 'உள்நுழைவு முறை முடக்கப்பட்டுள்ளது. Firebase கன்சோலில் Google-ஐ இயக்கவும் (Authentication > Sign-in method).' 
        : 'Sign-in methods are not enabled. Go to Firebase Console > Authentication > Sign-in method and enable "Google".';
    }
    if (code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user') {
      return null; 
    }
    if (code === 'auth/network-request-failed' || (err.message && err.message.includes('auth/network-request-failed'))) {
      return language === 'ta' ? 'இணைய இணைப்பு இல்லை. மீண்டும் முயற்சிக்கவும்.' : 'Network error. Please check your internet connection.';
    }
    return err.message;
  };

  const handleGoogleLogin = async () => {
    if (googleLoading) return;
    const provider = new GoogleAuthProvider();
    setGoogleLoading(true);
    try {
      setError(null);
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error(err);
      const msg = getFriendlyErrorMessage(err);
      if (msg) setError(msg);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-between p-8 bg-white overflow-hidden relative w-full">
      <div className="absolute top-8 right-8 z-10 text-right flex flex-col items-end gap-2">
        <button 
          onClick={onSkip}
          className="text-gray-400 font-black text-[10px] uppercase tracking-widest hover:text-primary transition-colors flex items-center gap-2"
        >
          {language === 'ta' ? 'தவிர்' : 'Skip'}
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="w-full flex-1 flex flex-col items-center justify-center space-y-10 max-w-sm mx-auto">
        <motion.div 
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          className="w-24 h-24 bg-primary/10 rounded-[32px] flex items-center justify-center text-5xl shadow-inner"
        >
          🌾
        </motion.div>

        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black text-primary tracking-tighter">AgriMarket</h1>
          <p className="text-gray-400 font-black text-[10px] uppercase tracking-widest leading-relaxed">
            Sell directly without middlemen!
          </p>
        </div>

        <div className="w-full space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">
              {language === 'ta' ? 'வருக!' : 'Welcome'}
            </h2>
            <p className="text-gray-400 font-medium text-xs mt-1">
              {language === 'ta' ? 'தொடர உங்கள் கூகுள் கணக்குடன் நுழையவும்' : 'Please sign in with your Google account to continue'}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button 
              disabled={googleLoading}
              onClick={handleGoogleLogin}
              className="w-full bg-white border-2 border-gray-100 p-5 rounded-2xl flex items-center justify-center gap-3 hover:border-primary transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm"
            >
              {googleLoading ? (
                 <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <svg viewBox="0 0 24 24" className="w-5 h-5">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span className="font-bold text-gray-700 uppercase text-[12px] tracking-widest">
                    Continue with Google
                  </span>
                </>
              )}
            </button>
            
            {error && (
              <div className="text-red-500 text-[10px] font-black uppercase tracking-widest text-center mt-2 px-4">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const RoleSelectionScreen = ({ onSelect, language }: any) => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col p-6 space-y-8">
      <div className="pt-12 text-center space-y-2">
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">
          {language === 'ta' ? 'வணக்கம்!' : 'Welcome!'}
        </h1>
        <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">
          {language === 'ta' ? 'இன்று நீங்கள் என்ன செய்ய விரும்புகிறீர்கள்?' : 'What would you like to do today?'}
        </p>
      </div>

      <div className="flex-1 flex flex-col gap-6 justify-center">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect('buy')}
          className="bg-white p-8 rounded-[40px] shadow-sm border border-gray-100 flex flex-col items-center gap-4 group hover:border-primary transition-all"
        >
          <div className="w-20 h-20 bg-green-50 rounded-3xl flex items-center justify-center text-4xl group-hover:scale-110 transition-transform">
            🛒
          </div>
          <div className="text-center">
            <h3 className="text-xl font-black text-gray-900">
              {language === 'ta' ? 'வாங்க / Home' : 'I want to Buy'}
            </h3>
            <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-wide">
              {language === 'ta' ? 'Browse crops & equipment' : 'பயிர்கள் & கருவிகள் வாங்க'}
            </p>
          </div>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect('sell')}
          className="bg-white p-8 rounded-[40px] shadow-sm border border-gray-100 flex flex-col items-center gap-4 group hover:border-primary transition-all"
        >
          <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center text-4xl group-hover:scale-110 transition-transform">
            💰
          </div>
          <div className="text-center">
            <h3 className="text-xl font-black text-gray-900">
              {language === 'ta' ? 'விற்க / Seller Dashboard' : 'I want to Sell'}
            </h3>
            <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-wide">
              {language === 'ta' ? 'Manage your listings' : 'உங்கள் பொருட்களை விற்க'}
            </p>
          </div>
        </motion.button>
      </div>

      <p className="text-[10px] font-black text-gray-300 text-center uppercase tracking-[0.2em] pb-8">
        You can always switch between modes later
      </p>
    </div>
  );
};

const OnboardingScreen = ({ user, language, setLanguage, onComplete }: any) => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: user?.name && user.name !== 'Farmer' ? user.name : '',
    state: user?.state || 'Tamil Nadu',
    district: user?.district || '',
    subDistrict: user?.subDistrict || '',
    prefLanguage: user?.language || language,
    phone: user?.phone || auth.currentUser?.phoneNumber || ''
  });
  const [isSaving, setIsSaving] = useState(false);

  // Initial step calculation on mount
  useEffect(() => {
    if (user) {
      if (!user.language) {
        setStep(1);
      } else if (!user.name || user.name === 'Farmer') {
        setStep(2);
      } else if (!user.state || !user.district || !user.subDistrict) {
        setStep(3);
      } else if (!user.phone) {
        setStep(4);
      } else {
        setStep(1);
      }
    }
  }, []);

  // If user profile updates in background, keep formData in sync if we haven't touched it
  useEffect(() => {
    if (user && !isSaving) {
      setFormData(prev => ({
        ...prev,
        name: prev.name || ((user.name && user.name !== 'Farmer') ? user.name : ''),
        state: prev.state || user.state || 'Tamil Nadu',
        district: prev.district || user.district || '',
        subDistrict: prev.subDistrict || user.subDistrict || '',
        prefLanguage: prev.prefLanguage || user.language || language,
        phone: prev.phone || user.phone || auth.currentUser?.phoneNumber || ''
      }));
    }
  }, [user, language]);

  const availableDistricts = useMemo(() => {
    const stateData = LOCATION_DATA.find(s => s.state === formData.state);
    return stateData ? stateData.districts : [];
  }, [formData.state]);

  const availableSubDistricts = useMemo(() => {
    const districtData = availableDistricts.find(d => d.name === formData.district);
    return districtData ? districtData.subDistricts : [];
  }, [formData.district, availableDistricts]);

  const handleNext = () => {
    if (step === 1 && formData.prefLanguage) {
      setLanguage(formData.prefLanguage);
      setStep(2);
    }
    else if (step === 2 && formData.name.trim()) {
      setStep(3);
    }
    else if (step === 3 && formData.state && formData.district && formData.subDistrict) {
      setStep(4);
    }
    else if (step === 4 && formData.phone.trim()) {
      handleFinish();
    }
  };

  const handleFinish = async () => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) {
      alert(language === 'ta' ? 'பயனர் அடையாளம் கிடைக்கவில்லை!' : 'User ID not found! Please try logging in again.');
      return;
    }
    setIsSaving(true);
    try {
      // 1. Update Firebase Auth Display Name if available
      if (auth.currentUser) {
        try {
          await updateProfile(auth.currentUser, {
            displayName: formData.name.trim()
          });
        } catch (authErr) {
          console.error("Auth profile update non-blocking failure:", authErr);
        }
      }

      // 2. Save location, name, and phone to Firestore
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, {
        name: formData.name.trim(),
        state: formData.state,
        district: formData.district,
        subDistrict: formData.subDistrict,
        location: `${formData.subDistrict}, ${formData.district}`,
        phone: formData.phone.trim(),
        language: formData.prefLanguage || language,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Propagate name to any existing listings/conversations (unlikely for new user but good for consistency)
      const listingsQuery = query(collection(db, 'listings'), where('farmerId', '==', uid));
      const listingsSnap = await getDocs(listingsQuery);
      const listingUpdates = listingsSnap.docs.map(d => updateDoc(doc(db, 'listings', d.id), { 
        farmerName: formData.name.trim(), 
        phone: formData.phone.trim(),
        updatedAt: serverTimestamp() 
      }));

      const convosQuery = query(collection(db, 'conversations'), where('participants', 'array-contains', uid));
      const convosSnap = await getDocs(convosQuery);
      const convoUpdates = convosSnap.docs.map(d => updateDoc(doc(db, 'conversations', d.id), { 
        [`participantNames.${uid}`]: formData.name.trim(), 
        updatedAt: serverTimestamp() 
      }));
      
      try {
        await Promise.all([...listingUpdates, ...convoUpdates]);
      } catch (subErr) {
        console.error("Sub-documents propagation non-blocking feedback:", subErr);
      }
      
      if (onComplete) {
        onComplete();
      }
    } catch (err: any) {
      console.error("Error saving onboarding data", err);
      alert(language === 'ta' ? 'விபரங்களைச் சேமிப்பதில் பிழை ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.' : 'Error saving onboarding data. Please try again. Details: ' + (err?.message || err));
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  const languages = [
    { code: 'en', label: 'English', native: 'English' },
    { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
    { code: 'te', label: 'Telugu', native: 'తెలుగు' },
    { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
    { code: 'ml', label: 'Malayalam', native: 'മലയാളம்' }
  ];

  return (
    <div className="bg-white min-h-screen flex flex-col p-6 pt-20">
      <div className="flex-1 max-w-md mx-auto w-full">
        <div className="mb-12">
          <div className="flex gap-2 mb-6">
            <div className={`h-2 flex-1 rounded-full ${step >= 1 ? 'bg-primary' : 'bg-gray-100'}`} />
            <div className={`h-2 flex-1 rounded-full ${step >= 2 ? 'bg-primary' : 'bg-gray-100'}`} />
            <div className={`h-2 flex-1 rounded-full ${step >= 3 ? 'bg-primary' : 'bg-gray-100'}`} />
            <div className={`h-2 flex-1 rounded-full ${step >= 4 ? 'bg-primary' : 'bg-gray-100'}`} />
          </div>
          <h1 className="text-3xl font-black text-gray-900 leading-tight">
            {step === 1 
              ? 'Choose your language'
              : step === 2
                ? (language === 'ta' ? 'உங்களை நாங்கள் அழைக்க எப்படி?' : 'What should we call you?')
                : step === 3
                  ? (language === 'ta' ? 'உங்கள் பகுதி எது?' : 'Where are you based?')
                  : (language === 'ta' ? 'உங்கள் தொலைபேசி எண்?' : 'Your phone number?')
            }
          </h1>
          <p className="text-gray-500 font-medium mt-2 text-xs uppercase tracking-widest leading-relaxed">
            {step === 1
              ? 'Please select your preferred language.'
              : step === 2
                ? (language === 'ta' ? 'உங்கள் அனுபவத்தைத் தனிப்பயனாக்க உதவும்.' : 'Help us personalize your experience.')
                : step === 3
                  ? (language === 'ta' ? 'விற்பனையாளர்கள் உங்களை தொடர்பு கொள்ள இது உதவும்.' : 'Find listings and buyers near you.')
                  : (language === 'ta' ? 'பயிர்களை வாங்கவும் விற்கவும் தொடர்பு கொள்ள இந்த எண் தேவைப்படும்.' : 'Necessary for seamless contact between buyers and sellers.')
            }
          </p>
        </div>

        <div className="space-y-6">
          {step === 1 ? (
            <div className="grid grid-cols-1 gap-3">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setFormData({ ...formData, prefLanguage: lang.code as Language })}
                  className={`flex items-center justify-between p-5 rounded-[24px] border-2 transition-all ${
                    formData.prefLanguage === lang.code 
                      ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10' 
                      : 'border-gray-100 hover:border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="text-left">
                    <p className={`font-black ${formData.prefLanguage === lang.code ? 'text-primary' : 'text-gray-900'}`}>{lang.native}</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{lang.label}</p>
                  </div>
                  {formData.prefLanguage === lang.code && (
                    <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center text-white">
                      <Check size={14} strokeWidth={4} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : step === 2 ? (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                {language === 'ta' ? 'பெயர்' : 'Full Name'}
              </label>
              <input 
                type="text"
                placeholder={language === 'ta' ? 'உங்கள் பெயர்' : 'Enter your name'}
                className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl p-4 font-bold focus:border-primary focus:bg-white outline-none transition-all"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
          ) : step === 3 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                  {language === 'ta' ? 'மாநிலம்' : 'State'}
                </label>
                <select 
                  className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl p-4 font-bold focus:border-primary focus:bg-white outline-none transition-all appearance-none"
                  value={formData.state}
                  onChange={(e) => setFormData({...formData, state: e.target.value, district: '', subDistrict: ''})}
                >
                  <option value="">{language === 'ta' ? 'தேர்ந்தெடுக்கவும்' : 'Select State'}</option>
                  {LOCATION_DATA.map(s => <option key={s.state} value={s.state}>{s.state}</option>)}
                </select>
              </div>

              <div className="space-y-2 relative">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                  {language === 'ta' ? 'மாவட்டம்' : 'District'}
                </label>
                <select 
                  className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl p-4 font-bold focus:border-primary focus:bg-white outline-none transition-all appearance-none disabled:opacity-50"
                  disabled={!formData.state}
                  value={formData.district}
                  onChange={(e) => setFormData({...formData, district: e.target.value, subDistrict: ''})}
                >
                  <option value="">{language === 'ta' ? 'தேர்ந்தெடுக்கவும்' : 'Select District'}</option>
                  {availableDistricts.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                  {language === 'ta' ? 'வட்டம் / பகுதி' : 'Sub-District / Area'}
                </label>
                <select 
                  className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl p-4 font-bold focus:border-primary focus:bg-white outline-none transition-all appearance-none disabled:opacity-50"
                  disabled={!formData.district}
                  value={formData.subDistrict}
                  onChange={(e) => setFormData({...formData, subDistrict: e.target.value})}
                >
                  <option value="">{language === 'ta' ? 'தேர்ந்தெடுக்கவும்' : 'Select Sub-District'}</option>
                  {availableSubDistricts.map(sd => <option key={sd} value={sd}>{sd}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                {language === 'ta' ? 'தொலைபேசி எண்' : 'Phone Number'}
              </label>
              <input 
                type="tel"
                placeholder={language === 'ta' ? '10 இலக்க தொலைபேசி எண்ணை உள்ளிடவும்' : 'Enter 10-digit phone number'}
                maxLength={10}
                className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl p-4 font-bold focus:border-primary focus:bg-white outline-none transition-all"
                value={formData.phone}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setFormData({...formData, phone: val});
                }}
              />
            </div>
          )}
        </div>

        <div className="mt-12">
          <button 
            disabled={
              isSaving || 
              (step === 1 && !formData.prefLanguage) ||
              (step === 2 && !formData.name.trim()) || 
              (step === 3 && (!formData.state || !formData.district || !formData.subDistrict)) ||
              (step === 4 && formData.phone.trim().length !== 10)
            }
            onClick={handleNext}
            className="w-full bg-primary text-white p-5 rounded-[24px] font-black text-lg shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:grayscale disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                {step < 4 ? (language === 'ta' ? 'அடுத்தது' : 'Continue') : (language === 'ta' ? 'முடிக்க' : 'Complete Setup')}
                <ChevronRight size={20} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const SellerDashboardScreen = ({ userId, user, listings, language, onNavigate }: any) => {
  const myListings = listings?.filter((l: any) => l.farmerId === userId) || [];
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (listingId: string) => {
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'listings', listingId));
      setDeleteId(null);
    } catch (err) {
      console.error("Delete failed:", err);
      handleFirestoreError(err, OperationType.DELETE, 'listings');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="bg-primary text-white p-6 pt-10 shadow-lg px-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black leading-tight tracking-tight">
              {language === 'ta' ? 'விற்பனையாளர் பக்கம்' : 'Seller Dashboard'}
            </h1>
            <p className="text-xs opacity-80 uppercase font-bold tracking-widest mt-1">Manage your business</p>
          </div>
          <button 
             onClick={() => onNavigate('Home')}
             className="bg-white/20 px-4 py-2 rounded-xl backdrop-blur-md text-[10px] font-black uppercase tracking-widest"
          >
            {language === 'ta' ? 'வாங்க' : 'Switch to Buy'}
          </button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4 -mt-4 relative z-10 px-6">
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
           <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Active Ads</p>
           <p className="text-2xl font-black text-gray-900">{myListings.length}</p>
        </div>
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
           <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Views</p>
           <p className="text-2xl font-black text-gray-900">{myListings.reduce((acc: number, curr: any) => acc + (curr.views || 0), 0)}</p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex justify-between items-end">
          <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest">
            {language === 'ta' ? 'எனது பதிவுகள்' : 'My Listings'}
          </h2>
          <button 
             onClick={() => onNavigate('Post')}
             className="text-primary font-black text-[10px] uppercase tracking-widest flex items-center gap-1"
          >
            <PlusCircle size={14} /> {language === 'ta' ? 'புதியது' : 'Add New'}
          </button>
        </div>

        {myListings.length === 0 ? (
          <div className="bg-white rounded-[40px] p-12 text-center border border-dashed border-gray-200">
             <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">📭</div>
             <p className="text-gray-400 font-bold text-sm">
                {language === 'ta' ? 'பதிவுகள் எதுவும் இல்லை' : 'You haven\'t posted anything yet'}
             </p>
             <button 
               onClick={() => onNavigate('Post')}
               className="mt-6 bg-primary text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-primary/20"
             >
               {language === 'ta' ? 'முதல் பதிவை இடவும்' : 'Post your first ad'}
             </button>
          </div>
        ) : (
          <div className="space-y-4">
            {myListings.map((listing: any) => (
              <SwipeableListingItem 
                key={listing.id} 
                listing={listing} 
                language={language} 
                onNavigate={onNavigate} 
                onDelete={() => setDeleteId(listing.id)}
              />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {deleteId && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-white w-full max-w-sm rounded-[40px] overflow-hidden shadow-2xl"
            >
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Trash2 size={32} />
                </div>
                <h3 className="text-xl font-black text-gray-900 mb-2">
                  {language === 'ta' ? 'பதிவை நீக்கவா?' : 'Delete Listing?'}
                </h3>
                <p className="text-gray-500 font-medium text-sm px-4">
                  {language === 'ta' ? 'இந்த பதிவை நீங்கள் நிரந்தரமாக நீக்க விரும்புகிறீர்களா?' : 'Are you sure you want to permanently delete this listing?'}
                </p>
              </div>
              <div className="p-4 bg-gray-50 flex gap-3">
                <button 
                  onClick={() => setDeleteId(null)}
                  disabled={isDeleting}
                  className="flex-1 py-4 font-black text-xs uppercase tracking-widest text-gray-400 bg-white rounded-2xl active:scale-95 transition-transform"
                >
                  {language === 'ta' ? 'இல்லை' : 'Cancel'}
                </button>
                <button 
                  onClick={() => handleDelete(deleteId)}
                  disabled={isDeleting}
                  className="flex-1 py-4 font-black text-xs uppercase tracking-widest text-white bg-red-500 rounded-2xl shadow-lg shadow-red-200 active:scale-95 transition-transform flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    language === 'ta' ? 'ஆம், நீக்கு' : 'Yes, Delete'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SwipeableListingItem = ({ listing, language, onNavigate, onDelete }: any) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative overflow-hidden rounded-3xl bg-red-500 h-[104px]">
      <div className="absolute inset-y-0 right-0 w-24 flex items-center justify-center">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
            setIsOpen(false);
          }}
          className="w-full h-full flex flex-col items-center justify-center text-white cursor-pointer active:bg-red-600 transition-colors"
        >
          <Trash2 size={24} />
          <span className="text-[8px] font-black uppercase tracking-tighter mt-1">Delete</span>
        </button>
      </div>

      <motion.div 
        drag="x"
        dragConstraints={{ right: 0, left: -96 }}
        dragElastic={0.1}
        animate={{ x: isOpen ? -96 : 0 }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -30) setIsOpen(true);
          else if (info.offset.x > 30) setIsOpen(false);
        }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
        whileTap={{ cursor: 'grabbing' }}
        className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 flex gap-4 relative z-10 h-full"
      >
        <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center text-3xl shrink-0 overflow-hidden">
          {listing.imageUrl ? (
            <img src={listing.imageUrl} alt={listing.titleEn} className="w-full h-full object-cover" />
          ) : (
            listing.photoEmoji
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-black text-gray-900 truncate">{language === 'ta' ? listing.titleTa : listing.titleEn}</h4>
          <p className="text-primary font-black text-sm">₹{listing.price}/{listing.unit}</p>
          <p className="text-[10px] font-bold text-gray-400 mt-1">{listing.views} views • {listing.postedDate}</p>
        </div>
        <div className="flex flex-col justify-center gap-2">
          <button 
            onClick={() => onNavigate('Post', listing)}
            className="p-2.5 bg-gray-50 rounded-xl text-primary hover:bg-primary/10 transition-colors active:scale-95"
          >
            <Pencil size={18} />
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-2.5 bg-red-50 rounded-xl text-red-500 hover:bg-red-100 transition-colors active:scale-95"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default App;
