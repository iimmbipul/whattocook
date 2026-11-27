/**
 * Milkbasket auto-order rules, shared by the server and the admin screen:
 * which pantry levels start an order, what happens to a low item (needs a
 * mapping, needs approval, or goes straight to the basket), the calls to
 * Milkbasket's GraphQL API, how its answers are read, and retries.
 *
 * Pure functions with no runtime imports, so they can be unit-tested directly
 * with `node --test` (tests/milkbasket.test.mjs). The HTTP calls take `fetch`
 * as a parameter so tests never reach the real Milkbasket. Firestore access
 * lives in src/lib/server/milkbasket.ts.
 */

/* ─── Pantry levels ──────────────────────────────────────────────────── */

/** Pantry levels (src/lib/grocery/logic.ts) that mean "low or empty": Quarter is the app's Low. */
export const ORDER_LEVELS: readonly string[] = ['quarter', 'empty'];
/** Levels that mean the item is fine again (Full or Half): open approvals and mapping requests are cancelled. */
export const OK_LEVELS: readonly string[] = ['full', 'half'];

export interface LevelChange {
    itemId: string;
    /** English name, for the request's history. */
    name: string;
    from: string;
    to: string;
}

/** Only a change of level counts, not saving the same level again. */
export function isOrderTrigger(change: { from: string; to: string }): boolean {
    return change.from !== change.to && ORDER_LEVELS.includes(change.to);
}

export function isBackToOk(change: { from: string; to: string }): boolean {
    return change.from !== change.to && OK_LEVELS.includes(change.to);
}

/* ─── Settings ───────────────────────────────────────────────────────── */

export interface MilkbasketSettings {
    /** Global switch. Off: stock changes start nothing and nothing is added without someone approving it. */
    enabled: boolean;
    /** Items priced strictly below this (₹, per unit) are added automatically; at or above it they need approval. */
    priceLimit: number;
    /** Delivery date: 1 = tomorrow, 2 = the day after. */
    deliveryDays: 1 | 2;
    /** An item added to the basket within this many hours is not added again. */
    duplicateWindowHours: number;
    /** Bell notifications to the owner when something needs them, was added or failed. */
    notify: boolean;
}

export const DEFAULT_PRICE_LIMIT = 150;
export const DEFAULT_DUPLICATE_HOURS = 24;

/** The price limit from AUTO_ADD_PRICE_LIMIT, or 150. */
export function priceLimitFromEnv(value: string | undefined): number {
    const n = Number(value);
    return value !== undefined && value.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : DEFAULT_PRICE_LIMIT;
}

export function defaultSettings(priceLimit: number = DEFAULT_PRICE_LIMIT): MilkbasketSettings {
    return { enabled: false, priceLimit, deliveryDays: 1, duplicateWindowHours: DEFAULT_DUPLICATE_HOURS, notify: true };
}

export function cleanSettings(value: unknown, defaultLimit: number = DEFAULT_PRICE_LIMIT): MilkbasketSettings {
    const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const d = defaultSettings(defaultLimit);
    const limit = typeof v.priceLimit === 'number' && Number.isFinite(v.priceLimit) && v.priceLimit > 0 && v.priceLimit <= 100_000
        ? Math.round(v.priceLimit * 100) / 100
        : d.priceLimit;
    const hours = typeof v.duplicateWindowHours === 'number' && Number.isFinite(v.duplicateWindowHours)
        ? Math.min(168, Math.max(1, Math.round(v.duplicateWindowHours)))
        : d.duplicateWindowHours;
    return {
        enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
        priceLimit: limit,
        deliveryDays: v.deliveryDays === 2 ? 2 : 1,
        duplicateWindowHours: hours,
        notify: typeof v.notify === 'boolean' ? v.notify : d.notify,
    };
}

/* ─── Mappings ───────────────────────────────────────────────────────── */

export interface ProductMapping {
    itemId: string;
    milkbasketProductId: number;
    /** As shown on Milkbasket. */
    productName: string;
    /** Pack size as shown on Milkbasket ("500 ml"), if known. */
    size: string;
    /** Last known price (₹ per unit), or null if unknown. */
    price: number | null;
    defaultQuantity: number;
    priceUpdatedAt: number | null;
    /** Auto-order on or off for this item. */
    enabled: boolean;
}

