import 'server-only';

import { randomUUID } from 'node:crypto';
import { FieldValue, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import type { User } from '@/types/meal';
import { adminFirestore } from './firebaseAdmin';
import { isSafeDocId } from './guards';
import { isMilkbasketHousehold, runAfterResponse } from './milkbasketTrigger';
import { listPantryItems, restockFromBasket } from './grocery';
import { actorFromUser } from '../actor';
import { localTime } from '../ratings/logic';
import * as M from '../milkbasket/logic';
import type {
    MappingRow,
    MilkbasketAdminView,
    MilkbasketResult,
    OrderHistoryResult,
    PurchaseRequestRow,
    UnmappedItem,
} from '../milkbasket/types';

/*
 * Milkbasket auto-order. Data model (server-only; security rules deny the browser):
 *
 *   households/{hid}/milkbasket_products/{itemId}   Mapping: pantry item → Milkbasket product,
 *                                                   last known price, default quantity, auto-order on/off.
 *   households/{hid}/purchase_requests/{id}         Every request, never deleted, with a `history`
 *                                                   of its status changes.
 *   households/{hid}/milkbasket_items/{itemId}      Per-item guard written with each new request, so
 *                                                   two reports at once can't open two requests.
 *   households/{hid}/settings/milkbasket            Switch, price limit, delivery day, duplicate window.
 *   households/{hid}/settings/milkbasket_worker     Worker lease (one add at a time) and the last
 *                                                   Milkbasket problem shown as a banner.
 *   households/{hid}/settings/milkbasket_history    Products from recent orders, cached for an hour.
 *
 * The server calls Milkbasket's GraphQL API directly with one account's login
 * token (MILKBASKET_TOKEN, a server-only environment variable). The token is
 * only ever sent in the Authorization header: it is not stored in Firestore,
 * logged, or shown. Only households in MB_HOUSEHOLD_IDS can use it.
 */

type Fs = ReturnType<typeof adminFirestore>;

const requestsPath = (hid: string) => `households/${hid}/purchase_requests`;
const mappingsPath = (hid: string) => `households/${hid}/milkbasket_products`;
const guardsPath = (hid: string) => `households/${hid}/milkbasket_items`;
const settingsPath = (hid: string) => `households/${hid}/settings/milkbasket`;
const workerPath = (hid: string) => `households/${hid}/settings/milkbasket_worker`;
const historyPath = (hid: string) => `households/${hid}/settings/milkbasket_history`;

const LEASE_MS = 2 * 60_000;
/** An add still "adding" after this long was cut off before Milkbasket answered. */
const STALE_ADDING_MS = 5 * 60_000;
const HISTORY_TTL_MS = 60 * 60_000;
const MAX_HISTORY_PRODUCTS = 500;
const ACTIVITY_LIMIT = 50;

function defaultPriceLimit(): number {
    return M.priceLimitFromEnv(process.env.AUTO_ADD_PRICE_LIMIT);
}

/**
 * Milkbasket settings from the environment: MILKBASKET_TOKEN, MILKBASKET_CITY_ID
 * and MILKBASKET_HUB_ID (required), MILKBASKET_APP_VERSION and MILKBASKET_API_URL
 * (optional; the URL is only changed for testing against a mock).
 */
function milkbasketConfig(): { deps: M.MilkbasketDeps | null; missing: string[]; apiHost: string; tokenExpiresAt: number | null } {
    const token = M.cleanToken(process.env.MILKBASKET_TOKEN);
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
    const missing = [
        !token && 'MILKBASKET_TOKEN',
        !cityId && 'MILKBASKET_CITY_ID',
        !hubId && 'MILKBASKET_HUB_ID',
        !apiHost && 'MILKBASKET_API_URL',
    ].filter((m): m is string => !!m);
    const deps: M.MilkbasketDeps | null = missing.length > 0 ? null : {
        apiUrl,
        token,
        cityId,
        hubId,
        appVersion,
        fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }),
    };
    return { deps, missing, apiHost, tokenExpiresAt: token ? M.tokenExpiry(token) : null };
}

/** What the admin panel may show about the connection: never the token itself. */
function connectionInfo(): MilkbasketAdminView['connection'] {
    const { deps, missing, apiHost, tokenExpiresAt } = milkbasketConfig();
    const now = Date.now();
    const tokenStatus = tokenExpiresAt === null ? 'unknown' : tokenExpiresAt < now ? 'expired' : tokenExpiresAt < now + 3 * 86_400_000 ? 'expiring' : 'ok';
    return { configured: !!deps, missing, apiHost, tokenExpiresAt, tokenStatus };
}

function notConfigured(missing: string[]): string {
    return `Milkbasket isn't set up on the server: add ${missing.join(', ')} to the environment variables and redeploy.`;
}

/* ─── Reading documents ──────────────────────────────────────────────── */

