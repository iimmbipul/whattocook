/**
 * Password / PIN hashing with scrypt.
 *
 * Stored format: `scrypt:1:<peppered 0|1>:<log2 N>:<r>:<p>:<salt b64url>:<hash b64url>`
 *
 * If CREDENTIAL_PEPPER is set, secrets are HMAC'd with it before hashing, so a
 * leaked database alone is not enough to brute-force short PINs offline. The
 * flag in the stored hash records whether a pepper was used, so turning the
 * pepper on later keeps old hashes working (they are upgraded on next login).
 * Losing or changing the pepper invalidates every peppered hash.
 *
 * Pure module (node:crypto + process.env) so it can be unit-tested with Node.
 */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PREFIX = 'scrypt';
const FORMAT_VERSION = '1';
const LOG2_N = 15; // N = 32768
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
const MAX_SECRET_LENGTH = 1024;

function scryptAsync(secret: Buffer, salt: Buffer, log2N: number, r: number, p: number): Promise<Buffer> {
    const N = 2 ** log2N;
    return new Promise((resolve, reject) => {
        scrypt(secret, salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r }, (err, key) => {
            if (err) reject(err);
            else resolve(key);
        });
    });
}

function currentPepper(): Buffer | null {
    const pepper = process.env.CREDENTIAL_PEPPER;
    return pepper ? Buffer.from(pepper, 'utf8') : null;
}

function prepare(secret: string, pepper: Buffer | null): Buffer {
    const raw = Buffer.from(secret.normalize('NFKC'), 'utf8');
    return pepper ? createHmac('sha256', pepper).update(raw).digest() : raw;
}

export function isHashedSecret(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(`${PREFIX}:${FORMAT_VERSION}:`);
}

export async function hashSecret(secret: string): Promise<string> {
    if (typeof secret !== 'string' || secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
        throw new Error('Invalid secret');
    }
    const pepper = currentPepper();
    const salt = randomBytes(SALT_BYTES);
    const key = await scryptAsync(prepare(secret, pepper), salt, LOG2_N, R, P);
    return [PREFIX, FORMAT_VERSION, pepper ? '1' : '0', LOG2_N, R, P, salt.toString('base64url'), key.toString('base64url')].join(':');
}

export interface VerifyResult {
    ok: boolean;
    /** True when the caller should store a fresh hash (legacy plaintext, old params, pepper added). */
    needsRehash: boolean;
}

/** Constant-time comparison of two strings of possibly different length. */
function safeEqualStrings(a: string, b: string): boolean {
    const da = createHash('sha256').update(a, 'utf8').digest();
    const db = createHash('sha256').update(b, 'utf8').digest();
    return timingSafeEqual(da, db) && a.length === b.length;
}

/**
 * Check `secret` against a stored scrypt hash, or — for records that predate
 * hashing — against the legacy plaintext value.
 */
export async function verifySecret(
    secret: string,
    storedHash: unknown,
    legacyPlaintext?: unknown,
): Promise<VerifyResult> {
    if (typeof secret !== 'string' || secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
        return { ok: false, needsRehash: false };
    }

    if (isHashedSecret(storedHash)) {
        const parts = storedHash.split(':');
        if (parts.length !== 8) return { ok: false, needsRehash: false };
        const [, , peppered, log2NStr, rStr, pStr, saltStr, keyStr] = parts;
        const log2N = Number(log2NStr), r = Number(rStr), p = Number(pStr);
        if (![log2N, r, p].every(Number.isInteger) || log2N < 10 || log2N > 20 || r < 1 || r > 32 || p < 1 || p > 16) {
            return { ok: false, needsRehash: false };
        }

        const pepper = currentPepper();
        if (peppered === '1' && !pepper) {
            console.error('[password] stored hash requires CREDENTIAL_PEPPER, which is not set');
            return { ok: false, needsRehash: false };
        }
        const expected = Buffer.from(keyStr, 'base64url');
        if (expected.length !== KEY_LENGTH) return { ok: false, needsRehash: false };
        const actual = await scryptAsync(prepare(secret, peppered === '1' ? pepper : null), Buffer.from(saltStr, 'base64url'), log2N, r, p);
        const ok = timingSafeEqual(actual, expected);
        const needsRehash = ok && (log2N !== LOG2_N || r !== R || p !== P || (peppered === '0' && !!pepper));
        return { ok, needsRehash };
    }

    if (typeof legacyPlaintext === 'string' && legacyPlaintext.length > 0) {
        // Burn comparable time so a legacy record doesn't stand out by latency.
        await scryptAsync(Buffer.from(secret, 'utf8'), randomBytes(SALT_BYTES), LOG2_N, R, P);
        const ok = safeEqualStrings(secret, legacyPlaintext);
        return { ok, needsRehash: ok };
    }

    return { ok: false, needsRehash: false };
}

/** Spend the same time as a real verification (used when no record matched). */
export async function dummyVerify(secret: string): Promise<void> {
    await scryptAsync(Buffer.from(String(secret).slice(0, MAX_SECRET_LENGTH), 'utf8'), randomBytes(SALT_BYTES), LOG2_N, R, P);
}
