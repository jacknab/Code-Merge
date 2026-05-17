export interface StoreData {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  timezone: string;
  bookingSlug?: string;
  bookingTheme?: string;
  businessHours?: {
    id: number;
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
  }[];
}

export interface ServiceData {
  id: number;
  name: string;
  description?: string;
  duration: number;
  price: string;
  category: string;
  categoryId?: number;
  depositRequired?: boolean;
  depositAmount?: string | null;
}

export interface CategoryData {
  id: number;
  name: string;
  storeId: number;
}

export interface AddonData {
  id: number;
  name: string;
  description?: string;
  price: string;
  duration: number;
  storeId: number;
}

export interface ServiceAddonData {
  id: number;
  serviceId: number;
  addonId: number;
}

export interface TimeSlot {
  id: string;
  time: string;
  staffId: number;
  staffName: string;
}