function text(value: unknown, max: number): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readMapping(itemId: string, data: DocumentData | undefined): M.ProductMapping | null {
    if (!data || !M.isProductId(data.milkbasketProductId)) return null;
    return {
        itemId,
        milkbasketProductId: data.milkbasketProductId,
        productName: text(data.productName, 120) || `Product ${data.milkbasketProductId}`,
        size: text(data.size, 40),
        price: M.cleanPrice(data.price),
        defaultQuantity: M.cleanQuantity(data.defaultQuantity, 1),
        priceUpdatedAt: num(data.priceUpdatedAt),
        enabled: data.enabled !== false,
    };
}

const REASONS: readonly M.Reason[] = ['unmapped', 'price-unknown', 'over-limit', 'under-limit', 'auto-off', 'item-off', 'approved'];

function readRequest(id: string, data: DocumentData): PurchaseRequestRow {
    const trigger = data.trigger && typeof data.trigger === 'object' ? data.trigger : null;
    return {
        id,
        pantryItemId: text(data.pantryItemId, 128),
        itemName: text(data.itemName, 80) || text(data.pantryItemId, 80),
        milkbasketProductId: M.isProductId(data.milkbasketProductId) ? data.milkbasketProductId : null,
        productName: text(data.productName, 120) || null,
        size: text(data.size, 40),
        quantity: M.cleanQuantity(data.quantity, 1),
        price: M.cleanPrice(data.price),
        status: M.isRequestStatus(data.status) ? data.status : 'failed',
        reason: REASONS.includes(data.reason) ? data.reason : 'unmapped',
        errorMessage: text(data.errorMessage, 300) || null,
        deliveryDate: typeof data.deliveryDate === 'string' ? data.deliveryDate : null,
        createdAt: num(data.createdAt) ?? 0,
        updatedAt: num(data.updatedAt) ?? 0,
        addedAt: num(data.addedAt),
        decidedBy: text(data.decidedBy, 128) || null,
        decidedByName: text(data.decidedByName, 80) || null,
        decidedAt: num(data.decidedAt),
        trigger: trigger ? { from: text(trigger.from, 20), to: text(trigger.to, 20) } : null,
        attempts: num(data.attempts) ?? 0,
    };
}

const summary = (r: PurchaseRequestRow): M.RequestSummary => ({ id: r.id, status: r.status, addedAt: r.addedAt });

async function readSettings(fs: Fs, hid: string): Promise<M.MilkbasketSettings> {
    return M.cleanSettings((await fs.doc(settingsPath(hid)).get()).data(), defaultPriceLimit());
}

/** A status change: the fields, plus one entry in the request's history. */
function statusUpdate(status: M.RequestStatus, nowMs: number, note: string | null, extra: DocumentData = {}): DocumentData {
    return { ...extra, status, updatedAt: nowMs, history: FieldValue.arrayUnion({ status, at: nowMs, note: note?.slice(0, 300) ?? null }) };
}

function productFields(mapping: M.ProductMapping): DocumentData {
    return {
        milkbasketProductId: mapping.milkbasketProductId,
        productName: mapping.productName,
        size: mapping.size,
        price: mapping.price,
    };
}

const validOwner = (user: User) => user.role === 'user' && isSafeDocId(user.uid) && isSafeDocId(user.householdId);

function deciderFields(user: User, nowMs: number): DocumentData {
    return { decidedBy: user.uid, decidedByName: actorFromUser(user)?.name ?? null, decidedAt: nowMs };
}

/* ─── Bell notifications (owner only) ────────────────────────────────── */

async function notifyOwner(fs: Fs, hid: string, kind: 'review' | 'added' | 'failed', names: string[]): Promise<void> {
    if (names.length === 0) return;
    try {
        await fs.collection(`households/${hid}/notifications`).add({
            type: 'milkbasket',
            actorId: 'milkbasket',
            actorName: 'Milkbasket',
            date: null,
            mealType: null,
            payload: { kind, items: [...new Set(names)].slice(0, 10).join(', '), count: names.length, audience: 'owner' },
            createdAt: FieldValue.serverTimestamp(),
            readBy: [],
        });
    } catch (err) {
        console.error('[milkbasket] notification failed:', err instanceof Error ? err.message : err);
    }
}

/* ─── Milkbasket problems (banner) ───────────────────────────────────── */

async function setProblem(fs: Fs, hid: string, message: string | null): Promise<void> {
    await fs.doc(workerPath(hid)).set({ problem: message ? { message: message.slice(0, 300), atMs: Date.now() } : null }, { merge: true }).catch(() => {});
}

const PROBLEM_KINDS: readonly M.FailureKind[] = ['network', 'timeout', 'server', 'auth', 'config'];

/* ─── Stock changes: open or cancel requests ─────────────────────────── */

/**
 * Pantry levels changed (called in the background after the response).
 * Items are handled one after another; the worker then adds queued ones,
 * also one at a time.
 */
