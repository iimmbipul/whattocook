'use server';

import { db } from './firebase';
import { doc, getDoc, setDoc, deleteField, serverTimestamp } from 'firebase/firestore';

/**
 * Where we store Google refresh tokens. Owners live in `users`,
 * everyone else in `members` (cooks are excluded from chef rotation, so
 * they don't need calendar sync). We look up in that order.
 */
const CANDIDATE_COLLECTIONS = ['users', 'members'] as const;

export interface CalendarConnection {
    refreshToken: string;
    email?: string;
    connectedAt?: unknown;
}

/**
 * Find which collection holds a given uid so we can read/write its
 * calendar connection without knowing the caller's role upfront.
 */
async function resolveUserCollection(uid: string): Promise<'users' | 'members' | null> {
    for (const name of CANDIDATE_COLLECTIONS) {
        const snap = await getDoc(doc(db, name, uid));
        if (snap.exists()) return name;
    }
    return null;
}

export async function saveCalendarConnection(
    uid: string,
    refreshToken: string,
    email?: string
): Promise<boolean> {
    const collectionName = await resolveUserCollection(uid);
    if (!collectionName) return false;

    await setDoc(
        doc(db, collectionName, uid),
        {
            googleCalendar: {
                refreshToken,
                email: email ?? null,
                connectedAt: serverTimestamp(),
            },
        },
        { merge: true }
    );
    return true;
}

export async function getCalendarConnection(uid: string): Promise<CalendarConnection | null> {
    for (const name of CANDIDATE_COLLECTIONS) {
        const snap = await getDoc(doc(db, name, uid));
        if (!snap.exists()) continue;
        const gc = (snap.data() as any)?.googleCalendar;
        if (gc?.refreshToken) {
            return {
                refreshToken: gc.refreshToken,
                email: gc.email ?? undefined,
                connectedAt: gc.connectedAt,
            };
        }
    }
    return null;
}

export async function clearCalendarConnection(uid: string): Promise<void> {
    const collectionName = await resolveUserCollection(uid);
    if (!collectionName) return;
    await setDoc(
        doc(db, collectionName, uid),
        { googleCalendar: deleteField() },
        { merge: true }
    );
}

/**
 * Simple bool-check used by the profile page to render Connect vs
 * Disconnect without exposing the token.
 */
export async function isCalendarConnected(uid: string): Promise<{ connected: boolean; email?: string }> {
    const conn = await getCalendarConnection(uid);
    if (!conn) return { connected: false };
    return { connected: true, email: conn.email };
}
