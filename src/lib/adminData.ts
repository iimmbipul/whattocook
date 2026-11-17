'use server';

import { db } from './firebase';
import { collection, deleteField, doc, getDocs, writeBatch, type DocumentData, type WriteBatch } from 'firebase/firestore';
import { authorizeAppAdmin, isAppAdmin, isSafeDocId } from './server/guards';
import { hashSecret, isHashedSecret } from './server/password';

/**
 * App-admin tools: the raw JSON collection editor and the one-time
 * credential migration. Both act on data shared by every household, so they
 * are limited to ADMIN_EMAILS (see authorizeAppAdmin). The editor used to
 * talk to Firestore straight from the browser; it now goes through here.
 */

/** Collections the JSON editor may load/replace (same list the editor offered before). */
const EDITABLE_COLLECTIONS = [
    'menu_templates',
    'users',
    'category_templates',
    'meals_T6GggZ7CrPSSoY9uEydL',
    'households/T6GggZ7CrPSSoY9uEydL/meals',
];

/** Secrets that are never sent to the browser and never overwritten from it. */
const PROTECTED_FIELDS = ['password', 'passwordHash', 'pin', 'pinHash', 'googleCalendar', 'authFailures', 'authLockedUntil'];

const MAX_BATCH_OPS = 400;
const NOT_ADMIN = 'Only app admins (ADMIN_EMAILS) can use this tool.';

export async function getAdminCapabilities(): Promise<{ appAdmin: boolean }> {
    return { appAdmin: await isAppAdmin() };
}

export async function adminLoadCollection(
    name: string,
): Promise<{ ok: true; json: string } | { ok: false; error: string }> {
    try {
        if (!(await authorizeAppAdmin('adminLoadCollection'))) return { ok: false, error: NOT_ADMIN };
        if (!EDITABLE_COLLECTIONS.includes(name)) return { ok: false, error: 'Unknown collection.' };

        const snap = await getDocs(collection(db, name));
        const data = snap.docs.map(d => {
            const value: DocumentData = { ...d.data() };
            for (const f of PROTECTED_FIELDS) delete value[f];
            return { _id: d.id, ...value };
        });
        return { ok: true, json: JSON.stringify(data, null, 2) };
    } catch (error) {
        console.error('adminLoadCollection failed', error);
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to fetch data' };
    }
}

/**
 * Replace a whole collection with the given JSON array (documents missing
 * from the array are deleted — same semantics as before). Protected fields
 * of existing documents are carried over untouched.
 */
export async function adminReplaceCollection(
    name: string,
    json: string,
): Promise<{ ok: true; written: number; deleted: number } | { ok: false; error: string }> {
    try {
        if (!(await authorizeAppAdmin('adminReplaceCollection'))) return { ok: false, error: NOT_ADMIN };
        if (!EDITABLE_COLLECTIONS.includes(name)) return { ok: false, error: 'Unknown collection.' };

        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch {
            return { ok: false, error: 'Invalid JSON format' };
        }
        if (!Array.isArray(parsed)) return { ok: false, error: 'JSON data must be an array of objects' };

        const currentSnap = await getDocs(collection(db, name));
        const current = new Map(currentSnap.docs.map(d => [d.id, d.data()]));

        // Validate everything before writing anything.
        const writes: Array<{ id: string; data: DocumentData }> = [];
        const keep = new Set<string>();
        for (const item of parsed) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return { ok: false, error: 'Every entry must be an object' };
            }
            const { _id, ...rest } = item as Record<string, unknown>;
            let id: string;
            if (_id === undefined || _id === null || _id === '') {
                id = doc(collection(db, name)).id;
            } else if (isSafeDocId(_id)) {
                id = _id;
            } else {
                return { ok: false, error: `Invalid _id: ${String(_id).slice(0, 40)}` };
            }
            if (keep.has(id)) return { ok: false, error: `Duplicate _id: ${id}` };
            keep.add(id);

            const data: DocumentData = { ...rest };
            for (const f of PROTECTED_FIELDS) delete data[f];
            const existing = current.get(id);
            if (existing) {
                for (const f of PROTECTED_FIELDS) {
                    if (existing[f] !== undefined) data[f] = existing[f];
                }
            }
            writes.push({ id, data });
        }
        const deletions = [...current.keys()].filter(id => !keep.has(id));

        const batches: WriteBatch[] = [];
        let batch = writeBatch(db);
        let ops = 0;
        const count = () => {
            ops++;
            if (ops >= MAX_BATCH_OPS) {
                batches.push(batch);
                batch = writeBatch(db);
                ops = 0;
            }
        };
        for (const w of writes) {
            batch.set(doc(db, name, w.id), w.data);
            count();
        }
        for (const id of deletions) {
            batch.delete(doc(db, name, id));
            count();
        }
        if (ops > 0) batches.push(batch);
        for (const b of batches) await b.commit();

        return { ok: true, written: writes.length, deleted: deletions.length };
    } catch (error) {
        console.error('adminReplaceCollection failed', error);
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to update' };
    }
}

function plaintextValue(value: unknown): string | null {
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

/**
 * One-time migration: replace plaintext `password` / cook `pin` fields with
 * scrypt hashes (`passwordHash` / `pinHash`) and delete the plaintext.
 * Accounts that sign in are also migrated on the fly; this covers the rest.
 * With `dryRun`, only counts what would change.
 */
export async function migrateStoredCredentials(dryRun: boolean = false): Promise<{
    ok: boolean;
    migrated: number;
    alreadyHashed: number;
    skipped: number;
    error?: string;
}> {
    const result = { ok: false, migrated: 0, alreadyHashed: 0, skipped: 0 };
    try {
        if (!(await authorizeAppAdmin('migrateStoredCredentials'))) return { ...result, error: NOT_ADMIN };

        for (const name of ['users', 'members', 'cooks']) {
            const snap = await getDocs(collection(db, name));
            let batch = writeBatch(db);
            let ops = 0;

            for (const d of snap.docs) {
                const data = d.data();
                const isCook = name === 'cooks';
                const hashField = isCook ? 'pinHash' : 'passwordHash';
                const plaintextFields = isCook ? ['pin', 'password'] : ['password'];
                const present = plaintextFields.filter(f => data[f] !== undefined);
                const hasHash = isHashedSecret(data[hashField]);

                if (present.length === 0) {
                    if (hasHash) result.alreadyHashed++;
                    continue;
                }

                const plain = isCook
                    ? plaintextValue(data.pin) ?? plaintextValue(data.password)
                    : plaintextValue(data.password);
                if (!hasHash && !plain) {
                    // Unusable plaintext (empty / odd type): leave it for a human to look at.
                    result.skipped++;
                    continue;
                }

                result.migrated++;
                if (dryRun) continue;

                const update: DocumentData = {};
                if (!hasHash && plain) update[hashField] = await hashSecret(plain);
                for (const f of present) update[f] = deleteField();
                batch.update(d.ref, update);
                ops++;
                if (ops >= MAX_BATCH_OPS) {
                    await batch.commit();
                    batch = writeBatch(db);
                    ops = 0;
                }
            }
            if (ops > 0) await batch.commit();
        }
        return { ...result, ok: true };
    } catch (error) {
        console.error('migrateStoredCredentials failed', error);
        return { ...result, error: error instanceof Error ? error.message : 'Migration failed' };
    }
}