export async function handleLevelChanges(hid: string, changes: M.LevelChange[], now: Date = new Date()): Promise<void> {
    if (!isSafeDocId(hid) || !isMilkbasketHousehold(hid)) return;
    const fs = adminFirestore();
    const settings = await readSettings(fs, hid);
    const review: string[] = [];
    let queued = false;
    for (const change of changes) {
        if (!isSafeDocId(change.itemId)) continue;
        try {
            if (M.isOrderTrigger(change)) {
                const status = await openRequest(fs, hid, change, settings, now.getTime());
                if (status === 'queued') queued = true;
                else if (status) review.push(change.name);
            } else if (M.isBackToOk(change)) {
                await cancelOpenRequests(fs, hid, change, now.getTime());
            }
        } catch (err) {
            console.error('[milkbasket] handling a level change failed:', err instanceof Error ? err.message : err);
        }
    }
    if (settings.notify) await notifyOwner(fs, hid, 'review', review);
    if (queued) await runWorker(hid);
}

async function openRequest(
    fs: Fs,
    hid: string,
    change: M.LevelChange,
    settings: M.MilkbasketSettings,
    nowMs: number,
): Promise<M.RequestStatus | null> {
    const guard = fs.doc(`${guardsPath(hid)}/${change.itemId}`);
    const mappingRef = fs.doc(`${mappingsPath(hid)}/${change.itemId}`);
    const itemRequests = fs.collection(requestsPath(hid)).where('pantryItemId', '==', change.itemId);
    return fs.runTransaction(async tx => {
        // Reading and then writing the guard makes concurrent reports for one item take turns.
        const [, mappingSnap, requestSnap] = await Promise.all([tx.get(guard), tx.get(mappingRef), tx.get(itemRequests)]);
        const mapping = readMapping(change.itemId, mappingSnap.data());
        const requests = requestSnap.docs.map(d => summary(readRequest(d.id, d.data())));
        const decision = M.decideOnLow({ settings, mapping, requests, nowMs });
        if (decision.action === 'none') return null;
        const ref = fs.collection(requestsPath(hid)).doc();
        tx.set(ref, {
            id: ref.id,
            pantryItemId: change.itemId,
            itemName: change.name.slice(0, 80),
            milkbasketProductId: mapping?.milkbasketProductId ?? null,
            productName: mapping?.productName ?? null,
            size: mapping?.size ?? '',
            quantity: mapping?.defaultQuantity ?? 1,
            price: mapping?.price ?? null,
            status: decision.status,
            reason: decision.reason,
            errorMessage: null,
            deliveryDate: null,
            createdAt: nowMs,
            updatedAt: nowMs,
            addedAt: null,
            decidedBy: null,
            decidedByName: null,
            decidedAt: null,
            approved: false,
            attempts: 0,
            trigger: { from: change.from, to: change.to },
            history: [{ status: decision.status, at: nowMs, note: `Level ${change.from} → ${change.to}` }],
        });
        tx.set(guard, { lastRequestId: ref.id, updatedAtMs: nowMs }, { merge: true });
        return decision.status;
    });
}

/** The item is fine again: its approval or mapping request is no longer needed. Queued ones go ahead. */
async function cancelOpenRequests(fs: Fs, hid: string, change: M.LevelChange, nowMs: number): Promise<void> {
    const snap = await fs.collection(requestsPath(hid)).where('pantryItemId', '==', change.itemId).get();
    for (const d of snap.docs) {
        if (!M.CANCEL_ON_OK.includes(d.data().status)) continue;
        await moveRequest(fs, d.ref, 'cancelled', nowMs, `Level ${change.from} → ${change.to}: not needed any more`, {}, M.CANCEL_ON_OK);
    }
}

/**
 * Change a request's status if it is still in one of `from` (and the move is
 * allowed). Returns the updated request, or null if it had moved on.
 */
async function moveRequest(
    fs: Fs,
    ref: DocumentReference,
    to: M.RequestStatus,
    nowMs: number,
    note: string | null,
    extra: DocumentData,
    from: readonly M.RequestStatus[],
): Promise<PurchaseRequestRow | null> {
    return fs.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const current = readRequest(snap.id, snap.data()!);
        if (!from.includes(current.status) || !M.canMove(current.status, to)) return null;
        tx.update(ref, statusUpdate(to, nowMs, note, extra));
        return { ...current, status: to };
    });
}

/* ─── The worker: adds queued requests, one at a time ────────────────── */

async function takeLease(fs: Fs, hid: string, holder: string): Promise<boolean> {
    const ref = fs.doc(workerPath(hid));
    return fs.runTransaction(async tx => {
        const data = (await tx.get(ref)).data() ?? {};
        const now = Date.now();
        if (typeof data.leaseUntilMs === 'number' && data.leaseUntilMs > now && data.holder !== holder) return false;
        tx.set(ref, { holder, leaseUntilMs: now + LEASE_MS }, { merge: true });
        return true;
    });
}

