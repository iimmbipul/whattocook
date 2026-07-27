'use server';

import { db } from './firebase';
import { collection, doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp, getDocs, writeBatch, query, where } from 'firebase/firestore';
import { MealDocument, MealItem } from '@/types/meal';

/**
 * Template collection — the read-only default menu that all new households see.
 * Admin can edit this via the Admin JSON Editor.
 */
const TEMPLATES_COLLECTION = 'menu_templates';

const USERS_COLLECTION = 'users';
const MEMBERS_COLLECTION = 'members';
const COOKS_COLLECTION = 'cooks';

/**
 * Return household participants eligible to receive cooking responsibility:
 * owner + members. Cooks are excluded — they're hired help, not part of the
 * rotation the household divides duties across.
 */
export async function getHouseholdMemberIds(householdId: string): Promise<string[]> {
    const ids: string[] = [];

    const ownerSnap = await getDoc(doc(db, USERS_COLLECTION, householdId));
    if (ownerSnap.exists()) ids.push(householdId);

    const membersSnap = await getDocs(
        query(collection(db, MEMBERS_COLLECTION), where('linkedUserId', '==', householdId))
    );
    membersSnap.forEach(d => ids.push(d.id));

    return ids;
}

/**
 * Returns the Firestore collection name for a specific household's meals.
 * Each household gets its own collection so edits are isolated.
 */
