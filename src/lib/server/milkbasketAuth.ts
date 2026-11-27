import 'server-only';

import { randomUUID } from 'node:crypto';
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import { adminFirestore } from './firebaseAdmin';
import { fingerprint, secretKey, seal, unseal } from './secretBox';
import * as M from '../milkbasket/logic';

/*
 * The Milkbasket login the server uses: a login token (authKey, about a day)
 * and a refresh token (refreshKey). When the login token runs out the server
 * asks Milkbasket for a new pair with refreshAuthToken and keeps it.
 *
 *   milkbasket_auth/account   Both tokens, encrypted with AES-256-GCM (key from
 *                             SESSION_SECRET), when the login token expires, when
 *                             it was last renewed, the last renewal problem, and a
 *                             short lease so only one renewal runs at a time (each
 *                             renewal replaces the refresh token, so two at once
 *                             would cancel each other).
 *
 * Tokens come from the owner (Admin → Milkbasket → Settings) or, as a first
 * seed, from MILKBASKET_TOKEN and MILKBASKET_REFRESH_TOKEN; a changed seed in
 * the environment replaces the stored pair. Tokens are never logged or shown.
 * Server-only: security rules deny the browser.
 */

const AUTH_DOC = 'milkbasket_auth/account';
const LEASE_MS = 20_000;
/** Renew this long before the login token runs out. */
const RENEW_BEFORE_MS = 60 * 60_000;

export interface BaseConfig {
    apiUrl: string;
    apiHost: string;
    cityId: string;
    hubId: string;
    appVersion: string;
    /** Environment variables that are missing or invalid (MILKBASKET_CITY_ID, MILKBASKET_HUB_ID, MILKBASKET_API_URL). */
    missing: string[];
}

/** Everything except the tokens: MILKBASKET_CITY_ID, MILKBASKET_HUB_ID, MILKBASKET_APP_VERSION, MILKBASKET_API_URL. */
export function baseConfig(): BaseConfig {
    const id = (v: string | undefined) => (/^\d{1,9}$/.test(v?.trim() ?? '') ? v!.trim() : '');
    const cityId = id(process.env.MILKBASKET_CITY_ID);
    const hubId = id(process.env.MILKBASKET_HUB_ID);
    const version = process.env.MILKBASKET_APP_VERSION?.trim() ?? '';
    const appVersion = /^\d+(\.\d+){1,3}$/.test(version) ? version : M.DEFAULT_APP_VERSION;
    const apiUrl = process.env.MILKBASKET_API_URL?.trim() || M.DEFAULT_API_URL;
    let apiHost = '';
    try {
        apiHost = new URL(apiUrl).host;
    } catch {
        apiHost = '';
    }
    const missing = [!cityId && 'MILKBASKET_CITY_ID', !hubId && 'MILKBASKET_HUB_ID', !apiHost && 'MILKBASKET_API_URL'].filter((m): m is string => !!m);
    return { apiUrl, apiHost, cityId, hubId, appVersion, missing };
}

function makeDeps(base: BaseConfig, token: string): M.MilkbasketDeps {
    return {
        apiUrl: base.apiUrl,
        token,
        cityId: base.cityId,
        hubId: base.hubId,
        appVersion: base.appVersion,
        fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }),
    };
}

function encryptionKey(): Buffer | null {
    const secret = process.env.SESSION_SECRET;
    return secret && secret.length >= 16 ? secretKey(secret, 'milkbasket-tokens') : null;
}

export interface Login {
    authKey: string;
    refreshKey: string;
    /** When the login token runs out (ms), if Milkbasket said. */
    authExpiresAt: number | null;
    renewedAt: number | null;
    source: 'env' | 'admin' | 'renewed';
    lastError: { message: string; atMs: number } | null;
}

