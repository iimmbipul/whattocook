'use server';

import { db } from './firebase';
import { collection, doc, getDoc, updateDoc, serverTimestamp, Timestamp, getDocs, writeBatch } from 'firebase/firestore';
import { MealDocument, MealItem } from '@/types/meal';

const MEALS_COLLECTION = 'dailymenu';

/**
 * Safely parse a Firestore timestamp into a JS Date.
 * Handles: real Firestore Timestamp, plain {seconds, nanoseconds} object, and ISO strings.
 */
function resolveTimestamp(value: any): Date {
    if (!value) return new Date();
    if (typeof value.toDate === 'function') return value.toDate();          // Firestore Timestamp
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000); // plain {seconds}
    if (typeof value === 'string') return new Date(value);                   // ISO string
    return new Date();
}

/**
 * Helper to get the Document ID from a date — always returns zero-padded 2-digit string.
 * Accepts: "2026-01-31" → "31" | "01" → "01" | "1" → "01" | "31" → "31"
 */
function getDayId(dateString: string): string {
    // Already a 1 or 2 digit number (with or without leading zero)
    if (/^\d{1,2}$/.test(dateString)) {
        return parseInt(dateString, 10).toString().padStart(2, '0');
    }
    // Full ISO date e.g. "2026-01-31"
    const parts = dateString.split('-');
    if (parts.length === 3) {
        return parseInt(parts[2], 10).toString().padStart(2, '0');
    }
    const date = new Date(dateString);
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

            // Safely handle timestamps — support Firestore Timestamp, plain {seconds} object, and ISO strings
            const createdAt = resolveTimestamp(data.created_at);
            const updatedAt = resolveTimestamp(data.updated_at);

            return {
                id: mealSnap.id,
                ...data,
                created_at: createdAt,
                updated_at: updatedAt,
            } as MealDocument;
        }

        // Fallback: try the unpadded version (e.g. "1" if padded "01" wasn't found)
        const unpaddedId = parseInt(docId, 10).toString();
        if (unpaddedId !== docId) {
            const altRef = doc(db, MEALS_COLLECTION, unpaddedId);
            const altSnap = await getDoc(altRef);
            if (altSnap.exists()) {
                const data = altSnap.data();
                return {
                    id: altSnap.id,
                    ...data,
                    created_at: resolveTimestamp(data.created_at),
                    updated_at: resolveTimestamp(data.updated_at),
                } as MealDocument;
            }
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

            const createdAt = resolveTimestamp(data.created_at);
            const updatedAt = resolveTimestamp(data.updated_at);

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

                // Determine new Document ID: zero-padded 2-digit day (e.g. "01", "22")
                const newDocId = dayOfMonth.toString().padStart(2, '0');

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

/**
 * Get meals for a specific user (Assigned to Cook OR Attending)
 */
export async function getUserMeals(userId: string): Promise<{
    assigned: { date: string; mealType: string; meal: MealItem }[];
    attending: { date: string; mealType: string; meal: MealItem }[];
}> {
    try {
        const allMeals = await getAllMeals();
        const assigned: { date: string; mealType: string; meal: MealItem }[] = [];
        const attending: { date: string; mealType: string; meal: MealItem }[] = [];

        allMeals.forEach(doc => {
            // Check Responsibility
            if (doc.responsibility?.breakfastLunchId === userId) {
                if (doc.breakfast) assigned.push({ date: doc.date, mealType: 'Breakfast', meal: doc.breakfast });
                if (doc.lunch) assigned.push({ date: doc.date, mealType: 'Lunch', meal: doc.lunch });
            }
            if (doc.responsibility?.dinnerId === userId) {
                if (doc.dinner) assigned.push({ date: doc.date, mealType: 'Dinner', meal: doc.dinner });
            }

            // Check Attendance
            // If user record exists in attendance map
            const userAttendance = doc.attendance?.[userId];
            if (userAttendance) {
                if (userAttendance.breakfast && doc.breakfast) attending.push({ date: doc.date, mealType: 'Breakfast', meal: doc.breakfast });
                if (userAttendance.lunch && doc.lunch) attending.push({ date: doc.date, mealType: 'Lunch', meal: doc.lunch });
                if (userAttendance.dinner && doc.dinner) attending.push({ date: doc.date, mealType: 'Dinner', meal: doc.dinner });
            } else {
                // Default: If no record, assume eating? Or assume not?
                // In MealCard we assumed "eating" if record doesn't exist.
                // But for "My Plates" list, maybe only show explicit or default "eating".
                // Let's stick to: If record undefined => Eating (default).
                if (doc.breakfast) attending.push({ date: doc.date, mealType: 'Breakfast', meal: doc.breakfast });
                if (doc.lunch) attending.push({ date: doc.date, mealType: 'Lunch', meal: doc.lunch });
                if (doc.dinner) attending.push({ date: doc.date, mealType: 'Dinner', meal: doc.dinner });
            }
        });

        // Sort by date
        const sortFn = (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime();
        assigned.sort(sortFn);
        attending.sort(sortFn);

        // Filter out past cooking duties (assigned)
        // We keep today and future
        const todayStr = new Date().toISOString().split('T')[0];
        const futureAssigned = assigned.filter(item => item.date >= todayStr);

        return { assigned: futureAssigned, attending };
    } catch (error) {
        console.error('Error getting user meals:', error);
        return { assigned: [], attending: [] };
    }
}
