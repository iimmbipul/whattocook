// TypeScript interfaces matching the existing Firestore schema

export type UserRole = 'user' | 'cook' | 'member';

export interface MealItemTranslation {
  item_name: string;
  ingredients: string[];
  cooking_instructions?: string[];
}

export interface MealItem {
  item_name: string;
  ingredients: string[];
  recipe_url: string;
  image_url: string;
  calories: number;
  prep_time_minutes: number;
  is_vegetarian: boolean;
  cooking_instructions?: string[];
  nutrients?: {
    protein_g: number;
    fiber_g: number;
    carbs_g: number;
    fat_g: number;
  };
  /** Stored translations keyed by locale code, e.g. { hi: {...}, or: {...} } */
  translations?: Record<string, MealItemTranslation>;
}

export interface MealDocument {
  id: string;
  date: string; // YYYY-MM-DD
  day_of_week: string;
  breakfast: MealItem;
  lunch: MealItem;
  dinner: MealItem;
  total_calories: number;
  created_at: Date;
  updated_at: Date;
  // Map of userId -> { breakfast: boolean, lunch: boolean, dinner: boolean }
  // true = eating (default), false = skipping
  attendance?: Record<string, { breakfast: boolean; lunch: boolean; dinner: boolean }>;

  // Guests brought by each member for each meal type. Counted toward
  // "cooking for" so groceries can be planned accordingly.
  guests?: Record<string, { breakfast?: number; lunch?: number; dinner?: number }>;

  // Google Calendar sync state — one entry per responsibility slot pointing
  // at the event currently in the assigned chef's primary calendar. Kept so
  // we can delete/rewrite when the chef changes. Slots mirror
  // responsibility: breakfastLunch (combined) and dinner.
  calendarEvents?: {
    breakfastLunch?: { chefUid: string; eventId: string };
    dinner?: { chefUid: string; eventId: string };
    // Legacy per-meal keys — cleaned up on next sync.
    breakfast?: { chefUid: string; eventId: string };
    lunch?: { chefUid: string; eventId: string };
  };

  // Responsibility assignments
  responsibility?: {
    breakfastLunchId?: string; // User ID responsible for Breakfast + Lunch
    dinnerId?: string;       // User ID responsible for Dinner
    // Original assignee before a skip-triggered reassignment. Used to
    // restore the slot when the original chef un-skips.
    breakfastLunchOriginalId?: string;
    dinnerOriginalId?: string;
  };
}

export interface User {
  uid: string;
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  role: UserRole;
  phoneNumber: string;
  linkedUserId?: string;
  /** Household ID: owner's uid for owners, linkedUserId for members/cooks */
  householdId: string;
  houseCode?: string;
  housePin?: string;
  dietCategory?: string;
}

export type NotificationType =
  | 'meal_updated'
  | 'meal_skipped'
  | 'meal_unskipped'
  | 'guest_added'
  | 'guest_removed'
  | 'responsibility_changed'
  | 'responsibility_bulk_changed';

export interface NotificationDoc {
  id: string;
  type: NotificationType;
  actorId: string;
  actorName: string;
  /** ISO YYYY-MM-DD when applicable */
  date?: string;
  mealType?: 'breakfast' | 'lunch' | 'dinner';
  /** Free-form payload for message rendering: fromName, toName, newMealName, count, etc. */
  payload?: Record<string, string | number | null | undefined>;
  /** Milliseconds since epoch — set client-side via serverTimestamp on write */
  createdAt: number;
  /** UIDs of users who have marked this notification read */
  readBy: string[];
}
