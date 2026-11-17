/**
 * Minimal signed-token primitives (HMAC-SHA256), used for the session cookie
 * and the short-lived "pending sign-up" cookie.
 *
 * Format: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`
 *
 * Tokens are signed, not encrypted: never put anything in a payload that the
 * holder of the token must not be able to read.
 *
 * Pure module (only node:crypto) so it can be unit-tested with plain Node.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export type TokenPurpose = 'session' | 'pending-signup';

const VERSION = 'v1';
const MAX_TOKEN_LENGTH = 8192;

/**
 * Derive a per-purpose key from the master secret, so a token minted for one
 * purpose can never be replayed as another.
 */
export function deriveKey(secret: string, purpose: TokenPurpose): Buffer {
    return Buffer.from(hkdfSync('sha256', secret, 'whattocook', `wtc:${purpose}:v1`, 32));
}

function mac(key: Buffer, data: string): Buffer {
    return createHmac('sha256', key).update(data).digest();
}

export function signToken(payload: Record<string, unknown>, key: Buffer): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const data = `${VERSION}.${body}`;
    return `${data}.${mac(key, data).toString('base64url')}`;
}

/**
 * Returns the decoded payload when the signature is valid, otherwise null.
 * Does not check any claims (expiry etc.) — callers do that.
 */
export function verifyToken(token: unknown, key: Buffer): Record<string, unknown> | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;

    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) return null;

    const expected = mac(key, `${parts[0]}.${parts[1]}`);
    const given = Buffer.from(parts[2], 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    try {
        const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}