export const MAX_QUANTITY = 20;

export function isProductId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function cleanPrice(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100_000 ? Math.round(n * 100) / 100 : null;
}

export function cleanQuantity(value: unknown, fallback = 1): number {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY ? n : fallback;
}

/* ─── Purchase requests ──────────────────────────────────────────────── */

export type RequestStatus =
    | 'needs_mapping'
    | 'pending_approval'
    | 'queued'
    | 'adding'
    | 'added'
    | 'failed'
    | 'rejected'
    | 'cancelled';

export const REQUEST_STATUSES: readonly RequestStatus[] = [
    'needs_mapping', 'pending_approval', 'queued', 'adding', 'added', 'failed', 'rejected', 'cancelled',
];

export function isRequestStatus(value: unknown): value is RequestStatus {
    return typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value);
}

/**
 * A request that is still in progress, so the item is not asked for again.
 * `needs_mapping` counts too: mapping the item moves that same request on.
 */
export const OPEN_STATUSES: readonly RequestStatus[] = ['needs_mapping', 'pending_approval', 'queued', 'adding'];
/** Cancelled when the item is fine again. Queued and adding ones go ahead. */
export const CANCEL_ON_OK: readonly RequestStatus[] = ['needs_mapping', 'pending_approval'];

export interface RequestSummary {
    id?: string;
    status: RequestStatus;
    /** When it was added to the basket (ms), for the duplicate window. */
    addedAt: number | null;
}

/** Why a request got its status, shown in the admin panel. */
export type Reason = 'unmapped' | 'price-unknown' | 'over-limit' | 'under-limit' | 'auto-off' | 'item-off' | 'approved';

export type Decision =
    | { action: 'none'; why: 'off' | 'open-request' | 'recently-added' | 'item-off' }
    | { action: 'create'; status: 'needs_mapping' | 'pending_approval' | 'queued'; reason: Reason };

/**
 * Where a mapped item goes: strictly below the limit is added automatically;
 * at or above it, or with no known price, someone approves it first. With
 * the global switch or the item's auto-order off, it waits for approval too.
 */
export function routeMapped(
    mapping: Pick<ProductMapping, 'price' | 'enabled'>,
    settings: Pick<MilkbasketSettings, 'enabled' | 'priceLimit'>,
): { status: 'pending_approval' | 'queued'; reason: Reason } {
    if (!settings.enabled) return { status: 'pending_approval', reason: 'auto-off' };
    if (!mapping.enabled) return { status: 'pending_approval', reason: 'item-off' };
    if (mapping.price === null) return { status: 'pending_approval', reason: 'price-unknown' };
    if (mapping.price < settings.priceLimit) return { status: 'queued', reason: 'under-limit' };
    return { status: 'pending_approval', reason: 'over-limit' };
}

export function hasOpenRequest(requests: RequestSummary[]): boolean {
    return requests.some(r => OPEN_STATUSES.includes(r.status));
}

export function addedRecently(requests: RequestSummary[], nowMs: number, windowHours: number): boolean {
    const since = nowMs - windowHours * 3_600_000;
    return requests.some(r => r.status === 'added' && r.addedAt !== null && r.addedAt > since);
}

/** An item has just become low or empty: what to do. `requests` are this item's earlier requests. */
export function decideOnLow(input: {
    settings: MilkbasketSettings;
    mapping: ProductMapping | null;
    requests: RequestSummary[];
    nowMs: number;
}): Decision {
    const { settings, mapping, requests, nowMs } = input;
    if (!settings.enabled) return { action: 'none', why: 'off' };
    if (hasOpenRequest(requests)) return { action: 'none', why: 'open-request' };
    if (addedRecently(requests, nowMs, settings.duplicateWindowHours)) return { action: 'none', why: 'recently-added' };
    if (!mapping) return { action: 'create', status: 'needs_mapping', reason: 'unmapped' };
    if (!mapping.enabled) return { action: 'none', why: 'item-off' };
    return { action: 'create', ...routeMapped(mapping, settings) };
}

