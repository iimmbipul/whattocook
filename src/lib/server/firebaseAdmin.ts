import 'server-only';

import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * firebase-admin for all server-side Firestore/Auth access. The admin SDK is
 * authenticated with a service account, so Firestore security rules can deny
 * the browser everything except the notification bell (see firestore.rules).
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT_KEY holds the service-account JSON key,
 * either as raw JSON or base64-encoded. With FIRESTORE_EMULATOR_HOST /
 * FIREBASE_AUTH_EMULATOR_HOST set (local testing), no credentials are needed.
 *
 * Initialised lazily on first use so `next build` doesn't need the key.
 */

const APP_NAME = 'whattocook-server';

type AdminGlobals = typeof globalThis & { __wtcAdminFirestore?: Firestore };
const adminGlobals = globalThis as AdminGlobals;

function serviceAccountFromEnv(): (ServiceAccount & { project_id?: string }) | null {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
    if (!raw) return null;
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must be the service-account JSON key (raw or base64-encoded).');
    }
    // Keys pasted through some UIs end up with literal "\n" sequences.
    if (typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed as ServiceAccount & { project_id?: string };
}

function adminApp(): App {
    const existing = getApps().find(a => a.name === APP_NAME);
    if (existing) return existing;

    const serviceAccount = serviceAccountFromEnv();
    const usingEmulators = !!process.env.FIRESTORE_EMULATOR_HOST;
    if (!serviceAccount && !usingEmulators && process.env.NODE_ENV === 'production') {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set — the server cannot reach Firestore.');
    }
    return initializeApp(
        {
            projectId: serviceAccount?.project_id ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            // Without a key (local dev), fall back to Application Default Credentials.
            ...(serviceAccount ? { credential: cert(serviceAccount) } : {}),
        },
        APP_NAME,
    );
}

export function adminFirestore(): Firestore {
    if (!adminGlobals.__wtcAdminFirestore) {
        const db = getFirestore(adminApp());
        // Match the client SDK's tolerance for undefined fields. (Not using
        // `preferRest`: its REST transport ignores the emulator and looks for
        // Google default credentials.)
        db.settings({ ignoreUndefinedProperties: true });
        adminGlobals.__wtcAdminFirestore = db;
    }
    return adminGlobals.__wtcAdminFirestore;
}

/**
 * Loaded on demand: firebase-admin/auth pulls in jwks-rsa → jose (ESM-only,
 * needs Node 22.12+), which the Firestore-only server paths never need.
 */
export async function adminAuth(): Promise<Auth> {
    const { getAuth } = await import('firebase-admin/auth');
    return getAuth(adminApp());
}
