'use server';

import { db } from './firebase';
import { collection, doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp, getDocs, writeBatch } from 'firebase/firestore';
import { MealDocument, MealItem } from '@/types/meal';

/**
 * Template collection — the read-only default menu that all new households see.
 * Admin can edit this via the Admin JSON Editor.
 */
const TEMPLATES_COLLECTION = 'menu_templates';

/**
 * Returns the Firestore collection name for a specific household's meals.
 * Each household gets its own collection so edits are isolated.
 */
function getHouseholdCollection(householdId: string): string {
    return `meals_${householdId}`;
}

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
 * Parse a raw Firestore document snapshot into a MealDocument.
 */
function parseMealDoc(docSnap: any): MealDocument {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        ...data,
        created_at: resolveTimestamp(data.created_at),
        updated_at: resolveTimestamp(data.updated_at),
    } as MealDocument;
}

/**
 * Try to find a meal doc by dayId in a given collection, with fallback to unpadded ID.
 */
async function findDocInCollection(collectionName: string, dayId: string): Promise<MealDocument | null> {
    const mealRef = doc(db, collectionName, dayId);
    const mealSnap = await getDoc(mealRef);

    if (mealSnap.exists()) {
        return parseMealDoc(mealSnap);
    }

    // Fallback: try the unpadded version (e.g. "1" if padded "01" wasn't found)
    const unpaddedId = parseInt(dayId, 10).toString();
    if (unpaddedId !== dayId) {
        const altRef = doc(db, collectionName, unpaddedId);
        const altSnap = await getDoc(altRef);
        if (altSnap.exists()) {
            return parseMealDoc(altSnap);
        }
    }

    return null;
}

// ─────────────────────────────────────────────────────────────
// READ operations — household first, template fallback
// ─────────────────────────────────────────────────────────────

/**
 * Get a meal document by date (YYYY-MM-DD) for a specific household.
 * Tries the household collection first, falls back to the template.
 */
export async function getMealByDate(date: string, householdId: string): Promise<MealDocument | null> {
    try {
        const docId = getDayId(date);

        // 1. Try household-specific collection
        const householdMeal = await findDocInCollection(getHouseholdCollection(householdId), docId);
        if (householdMeal) return householdMeal;

        // 2. Fallback to master template
        return await findDocInCollection(TEMPLATES_COLLECTION, docId);
    } catch (error) {
        console.error('Error fetching meal by date:', error);
        return null;
    }
}

/**
 * Get today's meal for a household
 */
export async function getTodayMeal(householdId: string): Promise<MealDocument | null> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return getMealByDate(today, householdId);
}

/**
 * Get tomorrow's meal for a household
 */
export async function getTomorrowMeal(householdId: string): Promise<MealDocument | null> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD
    return getMealByDate(tomorrowDate, householdId);
}

// ─────────────────────────────────────────────────────────────
// COPY-ON-WRITE: Ensure household doc exists before writing
// ─────────────────────────────────────────────────────────────

/**
 * Ensure a meal document exists in the household collection.
 * If it doesn't, copies it from the template collection.
 * Returns true if the doc exists (or was successfully copied).
 */
async function ensureHouseholdDoc(dayId: string, householdId: string): Promise<boolean> {
    const hhCollection = getHouseholdCollection(householdId);
    const hhRef = doc(db, hhCollection, dayId);
    const hhSnap = await getDoc(hhRef);

    if (hhSnap.exists()) return true;

    // Also check unpadded
    const unpaddedId = parseInt(dayId, 10).toString();
    if (unpaddedId !== dayId) {
        const altRef = doc(db, hhCollection, unpaddedId);
        const altSnap = await getDoc(altRef);
        if (altSnap.exists()) return true;
    }

    // Copy from template
    const templateDoc = await findDocInCollection(TEMPLATES_COLLECTION, dayId);
    if (!templateDoc) return false; // No template either

    // Write the template data (minus our parsed 'id') into the household collection
    const { id, created_at, updated_at, ...rest } = templateDoc;
    await setDoc(hhRef, {
        ...rest,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    });

    return true;
}