/** Allowed status changes. History is kept: requests are never deleted. */
const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
    needs_mapping: ['pending_approval', 'queued', 'rejected', 'cancelled'],
    pending_approval: ['queued', 'needs_mapping', 'rejected', 'cancelled'],
    queued: ['adding', 'pending_approval', 'cancelled'],
    // Back to approval only when the switch was turned off before anything was sent.
    adding: ['added', 'failed', 'pending_approval'],
    added: [],
    failed: ['queued', 'pending_approval', 'needs_mapping'],
    rejected: [],
    cancelled: [],
};

export function canMove(from: RequestStatus, to: RequestStatus): boolean {
    return TRANSITIONS[from].includes(to);
}

/* ─── Dates ──────────────────────────────────────────────────────────── */

/** Delivery date from the household-local date (YYYY-MM-DD): tomorrow by default. */
export function deliveryDate(today: string, days: 1 | 2 = 1): string {
    const t = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
    return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/* ─── Milkbasket's answers ───────────────────────────────────────────── */

export type FailureKind =
    /** Milkbasket could not be reached (refused, DNS…). Safe to retry: nothing was sent. */
    | 'network'
    /** No answer in time. Not retried: Milkbasket may already have added it. */
    | 'timeout'
    /** HTTP 5xx from Milkbasket. Retried. */
    | 'server'
    /** The login token was refused or has expired. Needs a new MILKBASKET_TOKEN. */
    | 'auth'
    /** The server is missing MILKBASKET_TOKEN, MILKBASKET_CITY_ID or MILKBASKET_HUB_ID. */
    | 'config'
    /** Milkbasket refused (out of stock, past cutoff, price changed). Needs a person. */
    | 'milkbasket'
    /** An answer this app does not understand. */
    | 'unexpected';

export type AddOutcome =
    | { ok: true; /** How many of the product the basket now holds for that day, if Milkbasket said. */ basketQuantity: number | null }
    | { ok: false; kind: FailureKind; retryable: boolean; message: string };

const MAX_MESSAGE = 300;
const AUTH_WORDS = /unauthori[sz]ed|unauthenticated|forbidden|invalid token|token expired|jwt|not logged in|login required|session expired/i;
const TOKEN_HELP = 'Put a fresh token in MILKBASKET_TOKEN and redeploy.';

function text(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE) : '';
}