async function releaseLease(fs: Fs, hid: string, holder: string): Promise<void> {
    const ref = fs.doc(workerPath(hid));
    await fs.runTransaction(async tx => {
        const data = (await tx.get(ref)).data() ?? {};
        if (data.holder === holder) tx.set(ref, { holder: null, leaseUntilMs: 0 }, { merge: true });
    }).catch(err => console.error('[milkbasket] releasing the worker lease failed:', err instanceof Error ? err.message : err));
}

async function queuedRequests(fs: Fs, hid: string) {
    const snap = await fs.collection(requestsPath(hid)).where('status', '==', 'queued').get();
    return snap.docs.sort((a, b) => (num(a.data().createdAt) ?? 0) - (num(b.data().createdAt) ?? 0));
}

/** Requests left "adding" by a run that was cut off: we can't know if they were added, so a person checks. */
async function failStaleAdding(fs: Fs, hid: string, nowMs: number): Promise<void> {
    const snap = await fs.collection(requestsPath(hid)).where('status', '==', 'adding').get();
    for (const d of snap.docs) {
        if ((num(d.data().updatedAt) ?? 0) > nowMs - STALE_ADDING_MS) continue;
        const message = 'Stopped before Milkbasket answered. Check the basket in the Milkbasket app before retrying.';
        await moveRequest(fs, d.ref, 'failed', nowMs, message, { errorMessage: message }, ['adding']);
    }
}

async function claimNext(fs: Fs, hid: string): Promise<{ ref: DocumentReference; req: PurchaseRequestRow; approved: boolean } | null> {
    for (const d of await queuedRequests(fs, hid)) {
        const claimed = await fs.runTransaction(async tx => {
            const snap = await tx.get(d.ref);
            const data = snap.data();
            if (!data || data.status !== 'queued') return null;
            tx.update(d.ref, statusUpdate('adding', Date.now(), null));
            return { ref: d.ref, req: readRequest(snap.id, data), approved: data.approved === true };
        });
        if (claimed) return claimed;
    }
    return null;
}

type Processed = 'added' | 'failed' | 'returned';

async function processRequest(fs: Fs, hid: string, job: { ref: DocumentReference; req: PurchaseRequestRow; approved: boolean }): Promise<Processed> {
    const { ref, req } = job;
    const settings = await readSettings(fs, hid);
    const fail = async (message: string) => {
        await moveRequest(fs, ref, 'failed', Date.now(), message, { errorMessage: message }, ['adding']);
        return 'failed' as const;
    };
    if (!isMilkbasketHousehold(hid)) return fail('This household is not set up for Milkbasket (MB_HOUSEHOLD_IDS).');
    if (!settings.enabled && !job.approved) {
        await moveRequest(fs, ref, 'pending_approval', Date.now(), 'Auto-order is off: waiting for approval', { reason: 'auto-off' }, ['adding']);
        return 'returned';
    }
    if (req.milkbasketProductId === null || req.price === null) return fail('No Milkbasket product or price on this request.');
    const config = milkbasketConfig();
    if (!config.deps) {
        const message = notConfigured(config.missing);
        await setProblem(fs, hid, message);
        return fail(message);
    }

    const date = M.deliveryDate(localTime(new Date()).date, settings.deliveryDays);
    const outcome = await M.addToBasket(config.deps, { productId: req.milkbasketProductId, price: req.price, quantity: req.quantity, date });
    const nowMs = Date.now();

    if (!outcome.ok) {
        await moveRequest(fs, ref, 'failed', nowMs, outcome.message, {
            errorMessage: outcome.message,
            deliveryDate: date,
            attempts: FieldValue.increment(outcome.attempts),
        }, ['adding']);
        if (PROBLEM_KINDS.includes(outcome.kind)) await setProblem(fs, hid, outcome.message);
        return 'failed';
    }

    const inBasket = outcome.basketQuantity !== null ? `; the basket now has ${outcome.basketQuantity} for that day` : '';
    await moveRequest(fs, ref, 'added', nowMs, `Added ${req.quantity} × ₹${req.price} for ${date}${inBasket}`, {
        errorMessage: null,
        deliveryDate: date,
        addedAt: nowMs,
        attempts: FieldValue.increment(outcome.attempts),
    }, ['adding']);
    await setProblem(fs, hid, null);
    const bought = await restockFromBasket(hid, req.pantryItemId, { requestId: req.id, productName: req.productName ?? '' }).catch(err => {
        console.error('[milkbasket] marking bought failed:', err instanceof Error ? err.message : err);
        return false;
    });
    if (!bought) {
        await ref.update({ history: FieldValue.arrayUnion({ status: 'added', at: Date.now(), note: 'Added, but the pantry item could not be marked bought' }) }).catch(() => {});
    }
    return 'added';
}

/**
 * Add every queued request, one after another. Only one worker runs per
 * household (a lease in Firestore); a second call while one runs returns at
 * once, and the running one picks up anything queued meanwhile.
 */
