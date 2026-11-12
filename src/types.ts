export type PaymentMethod = 'Pix' | 'Cartão de Crédito' | 'Cartão de Débito' | 'Dinheiro';

export type AppointmentStatus = 'confirmed' | 'completed' | 'cancelled';

export interface NailService {
  id: string;
  name: string;
  durationMin: number;
  price: number;
}

export interface ClientProfile {
  uid: string;
  name: string;
  phone: string;
  email: string;
  wallpaper: string;
  wallpaperOpacity: number;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  serviceId: string;
  serviceName: string;
  servicePrice: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  slotId: string; // YYYY-MM-DD_HH-MM
  status: AppointmentStatus;
  paymentMethod: PaymentMethod;
  paymentTimingNote: string;
  paymentStatus: 'pending' | 'paid' | 'fee_pending';
  cancellationType: 'none' | 'free' | 'late_fee';
  cancellationFee: number;
  notes: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SlotDoc {
  id: string;
  date: string;
  time: string;
  status: 'booked';
  bookedByUid: string;
  appointmentId: string;
}

export interface ClosureDoc {
  id: string;
  type: 'day' | 'week' | 'slot';
  date: string;
  endDate: string;
  time: string;
  reason: string;
  createdBy: string;
}

export interface FinanceEntry {
  id: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  description: string;
  clientName: string;
  appointmentId: string;
  type: 'income' | 'fee';
  createdBy: string;
  createdAt?: unknown;
}

export interface StudioConfig {
  studioName: string;
  address: string;
  referencePoint: string;
  mapsUrl: string;
  ownerPhone: string;
  ownerEmail: string;
  lateCancellationFee: number;
  pixKey?: string;
  pixBeneficiaryName?: string;
  pixCity?: string;
  workingHours: string[];
  services: NailService[];
  updatedAt?: unknown;
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  'Pix',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Dinheiro',
];

export const DEFAULT_WORKING_HOURS = [
  '08:30',
  '10:00',
  '11:30',
  '13:30',
  '15:00',
  '16:30',
  '18:00',
];

export const DEFAULT_SERVICES: NailService[] = [
  { id: 'fibra_vidro', name: 'Alongamento em Fibra de Vidro', durationMin: 120, price: 180 },
  { id: 'banho_gel', name: 'Banho de Gel Natural', durationMin: 90, price: 120 },
  { id: 'manutencao', name: 'Manutenção de Alongamento', durationMin: 90, price: 110 },
  { id: 'esmaltacao_gel', name: 'Esmaltação em Gel', durationMin: 60, price: 85 },
  { id: 'spa_pes', name: 'Spa dos Pés + Esmaltação', durationMin: 60, price: 95 },
];

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  studioName: 'Atelier Anne Caroline',
  address: 'Rua das Flores, 240 — Sala 04, Centro',
  referencePoint: 'Próximo à Praça Central, edifício com fachada de vidro',
  mapsUrl: 'https://maps.google.com/?q=Rua+das+Flores+240+Centro',
  ownerPhone: '5511999999999',
  ownerEmail: 'contato@atelierannecaroline.com',
  lateCancellationFee: 35,
  pixKey: '',
  pixBeneficiaryName: 'Anne Caroline',
  pixCity: 'SAO PAULO',
  workingHours: DEFAULT_WORKING_HOURS,
  services: DEFAULT_SERVICES,
};

export interface WallpaperOption {
  id: string;
  label: string;
  description: string;
  imageUrl?: string;
  previewBg: string;
}

export const WALLPAPER_OPTIONS: WallpaperOption[] = [
  {
    id: 'default',
    label: 'Alabastro Clássico',
    description: 'Fundo neutro limpo com máxima legibilidade.',
    previewBg: 'linear-gradient(135deg, #FAFAFA 0%, #F1EFF4 100%)',
  },
  {
    id: 'rose_marble',
    label: 'Quartzo Rosé',
    description: 'Textura suave de mármore rosé com veios perolados.',
    imageUrl: '/src/assets/images/wallpaper_rose_marble_1794522575854.jpg',
    previewBg: 'linear-gradient(135deg, #F6E6E9 0%, #EAD3D8 100%)',
  },
  {
    id: 'botanical_sage',
    label: 'Botânico Sálvia',
    description: 'Linho natural com sombras delicadas de eucalipto.',
    imageUrl: '/src/assets/images/wallpaper_botanical_sage_1794522575995.jpg',
    previewBg: 'linear-gradient(135deg, #EFF2EC 0%, #DCE3D7 100%)',
  },
  {
    id: 'champagne_gold',
    label: 'Seda Champagne',
    description: 'Vidro fosco e seda champanhe em tons quentes.',
    imageUrl: '/src/assets/images/wallpaper_champagne_gold_1794522576876.jpg',
    previewBg: 'linear-gradient(135deg, #F7F2E8 0%, #EAE0CF 100%)',
  },
  {
    id: 'rosewood_mist',
    label: 'Névoa Ameixa',
    description: 'Gradiente sutil em tons de ameixa e pérola.',
    previewBg: 'linear-gradient(145deg, #F7F0F4 0%, #ECE1E8 55%, #F8F6F9 100%)',
  },
];

export const STUDIO_IMAGES = {
  hero: '/src/assets/images/studio_hero_nails_1794522576080.jpg',
  ownerAvatar: '/src/assets/images/anne_caroline_avatar_1794522577752.jpg',
};
