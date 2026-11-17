'use server';

import { db, addDoc, collection, doc, serverTimestamp, getDocs, query, orderBy, limit, writeBatch, arrayUnion } from './server/db';
import { NotificationType } from '@/types/meal';
import { authorizeHousehold, isSafeDocId } from './server/guards';

const MAX_RETAINED = 50;
const MAX_MARK_READ = 100;

function notificationsCollection(householdId: string) {
    return collection(db, `households/${householdId}/notifications`);
}

/**
 * Append a household notification. Fire-and-forget from the caller's
 * perspective — write failures are logged but never throw so a broken
 * notification pipeline cannot block a meal write.
 *
 * This module is reachable from the browser, so the household must be the
 * caller's own and the actor is always the signed-in user.
 */
export async function createNotification(
    householdId: string,
    input: {
        type: NotificationType;
        actorId: string;
        actorName: string;
        date?: string;
        mealType?: 'breakfast' | 'lunch' | 'dinner';
        payload?: Record<string, string | number | null | undefined>;
    }
): Promise<void> {
    try {
        const access = await authorizeHousehold('createNotification', householdId);
        if (!access || !input || typeof input !== 'object') return;
        householdId = access.householdId;
        input = { ...input, actorId: access.actor.uid, actorName: access.actor.name };

        const cleanPayload: Record<string, string | number> = {};
        if (input.payload) {
            for (const [k, v] of Object.entries(input.payload)) {
                if (v !== null && v !== undefined) cleanPayload[k] = v;
            }
        }

        await addDoc(notificationsCollection(householdId), {
            type: input.type,
            actorId: input.actorId,
            actorName: input.actorName,
            date: input.date ?? null,
            mealType: input.mealType ?? null,
            payload: cleanPayload,
            createdAt: serverTimestamp(),
            readBy: [],
        });

        // Best-effort retention trim — keep the most recent MAX_RETAINED docs.
        // Runs after write so a slow trim can't delay the notification itself.
        await trimOldNotifications(householdId).catch(() => {});
    } catch (err) {
        console.error('createNotification failed', err);
    }
}

/**
 * Mark the given notification ids as read by the signed-in user. Silently ignores
 * missing docs so a delete-during-scroll race can't error the UI.
 * `householdId` / `userId` must match the session (kept for compatibility).
 */
export async function markNotificationsRead(
    householdId: string,
    userId: string,
    notificationIds: string[],
): Promise<void> {
    if (!Array.isArray(notificationIds) || !notificationIds.length) return;
    try {
        const access = await authorizeHousehold('markNotificationsRead', householdId);
        if (!access) return;
        if (userId && userId !== access.user.uid) {
            console.warn(`[authz] markNotificationsRead: rejected — ${access.user.uid} tried to mark for ${userId}`);
            return;
        }
        householdId = access.householdId;
        userId = access.user.uid;
        notificationIds = notificationIds.filter(isSafeDocId).slice(0, MAX_MARK_READ);
        if (!notificationIds.length) return;

        const batch = writeBatch(db);
        notificationIds.forEach(id => {
            const ref = doc(db, `households/${householdId}/notifications`, id);
            batch.update(ref, { readBy: arrayUnion(userId) });
        });
        await batch.commit();
    } catch (err) {
        console.error('markNotificationsRead failed', err);
    }
}

async function trimOldNotifications(householdId: string): Promise<void> {
    const snap = await getDocs(
        query(notificationsCollection(householdId), orderBy('createdAt', 'desc'))
    );
    if (snap.size <= MAX_RETAINED) return;

    const excess = snap.docs.slice(MAX_RETAINED);
    const batch = writeBatch(db);
    excess.forEach(d => batch.delete(d.ref));
    await batch.commit();
}