export async function runWorker(hid: string): Promise<void> {
    if (!isSafeDocId(hid)) return;
    const fs = adminFirestore();
    const holder = randomUUID();
    const added: string[] = [];
    const failed: string[] = [];
    for (let round = 0; round < 3; round++) {
        if (!(await takeLease(fs, hid, holder))) break;
        try {
            await failStaleAdding(fs, hid, Date.now());
            for (let i = 0; i < 50; i++) {
                const job = await claimNext(fs, hid);
                if (!job) break;
                const result = await processRequest(fs, hid, job);
                const { itemName, productName } = job.req;
                const label = productName && productName.toLowerCase() !== itemName.toLowerCase() ? `${itemName} (${productName})` : itemName;
                if (result === 'added') added.push(label);
                else if (result === 'failed') failed.push(label);
                await takeLease(fs, hid, holder);
            }
        } finally {
            await releaseLease(fs, hid, holder);
        }
        // Something may have been queued while this run was finishing.
        if ((await queuedRequests(fs, hid)).length === 0) break;
    }
    if (added.length || failed.length) {
        const settings = await readSettings(fs, hid);
        if (settings.notify) {
            await notifyOwner(fs, hid, 'added', added);
            await notifyOwner(fs, hid, 'failed', failed);
        }
    }
}

/* ─── Owner: admin view ──────────────────────────────────────────────── */

export async function getMilkbasketAdminView(user: User, now: Date = new Date()): Promise<MilkbasketAdminView | null> {
    if (!validOwner(user)) return null;
    const hid = user.householdId;
    const allowed = isMilkbasketHousehold(hid);
    const base: MilkbasketAdminView = {
        allowed,
        householdId: hid,
        connection: connectionInfo(),
        today: localTime(now).date,
        settings: M.defaultSettings(defaultPriceLimit()),
        defaultPriceLimit: defaultPriceLimit(),
        problem: null,
        approvals: [],
        unmapped: [],
        mappings: [],
        activity: [],
    };
    if (!allowed) return base;

    const fs = adminFirestore();
    const [settings, workerSnap, mappingSnap, recentSnap, openSnap, pantry] = await Promise.all([
        readSettings(fs, hid),
        fs.doc(workerPath(hid)).get(),
        fs.collection(mappingsPath(hid)).get(),
        fs.collection(requestsPath(hid)).orderBy('createdAt', 'desc').limit(ACTIVITY_LIMIT).get(),
        fs.collection(requestsPath(hid)).where('status', 'in', [...M.OPEN_STATUSES]).get(),
        listPantryItems(hid),
    ]);
    const worker = workerSnap.data() ?? {};
    const problem = worker.problem && typeof worker.problem.message === 'string'
        ? { message: text(worker.problem.message, 300), atMs: num(worker.problem.atMs) ?? 0 }
        : null;

    const open = openSnap.docs.map(d => readRequest(d.id, d.data()));
    const approvals = open.filter(r => r.status === 'pending_approval').sort((a, b) => a.createdAt - b.createdAt);
    const waitingMapping = new Map(open.filter(r => r.status === 'needs_mapping').sort((a, b) => b.createdAt - a.createdAt).map(r => [r.pantryItemId, r]));

    const items = new Map(pantry.map(p => [p.itemId, p]));
    const mappingsById = new Map<string, M.ProductMapping>();
    mappingSnap.docs.forEach(d => {
        const m = readMapping(d.id, d.data());
        if (m) mappingsById.set(d.id, m);
    });
    const mappings: MappingRow[] = [...mappingsById.values()]
        .map(m => {
            const item = items.get(m.itemId);
            return { ...m, itemName: item?.en ?? m.itemId, itemLevel: item?.level ?? 'unknown', itemActive: item?.active ?? false };
        })
        .sort((a, b) => a.itemName.localeCompare(b.itemName));

    const unmapped: UnmappedItem[] = pantry
        .filter(p => !mappingsById.has(p.itemId))
        .map(p => ({ itemId: p.itemId, en: p.en, hi: p.hi, or: p.or, level: p.level, active: p.active, request: waitingMapping.get(p.itemId) ?? null }))
        .sort((a, b) =>
            Number(!!b.request) - Number(!!a.request)
            || (b.request?.createdAt ?? 0) - (a.request?.createdAt ?? 0)
            || Number(b.active) - Number(a.active)
            || a.en.localeCompare(b.en));
    // A needs-mapping request whose pantry item is gone still shows, so nothing is silently dropped.
    for (const r of waitingMapping.values()) {
        if (!items.has(r.pantryItemId) && !mappingsById.has(r.pantryItemId)) {
            unmapped.unshift({ itemId: r.pantryItemId, en: r.itemName, hi: '', or: '', level: 'unknown', active: false, request: r });
        }
    }

    // Kick the worker if something is waiting and no run holds the lease.
    const leaseFree = !(typeof worker.leaseUntilMs === 'number' && worker.leaseUntilMs > Date.now());
    const stale = open.some(r => r.status === 'adding' && r.updatedAt < Date.now() - STALE_ADDING_MS);
    if (leaseFree && (open.some(r => r.status === 'queued') || stale)) runAfterResponse('worker', () => runWorker(hid));

    return {
        ...base,
        settings,
        problem,
        approvals,
        unmapped,
        mappings,
        activity: recentSnap.docs.map(d => readRequest(d.id, d.data())),
    };
}