/** A readable message from an `error` value: a string, or an object with message / errorMsg / error. */
function errorText(value: unknown): string {
    if (typeof value === 'string') return text(value);
    if (value && typeof value === 'object') {
        const v = value as Record<string, unknown>;
        return text(v.errorMsg) || text(v.message) || text(v.error) || text(v.code);
    }
    return '';
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** GraphQL `errors[]` (or a top-level `error`) as one message, and whether it is a login problem. */
function graphqlErrors(body: Record<string, unknown>): { message: string; auth: boolean } | null {
    const list = Array.isArray(body.errors) && body.errors.length > 0 ? body.errors : body.error ? [body.error] : [];
    if (list.length === 0) return null;
    const codes = list.map(e => (isObject(e) && isObject(e.extensions) ? text(e.extensions.code) : '')).join(' ');
    const message = (list.map(errorText).filter(Boolean).join('; ') || 'Milkbasket returned an error.').slice(0, MAX_MESSAGE);
    return { message, auth: AUTH_WORDS.test(message) || AUTH_WORDS.test(codes) };
}

/**
 * Read Milkbasket's answer to the addToBasket mutation. HTTP 200 can still be
 * a failure, so the body decides: success is `data.addToBasket` with no
 * `error.errorMsg` (and `error.error` not true), and no GraphQL `errors`.
 */
export function parseAddResponse(httpStatus: number, body: unknown, productId?: number): AddOutcome {
    if (httpStatus === 401 || httpStatus === 403) {
        return { ok: false, kind: 'auth', retryable: false, message: `Milkbasket didn't accept the login token (HTTP ${httpStatus}). ${TOKEN_HELP}` };
    }
    if (httpStatus >= 500) {
        const detail = isObject(body) ? graphqlErrors(body)?.message ?? '' : '';
        return { ok: false, kind: 'server', retryable: true, message: `Milkbasket server error (HTTP ${httpStatus})${detail ? `: ${detail}` : ''}` };
    }
    if (!isObject(body)) {
        return { ok: false, kind: 'unexpected', retryable: false, message: `Milkbasket sent an answer this app can't read (HTTP ${httpStatus}).` };
    }
    const errors = graphqlErrors(body);
    if (errors) {
        return errors.auth
            ? { ok: false, kind: 'auth', retryable: false, message: `Milkbasket didn't accept the login token: ${errors.message}. ${TOKEN_HELP}` }
            : { ok: false, kind: 'milkbasket', retryable: false, message: errors.message };
    }
    if (httpStatus >= 400) {
        return { ok: false, kind: 'milkbasket', retryable: false, message: `Milkbasket refused the request (HTTP ${httpStatus}).` };
    }
    const data = isObject(body.data) ? body.data : null;
    const result = data && isObject(data.addToBasket) ? data.addToBasket : null;
    if (!result) {
        return { ok: false, kind: 'unexpected', retryable: false, message: 'Milkbasket answered without an addToBasket result.' };
    }
    const err = result.error;
    const failed = typeof err === 'string' ? text(err) !== '' : isObject(err) && (err.error === true || text(err.errorMsg) !== '');
    if (failed) return { ok: false, kind: 'milkbasket', retryable: false, message: errorText(err) || 'Milkbasket did not add the item.' };
    return { ok: true, basketQuantity: basketQuantity(result.basket, productId) };
}

function basketQuantity(basket: unknown, productId?: number): number | null {
    if (productId === undefined) return null;
    const baskets = Array.isArray(basket) ? basket : [basket];
    for (const b of baskets) {
        const products = isObject(b) && Array.isArray(b.products) ? b.products : [];
        for (const p of products) {
            const order = isObject(p) && isObject(p.order) ? p.order : null;
            if (order && Number(order.productId) === productId && typeof order.quantity === 'number') return order.quantity;
        }
    }
    return null;
}

/** A thrown fetch error: a timeout (not retried) or a connection problem (retried). */
export function networkFailure(err: unknown, timeoutMs: number): AddOutcome {
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } } | null;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        return {
            ok: false,
            kind: 'timeout',
            retryable: false,
            message: `Milkbasket didn't answer within ${Math.round(timeoutMs / 1000)} seconds. Check your basket in the Milkbasket app before retrying, in case it was added.`,
        };
    }
    const reason = text(e?.cause?.code) || text(e?.cause?.message) || text(e?.message) || 'unknown error';
    return { ok: false, kind: 'network', retryable: true, message: `Couldn't reach Milkbasket (${reason}).` };
}

/* ─── Calling Milkbasket (GraphQL) ───────────────────────────────────── */

export const DEFAULT_API_URL = 'https://consumerbff.milkbasket.com/graphql';
export const DEFAULT_APP_VERSION = '9.0.10.0';

export type FetchLike = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}) => Promise<{ status: number; text(): Promise<string> }>;

export interface MilkbasketDeps {
    apiUrl: string;
    /** The login token, without "Bearer ". Only ever sent in the Authorization header. */
    token: string;
    cityId: string;
    hubId: string;
    appVersion: string;
    fetch: FetchLike;
    /** Waits between retries; tests pass one that doesn't wait. */
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
}

/** The token as pasted, with any "Bearer " prefix removed; '' if it isn't usable in a header. */
export function cleanToken(value: string | undefined): string {
    const token = (value ?? '').trim().replace(/^bearer\s+/i, '');
    return /^[\x21-\x7e]{10,4096}$/.test(token) ? token : '';
}

/** When a JWT login token expires (ms), or null if the token isn't a JWT with an `exp`. */
export function tokenExpiry(token: string): number | null {
    const part = token.split('.')[1];
    if (!part) return null;
    try {
        const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
        return typeof json.exp === 'number' && Number.isFinite(json.exp) ? json.exp * 1000 : null;
    } catch {
        return null;
    }
}

/** The headers Milkbasket's web app sends. */
export function milkbasketHeaders(deps: Pick<MilkbasketDeps, 'token' | 'cityId' | 'hubId' | 'appVersion'>): Record<string, string> {
    return {
        accept: '*/*',
        'content-type': 'application/json',
        appplatform: 'web',
        appversion: deps.appVersion,
        binaryversion: deps.appVersion.split('.').slice(0, 3).join('.'),
        authorization: `Bearer ${deps.token}`,
        cityid: deps.cityId,
        hubid: deps.hubId,
        mbexpress: '0',
        mblitetype: '0',
        role: '0',
    };
}

