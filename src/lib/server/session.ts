import 'server-only';

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { User, UserRole } from '@/types/meal';
import { deriveKey, signToken, verifyToken, type TokenPurpose } from './token';

/**
 * Signed session cookie.
 *
 * The cookie holds an HMAC-signed snapshot of the user (see token.ts); the
 * signing key comes from the server-only SESSION_SECRET. Anything edited or
 * forged in the browser fails verification and is treated as logged out.
 *
 * The same token is handed to the client (User.sessionToken) so the iOS PWA
 * fallback can keep it in localStorage and ask the server to restore the
 * cookie — the server only ever trusts what it signed itself.
 */

export const SESSION_COOKIE = 'wtc_session';
/** Pre-hardening cookie: unsigned JSON. Never read; deleted when seen. */
const LEGACY_SESSION_COOKIE = 'session_user';
const PENDING_SIGNUP_COOKIE = 'wtc_pending_signup';

/** A session can be renewed for this long after it was last issued (sliding). */
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
/** Hard cap since the original sign-in, after which a fresh login is required. */
const SESSION_MAX_AGE_SINCE_LOGIN_SECONDS = 180 * 24 * 60 * 60;
/** After this, the account is re-checked in Firestore before the token is trusted again. */
export const SESSION_REVALIDATE_AFTER_SECONDS = 15 * 60;
const PENDING_SIGNUP_LIFETIME_SECONDS = 30 * 60;
const CLOCK_SKEW_SECONDS = 300;

export type AuthMethod = 'google' | 'pin' | 'password';
const AUTH_METHODS: readonly AuthMethod[] = ['google', 'pin', 'password'];
const ROLES: readonly UserRole[] = ['user', 'member', 'cook'];

export type SessionUser = Omit<User, 'sessionToken'>;

export interface VerifiedSession {
    user: SessionUser;
    /** How the user originally proved who they are. */
    amr: AuthMethod;
    /** Original sign-in time (seconds); carried across renewals. */
    authAt: number;
    issuedAt: number;
    /** False once SESSION_REVALIDATE_AFTER_SECONDS have passed since issue. */
    fresh: boolean;
}

export interface PendingSignup {
    email: string;
    displayName?: string;
    photoURL?: string;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

// Kept on globalThis so all of Next's server bundles share one dev key.
const devGlobal = globalThis as typeof globalThis & { __wtcDevSessionSecret?: string };

function masterSecret(): string {
    const secret = process.env.SESSION_SECRET;
    if (secret && secret.length >= 32) return secret;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters.');
    }
    if (secret) {
        console.warn('[session] SESSION_SECRET is shorter than 32 characters — acceptable for local development only.');
        return secret;
    }
    if (!devGlobal.__wtcDevSessionSecret) {
        devGlobal.__wtcDevSessionSecret = randomBytes(32).toString('base64url');
        console.warn('[session] SESSION_SECRET is not set — using a temporary development secret; sessions end when the dev server restarts.');
    }
    return devGlobal.__wtcDevSessionSecret;
}

function keyFor(purpose: TokenPurpose): Buffer {
    return deriveKey(masterSecret(), purpose);
}

function cookieOptions(maxAge: number) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        maxAge,
    };
}

