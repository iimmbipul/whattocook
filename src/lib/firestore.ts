'use server';

import { db } from './firebase';
import { collection, doc, getDoc, updateDoc, serverTimestamp, Timestamp, getDocs, writeBatch } from 'firebase/firestore';
import { MealDocument } from '@/types/meal';

const MEALS_COLLECTION = 'dailymenu';

/**
 * Helper to get the Document ID (Day of Month) from a full date string
 * Example: "2026-01-31" -> "31"
 * Example: "2026-02-06" -> "6"
 */
function getDayId(dateString: string): string {
    // Handle if the input is already just a number
    if (/^\d{1,2}$/.test(dateString)) {
        return parseInt(dateString, 10).toString().padStart(2, '0');
    }

    const date = new Date(dateString);
    // Use UTC date logic or local? split gives YYYY-MM-DD.
    // Safest is to just parse the string part if it is ISO format
    const parts = dateString.split('-');
    if (parts.length === 3) {
        return parseInt(parts[2], 10).toString().padStart(2, '0');
    }

    // Fallback to Date object parsing
    if (!isNaN(date.getTime())) {
        return date.getDate().toString().padStart(2, '0');
    }

    return dateString;
}

/**
 * Get a meal document by date (YYYY-MM-DD)
 */
export async function getMealByDate(date: string): Promise<MealDocument | null> {
    try {
        const docId = getDayId(date);
        const mealRef = doc(db, MEALS_COLLECTION, docId);
        const mealSnap = await getDoc(mealRef);

        if (mealSnap.exists()) {
            const data = mealSnap.data();

            // Safely handle timestamps
            let createdAt = new Date();
            let updatedAt = new Date();

            if (data.created_at) {
                createdAt = typeof data.created_at.toDate === 'function'
                    ? data.created_at.toDate()
                    : new Date(data.created_at);
            }

            if (data.updated_at) {
                updatedAt = typeof data.updated_at.toDate === 'function'
                    ? data.updated_at.toDate()
                    : new Date(data.updated_at);
            }

            return {
                id: mealSnap.id,
                ...data,
                created_at: createdAt,
                updated_at: updatedAt,
            } as MealDocument;
        }

        return null;
    } catch (error) {
        console.error('Error fetching meal by date:', error);
        return null;
    }
}

/**
 * Get today's meal
 */
export async function getTodayMeal(): Promise<MealDocument | null> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return getMealByDate(today);
}

/**
 * Get tomorrow's meal
 */
export async function getTomorrowMeal(): Promise<MealDocument | null> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD
    return getMealByDate(tomorrowDate);
}

/**
 * Update a meal document
 */
export async function updateMeal(
    mealId: string, // This could be the Day ID ('31') or generic ID
    updates: Partial<MealDocument>
): Promise<boolean> {
    try {
        // Ensure we are using the correct ID format if a full date was passed by mistake,
        // though usually the UI passes the ID from the fetched document.
        // Assuming mealId IS the document ID (e.g. "6" or "31").
        const docId = getDayId(mealId);
        const mealRef = doc(db, MEALS_COLLECTION, docId);

        // Add updated_at timestamp
        await updateDoc(mealRef, {
            ...updates,
            updated_at: serverTimestamp(),
        });

        return true;
    } catch (error) {
        console.error('Error updating meal:', error);
        return false;
    }
}

/**
 * Toggle meal attendance for a user (Skip/Eat)
 */