/* ─── Owner: actions ─────────────────────────────────────────────────── */

function guardOwner(user: User): { ok: false; error: 'forbidden' | 'not-allowed' } | null {
    if (!validOwner(user)) return { ok: false, error: 'forbidden' };
    if (!isMilkbasketHousehold(user.householdId)) return { ok: false, error: 'not-allowed' };
    return null;
}

async function requestRow(fs: Fs, hid: string, id: string): Promise<PurchaseRequestRow | null> {
    const snap = await fs.doc(`${requestsPath(hid)}/${id}`).get();
    return snap.exists ? readRequest(snap.id, snap.data()!) : null;
}

export interface MappingInput {
    itemId: string;
    milkbasketProductId: number;
    productName: string;
    size?: string;
    price: number | string | null;
    defaultQuantity: number;
    enabled: boolean;
}

/**
 * Save an item's mapping. A request waiting for this mapping moves on by the
 * normal rules (below the limit → added now; otherwise → approval), and
 * waiting approvals pick up the new product and price.
 */
export async function saveMapping(user: User, input: unknown): Promise<MilkbasketResult> {
    const denied = guardOwner(user);
    if (denied) return denied;
    if (!input || typeof input !== 'object') return { ok: false, error: 'invalid' };
    const r = input as Record<string, unknown>;
    const productId = typeof r.milkbasketProductId === 'string' ? Number(r.milkbasketProductId) : r.milkbasketProductId;
    const productName = text(r.productName, 120);
    const priceGiven = r.price !== null && r.price !== undefined && r.price !== '';
    const price = M.cleanPrice(r.price);
    if (!isSafeDocId(r.itemId) || !M.isProductId(productId) || !productName || (priceGiven && price === null)) return { ok: false, error: 'invalid' };
    if (typeof r.enabled !== 'boolean') return { ok: false, error: 'invalid' };
    const quantity = M.cleanQuantity(r.defaultQuantity, 0);
    if (quantity === 0) return { ok: false, error: 'invalid' };

    const hid = user.householdId;
    const fs = adminFirestore();
    const itemId = r.itemId;
    const pantryItem = (await listPantryItems(hid)).find(p => p.itemId === itemId);
    const waiting = await fs.collection(requestsPath(hid)).where('pantryItemId', '==', itemId).get();
    if (!pantryItem && !waiting.docs.some(d => d.data().status === 'needs_mapping')) return { ok: false, error: 'not-found' };

    const ref = fs.doc(`${mappingsPath(hid)}/${itemId}`);
    const nowMs = Date.now();
    const previous = readMapping(itemId, (await ref.get()).data());
    const mapping: M.ProductMapping = {
        itemId,
        milkbasketProductId: productId,
        productName,
        size: text(r.size, 40),
        price,
        defaultQuantity: quantity,
        priceUpdatedAt: price === null ? null : previous && previous.price === price ? previous.priceUpdatedAt ?? nowMs : nowMs,
        enabled: r.enabled,
    };
    await ref.set({ ...mapping, updatedAtMs: nowMs, updatedBy: user.uid });

    const settings = await readSettings(fs, hid);
    let queued = false;
    for (const d of waiting.docs) {
        const status = d.data().status;
        if (status === 'needs_mapping') {
            const route = M.routeMapped(mapping, settings);
            const moved = await moveRequest(fs, d.ref, route.status, nowMs, `Mapped to ${productName}`, {
                ...productFields(mapping),
                quantity: mapping.defaultQuantity,
                reason: route.reason,
            }, ['needs_mapping']);
            if (moved?.status === 'queued') queued = true;
        } else if (status === 'pending_approval') {
            await d.ref.update({ ...productFields(mapping), updatedAt: nowMs }).catch(() => {});
        }
    }
    if (queued) await runWorker(hid);
    return { ok: true };
}

/** Remove a mapping. Approvals waiting on it go back to "needs mapping"; queued adds go ahead. */
export async function removeMapping(user: User, itemId: unknown): Promise<MilkbasketResult> {
    const denied = guardOwner(user);
    if (denied) return denied;
    if (!isSafeDocId(itemId)) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    const hid = user.householdId;
    await fs.doc(`${mappingsPath(hid)}/${itemId}`).delete();
    const nowMs = Date.now();
    const snap = await fs.collection(requestsPath(hid)).where('pantryItemId', '==', itemId).get();
    for (const d of snap.docs) {
        if (d.data().status !== 'pending_approval') continue;
        await moveRequest(fs, d.ref, 'needs_mapping', nowMs, 'Mapping removed', {
            milkbasketProductId: null, productName: null, size: '', price: null, reason: 'unmapped',
        }, ['pending_approval']);
    }
    return { ok: true };
}

