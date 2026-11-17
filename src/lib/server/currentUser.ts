import 'server-only';

import { randomInt } from 'node:crypto';
import { db, doc, getDoc, setDoc, type DocumentData } from './db';
import type { User, UserRole } from '@/types/meal';
import {
    clearSessionCookies,
    readSessionCookie,
    writeSessionCookie,
    type AuthMethod,
} from './session';

export const USERS_COLLECTION = 'users'; // Owners/Admins
export const MEMBERS_COLLECTION = 'members'; // Family members
export const COOKS_COLLECTION = 'cooks'; // Cooks

export function collectionForRole(role: UserRole): string {
    if (role === 'member') return MEMBERS_COLLECTION;
    if (role === 'cook') return COOKS_COLLECTION;
    return USERS_COLLECTION;
}

/**
 * Owners (role 'user') are their own household; members/cooks belong to the
 * owner in linkedUserId (falling back to their own uid if unlinked).
 */
export function householdIdFor(role: UserRole, uid: string, linkedUserId?: string): string {
    if (role === 'user') return uid;
    return linkedUserId || uid;
}

export function randomLetters(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let out = '';
    for (let i = 0; i < length; i++) out += chars[randomInt(chars.length)];
    return out;
}

export function randomDigits(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) out += String(randomInt(10));
    return out;
}

/** Build the public User shape from a stored account document. */
export function buildUser(role: UserRole, uid: string, data: DocumentData): User {
    return {
        uid,
        email: data.email ?? null,
        displayName: data.displayName || undefined,
        photoURL: data.photoURL || undefined,
        role,
        phoneNumber: data.phoneNumber || process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
        linkedUserId: data.linkedUserId,
        householdId: householdIdFor(role, uid, data.linkedUserId),
        houseCode: role === 'user' ? data.houseCode : undefined,
        housePin: role === 'user' ? data.housePin : undefined,
    };
}

/**
 * Backfill houseCode/housePin for legacy owners created before these fields
 * existed. Mutates and returns `data`.
 */
export async function ensureHouseCredentials(role: UserRole, uid: string, data: DocumentData): Promise<DocumentData> {
    if (role !== 'user' || (data.houseCode && data.housePin)) return data;
    const houseCode = data.houseCode || randomLetters(6);
    const housePin = data.housePin || randomDigits(6);
    await setDoc(doc(db, USERS_COLLECTION, uid), { houseCode, housePin }, { merge: true });
    data.houseCode = houseCode;
    data.housePin = housePin;
    return data;
}

/** Load the account behind a session from Firestore; null if it no longer exists. */
export async function loadAccount(role: UserRole, uid: string): Promise<User | null> {
    const snap = await getDoc(doc(db, collectionForRole(role), uid));
    if (!snap.exists()) return null;
    const data = await ensureHouseCredentials(role, snap.id, { ...snap.data() });
    return buildUser(role, snap.id, data);
}

export interface CurrentSession {
    user: User;
    amr: AuthMethod;
    authAt: number;
}

/**
 * The verified session for this request, or null.
 *
 * Recently issued tokens are trusted as-is. Older ones are re-checked against
 * Firestore (so a removed member loses access within
 * SESSION_REVALIDATE_AFTER_SECONDS) and the cookie is rolled forward.
 */
export async function getSession(): Promise<CurrentSession | null> {
    const session = await readSessionCookie();
    if (!session) return null;
    if (session.fresh) return { user: { ...session.user }, amr: session.amr, authAt: session.authAt };

    const account = await loadAccount(session.user.role, session.user.uid);
    if (!account) {
        try { await clearSessionCookies(); } catch { /* read-only context */ }
        return null;
    }
    try {
        await writeSessionCookie(account, session.amr, session.authAt);
    } catch {
        // Server Components can't set cookies; the next action/route will.
    }
    return { user: account, amr: session.amr, authAt: session.authAt };
}

export async function getSessionUser(): Promise<User | null> {
    return (await getSession())?.user ?? null;
}
