export type Language = 'en' | 'ta' | 'te' | 'kn' | 'ml';

export interface Listing {
  id: string;
  farmerId: string;
  titleEn: string;
  titleTa: string;
  category: Category;
  price: number;
  unit: string;
  quantity: string;
  farmerName: string;
  location: string;
  district: string;
  subDistrict?: string;
  description: string;
  photoEmoji: string;
  phone?: string;
  isVerified: boolean;
  postedDate: string;
  views: number;
  imageUrl?: string;
  images?: string[];
  farmerRating?: number;
  farmerReviewCount?: number;
  qualityGrade?: string;
  harvestDate?: string;
  organic?: boolean;
  minOrderQty?: string;
  storageType?: string;
  createdAt?: any;
}

export type Category = 'Crops' | 'Vegetables' | 'Fruits' | 'Seeds' | 'Fertilizers' | 'Equipment' | 'Livestock' | 'Organic' | 'Land';

export interface MandiPrice {
  cropTa: string;
  cropEn: string;
  min: number;
  max: number;
  modal: number;
  change: number; // positive or negative
}

export interface User {
  uid: string;
  name: string;
  location: string;
  state?: string;
  district?: string;
  subDistrict?: string;
  isVerified: boolean;
  memberSince: string;
  rating: number;
  activeListings: number;
  totalSales: number;
  profileViews: number;
}

export type AppScreen = 'Home' | 'Search' | 'Post' | 'Prices' | 'Profile' | 'Detail' | 'Login' | 'ChatList' | 'ChatRoom' | 'RoleSelection' | 'SellerDashboard' | 'Onboarding' | 'Notifications' | 'Wishlist' | 'Orders' | 'Chat' | 'Analytics' | 'ProductForm' | 'ManageListings' | 'Negotiations';

export interface Message {
  id: string;
  senderId: string;
  text: string;
  audioUrl?: string;
  timestamp: string;
  isRead: boolean;
  isDelivered?: boolean;
  createdAt?: any;
  archivedForUsers?: { [key: string]: boolean };
  deletedForUsers?: { [key: string]: boolean };
}

export interface Conversation {
  id: string;
  participants: string[];
  participantName: string;
  participantAvatar: string;
  lastMessage: string;
  lastMessageTime: string;
  lastMessageSenderId?: string;
  unreadCount: number;
  typing?: { [key: string]: number | null };
  initialMessage?: string;
  updatedAt?: any;
  deletedUsers?: { [key: string]: boolean };
  archivedUsers?: { [key: string]: boolean };
  importantUsers?: { [key: string]: boolean };
  isPinned?: boolean;
}

export interface Review {
  id: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  rating: number;
  comment: string;
  createdAt: any;
}