export async function setMappingEnabled(user: User, itemId: unknown, enabled: unknown): Promise<MilkbasketResult> {
    const denied = guardOwner(user);
    if (denied) return denied;
    if (!isSafeDocId(itemId) || typeof enabled !== 'boolean') return { ok: false, error: 'invalid' };
    const ref = adminFirestore().doc(`${mappingsPath(user.householdId)}/${itemId}`);
    if (!(await ref.get()).exists) return { ok: false, error: 'not-found' };
    await ref.update({ enabled, updatedAtMs: Date.now(), updatedBy: user.uid });
    return { ok: true };
}

/**
 * Approve a waiting request: optionally a different quantity, and a price if
 * none is known yet (saved on the mapping too). It is added straight away and,
 * on success, the pantry item is marked bought.
 */
export async function approveRequest(user: User, requestId: unknown, quantity: unknown, price: unknown): Promise<MilkbasketResult<PurchaseRequestRow>> {
    const denied = guardOwner(user);
    if (denied) return denied;
    if (!isSafeDocId(requestId)) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    const hid = user.householdId;
    const ref = fs.doc(`${requestsPath(hid)}/${requestId}`);
    const nowMs = Date.now();
    type Step = { error: 'not-found' | 'conflict' | 'unmapped' | 'price-needed' } | { saveMappingPrice: number | null; itemId: string };
    const step: Step = await fs.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { error: 'not-found' as const };
        const req = readRequest(snap.id, snap.data()!);
        if (req.status !== 'pending_approval') return { error: 'conflict' as const };
        const mapping = readMapping(req.pantryItemId, (await tx.get(fs.doc(`${mappingsPath(hid)}/${req.pantryItemId}`))).data());
        if (!mapping) return { error: 'unmapped' as const };
        const given = M.cleanPrice(price);
        const usePrice = mapping.price ?? given;
        if (usePrice === null) return { error: 'price-needed' as const };
        const qty = M.cleanQuantity(quantity, req.quantity);
        tx.update(ref, statusUpdate('queued', nowMs, `Approved: ${qty} × ₹${usePrice}`, {
            ...productFields(mapping),
            price: usePrice,
            quantity: qty,
            approved: true,
            reason: 'approved',
            ...deciderFields(user, nowMs),
        }));
        return { saveMappingPrice: mapping.price === null ? usePrice : null, itemId: req.pantryItemId };
    });
    if ('error' in step) return { ok: false, error: step.error };
    if (step.saveMappingPrice !== null) {
        await fs.doc(`${mappingsPath(hid)}/${step.itemId}`).update({ price: step.saveMappingPrice, priceUpdatedAt: nowMs }).catch(() => {});
    }
    await runWorker(hid);
    const row = await requestRow(fs, hid, requestId);
    return row ? { ok: true, data: row } : { ok: false, error: 'failed' };
}

/** Reject a waiting approval, or dismiss a request waiting for a mapping. */
export async function rejectRequest(user: User, requestId: unknown): Promise<MilkbasketResult> {
    const denied = guardOwner(user);
    if (denied) return denied;
    if (!isSafeDocId(requestId)) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    const nowMs = Date.now();
    const moved = await moveRequest(fs, fs.doc(`${requestsPath(user.householdId)}/${requestId}`), 'rejected', nowMs, 'Rejected', deciderFields(user, nowMs), ['pending_approval', 'needs_mapping']);
    return moved ? { ok: true } : { ok: false, error: 'conflict' };
}

/**
 * Retry a failed request with the mapping's current product and price: below
 * the limit it is added now, otherwise it goes to approval. Refused if the item
 * has another open request or was added within the duplicate window.
 */
export async function retryRequest(user: User, requestId: unknown): Promise<MilkbasketResult<PurchaseRequestRow>> {
    const denied = guardOwner(user);
    if (denied) return denied;
    if (!isSafeDocId(requestId)) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    const hid = user.householdId;
    const settings = await readSettings(fs, hid);
    const ref = fs.doc(`${requestsPath(hid)}/${requestId}`);
    const nowMs = Date.now();
    type Step = { error: 'not-found' | 'conflict' | 'duplicate'; message?: string } | { status: M.RequestStatus };
    const result: Step = await fs.runTransaction(async (tx): Promise<Step> => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { error: 'not-found' as const };
        const req = readRequest(snap.id, snap.data()!);
        if (req.status !== 'failed') return { error: 'conflict' as const };
        const guard = fs.doc(`${guardsPath(hid)}/${req.pantryItemId}`);
        const [, mappingSnap, others] = await Promise.all([
            tx.get(guard),
            tx.get(fs.doc(`${mappingsPath(hid)}/${req.pantryItemId}`)),
            tx.get(fs.collection(requestsPath(hid)).where('pantryItemId', '==', req.pantryItemId)),
        ]);
        const rest = others.docs.filter(d => d.id !== req.id).map(d => summary(readRequest(d.id, d.data())));
        if (M.hasOpenRequest(rest)) return { error: 'duplicate' as const, message: 'This item already has an open request.' };
        if (M.addedRecently(rest, nowMs, settings.duplicateWindowHours)) {
            return { error: 'duplicate' as const, message: `This item was added to the basket in the last ${settings.duplicateWindowHours} hours.` };
        }
        const mapping = readMapping(req.pantryItemId, mappingSnap.data());
        const route = mapping ? M.routeMapped(mapping, settings) : { status: 'needs_mapping' as const, reason: 'unmapped' as const };
        tx.update(ref, statusUpdate(route.status, nowMs, `Retry (was: ${req.errorMessage ?? 'failed'})`, {
            ...(mapping ? productFields(mapping) : {}),
            errorMessage: null,
            approved: false,
            reason: route.reason,
            ...deciderFields(user, nowMs),
        }));
        tx.set(guard, { lastRequestId: req.id, updatedAtMs: nowMs }, { merge: true });
        return { status: route.status };
    });
    if ('error' in result) return { ok: false, error: result.error, message: result.message };
    if (result.status === 'queued') await runWorker(hid);
    const row = await requestRow(fs, hid, requestId);
    return row ? { ok: true, data: row } : { ok: false, error: 'failed' };
}