function getHouseholdCollection(householdId: string): string {
    return `households/${householdId}/meals`;
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
 * Tries the household collection specific date first, then the household generic day, then template.
 */
export async function getMealByDate(date: string, householdId: string): Promise<MealDocument | null> {
    try {
        const hhCollection = getHouseholdCollection(householdId);

        // 1. Try specific date in household (e.g. 2026-03-17)
        let meal = await findDocInCollection(hhCollection, date);
        if (meal) return meal;

        const docId = getDayId(date);

        // 2. Try generic day in household
        meal = await findDocInCollection(hhCollection, docId);
        if (meal) return meal;

        // 3. Fallback to master template
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
 * If it doesn't, copies it from the template collection or generic fallback.
 * Returns true if the doc exists (or was successfully copied).
 */
async function ensureHouseholdDoc(docId: string, householdId: string): Promise<boolean> {
    const hhCollection = getHouseholdCollection(householdId);
    const hhRef = doc(db, hhCollection, docId);
    const hhSnap = await getDoc(hhRef);

    if (hhSnap.exists()) return true;

    // It doesn't exist. We need to copy from fallback.
    let fallbackDoc = null;
    const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(docId);

    if (isFullDate) {
        const dayId = getDayId(docId);
        // Try household unpadded/padded
        fallbackDoc = await findDocInCollection(hhCollection, dayId);
        if (!fallbackDoc) fallbackDoc = await findDocInCollection(hhCollection, parseInt(dayId, 10).toString());
        if (!fallbackDoc) fallbackDoc = await findDocInCollection(TEMPLATES_COLLECTION, dayId);
    } else {
        // Just day ID, fallback is template
        fallbackDoc = await findDocInCollection(TEMPLATES_COLLECTION, docId);
        if (!fallbackDoc) fallbackDoc = await findDocInCollection(TEMPLATES_COLLECTION, parseInt(docId, 10).toString());
    }

    if (!fallbackDoc) {
        // If there's no template, create an empty one so it doesn't crash on updates!
        fallbackDoc = {
            id: docId,
            date: isFullDate ? docId : "unknown",
            day_of_week: "Unknown",
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            total_calories: 0,
            breakfast: { item_name: 'Not Set', calories: 0, image_url: '', is_vegetarian: false },
            lunch: { item_name: 'Not Set', calories: 0, image_url: '', is_vegetarian: false },
            dinner: { item_name: 'Not Set', calories: 0, image_url: '', is_vegetarian: false },
        };
    }

    const { id, created_at, updated_at, ...rest } = fallbackDoc;
    await setDoc(hhRef, {
        ...rest,
        date: isFullDate ? docId : rest.date,
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
    householdId: string,
    applyToAllMonths: boolean = false
): Promise<boolean> {
    try {
        const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(mealId);
        const docId = (applyToAllMonths && isFullDate) ? getDayId(mealId) : mealId;

        await ensureHouseholdDoc(docId, householdId);

        const hhCollection = getHouseholdCollection(householdId);
        const mealRef = doc(db, hhCollection, docId);

        await updateDoc(mealRef, {
            ...updates,
            updated_at: serverTimestamp(),
        });

        // If applying to all months, also update the specific date doc if it exists so UI updates instantly
        if (applyToAllMonths && isFullDate) {
            const specificRef = doc(db, hhCollection, mealId);
            const snap = await getDoc(specificRef);
            if (snap.exists()) {
                await updateDoc(specificRef, {
                    ...updates,
                    updated_at: serverTimestamp(),
                });
            }
        }

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
        const docId = mealId; // Always specific date
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
            ...data,
            attendance: {
                ...currentAttendance,
                [userId]: userAttendance
            }
        });

        // If this user was the assigned cook for the affected slot AND is now
        // skipping any of that slot's meals, hand it off to the least-loaded
        // member who isn't also skipping.
        if (isSkipping) {
            const resp = data.responsibility || {};
            const isBLSlot = mealType === 'breakfast' || mealType === 'lunch';
            if (isBLSlot && resp.breakfastLunchId === userId) {
                await reassignSkippedSlot(docId, 'breakfastLunchId', householdId, userId);
            }
            if (mealType === 'dinner' && resp.dinnerId === userId) {
                await reassignSkippedSlot(docId, 'dinnerId', householdId, userId);
            }
        }

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
        const docId = mealId; // Always specific date
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
    updates: { breakfastLunchId?: string | null; dinnerId?: string | null },
    householdId: string
): Promise<{ success: boolean; updated: number; error?: string }> {
    try {
        if (dates.length === 0) return { success: true, updated: 0 };

        const hhCollection = getHouseholdCollection(householdId);

        // Ensure all household docs exist first (copy-on-write)
        for (const dateStr of dates) {
            const docId = dateStr; // Specific date
            await ensureHouseholdDoc(docId, householdId);
        }

        const batch = writeBatch(db);
        let count = 0;

        dates.forEach(dateStr => {
            const docId = dateStr; // Specific date
            const mealRef = doc(db, hhCollection, docId);

            const updateNested: any = { responsibility: {} };

            if (updates.breakfastLunchId !== undefined) {
                updateNested.responsibility.breakfastLunchId = updates.breakfastLunchId;
            }

            if (updates.dinnerId !== undefined) {
                updateNested.responsibility.dinnerId = updates.dinnerId;
            }

            if (Object.keys(updateNested.responsibility).length > 0) {
                batch.set(mealRef, updateNested, { merge: true });
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
// FAIR DISTRIBUTION of cooking responsibility
// ─────────────────────────────────────────────────────────────

/**
 * Reset & evenly distribute cooking responsibility across all household participants.
 * Iterates every meal doc in the household collection and assigns
 * Breakfast+Lunch and Dinner slots in a round-robin so counts stay balanced.
 */
export async function redistributeResponsibilitiesEqually(
    householdId: string,
    memberIds: string[]
): Promise<{ success: boolean; updated: number; error?: string }> {
    try {
        if (!memberIds.length) return { success: true, updated: 0 };

        const hhCollection = getHouseholdCollection(householdId);
        let snap = await getDocs(collection(db, hhCollection));

        // Legacy households have no meal docs until the first edit — seed the
        // subcollection from the master template so we have something to assign.
        if (snap.empty) {
            const templateSnap = await getDocs(collection(db, TEMPLATES_COLLECTION));
            if (!templateSnap.empty) {
                const seedBatch = writeBatch(db);
                templateSnap.forEach((tDoc) => {
                    const data = tDoc.data();
                    const { id: _id, created_at: _c, updated_at: _u, ...rest } = data as any;
                    const targetRef = doc(db, hhCollection, tDoc.id);
                    seedBatch.set(targetRef, {
                        ...rest,
                        created_at: serverTimestamp(),
                        updated_at: serverTimestamp(),
                    });
                });
                await seedBatch.commit();
                snap = await getDocs(collection(db, hhCollection));
            }
        }

        if (snap.empty) {
            return { success: false, updated: 0, error: 'No meal days found in household or template collection.' };
        }

        // Sort deterministically so re-runs produce the same schedule
        const docs = snap.docs.slice().sort((a, b) => a.id.localeCompare(b.id));

        // Weight each slot by the number of future meals it would produce,
        // so the same rule used on the profile page (My Plates counting) gets
        // balanced — template docs count for current + next month, past dates
        // count for 0. Then greedily assign each slot (heaviest first) to the
        // currently-least-loaded member.
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;
        const todayStr = today.toISOString().split('T')[0];

        const futureOccurrences = (id: string): number => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(id)) return id >= todayStr ? 1 : 0;
            const dayNum = parseInt(id, 10);
            if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) return 0;
            const thisMonth = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
            let nextY = currentYear, nextM = currentMonth + 1;
            if (nextM > 12) { nextM = 1; nextY++; }
            const nextMonth = `${nextY}-${nextM.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
            return (thisMonth >= todayStr ? 1 : 0) + (nextMonth >= todayStr ? 1 : 0);
        };

        type Slot = { docIdx: number; kind: 'bl' | 'd'; weight: number };
        const slots: Slot[] = [];
        docs.forEach((docSnap, idx) => {
            const data = docSnap.data() as MealDocument;
            const occ = futureOccurrences(docSnap.id);
            const blMeals = (data.breakfast ? 1 : 0) + (data.lunch ? 1 : 0);
            const dMeals = data.dinner ? 1 : 0;
            slots.push({ docIdx: idx, kind: 'bl', weight: occ * blMeals });
            slots.push({ docIdx: idx, kind: 'd', weight: occ * dMeals });
        });

        // Heaviest slots first; tie-break by docIdx + kind for determinism
        slots.sort((a, b) => b.weight - a.weight || a.docIdx - b.docIdx || (a.kind < b.kind ? -1 : 1));

        const load: Record<string, number> = {};
        memberIds.forEach(id => { load[id] = 0; });

        // Rotating tiebreak so members with equal load don't all get pinned
        // to the first uid in memberIds order.
        let rotation = 0;

        const assignments: Record<number, { bl?: string; d?: string }> = {};
        for (const slot of slots) {
            const ordered = memberIds
                .slice(rotation)
                .concat(memberIds.slice(0, rotation));
            const pick = ordered.reduce((best, uid) =>
                load[uid] < load[best] ? uid : best
            , ordered[0]);
            rotation = (rotation + 1) % memberIds.length;

            load[pick] += slot.weight;
            const cur = assignments[slot.docIdx] || {};
            if (slot.kind === 'bl') cur.bl = pick; else cur.d = pick;
            assignments[slot.docIdx] = cur;
        }

        const batch = writeBatch(db);
        docs.forEach((docSnap, idx) => {
            const a = assignments[idx] || {};
            batch.set(docSnap.ref, {
                responsibility: {
                    breakfastLunchId: a.bl ?? null,
                    dinnerId: a.d ?? null,
                }
            }, { merge: true });
        });

        await batch.commit();
        return { success: true, updated: docs.length };
    } catch (error: any) {
        console.error('Error redistributing responsibilities:', error);
        return { success: false, updated: 0, error: error.message };
    }
}

/**
 * Convenience wrapper: fetch members and redistribute in one call.
 */
export async function resetHouseholdResponsibilities(
    householdId: string
): Promise<{ success: boolean; updated: number; error?: string }> {
    const memberIds = await getHouseholdMemberIds(householdId);
    return redistributeResponsibilitiesEqually(householdId, memberIds);
}

/**
 * Null out any responsibility assignments pointing at a departing member,
 * so counts stay accurate and skipped-slot reassignment can pick them up.
 */
export async function clearMemberAssignments(
    householdId: string,
    memberUid: string
): Promise<void> {
    const hhCollection = getHouseholdCollection(householdId);
    const snap = await getDocs(collection(db, hhCollection));
    const batch = writeBatch(db);
    let touched = 0;

    snap.forEach(d => {
        const data = d.data() as MealDocument;
        const update: Record<string, unknown> = {};
        if (data.responsibility?.breakfastLunchId === memberUid) {
            update['responsibility.breakfastLunchId'] = null;
        }
        if (data.responsibility?.dinnerId === memberUid) {
            update['responsibility.dinnerId'] = null;
        }
        if (Object.keys(update).length > 0) {
            batch.update(doc(db, hhCollection, d.id), update);
            touched++;
        }
    });

    if (touched > 0) await batch.commit();
}

/**
 * Per-member cooking-task counts, using the same rules as getUserMeals
 * (My Plates → Cooking Duties) so the numbers match what the user sees there:
 *   - counts individual meals, not responsibility slots
 *     (Breakfast+Lunch assignment contributes 2, Dinner contributes 1)
 *   - expands template day-of-month docs into current + next calendar month
 *   - only counts today and future dates
 */
export async function getHouseholdAssignmentCounts(
    householdId: string
): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const bump = (uid: string, n: number) => {
        counts[uid] = (counts[uid] ?? 0) + n;
    };

    const allMeals = await getAllMeals(householdId);

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const todayStr = today.toISOString().split('T')[0];

    const activeMealsMap = new Map<string, MealDocument>();

    allMeals.forEach(doc => {
        const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(doc.id);
        if (isFullDate) {
            activeMealsMap.set(doc.id, doc);
        } else {
            const dayNum = parseInt(doc.id, 10);
            if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
                const dateKey = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
                if (!activeMealsMap.has(dateKey)) activeMealsMap.set(dateKey, doc);

                let nextMonth = currentMonth + 1;
                let nextYear = currentYear;
                if (nextMonth > 12) { nextMonth = 1; nextYear++; }

                const nextDateKey = `${nextYear}-${nextMonth.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
                if (!activeMealsMap.has(nextDateKey)) activeMealsMap.set(nextDateKey, doc);
            }
        }
    });

    activeMealsMap.forEach((doc, dateStr) => {
        if (dateStr < todayStr) return;

        const bl = doc.responsibility?.breakfastLunchId;
        if (bl) {
            let n = 0;
            if (doc.breakfast) n++;
            if (doc.lunch) n++;
            if (n > 0) bump(bl, n);
        }

        const dn = doc.responsibility?.dinnerId;
        if (dn && doc.dinner) {
            bump(dn, 1);
        }
    });

    return counts;
}

/**
 * Count how many BL/Dinner slots each member is currently assigned across
 * every household meal doc. Used to find the least-loaded replacement.
 */
async function countResponsibilities(
    householdId: string,
    memberIds: string[]
): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    memberIds.forEach(id => counts.set(id, 0));

    const hhCollection = getHouseholdCollection(householdId);
    const snap = await getDocs(collection(db, hhCollection));
    snap.forEach(d => {
        const data = d.data() as MealDocument;
        const bl = data.responsibility?.breakfastLunchId;
        const dn = data.responsibility?.dinnerId;
        if (bl && counts.has(bl)) counts.set(bl, counts.get(bl)! + 1);
        if (dn && counts.has(dn)) counts.set(dn, counts.get(dn)! + 1);
    });

    return counts;
}

/**
 * When the assigned cook for a slot skips one of its meals, find the
 * least-loaded member who isn't skipping the same slot and reassign.
 * If nobody is available (everyone skips), the slot is left unassigned.
 */
async function reassignSkippedSlot(
    mealId: string,
    slot: 'breakfastLunchId' | 'dinnerId',
    householdId: string,
    excludeUserId: string
): Promise<void> {
    const memberIds = await getHouseholdMemberIds(householdId);
    if (!memberIds.length) return;

    const hhCollection = getHouseholdCollection(householdId);
    const mealRef = doc(db, hhCollection, mealId);
    const mealSnap = await getDoc(mealRef);
    if (!mealSnap.exists()) return;

    const mealData = mealSnap.data() as MealDocument;
    const attendance = mealData.attendance || {};
    const slotMeals: Array<'breakfast' | 'lunch' | 'dinner'> =
        slot === 'breakfastLunchId' ? ['breakfast', 'lunch'] : ['dinner'];

    const isSkipping = (uid: string) => {
        const a = attendance[uid];
        if (!a) return false;
        return slotMeals.some(m => a[m] === false);
    };

    const counts = await countResponsibilities(householdId, memberIds);

    const candidates = memberIds
        .filter(id => id !== excludeUserId && !isSkipping(id))
        .sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));

    const newAssignee = candidates[0] ?? null;

    await updateDoc(mealRef, {
        [`responsibility.${slot}`]: newAssignee,
    });
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

        const activeMealsMap = new Map<string, MealDocument>(); // Key is YYYY-MM-DD

        allMeals.forEach(doc => {
            const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(doc.id);
            if (isFullDate) {
                activeMealsMap.set(doc.id, doc);
            } else {
                const dayNum = parseInt(doc.id, 10);
                if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
                    // Map to current month
                    const dateKey = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
                    if (!activeMealsMap.has(dateKey)) activeMealsMap.set(dateKey, doc);

                    // Map to next month
                    let nextMonth = currentMonth + 1;
                    let nextYear = currentYear;
                    if (nextMonth > 12) { nextMonth = 1; nextYear++; }

                    const nextDateKey = `${nextYear}-${nextMonth.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
                    if (!activeMealsMap.has(nextDateKey)) activeMealsMap.set(nextDateKey, doc);
                }
            }
        });

        activeMealsMap.forEach((doc, realDateStr) => {
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
