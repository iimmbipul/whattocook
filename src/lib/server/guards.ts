import 'server-only';

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { actorFromUser } from '../actor';
import type { User, UserRole } from '@/types/meal';
import {
    COOKS_COLLECTION,
    MEMBERS_COLLECTION,
    USERS_COLLECTION,
    getSession,
} from './currentUser';
import type { AuthMethod } from './session';

/**
 * Authorization helpers for server actions.
 *
 * Every server action is a public HTTP endpoint: arguments come from the
 * browser and can be anything. The household and user an action works on are
 * taken from the verified session; IDs passed by the client are only accepted
 * when they match it.
 */

export interface HouseholdAccess {
    user: User;
    householdId: string;
    /** Notification attribution, always derived from the session. */
    actor: { uid: string; name: string };
    amr: AuthMethod;
}

export async function authorizeHousehold(
    action: string,
    requestedHouseholdId?: string | null,
    roles?: readonly UserRole[],
): Promise<HouseholdAccess | null> {
    const session = await getSession();
    if (!session) {
        console.warn(`[authz] ${action}: rejected — not signed in`);
        return null;
    }
    const { user } = session;
    if (requestedHouseholdId && requestedHouseholdId !== user.householdId) {
        console.warn(`[authz] ${action}: rejected — uid ${user.uid} (household ${user.householdId}) asked for household ${requestedHouseholdId}`);
        return null;
    }
    if (roles && !roles.includes(user.role)) {
        console.warn(`[authz] ${action}: rejected — role ${user.role} not allowed`);
        return null;
    }
    return {
        user,
        householdId: user.householdId,
        actor: actorFromUser(user) ?? { uid: user.uid, name: 'Someone' },
        amr: session.amr,
    };
}

/** True if `id` is safe to use as a single Firestore document ID. */
export function isSafeDocId(id: unknown): id is string {
    return typeof id === 'string' && id.length > 0 && id.length <= 128 && !id.includes('/') && id !== '.' && id !== '..';
}

/** Meal docs are keyed by full date (YYYY-MM-DD) or day-of-month template ID ("07"). */
export function isValidMealId(id: unknown): id is string {
    return typeof id === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(id) || /^\d{1,2}$/.test(id));
}

export function isFullDateId(id: unknown): id is string {
    return typeof id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(id);
}

/**
 * Is `uid` the owner, a member, or (optionally) a cook of `householdId`?
 */
export async function isHouseholdParticipant(
    householdId: string,
    uid: string,
    opts: { includeCooks?: boolean } = {},
): Promise<boolean> {
    if (!isSafeDocId(uid) || !isSafeDocId(householdId)) return false;
    if (uid === householdId) {
        return (await getDoc(doc(db, USERS_COLLECTION, uid))).exists();
    }
    const memberSnap = await getDoc(doc(db, MEMBERS_COLLECTION, uid));
    if (memberSnap.exists()) return memberSnap.data().linkedUserId === householdId;
    if (opts.includeCooks) {
        const cookSnap = await getDoc(doc(db, COOKS_COLLECTION, uid));
        if (cookSnap.exists()) return cookSnap.data().linkedUserId === householdId;
    }
    return false;
}

function adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS ?? '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * App-wide administration (the shared menu templates, the raw JSON editor,
 * credential migration) affects every household, so it is limited to the
 * Google-verified accounts listed in ADMIN_EMAILS — not every household owner.
 */
export async function authorizeAppAdmin(action: string): Promise<User | null> {
    const session = await getSession();
    if (!session) {
        console.warn(`[authz] ${action}: rejected — not signed in`);
        return null;
    }
    const email = session.user.email?.toLowerCase();
    const allowed = session.amr === 'google' && session.user.role !== 'cook' && !!email && adminEmails().includes(email);
    if (!allowed) {
        console.warn(`[authz] ${action}: rejected — uid ${session.user.uid} is not an app admin${adminEmails().length ? '' : ' (ADMIN_EMAILS is not set)'}`);
        return null;
    }
    return session.user;
}

export async function isAppAdmin(): Promise<boolean> {
    const session = await getSession();
    if (!session) return false;
    const email = session.user.email?.toLowerCase();
    return session.amr === 'google' && session.user.role !== 'cook' && !!email && adminEmails().includes(email);
}