export async function updateMilkbasketSettings(user: User, input: unknown): Promise<MilkbasketResult> {
    const denied = guardOwner(user);
    if (denied) return denied;
    if (!input || typeof input !== 'object') return { ok: false, error: 'invalid' };
    const settings = M.cleanSettings(input, defaultPriceLimit());
    await adminFirestore().doc(settingsPath(user.householdId)).set({ ...settings, updatedAtMs: Date.now(), updatedBy: user.uid });
    return { ok: true };
}

/** Test connection: a read-only fetchOrders call with the server's token. Never shows the token. */
export async function testConnection(user: User): Promise<MilkbasketResult<{ message: string }>> {
    const denied = guardOwner(user);
    if (denied) return denied;
    const fs = adminFirestore();
    const config = milkbasketConfig();
    if (!config.deps) {
        const message = notConfigured(config.missing);
        await setProblem(fs, user.householdId, message);
        return { ok: false, error: 'milkbasket', message };
    }
    try {
        const orders = await M.fetchOrders(config.deps);
        await setProblem(fs, user.householdId, null);
        return { ok: true, data: { message: `Your account answered with ${orders.length} recent order${orders.length === 1 ? '' : 's'}.` } };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Milkbasket is not reachable.';
        await setProblem(fs, user.householdId, message);
        return { ok: false, error: 'milkbasket', message };
    }
}

/**
 * Products from recent Milkbasket orders (name, size, price, product id), to
 * pick a mapping from. Cached for an hour; `refresh` fetches again.
 */
export async function getOrderHistory(user: User, refresh: unknown): Promise<MilkbasketResult<OrderHistoryResult>> {
    const denied = guardOwner(user);
    if (denied) return denied;
    const fs = adminFirestore();
    const ref = fs.doc(historyPath(user.householdId));
    const cached = (await ref.get()).data();
    const cachedResult: OrderHistoryResult | null = cached && Array.isArray(cached.products)
        ? { products: cached.products, fetchedAtMs: num(cached.fetchedAtMs) ?? 0, orderCount: num(cached.orderCount) ?? 0 }
        : null;
    if (cachedResult && refresh !== true && Date.now() - cachedResult.fetchedAtMs < HISTORY_TTL_MS) return { ok: true, data: cachedResult };

    const config = milkbasketConfig();
    if (!config.deps) {
        if (cachedResult && refresh !== true) return { ok: true, data: cachedResult };
        return { ok: false, error: 'milkbasket', message: notConfigured(config.missing) };
    }
    const deps = config.deps;
    try {
        const orders = await M.fetchOrders(deps);
        const perOrder: M.HistoryProduct[][] = new Array(orders.length).fill([]);
        let failures = 0;
        // A few at a time, keeping the orders' order (latest first) for the merge.
        for (let i = 0; i < orders.length; i += 3) {
            await Promise.all(orders.slice(i, i + 3).map(async (order, j) => {
                try {
                    perOrder[i + j] = await M.fetchOrderDetail(deps, order);
                } catch {
                    failures++;
                }
            }));
        }
        if (orders.length > 0 && failures === orders.length) throw new Error('Milkbasket did not return any order details.');
        const result: OrderHistoryResult = {
            products: M.mergeHistory(perOrder).slice(0, MAX_HISTORY_PRODUCTS),
            fetchedAtMs: Date.now(),
            orderCount: orders.length - failures,
        };
        await ref.set(result);
        await setProblem(fs, user.householdId, null);
        return { ok: true, data: result };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Milkbasket is not reachable.';
        // An older list is better than none, unless someone asked for a fresh one.
        if (cachedResult && refresh !== true) return { ok: true, data: cachedResult };
        return { ok: false, error: 'milkbasket', message };
    }
}