function toSessionUser(user: User): SessionUser {
    return {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? undefined,
        photoURL: user.photoURL ?? undefined,
        role: user.role,
        phoneNumber: user.phoneNumber ?? '',
        linkedUserId: user.linkedUserId,
        householdId: user.householdId,
        houseCode: user.houseCode,
        housePin: user.housePin,
    };
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseSession(payload: Record<string, unknown>): VerifiedSession | null {
    if (payload.typ !== 'session' || payload.ver !== 1) return null;
    const { iat, exp, authAt, amr } = payload;
    if (!isNumber(iat) || !isNumber(exp) || !isNumber(authAt)) return null;
    if (!AUTH_METHODS.includes(amr as AuthMethod)) return null;

    const now = nowSeconds();
    if (exp <= now || iat > now + CLOCK_SKEW_SECONDS) return null;
    if (now - authAt > SESSION_MAX_AGE_SINCE_LOGIN_SECONDS) return null;

    const u = payload.user as Record<string, unknown> | undefined;
    if (!u || typeof u !== 'object') return null;
    if (typeof u.uid !== 'string' || !u.uid || u.uid.includes('/')) return null;
    if (typeof u.householdId !== 'string' || !u.householdId || u.householdId.includes('/')) return null;
    if (!ROLES.includes(u.role as UserRole)) return null;
    // Owners are their own household — a signed token can't say otherwise,
    // but keep the invariant explicit.
    if (u.role === 'user' && u.householdId !== u.uid) return null;

    return {
        user: u as unknown as SessionUser,
        amr: amr as AuthMethod,
        authAt,
        issuedAt: iat,
        fresh: now - iat < SESSION_REVALIDATE_AFTER_SECONDS,
    };
}

export function issueSessionToken(user: User, amr: AuthMethod, authAt?: number): string {
    const now = nowSeconds();
    return signToken(
        {
            typ: 'session',
            ver: 1,
            iat: now,
            exp: now + SESSION_LIFETIME_SECONDS,
            authAt: authAt ?? now,
            amr,
            user: toSessionUser(user) as unknown as Record<string, unknown>,
        },
        keyFor('session'),
    );
}

/** Verify a session token from the cookie or from the client's localStorage copy. */
export function verifySessionToken(token: unknown): VerifiedSession | null {
    try {
        const payload = verifyToken(token, keyFor('session'));
        return payload ? parseSession(payload) : null;
    } catch (err) {
        console.error('[session] cannot verify session token:', err);
        return null;
    }
}

/** Sign `user` into a fresh session cookie. Returns the token (for User.sessionToken). */
export async function writeSessionCookie(user: User, amr: AuthMethod, authAt?: number): Promise<string> {
    const token = issueSessionToken(user, amr, authAt);
    const store = await cookies();
    store.set(SESSION_COOKIE, token, cookieOptions(SESSION_LIFETIME_SECONDS));
    if (store.get(LEGACY_SESSION_COOKIE)) store.delete(LEGACY_SESSION_COOKIE);
    return token;
}

/** Put an already-signed (and already verified) token back into the cookie. */
export async function writeSessionTokenCookie(token: string): Promise<void> {
    const store = await cookies();
    store.set(SESSION_COOKIE, token, cookieOptions(SESSION_LIFETIME_SECONDS));
    if (store.get(LEGACY_SESSION_COOKIE)) store.delete(LEGACY_SESSION_COOKIE);
}

export async function readSessionCookie(): Promise<VerifiedSession | null> {
    return (await readSessionCookieWithToken())?.session ?? null;
}

export async function readSessionCookieWithToken(): Promise<{ session: VerifiedSession; token: string } | null> {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    const session = verifySessionToken(token);
    return session && token ? { session, token } : null;
}

export async function clearSessionCookies(): Promise<void> {
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    store.delete(LEGACY_SESSION_COOKIE);
}

// ─────────────────────────────────────────────────────────────
// Pending sign-up: a verified Google identity with no account yet.
// Set by loginWithGoogle, consumed by createNewHousehold/joinHousehold.
// ─────────────────────────────────────────────────────────────

export async function writePendingSignup(pending: PendingSignup): Promise<void> {
    const now = nowSeconds();
    const token = signToken(
        {
            typ: 'pending-signup',
            ver: 1,
            iat: now,
            exp: now + PENDING_SIGNUP_LIFETIME_SECONDS,
            email: pending.email,
            displayName: pending.displayName ?? null,
            photoURL: pending.photoURL ?? null,
        },
        keyFor('pending-signup'),
    );
    const store = await cookies();
    store.set(PENDING_SIGNUP_COOKIE, token, cookieOptions(PENDING_SIGNUP_LIFETIME_SECONDS));
}

export async function readPendingSignup(): Promise<PendingSignup | null> {
    try {
        const store = await cookies();
        const payload = verifyToken(store.get(PENDING_SIGNUP_COOKIE)?.value, keyFor('pending-signup'));
        if (!payload || payload.typ !== 'pending-signup' || payload.ver !== 1) return null;
        if (!isNumber(payload.exp) || payload.exp <= nowSeconds()) return null;
        if (typeof payload.email !== 'string' || !payload.email.includes('@')) return null;
        return {
            email: payload.email,
            displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
            photoURL: typeof payload.photoURL === 'string' ? payload.photoURL : undefined,
        };
    } catch (err) {
        console.error('[session] cannot read pending sign-up:', err);
        return null;
    }
}

export async function clearPendingSignup(): Promise<void> {
    const store = await cookies();
    if (store.get(PENDING_SIGNUP_COOKIE)) store.delete(PENDING_SIGNUP_COOKIE);
}
