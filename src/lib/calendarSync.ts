'use server';

import { db } from './firebase';
import { doc, getDoc, updateDoc, deleteField, setDoc, serverTimestamp, collection, getDocs } from 'firebase/firestore';
import { MealDocument, MealItem } from '@/types/meal';
import { getCalendarConnection } from './calendarTokens';
import {
    refreshAccessToken,
    createCalendarEvent,
    deleteCalendarEvent,
    updateCalendarEvent,
    CalendarEventInput,
} from './googleCalendar';

const HOUSEHOLD_COLLECTION = (householdId: string) => `households/${householdId}/meals`;

/**
 * Default meal times used to place calendar events. Kept as a constant here
 * so it's obvious how to tweak later (per-household preference, per-user
 * timezone override, etc). Times are local wall-clock in DEFAULT_TIMEZONE.
 * Breakfast and Lunch share a single calendar event because they share a
 * chef assignment (responsibility.breakfastLunchId).
 */
const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const SLOT_TIMES: Record<'breakfastLunch' | 'dinner', { start: string; end: string }> = {
    breakfastLunch: { start: '07:00:00', end: '07:30:00' },
    dinner: { start: '19:00:00', end: '19:30:00' },
};
// Reminder offsets in minutes before the event start.
//   breakfastLunch (07:00) → 22:00 the previous day = 9 hours = 540 min
//   dinner        (19:00) → 30 min before
const SLOT_REMINDER_MINUTES: Record<'breakfastLunch' | 'dinner', number> = {
    breakfastLunch: 9 * 60,
    dinner: 30,
};

type Slot = 'breakfastLunch' | 'dinner';
const SLOTS: Slot[] = ['breakfastLunch', 'dinner'];

function chefFieldForSlot(slot: Slot): 'breakfastLunchId' | 'dinnerId' {
    return slot === 'dinner' ? 'dinnerId' : 'breakfastLunchId';
}

/**
 * Assemble the event body for a single slot. For breakfastLunch, combines
 * both meals into one event; for dinner, uses just the dinner meal.
 * Returns null if there's nothing to cook (e.g. both meals missing).
 */