// ─────────────────────────────────────────────────────────────
// WRITE operations — always target the household collection
// ─────────────────────────────────────────────────────────────

/**
 * Update a meal document in the household collection.
 */
export async function updateMeal(
    mealId: string,
    updates: Partial<MealDocument>,
    householdId: string
): Promise<boolean> {
    try {
        const docId = getDayId(mealId);
        await ensureHouseholdDoc(docId, householdId);

        const hhCollection = getHouseholdCollection(householdId);
        const mealRef = doc(db, hhCollection, docId);

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
 * Toggle meal attendance for a user (Skip/Eat) — writes to household collection.
 */
export async function toggleMealAttendance(
    mealId: string,
    mealType: 'breakfast' | 'lunch' | 'dinner',
    userId: string,
    isSkipping: boolean,
    householdId: string
): Promise<boolean> {
    try {
        const docId = getDayId(mealId);
        await ensureHouseholdDoc(docId, householdId);

        const hhCollection = getHouseholdCollection(householdId);
        const mealRef = doc(db, hhCollection, docId);

        const mealSnap = await getDoc(mealRef);
        if (!mealSnap.exists()) return false;

        const data = mealSnap.data() as MealDocument;
        const currentAttendance = data.attendance || {};
        const userAttendance = currentAttendance[userId] || { breakfast: true, lunch: true, dinner: true };

        userAttendance[mealType] = !isSkipping;

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
 * Update meal responsibility assignment — writes to household collection.
 */
export async function updateMealResponsibility(
    mealId: string,
    slot: 'breakfastLunchId' | 'dinnerId',
    userId: string | null,
    householdId: string
): Promise<boolean> {
    try {
        const docId = getDayId(mealId);
        await ensureHouseholdDoc(docId, householdId);

        const hhCollection = getHouseholdCollection(householdId);
        const mealRef = doc(db, hhCollection, docId);

        const fieldPath = `responsibility.${slot}`;

        await updateDoc(mealRef, {
            [fieldPath]: userId || null
        });

        return true;
    } catch (error) {
        console.error('Error updating responsibility:', error);
        return false;
    }
}

/**
 * Bulk update meal responsibility for multiple dates — writes to household collection.
 */
export async function bulkUpdateMealResponsibility(
    dates: string[],
    updates: { breakfastLunchId?: string; dinnerId?: string },
    householdId: string
): Promise<{ success: boolean; updated: number; error?: string }> {
    try {
        if (dates.length === 0) return { success: true, updated: 0 };

        const hhCollection = getHouseholdCollection(householdId);

        // Ensure all household docs exist first (copy-on-write)
        for (const dateStr of dates) {
            const docId = getDayId(dateStr);
            await ensureHouseholdDoc(docId, householdId);
        }

        const batch = writeBatch(db);
        let count = 0;

        dates.forEach(dateStr => {
            const docId = getDayId(dateStr);
            const mealRef = doc(db, hhCollection, docId);

            const updateData: any = {};

            if (updates.breakfastLunchId !== undefined) {
                updateData['responsibility.breakfastLunchId'] = updates.breakfastLunchId || null;
            }

            if (updates.dinnerId !== undefined) {
                updateData['responsibility.dinnerId'] = updates.dinnerId || null;
            }

            if (Object.keys(updateData).length > 0) {
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


// ─────────────────────────────────────────────────────────────
// GET ALL — merges household overrides with template defaults
// ─────────────────────────────────────────────────────────────

/**
 * Get all meals — merges household collection with template fallbacks.
 * Days that exist in the household collection use that data;
 * Days only in the template use the template data.
 */
export async function getAllMeals(householdId: string): Promise<MealDocument[]> {
    try {
        // 1. Load all templates
        const templatesRef = collection(db, TEMPLATES_COLLECTION);
        const templateSnapshot = await getDocs(templatesRef);
        const templateMap = new Map<string, MealDocument>();

        templateSnapshot.forEach((docSnap) => {
            templateMap.set(docSnap.id, parseMealDoc(docSnap));
        });

        // 2. Load household overrides
        const hhCollection = getHouseholdCollection(householdId);
        const hhRef = collection(db, hhCollection);
        const hhSnapshot = await getDocs(hhRef);

        hhSnapshot.forEach((docSnap) => {
            // Override template entry with household data
            templateMap.set(docSnap.id, parseMealDoc(docSnap));
        });

        return Array.from(templateMap.values());
    } catch (error) {
        console.error('Error fetching all meals:', error);
        return [];
    }
}

/**
 * Get all template meals (admin-only, for the template editor).
 */
export async function getAllTemplateMeals(): Promise<MealDocument[]> {
    try {
        const templatesRef = collection(db, TEMPLATES_COLLECTION);
        const querySnapshot = await getDocs(templatesRef);

        const meals: MealDocument[] = [];
        querySnapshot.forEach((docSnap) => {
            meals.push(parseMealDoc(docSnap));
        });

        return meals;
    } catch (error) {
        console.error('Error fetching template meals:', error);
        return [];
    }
}


// ─────────────────────────────────────────────────────────────
// ADMIN: Update template dates to current month
// ─────────────────────────────────────────────────────────────

/**
 * Update all meal dates to the current month AND migrate IDs to Day format.
 * Operates on the TEMPLATE collection only (admin function).
 */
export async function updateMealDatesToCurrentMonth(): Promise<{ success: boolean; updated: number; error?: string }> {
    try {
        console.log('Starting template date update and ID migration...');
        const meals = await getAllTemplateMeals();
        console.log(`Found ${meals.length} template meals to update`);

        if (meals.length === 0) {
            return { success: false, updated: 0, error: 'No meals found in template database' };
        }

        const batch = writeBatch(db);
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth(); // 0-indexed

        let updatedCount = 0;

        for (const meal of meals) {
            try {
                const oldDateString = meal.date;
                const oldDate = new Date(oldDateString + 'T00:00:00');
                const dayOfMonth = oldDate.getDate();

                const newDate = new Date(currentYear, currentMonth, dayOfMonth);
                const newDateString = newDate.toISOString().split('T')[0];
                const newDocId = dayOfMonth.toString().padStart(2, '0');

                console.log(`Migrating/Updating: ${meal.id} -> DocID: ${newDocId} (Date: ${newDateString})`);

                const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const newDayOfWeek = daysOfWeek[newDate.getDay()];

                const oldRef = doc(db, TEMPLATES_COLLECTION, meal.id);
                const newRef = doc(db, TEMPLATES_COLLECTION, newDocId);

                const cleanData: any = {};
                for (const [key, value] of Object.entries(meal)) {
                    if (key !== 'id' && key !== 'created_at' && key !== 'updated_at') {
                        cleanData[key] = value;
                    }
                }

                cleanData.date = newDateString;
                cleanData.day_of_week = newDayOfWeek;
                cleanData.updated_at = serverTimestamp();
                cleanData.created_at = meal.created_at || serverTimestamp();

                if (meal.id === newDocId) {
                    batch.update(newRef, cleanData);
                } else {
                    batch.delete(oldRef);
                    batch.set(newRef, cleanData);
                }

                updatedCount++;
            } catch (itemError: any) {
                console.error(`Error processing meal ${meal.id}:`, itemError);
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


// ─────────────────────────────────────────────────────────────
// ADMIN: Copy dailymenu → menu_templates (one-time migration)
// ─────────────────────────────────────────────────────────────

/**
 * Copy all documents from the old 'dailymenu' collection to 'menu_templates'.
 * This is a one-time migration script for admins.
 */
export async function copyDailyMenuToTemplates(): Promise<{ success: boolean; copied: number; error?: string }> {
    try {
        const SOURCE = 'dailymenu';

        const sourceRef = collection(db, SOURCE);
        const sourceSnapshot = await getDocs(sourceRef);

        if (sourceSnapshot.empty) {
            return { success: false, copied: 0, error: 'No documents found in dailymenu collection' };
        }

        const batch = writeBatch(db);
        let count = 0;

        sourceSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const targetRef = doc(db, TEMPLATES_COLLECTION, docSnap.id);
            batch.set(targetRef, data);
            count++;
        });

        await batch.commit();
        console.log(`Copied ${count} documents from ${SOURCE} to ${TEMPLATES_COLLECTION}`);

        return { success: true, copied: count };
    } catch (error: any) {
        console.error('Error copying dailymenu to templates:', error);
        return { success: false, copied: 0, error: error.message || 'Unknown error' };
    }
}


// ─────────────────────────────────────────────────────────────
// USER MEALS — reads from household collection (with template fallback)
// ─────────────────────────────────────────────────────────────

/**
 * Get meals for a specific user (Assigned to Cook OR Attending)
 */
export async function getUserMeals(userId: string, householdId: string): Promise<{
    assigned: { date: string; mealType: string; meal: MealItem }[];
    attending: { date: string; mealType: string; meal: MealItem }[];
}> {
    try {
        const allMeals = await getAllMeals(householdId);
        const assigned: { date: string; mealType: string; meal: MealItem }[] = [];
        const attending: { date: string; mealType: string; meal: MealItem }[] = [];

        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1; // 1-12

        allMeals.forEach(doc => {
            // Synthesize the correct date for the current month using the doc.id (which is 01..31)
            const dayNum = parseInt(doc.id, 10);
            let realDateStr = doc.date;

            if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
                realDateStr = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
            }

            // Check Responsibility
            if (doc.responsibility?.breakfastLunchId === userId) {
                if (doc.breakfast) assigned.push({ date: realDateStr, mealType: 'Breakfast', meal: doc.breakfast });
                if (doc.lunch) assigned.push({ date: realDateStr, mealType: 'Lunch', meal: doc.lunch });
            }
            if (doc.responsibility?.dinnerId === userId) {
                if (doc.dinner) assigned.push({ date: realDateStr, mealType: 'Dinner', meal: doc.dinner });
            }

            // Check Attendance
            const userAttendance = doc.attendance?.[userId];
            if (userAttendance) {
                if (userAttendance.breakfast && doc.breakfast) attending.push({ date: realDateStr, mealType: 'Breakfast', meal: doc.breakfast });
                if (userAttendance.lunch && doc.lunch) attending.push({ date: realDateStr, mealType: 'Lunch', meal: doc.lunch });
                if (userAttendance.dinner && doc.dinner) attending.push({ date: realDateStr, mealType: 'Dinner', meal: doc.dinner });
            } else {
                // Default: If no record, assume eating
                if (doc.breakfast) attending.push({ date: realDateStr, mealType: 'Breakfast', meal: doc.breakfast });
                if (doc.lunch) attending.push({ date: realDateStr, mealType: 'Lunch', meal: doc.lunch });
                if (doc.dinner) attending.push({ date: realDateStr, mealType: 'Dinner', meal: doc.dinner });
            }
        });

        // Sort by date
        const sortFn = (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime();
        assigned.sort(sortFn);
        attending.sort(sortFn);

        // Filter out past cooking duties
        const todayStr = new Date().toISOString().split('T')[0];
        const futureAssigned = assigned.filter(item => item.date >= todayStr);

        return { assigned: futureAssigned, attending };
    } catch (error) {
        console.error('Error getting user meals:', error);
        return { assigned: [], attending: [] };
    }
}