export async function toggleMealAttendance(
    mealId: string,
    mealType: 'breakfast' | 'lunch' | 'dinner',
    userId: string,
    isSkipping: boolean // true if skipping, false if eating (default)
): Promise<boolean> {
    try {
        const docId = getDayId(mealId);
        const mealRef = doc(db, MEALS_COLLECTION, docId);

        // We need dot notation to update a specific key in the map without overwriting
        // e.g. "attendance.USER_ID.breakfast"
        // correct field path: attendance.{userId}.{mealType}
        // However, Firestore update with dot notation requires the map to exist?
        // Actually setDoc with merge: true is safer for deep nested maps if parent keys might not exist,
        // but updateDoc is fine if 'attendance' field exists or we use dot notation for known paths.
        // But if attendance map doesn't exist, dot notation "attendance.uid.meal" might fail if "attendance" is missing.
        // Safer to read content first OR use set with merge.
        // Let's use getDoc to be safe and simple for now, or just updateDoc with dot notation if we ensure structure.

        // Actually, we can just use `attendance.${userId}.${mealType}` directly? 
        // If `attendance` field is missing, updateDoc might fail.

        // Let's safe-guard by using setDoc with merge if we are unsure, OR just checking existence.
        // Let's try reading first to get current state map, modify it, and write back. 
        // It's less efficient but safer for strictly typed maps.

        // BETTER: Use dot notation which creates parents? No, Firestore update requires top-level field to exist.
        // Let's just use dot notation and assume we might need to initialize attendance if missing.

        const mealSnap = await getDoc(mealRef);
        if (!mealSnap.exists()) return false;

        const data = mealSnap.data() as MealDocument;
        const currentAttendance = data.attendance || {};
        const userAttendance = currentAttendance[userId] || { breakfast: true, lunch: true, dinner: true };

        // Update specific meal
        // valid 'eating' means value is TRUE. Skipping means FALSE.
        // input isSkipping: true -> set to false (not eating)
        // input isSkipping: false -> set to true (eating)
        userAttendance[mealType] = !isSkipping;

        // Update map
        await updateDoc(mealRef, {
            [`attendance.${userId}`]: userAttendance
        });

        return true;
    } catch (error) {
        console.error('Error toggling attendance:', error);
        return false;
    }
}

/**
 * Update meal responsibility assignment
 */
export async function updateMealResponsibility(
    mealId: string,
    slot: 'breakfastLunchId' | 'dinnerId',
    userId: string | null // null or empty string to unassign
): Promise<boolean> {
    try {
        const docId = getDayId(mealId);
        const mealRef = doc(db, MEALS_COLLECTION, docId);

        // Update specific responsibility field using dot notation
        // responsibility.breakfastLunchId OR responsibility.dinnerId
        const fieldPath = `responsibility.${slot}`;

        await updateDoc(mealRef, {
            [fieldPath]: userId || null // Store null if unassigning
        });

        return true;
    } catch (error) {
        console.error('Error updating responsibility:', error);
        return false;
    }
}

/**
 * Bulk update meal responsibility for multiple dates
 */
export async function bulkUpdateMealResponsibility(
    dates: string[], // Array of "DD" strings or "YYYY-MM-DD"
    updates: { breakfastLunchId?: string; dinnerId?: string }
): Promise<{ success: boolean; updated: number; error?: string }> {
    try {
        if (dates.length === 0) return { success: true, updated: 0 };

        const batch = writeBatch(db);
        let count = 0;

        dates.forEach(dateStr => {
            const docId = getDayId(dateStr);
            const mealRef = doc(db, MEALS_COLLECTION, docId);

            // We need to construct the update object dynamically
            const updateData: any = {};

            if (updates.breakfastLunchId !== undefined) {
                updateData['responsibility.breakfastLunchId'] = updates.breakfastLunchId || null;
            }

            if (updates.dinnerId !== undefined) {
                updateData['responsibility.dinnerId'] = updates.dinnerId || null;
            }

            if (Object.keys(updateData).length > 0) {
                // Use update, but we need to be careful if the document doesn't exist yet.
                // However, for this app, we assume meal docs exist (created by migration or other flows).
                // If they might not exist, we should use set with merge, but dot notation implies structure.
                // Safest to use update since we expect daily menu items.
                batch.update(mealRef, updateData);
                count++;
            }
        });

        await batch.commit();
        return { success: true, updated: count };
    } catch (error: any) {
        console.error('Error in bulk update responsibility:', error);
        return { success: false, updated: 0, error: error.message };
    }
}


/**
 * Get all meals from the collection
 */