function buildEvent(
    slot: Slot,
    date: string,
    data: MealDocument
): CalendarEventInput | null {
    const times = SLOT_TIMES[slot];
    const startDateTime = `${date}T${times.start}`;
    const endDateTime = `${date}T${times.end}`;

    const parts: string[] = [];
    let title: string;

    if (slot === 'breakfastLunch') {
        const b = data.breakfast as MealItem | undefined;
        const l = data.lunch as MealItem | undefined;
        if (!b && !l) return null;
        const names = [b?.item_name, l?.item_name].filter(Boolean).join(' + ');
        title = `👨‍🍳 Cook Breakfast & Lunch: ${names}`;

        if (b) {
            parts.push(`— Breakfast: ${b.item_name}${b.calories ? ` (~${b.calories} kcal)` : ''}`);
            if (b.ingredients?.length) parts.push(`  Ingredients: ${b.ingredients.join(', ')}`);
            if (b.cooking_instructions?.length) parts.push(`  Steps:\n${b.cooking_instructions.map((s, i) => `    ${i + 1}. ${s}`).join('\n')}`);
        }
        if (l) {
            parts.push(`— Lunch: ${l.item_name}${l.calories ? ` (~${l.calories} kcal)` : ''}`);
            if (l.ingredients?.length) parts.push(`  Ingredients: ${l.ingredients.join(', ')}`);
            if (l.cooking_instructions?.length) parts.push(`  Steps:\n${l.cooking_instructions.map((s, i) => `    ${i + 1}. ${s}`).join('\n')}`);
        }
    } else {
        const d = data.dinner as MealItem | undefined;
        if (!d) return null;
        title = `👨‍🍳 Cook Dinner: ${d.item_name}`;
        if (d.calories) parts.push(`~${d.calories} kcal`);
        if (d.ingredients?.length) parts.push(`Ingredients:\n- ${d.ingredients.join('\n- ')}`);
        if (d.cooking_instructions?.length) parts.push(`Steps:\n${d.cooking_instructions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
    }

    return {
        summary: title,
        description: parts.join('\n\n'),
        start: { dateTime: startDateTime, timeZone: DEFAULT_TIMEZONE },
        end: { dateTime: endDateTime, timeZone: DEFAULT_TIMEZONE },
        reminders: {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: SLOT_REMINDER_MINUTES[slot] }],
        },
    };
}

/**
 * True only for `YYYY-MM-DD` docs. Template day-of-month docs (e.g. "01")
 * are skipped — they don't map to any specific calendar date.
 */
function isFullDate(id: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(id);
}

/**
 * Given a member's uid, resolve access token from stored refresh_token.
 * Returns null (not throws) when the user hasn't connected — the sync
 * loop treats that as "skip this chef, leave no event".
 */
async function accessTokenFor(uid: string): Promise<string | null> {
    const conn = await getCalendarConnection(uid);
    if (!conn) return null;
    try {
        const t = await refreshAccessToken(conn.refreshToken);
        return t.access_token;
    } catch (err) {
        console.warn(`[calendarSync] refresh failed for ${uid}:`, err);
        return null;
    }
}

/**
 * Best-effort delete. Swallows errors so a bad token / revoked grant
 * doesn't break the sync loop or the underlying meal write.
 */
async function safeDelete(uid: string, eventId: string): Promise<void> {
    try {
        const token = await accessTokenFor(uid);
        if (!token) return;
        await deleteCalendarEvent(token, eventId);
    } catch (err) {
        console.warn(`[calendarSync] delete failed uid=${uid} event=${eventId}:`, err);
    }
}

/**
 * Reconcile the calendar-events map on a meal doc against its current
 * responsibility assignments. For each slot:
 *   - chef unchanged  → patch existing event (name/ingredients may have changed)
 *   - chef changed    → delete old event, create new one on new chef's cal
 *   - no chef (null)  → delete any existing event
 * Writes the resulting eventId map back onto the meal doc.
 *
 * Called after every meal-mutating write. Failures are logged but never
 * thrown — calendar sync is best-effort and must not break the app flow.
 */
export async function syncMealCalendar(householdId: string, mealId: string): Promise<void> {
    if (!isFullDate(mealId)) return; // Template day docs have no real date

    try {
        const ref = doc(db, HOUSEHOLD_COLLECTION(householdId), mealId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const data = snap.data() as MealDocument;
        const currentEvents = data.calendarEvents ?? {};
        const responsibility = data.responsibility ?? {};

        // Legacy cleanup: earlier versions stored per-meal events under
        // `breakfast` / `lunch` keys. If we see those, delete them from the
        // owning chef's calendar so we don't leave duplicates behind.
        for (const legacyKey of ['breakfast', 'lunch'] as const) {
            const legacy = (currentEvents as any)[legacyKey];
            if (legacy?.eventId && legacy?.chefUid) {
                await safeDelete(legacy.chefUid, legacy.eventId);
            }
        }

        const nextEvents: NonNullable<MealDocument['calendarEvents']> = {};

        for (const slot of SLOTS) {
            const chefUid = (responsibility as any)[chefFieldForSlot(slot)] as string | undefined | null;
            const existing = currentEvents[slot];
            const event = chefUid ? buildEvent(slot, mealId, data) : null;

            // No chef or nothing to cook → drop any existing event
            if (!chefUid || !event) {
                if (existing) await safeDelete(existing.chefUid, existing.eventId);
                continue;
            }

            // Chef changed → delete old, create new
            if (existing && existing.chefUid !== chefUid) {
                await safeDelete(existing.chefUid, existing.eventId);
                const token = await accessTokenFor(chefUid);
                if (!token) continue; // new chef hasn't connected
                try {
                    const newId = await createCalendarEvent(token, event);
                    nextEvents[slot] = { chefUid, eventId: newId };
                } catch (err) {
                    console.warn(`[calendarSync] create failed for ${chefUid}:`, err);
                }
                continue;
            }

            // Chef unchanged and event exists → patch (meal name/ingredients may have changed)
            if (existing && existing.chefUid === chefUid) {
                const token = await accessTokenFor(chefUid);
                if (!token) continue; // chef disconnected — drop record
                try {
                    await updateCalendarEvent(token, existing.eventId, event);
                    nextEvents[slot] = existing;
                } catch (err) {
                    console.warn(`[calendarSync] patch failed for ${chefUid}:`, err);
                }
                continue;
            }

            // No existing event, chef assigned → create fresh
            const token = await accessTokenFor(chefUid);
            if (!token) continue;
            try {
                const newId = await createCalendarEvent(token, event);
                nextEvents[slot] = { chefUid, eventId: newId };
            } catch (err) {
                console.warn(`[calendarSync] create failed for ${chefUid}:`, err);
            }
        }

        // Persist the new map (or clear it if empty)
        const hasEntries = Object.keys(nextEvents).length > 0;
        await updateDoc(ref, {
            calendarEvents: hasEntries ? nextEvents : deleteField(),
        });
    } catch (err) {
        console.warn(`[calendarSync] sync failed for ${householdId}/${mealId}:`, err);
    }
}

/**
 * Fire-and-forget wrapper — meant to be called from write helpers without
 * blocking their response. Errors are already swallowed inside syncMealCalendar,
 * but we also detach the promise so awaiters return immediately.
 */
export async function syncMealCalendarAsync(householdId: string, mealId: string): Promise<void> {
    // Note: in Next.js serverless environments the function may terminate
    // before the detached promise resolves. In dev/self-host that's fine;
    // on Vercel prefer `waitUntil` or awaiting inline. We await here so it
    // completes deterministically, and rely on failures being swallowed.
    await syncMealCalendar(householdId, mealId);
}

/**
 * Ensure a real-date household doc exists for the given date, seeded from
 * the day-of-month template if needed. Mirrors the logic in firestore.ts's
 * ensureHouseholdDoc but scoped to what backfill needs.
 */
async function materializeDate(householdId: string, dateStr: string): Promise<boolean> {
    const hhCollection = `households/${householdId}/meals`;
    const dateRef = doc(db, hhCollection, dateStr);
    const dateSnap = await getDoc(dateRef);
    if (dateSnap.exists()) return true;

    // Try day-of-month fallbacks (padded and unpadded)
    const dayNum = parseInt(dateStr.split('-')[2], 10);
    const candidates = [dayNum.toString().padStart(2, '0'), dayNum.toString()];
    for (const cand of candidates) {
        const templateRef = doc(db, hhCollection, cand);
        const templateSnap = await getDoc(templateRef);
        if (templateSnap.exists()) {
            const { id: _id, created_at: _c, updated_at: _u, ...rest } = templateSnap.data() as any;
            await setDoc(dateRef, {
                ...rest,
                date: dateStr,
                created_at: serverTimestamp(),
                updated_at: serverTimestamp(),
            });
            return true;
        }
    }

    // Fall back to master template collection
    for (const cand of candidates) {
        const masterRef = doc(db, 'menu_templates', cand);
        const masterSnap = await getDoc(masterRef);
        if (masterSnap.exists()) {
            const { id: _id, created_at: _c, updated_at: _u, ...rest } = masterSnap.data() as any;
            await setDoc(dateRef, {
                ...rest,
                date: dateStr,
                created_at: serverTimestamp(),
                updated_at: serverTimestamp(),
            });
            return true;
        }
    }
    return false;
}

/**
 * One-shot backfill: for each of the next `days` calendar days, ensure a
 * real-date household meal doc exists and push its assigned chef events
 * to whichever members have connected their calendar.
 * Returns how many dates were successfully synced.
 */
export async function backfillCalendarSync(
    householdId: string,
    days: number = 30
): Promise<{ synced: number; skipped: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let synced = 0;
    let skipped = 0;
    for (let i = 0; i < days; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const ok = await materializeDate(householdId, dateStr);
        if (!ok) {
            skipped++;
            continue;
        }
        await syncMealCalendar(householdId, dateStr);
        synced++;
    }
    return { synced, skipped };
}
