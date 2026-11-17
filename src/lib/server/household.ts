import 'server-only';

import { db, collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from './db';
import { MealDocument } from '@/types/meal';
import { syncMealCalendarAsync } from '../calendarSync';
import { MEMBERS_COLLECTION, USERS_COLLECTION } from './currentUser';

/**
 * Household-wide responsibility operations that take a *trusted* household ID.
 *
 * These used to be exported from the 'use server' module firestore.ts, which
 * made each of them a public endpoint accepting any household ID. They now
 * live here (not a server-action module); callers must authorize first.
 */

const TEMPLATES_COLLECTION = 'menu_templates';

function getHouseholdCollection(householdId: string): string {
    return `households/${householdId}/meals`;
}

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
                    const rest: Record<string, unknown> = { ...tDoc.data() };
                    delete rest.id;
                    delete rest.created_at;
                    delete rest.updated_at;
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

        // Sync only the real-date docs; template day docs (e.g. "01") are
        // filtered out inside syncMealCalendar.
        for (const docSnap of docs) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(docSnap.id)) {
                await syncMealCalendarAsync(householdId, docSnap.id);
            }
        }

        return { success: true, updated: docs.length };
    } catch (error) {
        console.error('Error redistributing responsibilities:', error);
        return { success: false, updated: 0, error: error instanceof Error ? error.message : String(error) };
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

    if (touched > 0) {
        await batch.commit();
        // Rebuild calendar events for affected real-date docs so the
        // departing member's events get deleted (and any successor picked
        // up by reassignment logic gets a new event).
        snap.forEach(d => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(d.id)) {
                syncMealCalendarAsync(householdId, d.id).catch(() => {});
            }
        });
    }
}