export async function getAllMeals(): Promise<MealDocument[]> {
    try {
        const mealsRef = collection(db, MEALS_COLLECTION);
        const querySnapshot = await getDocs(mealsRef);

        const meals: MealDocument[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();

            // Safely handle timestamps - they might not exist or might not be Timestamp objects
            let createdAt = new Date();
            let updatedAt = new Date();

            if (data.created_at) {
                createdAt = typeof data.created_at.toDate === 'function'
                    ? data.created_at.toDate()
                    : new Date(data.created_at);
            }

            if (data.updated_at) {
                updatedAt = typeof data.updated_at.toDate === 'function'
                    ? data.updated_at.toDate()
                    : new Date(data.updated_at);
            }

            meals.push({
                id: doc.id,
                ...data,
                created_at: createdAt,
                updated_at: updatedAt,
            } as MealDocument);
        });

        return meals;
    } catch (error) {
        console.error('Error fetching all meals:', error);
        return [];
    }
}

/**
 * Update all meal dates to the current month AND migrate IDs to Day format
 * Preserves the day of month and shifts to current month/year
 * Migrates "YYYY-MM-DD" IDs to "D" IDs
 */
export async function updateMealDatesToCurrentMonth(): Promise<{ success: boolean; updated: number; error?: string }> {
    try {
        console.log('Starting meal date update and ID migration...');
        const meals = await getAllMeals();
        console.log(`Found ${meals.length} meals to update`);

        if (meals.length === 0) {
            return { success: false, updated: 0, error: 'No meals found in database' };
        }

        const batch = writeBatch(db);
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth(); // 0-indexed

        let updatedCount = 0;

        for (const meal of meals) {
            try {
                // Parse the original date from the document data
                // Assuming 'date' field exists and is "YYYY-MM-DD"
                const oldDateString = meal.date;
                const oldDate = new Date(oldDateString + 'T00:00:00');

                // Get the day of the month (1-31)
                const dayOfMonth = oldDate.getDate();

                // Create new date object for CURRENT month
                const newDate = new Date(currentYear, currentMonth, dayOfMonth);
                const newDateString = newDate.toISOString().split('T')[0]; // YYYY-MM-DD

                // Determine new Document ID: Just the day number (e.g., "6" or "31")
                const newDocId = dayOfMonth.toString();

                console.log(`Migrating/Updating: ${meal.id} -> DocID: ${newDocId} (Date: ${newDateString})`);

                // Get day of week for the new date
                const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const newDayOfWeek = daysOfWeek[newDate.getDay()];

                // Prepare references
                const oldRef = doc(db, MEALS_COLLECTION, meal.id);
                const newRef = doc(db, MEALS_COLLECTION, newDocId);

                // Prepare clean data
                const cleanData: any = {};
                for (const [key, value] of Object.entries(meal)) {
                    if (key !== 'id' && key !== 'created_at' && key !== 'updated_at') {
                        cleanData[key] = value;
                    }
                }

                // Update fields
                cleanData.date = newDateString;
                cleanData.day_of_week = newDayOfWeek;
                cleanData.updated_at = serverTimestamp();
                cleanData.created_at = meal.created_at || serverTimestamp();

                // Logic:
                // 1. If old ID == new ID, just update (e.g. already migrated, just rolling over month)
                // 2. If old ID != new ID (e.g. "2026-01-31" vs "31"), delete old, create new.

                if (meal.id === newDocId) {
                    batch.update(newRef, cleanData); // Just update fields
                } else {
                    batch.delete(oldRef); // Delete old ID doc
                    batch.set(newRef, cleanData); // Create new ID doc
                }

                updatedCount++;
            } catch (itemError: any) {
                console.error(`Error processing meal ${meal.id}:`, itemError);
                // Continue with other meals
            }
        }

        console.log(`Committing batch update/migration for ${updatedCount} meals...`);
        await batch.commit();
        console.log('Batch update completed successfully!');

        return { success: true, updated: updatedCount };
    } catch (error: any) {
        console.error('Error updating meal dates:', error);
        return { success: false, updated: 0, error: error.message || 'Unknown error occurred' };
    }
}