/** The pair seeded from the environment, if any, and its fingerprint. */
function envSeed(): { authKey: string; refreshKey: string; hash: string } | null {
    const authKey = M.cleanToken(process.env.MILKBASKET_TOKEN);
    const refreshKey = M.cleanToken(process.env.MILKBASKET_REFRESH_TOKEN);
    if (!authKey && !refreshKey) return null;
    return { authKey, refreshKey, hash: fingerprint(`${authKey}\n${refreshKey}`) };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readStored(data: DocumentData | undefined, key: Buffer): Login | null {
    if (!data) return null;
    const authKey = unseal(data.authKey, key) ?? '';
    const refreshKey = unseal(data.refreshKey, key) ?? '';
    if (!authKey && !refreshKey) return null;
    const source = data.source === 'admin' || data.source === 'renewed' ? data.source : 'env';
    const lastError = data.lastError && typeof data.lastError.message === 'string'
        ? { message: String(data.lastError.message).slice(0, 300), atMs: num(data.lastError.atMs) ?? 0 }
        : null;
    return { authKey, refreshKey, authExpiresAt: num(data.authExpiresAt), renewedAt: num(data.renewedAt), source, lastError };
}

function sealed(key: Buffer, authKey: string, refreshKey: string) {
    return { authKey: authKey ? seal(authKey, key) : null, refreshKey: refreshKey ? seal(refreshKey, key) : null };
}

/**
 * The current login, or null if none is saved. A new seed in the environment
 * (MILKBASKET_TOKEN / MILKBASKET_REFRESH_TOKEN changed) replaces what is stored.
 */
export async function loadLogin(): Promise<Login | null> {
    const key = encryptionKey();
    if (!key) return null;
    const ref = adminFirestore().doc(AUTH_DOC);
    const data = (await ref.get()).data();
    const seed = envSeed();
    if (seed && (seed.hash !== data?.envSeedHash || !readStored(data, key))) {
        const nowMs = Date.now();
        await ref.set({ ...sealed(key, seed.authKey, seed.refreshKey), authExpiresAt: null, renewedAt: null, source: 'env', envSeedHash: seed.hash, lastError: null, lease: null, updatedAtMs: nowMs });
        return { authKey: seed.authKey, refreshKey: seed.refreshKey, authExpiresAt: null, renewedAt: null, source: 'env', lastError: null };
    }
    return readStored(data, key);
}

/** The owner pastes a refresh token (and optionally a login token). It replaces the stored pair. */
export async function saveLogin(refreshToken: unknown, authToken: unknown, byUid: string): Promise<{ ok: true } | { ok: false; error: 'invalid' | 'no-key' }> {
    const refreshKey = M.cleanToken(typeof refreshToken === 'string' ? refreshToken : '');
    const authKey = M.cleanToken(typeof authToken === 'string' ? authToken : '');
    if (!refreshKey) return { ok: false, error: 'invalid' };
    const key = encryptionKey();
    if (!key) return { ok: false, error: 'no-key' };
    const seed = envSeed();
    await adminFirestore().doc(AUTH_DOC).set({
        ...sealed(key, authKey, refreshKey),
        authExpiresAt: null,
        renewedAt: null,
        source: 'admin',
        // The environment's seed (if any) stays as it is, so it doesn't replace this again.
        envSeedHash: seed?.hash ?? null,
        lastError: null,
        lease: null,
        updatedAtMs: Date.now(),
        updatedBy: byUid,
    });
    return { ok: true };
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Renew the login with the refresh token. `usedAuthKey` is the login token
 * that was refused (or is about to run out): if another request renewed it
 * meanwhile, that newer login is returned instead of renewing again.
 * Returns the new login, or null (and records why) when renewal fails.
 */
export async function renewLogin(usedAuthKey: string): Promise<Login | null> {
    const key = encryptionKey();
    if (!key) return null;
    const fs = adminFirestore();
    const ref = fs.doc(AUTH_DOC);
    const holder = randomUUID();

    for (let attempt = 0; attempt < 6; attempt++) {
        const claim = await fs.runTransaction(async tx => {
            const data = (await tx.get(ref)).data();
            const current = readStored(data, key);
            if (!current) return { kind: 'none' as const };
            if (current.authKey && current.authKey !== usedAuthKey) return { kind: 'newer' as const, login: current };
            if (!current.refreshKey) return { kind: 'no-refresh' as const, login: current };
            const until = num(data?.lease?.untilMs) ?? 0;
            if (until > Date.now()) return { kind: 'busy' as const };
            tx.update(ref, { lease: { holder, untilMs: Date.now() + LEASE_MS } });
            return { kind: 'claimed' as const, login: current };
        });
        if (claim.kind === 'none') return null;
        if (claim.kind === 'newer') return claim.login;
        if (claim.kind === 'no-refresh') {
            await recordError(ref, 'No refresh token is saved, so the login can’t be renewed. Paste one in Admin → Milkbasket → Settings.');
            return null;
        }
        if (claim.kind === 'busy') {
            await wait(1_500); // another request is renewing; use its result
            continue;
        }

        const base = baseConfig();
        const outcome = await M.refreshAuth(makeDeps(base, claim.login.authKey), claim.login.refreshKey);
        const nowMs = Date.now();
        if (!outcome.ok) {
            await ref.update({ lease: null, lastError: { message: outcome.message.slice(0, 300), atMs: nowMs } }).catch(() => {});
            console.error('[milkbasket] renewing the login failed:', outcome.kind);
            return null;
        }
        const refreshKey = outcome.refreshKey ?? claim.login.refreshKey;
        const authExpiresAt = outcome.expiresInMinutes !== null ? nowMs + outcome.expiresInMinutes * 60_000 : null;
        await ref.update({
            ...sealed(key, outcome.authKey, refreshKey),
            authExpiresAt,
            renewedAt: nowMs,
            source: 'renewed',
            lastError: null,
            lease: null,
            updatedAtMs: nowMs,
        });
        return { authKey: outcome.authKey, refreshKey, authExpiresAt, renewedAt: nowMs, source: 'renewed', lastError: null };
    }
    return null;
}

async function recordError(ref: DocumentReference, message: string): Promise<void> {
    await ref.update({ lastError: { message, atMs: Date.now() } }).catch(() => {});
}

export type DepsResult = { ok: true; deps: M.MilkbasketDeps } | { ok: false; message: string };

export function notConfigured(missing: string[]): string {
    return `Milkbasket isn't set up on the server: add ${missing.join(', ')} to the environment variables and redeploy.`;
}

export const NO_LOGIN = 'No Milkbasket login is saved yet: paste a refresh token in Admin → Milkbasket → Settings.';

/** Ready-to-use Milkbasket access, renewing the login first if it runs out within the hour. */
export async function getDeps(): Promise<DepsResult> {
    const base = baseConfig();
    if (base.missing.length > 0) return { ok: false, message: notConfigured(base.missing) };
    if (!encryptionKey()) return { ok: false, message: 'SESSION_SECRET must be set on the server to keep the Milkbasket login.' };
    let login = await loadLogin();
    if (!login) return { ok: false, message: NO_LOGIN };
    const runningOut = !login.authKey || (login.authExpiresAt !== null && login.authExpiresAt < Date.now() + RENEW_BEFORE_MS);
    if (runningOut && login.refreshKey) login = (await renewLogin(login.authKey)) ?? login;
    if (!login.authKey) return { ok: false, message: login.lastError?.message ?? NO_LOGIN };
    return { ok: true, deps: makeDeps(base, login.authKey) };
}

/** After Milkbasket refused `deps.token`: renew and return new access, or null. */
export async function renewedDeps(deps: M.MilkbasketDeps): Promise<M.MilkbasketDeps | null> {
    const login = await renewLogin(deps.token);
    return login?.authKey ? { ...deps, token: login.authKey } : null;
}

/** Run a read against Milkbasket; if the login token is refused, renew it and try once more. */
export async function readWithLogin<T>(read: (deps: M.MilkbasketDeps) => Promise<T>): Promise<T> {
    const got = await getDeps();
    if (!got.ok) throw new Error(got.message);
    try {
        return await read(got.deps);
    } catch (err) {
        if (!M.isAuthError(err)) throw err;
        const renewed = await renewedDeps(got.deps);
        if (!renewed) throw err;
        return read(renewed);
    }
}

/** What Admin may show about the login (never the tokens). */
export async function loginStatus(): Promise<{
    configured: boolean;
    missing: string[];
    apiHost: string;
    hasLogin: boolean;
    canRenew: boolean;
    authExpiresAt: number | null;
    renewedAt: number | null;
    source: Login['source'] | null;
    loginError: { message: string; atMs: number } | null;
}> {
    const base = baseConfig();
    const login = encryptionKey() ? await loadLogin().catch(() => null) : null;
    return {
        configured: base.missing.length === 0 && !!login,
        missing: base.missing,
        apiHost: base.apiHost,
        hasLogin: !!login,
        canRenew: !!login?.refreshKey,
        authExpiresAt: login?.authExpiresAt ?? null,
        renewedAt: login?.renewedAt ?? null,
        source: login?.source ?? null,
        loginError: login?.lastError ?? null,
    };
}
