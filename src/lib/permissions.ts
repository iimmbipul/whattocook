import { UserRole } from '@/types/meal';

/**
 * Check if a date is in the past
 */
export function isPastDate(date: string): boolean {
    const today = new Date().toISOString().split('T')[0];
    return date < today;
}

/**
 * Check if user can edit a meal based on role and date
 * Rules:
 * - Cook role: always false (view-only)
 * - User role: false if date is in the past, true for today and future
 */
export function canEditMeal(userRole: UserRole, mealDate: string): boolean {
    if (userRole === 'cook') {
        return false;
    }
    // Both 'user' (owner) and 'member' can edit
    return !isPastDate(mealDate);
}

/**
 * Check if user can manage other users (access admin page)
 * Only 'user' (Owner) can do this.
 */
export function canManageUsers(userRole: UserRole): boolean {
    return userRole === 'user';
}

/**
 * Get formatted date string
 */
export function getFormattedDate(dateString: string): string {
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Get tomorrow's date in YYYY-MM-DD format
 */
export function getTomorrowDate(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
}
