import { Category, Listing, MandiPrice, Conversation, Message } from './types';

export const PRIMARY_GREEN = '#1D9E75';

export const CATEGORIES: { id: Category; labelEn: string; labelTa: string; emoji: string; bgColor: string }[] = [
  { id: 'Crops', labelEn: 'Crops', labelTa: 'பயிர்கள்', emoji: '🌾', bgColor: 'bg-amber-50' },
  { id: 'Vegetables', labelEn: 'Vegetables', labelTa: 'காய்கறிகள்', emoji: '🥕', bgColor: 'bg-emerald-50' },
  { id: 'Fruits', labelEn: 'Fruits', labelTa: 'பழங்கள்', emoji: '🍎', bgColor: 'bg-rose-50' },
  { id: 'Seeds', labelEn: 'Seeds', labelTa: 'விதைகள்', emoji: '🌱', bgColor: 'bg-green-50' },
  { id: 'Fertilizers', labelEn: 'Fertilizers', labelTa: 'உரங்கள்', emoji: '🧪', bgColor: 'bg-blue-50' },
  { id: 'Equipment', labelEn: 'Equipment', labelTa: 'கருவிகள்', emoji: '🚜', bgColor: 'bg-slate-50' },
  { id: 'Livestock', labelEn: 'Livestock', labelTa: 'கால்நடைகள்', emoji: '🐄', bgColor: 'bg-orange-50' },
  { id: 'Organic', labelEn: 'Organic', labelTa: 'இயற்கை பொருட்கள்', emoji: '🌿', bgColor: 'bg-lime-50' },
  { id: 'Land', labelEn: 'Land', labelTa: 'நிலம்', emoji: '🏞️', bgColor: 'bg-blue-50' },
];

export const DISTRICTS = ['Erode', 'Coimbatore', 'Salem', 'Namakkal', 'Karur', 'Tirupur'];

export const LOCATION_DATA = [
  {
    state: 'Tamil Nadu',
    districts: [
      {
        name: 'Erode',
        subDistricts: ['Gobichettipalayam', 'Bhavani', 'Perundurai', 'Sathyamangalam', 'Anthiyur', 'Kodumudi', 'Modakkurichi']
      },
      {
        name: 'Coimbatore',
        subDistricts: ['Pollachi', 'Mettupalayam', 'Sulur', 'Valparai', 'Annur', 'Kinathukadavu', 'Madukkarai']
      },
      {
        name: 'Salem',
        subDistricts: ['Attur', 'Mettur', 'Omalur', 'Sankari', 'Yercaud', 'Gangavalli', 'Edappadi']
      }
    ]
  },
  {
    state: 'Karnataka',
    districts: [
      {
        name: 'Bangalore',
        subDistricts: ['Anekal', 'Bangalore North', 'Bangalore South', 'Bangalore East']
      },
      {
        name: 'Mysore',
        subDistricts: ['Hunsur', 'KR Nagar', 'Nanjangud', 'Periyapatna', 'T Narasipura']
      }
    ]
  },
  {
    state: 'Kerala',
    districts: [
      {
        name: 'Kollam',
        subDistricts: ['Kollam', 'Karunagappally', 'Punalur', 'Kottarakkara', 'Pathanapuram']
      }
    ]
  }
];

export const SAMPLE_LISTINGS: Listing[] = [
  {
    id: '1',
    farmerId: 'farmer1',
    titleEn: 'Turmeric',
    titleTa: 'மஞ்சள்',
    category: 'Crops',
    price: 85,
    unit: 'kg',
    quantity: '500kg',
    farmerName: 'Murugan',
    location: 'Gobichettipalayam',
    district: 'Erode',
    description: 'Fresh organic turmeric from the latest harvest. Grade A quality.',
    photoEmoji: '🌿',
    phone: '9876543210',
    isVerified: true,
    postedDate: '2 days ago',
    views: 124,
  },
  {
    id: '2',
    farmerId: 'farmer2',
    titleEn: 'Coconut',
    titleTa: 'தேங்காய்',
    category: 'Crops',
    price: 18,
    unit: 'piece',
    quantity: '2000 pieces',
    farmerName: 'Ramu',
    location: 'Bhavani',
    district: 'Erode',
    description: 'Pollachi tall variety coconuts. Very high oil content.',
    photoEmoji: '🥥',
    phone: '8765432109',
    isVerified: true,
    postedDate: '1 day ago',
    views: 82,
  },
  {
    id: '3',
    farmerId: 'farmer3',
    titleEn: 'Tractor for Rent',
    titleTa: 'டிராக்டர் வாடகை',
    category: 'Equipment',
    price: 800,
    unit: 'hour',
    quantity: '1 available',
    farmerName: 'Selvam',
    location: 'Erode',
    district: 'Erode',
    description: 'Mahindra tractor with rotavator. Skilled driver included.',
    photoEmoji: '🚜',
    phone: '7654321098',
    isVerified: false,
    postedDate: '3 days ago',
    views: 210,
  },
];

export const SAMPLE_PRICES: MandiPrice[] = [
  { cropTa: 'மஞ்சள்', cropEn: 'Turmeric', min: 8200, max: 8800, modal: 8500, change: 150 },
  { cropTa: 'தேங்காய்', cropEn: 'Coconut', min: 15, max: 22, modal: 18, change: -2 },
  { cropTa: 'வாழைப்பழம்', cropEn: 'Banana', min: 20, max: 30, modal: 25, change: 5 },
  { cropTa: 'நெல்', cropEn: 'Paddy', min: 1900, max: 2300, modal: 2100, change: 40 },
];

export const SAMPLE_CONVERSATIONS: Conversation[] = [
  {
    id: 'c1',
    participants: ['me', 'farmer1'],
    participantName: 'Murugan K.',
    participantAvatar: 'MK',
    lastMessage: 'Is the turmeric still available?',
    lastMessageTime: '10:30 AM',
    unreadCount: 2,
  },
  {
    id: 'c2',
    participants: ['me', 'farmer2'],
    participantName: 'Ramu',
    participantAvatar: 'R',
    lastMessage: 'I can offer 16 per piece for the coconuts.',
    lastMessageTime: 'Yesterday',
    unreadCount: 0,
  },
];

export const SAMPLE_MESSAGES: Record<string, Message[]> = {
  'c1': [
    { id: '1', senderId: 'other', text: 'வணக்கம்! மஞ்சள் இருக்கிறதா?', timestamp: '10:00 AM', isRead: true, isDelivered: true },
    { id: '2', senderId: 'me', text: 'ஆம், இருக்கிறது. எவ்வளவு வேண்டும்?', timestamp: '10:15 AM', isRead: true, isDelivered: true },
    { id: '3', senderId: 'other', text: 'Is the turmeric still available?', timestamp: '10:30 AM', isRead: false, isDelivered: true },
  ]
};