export const FETCH_ORDERS_QUERY = `query fetchOrders {
  getAccountHistory {
    orders { id details amount date day }
  }
}`;

export const ORDER_DETAIL_QUERY = `query getOrderDetail($orderId: Float!) {
  getOrderDetail(orderId: $orderId) {
    data {
      title type
      data {
        id name
        assets { image { url type } }
        weight { text }
        order { productId quantity }
        price { currency perUnit mrp { amount value text } price { amount value text } discount { amount value percent text } }
      }
    }
    reOrderProductList { id }
    billDetails {
      date id deliveryTypeId
      billDetails {
        total subTotal subSavings subSavingsAmount isOtdf deliveryFee payableAmount payable
        coupon { name label amount }
        productDiscount { label amount }
        extraFeeList { label desc type appliedFee { amount label } applicableFee { amount label } }
      }
    }
  }
}`;

export const ADD_TO_BASKET_MUTATION = `mutation addToBasket($payload: AddToBasketFilterInput!) {
  addToBasket(payload: $payload) {
    isRefreshBasket
    error { error errorMsg nextOrderDate parentProductId }
    basket {
      id date quantity saving total
      products { id name weight { text } price { price { amount value } } order { productId quantity } }
      billDetails { subTotal subSavings total }
    }
  }
}`;

