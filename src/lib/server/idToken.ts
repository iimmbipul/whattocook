/**
 * Server-side verification of Google sign-in proofs.
 *
 * Accepts either
 *   - a Firebase Auth ID token (web: `signInWithPopup` → `user.getIdToken()`),
 *     issued for this Firebase project via the google.com provider, or
 *   - a Google OAuth ID token (native Google Sign-In in the mobile app) whose
 *     audience is listed in GOOGLE_ID_TOKEN_AUDIENCES.
 *
 * Signatures are checked against Google's published JWKS with node:crypto, so
 * no extra dependency (or service account) is needed.
 *
 * When FIREBASE_AUTH_EMULATOR_HOST is set outside production, unsigned tokens
 * from the Auth emulator are accepted (same behaviour as firebase-admin).
 */
import { createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto';

const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const CLOCK_SKEW_SECONDS = 300;
const MAX_TOKEN_LENGTH = 8192;
const MIN_REFETCH_INTERVAL_MS = 60_000;

export interface VerifiedGoogleIdentity {
    email: string;
    name?: string;
    picture?: string;
    subject: string;
    issuer: 'firebase' | 'google';
}

type JwksEntry = { keys: Map<string, KeyObject>; expiresAt: number; fetchedAt: number };
const jwksCache = new Map<string, JwksEntry>();

function parseMaxAge(cacheControl: string | null): number | null {
    const m = cacheControl?.match(/max-age=(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
}

async function fetchJwks(url: string): Promise<JwksEntry> {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
    const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
        if (jwk.kid && jwk.kty === 'RSA') {
            keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
        }
    }
    const maxAgeSeconds = Math.min(parseMaxAge(res.headers.get('cache-control')) ?? 3600, 6 * 3600);
    const now = Date.now();
    return { keys, expiresAt: now + maxAgeSeconds * 1000, fetchedAt: now };
}

async function getSigningKey(url: string, kid: string): Promise<KeyObject | null> {
    let entry = jwksCache.get(url);
    const now = Date.now();
    const expired = !entry || entry.expiresAt <= now;
    // Unknown kid usually means Google rotated keys — refetch, but not more
    // than once a minute so junk tokens can't make us hammer the endpoint.
    const unknownKid = !!entry && !entry.keys.has(kid) && now - entry.fetchedAt > MIN_REFETCH_INTERVAL_MS;
    if (expired || unknownKid) {
        entry = await fetchJwks(url);
        jwksCache.set(url, entry);
    }
    return entry?.keys.get(kid) ?? null;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function emulatorMode(): boolean {
    return !!process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.NODE_ENV !== 'production';
}

function allowedGoogleAudiences(): string[] {
    return (process.env.GOOGLE_ID_TOKEN_AUDIENCES ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * Verify a Google/Firebase ID token. Returns the verified identity, or null
 * if the token is malformed, expired, for another project/client, unsigned,
 * badly signed, or lacks a verified email.
 */
export async function verifyGoogleIdentityToken(idToken: unknown): Promise<VerifiedGoogleIdentity | null> {
    if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > MAX_TOKEN_LENGTH) return null;

    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const header = decodeSegment(parts[0]);
    const claims = decodeSegment(parts[1]);
    if (!header || !claims) return null;

    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const now = Math.floor(Date.now() / 1000);

    let issuer: VerifiedGoogleIdentity['issuer'];
    let jwksUrl: string;
    if (projectId && claims.iss === `https://securetoken.google.com/${projectId}`) {
        if (claims.aud !== projectId) return null;
        const firebaseClaim = claims.firebase as { sign_in_provider?: unknown } | undefined;
        if (firebaseClaim?.sign_in_provider !== 'google.com') return null;
        if (typeof claims.auth_time !== 'number' || claims.auth_time - CLOCK_SKEW_SECONDS > now) return null;
        issuer = 'firebase';
        jwksUrl = FIREBASE_JWKS_URL;
    } else if (claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com') {
        const audiences = allowedGoogleAudiences();
        if (typeof claims.aud !== 'string' || !audiences.includes(claims.aud)) return null;
        issuer = 'google';
        jwksUrl = GOOGLE_JWKS_URL;
    } else {
        return null;
    }

    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) return null;
    if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_SECONDS > now) return null;
    if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255) return null;

    const unsignedEmulatorToken = header.alg === 'none' && parts[2] === '';
    if (unsignedEmulatorToken) {
        if (!(emulatorMode() && issuer === 'firebase')) return null;
    } else {
        if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
        let key: KeyObject | null;
        try {
            key = await getSigningKey(jwksUrl, header.kid);
        } catch (err) {
            console.error('[idToken] could not load Google signing keys', err);
            return null;
        }
        if (!key) return null;
        const valid = verifySignature(
            'RSA-SHA256',
            Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
            key,
            Buffer.from(parts[2], 'base64url'),
        );
        if (!valid) return null;
    }

    if (typeof claims.email !== 'string' || !claims.email.includes('@')) return null;
    if (claims.email_verified !== true) return null;

    return {
        email: claims.email,
        name: typeof claims.name === 'string' ? claims.name : undefined,
        picture: typeof claims.picture === 'string' ? claims.picture : undefined,
        subject: claims.sub,
        issuer,
    };
}
