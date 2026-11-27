import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encryption for secrets kept in Firestore (the Milkbasket login tokens):
 * AES-256-GCM with a key derived from a server-only master secret, so the
 * database never holds them in plain text and a changed value is rejected.
 *
 * No other imports, so it can be unit-tested with `node --test`.
 */

const VERSION = 'v1';

/** A 32-byte key for one purpose, derived from the master secret (HKDF-SHA256). */
export function secretKey(master: string, purpose: string): Buffer {
    return Buffer.from(hkdfSync('sha256', master, 'whattocook', `wtc:${purpose}:${VERSION}`, 32));
}

/** Encrypt text: "v1.<base64url of iv | tag | ciphertext>". */
export function seal(plain: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
}

/** Decrypt what `seal` made; null if it was made with another key, was changed, or isn't sealed. */
export function unseal(sealed: unknown, key: Buffer): string | null {
    if (typeof sealed !== 'string' || !sealed.startsWith(`${VERSION}.`)) return null;
    try {
        const raw = Buffer.from(sealed.slice(VERSION.length + 1), 'base64url');
        if (raw.length < 29) return null;
        const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}

/** A short one-way fingerprint, to tell whether a secret changed without storing it. */
export function fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