export interface AddToBasketBody {
    productId: number;
    price: number;
    quantity: number;
    /** Delivery date, YYYY-MM-DD. */
    date: string;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
/** Retries after the first try, for network and 5xx errors only. */
export const MAX_RETRIES = 3;
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 9_000];

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/** One GraphQL POST. Throws only when Milkbasket can't be reached (the fetch itself fails). */
async function graphql(deps: MilkbasketDeps, operationName: string, query: string, variables: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const res = await deps.fetch(deps.apiUrl, {
        method: 'POST',
        headers: milkbasketHeaders(deps),
        body: JSON.stringify({ operationName, variables, query }),
        signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return { status: res.status, body: parseJson(await res.text()) };
}

/** The addToBasket payload, as Milkbasket's web app sends it. */
export function addToBasketPayload(body: AddToBasketBody, appVersion: string): Record<string, unknown> {
    return {
        productId: body.productId,
        quantity: body.quantity,
        price: body.price,
        date: body.date,
        bypassTimeCheck: false,
        appVersion,
        offerIds: [],
        fetchOffers: true,
        params: {},
    };
}

async function addOnce(deps: MilkbasketDeps, body: AddToBasketBody): Promise<AddOutcome> {
    try {
        const res = await graphql(deps, 'addToBasket', ADD_TO_BASKET_MUTATION, { payload: addToBasketPayload(body, deps.appVersion) });
        return parseAddResponse(res.status, res.body, body.productId);
    } catch (err) {
        return networkFailure(err, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    }
}

/** Add one product to the basket, retrying network and 5xx errors (at most 3 retries, waiting longer each time). */
export async function addToBasket(deps: MilkbasketDeps, body: AddToBasketBody): Promise<AddOutcome & { attempts: number }> {
    const sleep = deps.sleep ?? wait;
    let attempts = 0;
    for (;;) {
        attempts++;
        const outcome = await addOnce(deps, body);
        if (outcome.ok || !outcome.retryable || attempts > MAX_RETRIES) return { ...outcome, attempts };
        await sleep(RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]);
    }
}

/** A read-only query. Throws a readable Error (never containing the token) when it fails. */
async function readQuery(deps: MilkbasketDeps, operationName: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let res: { status: number; body: unknown };
    try {
        res = await graphql(deps, operationName, query, variables);
    } catch (err) {
        const failure = networkFailure(err, timeoutMs);
        throw new Error(failure.ok ? 'Unknown error' : failure.kind === 'timeout' ? `Milkbasket didn't answer within ${Math.round(timeoutMs / 1000)} seconds.` : failure.message);
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Milkbasket didn't accept the login token (HTTP ${res.status}). ${TOKEN_HELP}`);
    const errors = isObject(res.body) ? graphqlErrors(res.body) : null;
    if (errors) throw new Error(errors.auth ? `Milkbasket didn't accept the login token: ${errors.message}. ${TOKEN_HELP}` : `Milkbasket: ${errors.message}`);
    if (res.status >= 400 || !isObject(res.body)) throw new Error(`Milkbasket error (HTTP ${res.status}).`);
    return res.body;
}

/** Recent orders (fetchOrders), latest first. Also used by Test connection. */
export async function fetchOrders(deps: MilkbasketDeps): Promise<OrderSummary[]> {
    return parseOrders(await readQuery(deps, 'fetchOrders', FETCH_ORDERS_QUERY, {}));
}

/** One order's products (getOrderDetail). */
export async function fetchOrderDetail(deps: MilkbasketDeps, order: OrderSummary): Promise<HistoryProduct[]> {
    const orderId = Number(order.id);
    if (!Number.isFinite(orderId)) return [];
    return parseOrderDetail(await readQuery(deps, 'getOrderDetail', ORDER_DETAIL_QUERY, { orderId }), order.date);
}

/* ─── Order history: products to map from ────────────────────────────── */

export interface OrderSummary {
    id: string;
    date: string;
}

/** `data.getAccountHistory.orders[]` → order ids and dates, as sent (latest first). */
export function parseOrders(body: unknown): OrderSummary[] {
    const data = isObject(body) && isObject(body.data) ? body.data : null;
    const history = data && isObject(data.getAccountHistory) ? data.getAccountHistory : null;
    const orders = history && Array.isArray(history.orders) ? history.orders : [];
    const out: OrderSummary[] = [];
    for (const o of orders) {
        if (!isObject(o)) continue;
        const id = typeof o.id === 'number' || typeof o.id === 'string' ? String(o.id).trim() : '';
        if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;
        out.push({ id, date: text(o.date).slice(0, 40) });
    }
    return out;
}

export interface HistoryProduct {
    /** `order.productId`, never the order-line id. */
    productId: number;
    name: string;
    size: string;
    /** Price paid in that order (₹ per unit), or null. */
    price: number | null;
    /** Date of the latest order it was in, as Milkbasket shows it. */
    lastOrdered: string;
    /** How many of the fetched orders it was in. */
    orders: number;
}

/** `data.getOrderDetail.data[].data[]` → products. The order-line `id` is ignored; `order.productId` is the product. */
export function parseOrderDetail(body: unknown, orderDate: string): HistoryProduct[] {
    const data = isObject(body) && isObject(body.data) ? body.data : null;
    const detail = data && isObject(data.getOrderDetail) ? data.getOrderDetail : null;
    const groups = detail && Array.isArray(detail.data) ? detail.data : [];
    const out: HistoryProduct[] = [];
    for (const group of groups) {
        const lines = isObject(group) && Array.isArray(group.data) ? group.data : [];
        for (const line of lines) {
            if (!isObject(line)) continue;
            const order = isObject(line.order) ? line.order : null;
            const productId = order ? Number(order.productId) : NaN;
            if (!isProductId(productId)) continue;
            const priceObj = isObject(line.price) && isObject(line.price.price) ? line.price.price : null;
            out.push({
                productId,
                name: text(line.name).slice(0, 120) || `Product ${productId}`,
                size: isObject(line.weight) ? text(line.weight.text).slice(0, 40) : '',
                price: cleanPrice(priceObj ? priceObj.value : null),
                lastOrdered: orderDate,
                orders: 1,
            });
        }
    }
    return out;
}

/** One entry per product, from orders listed latest first: the latest name, size and price win. */
export function mergeHistory(perOrder: HistoryProduct[][]): HistoryProduct[] {
    const byId = new Map<number, HistoryProduct>();
    for (const products of perOrder) {
        const seenInOrder = new Set<number>();
        for (const p of products) {
            const existing = byId.get(p.productId);
            if (!existing) byId.set(p.productId, { ...p });
            else if (!seenInOrder.has(p.productId)) existing.orders += 1;
            seenInOrder.add(p.productId);
        }
    }
    return [...byId.values()];
}

/** Products matching a search (name, size or product id). */
export function searchHistory(products: HistoryProduct[], query: string): HistoryProduct[] {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    const words = q.split(/\s+/);
    return products.filter(p => {
        const hay = `${p.name} ${p.size} ${p.productId}`.toLowerCase();
        return words.every(w => hay.includes(w));
    });
}
