// TypeScript interfaces matching the existing Firestore schema

export type UserRole = 'user' | 'cook' | 'member';

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

  // Responsibility assignments
  responsibility?: {
    breakfastLunchId?: string; // User ID responsible for Breakfast + Lunch
    dinnerId?: string;       // User ID responsible for Dinner
  };
}

export interface User {
  uid: string;
  email: string | null;
  role: UserRole;
  phoneNumber: string;
  linkedUserId?: string;
}
