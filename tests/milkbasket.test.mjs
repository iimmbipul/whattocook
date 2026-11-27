// Unit tests for Milkbasket auto-order. Run with: npm test
// Milkbasket is always mocked: no test makes a network call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ADD_TO_BASKET_MUTATION, CANCEL_ON_OK, DEFAULT_API_URL, MAX_RETRIES, OPEN_STATUSES, RETRY_DELAYS_MS,
    addToBasket, addToBasketPayload, canMove, cleanSettings, cleanToken, decideOnLow, defaultSettings, deliveryDate,
    GET_BASKET_QUERY, fetchBasket, parseBasket,
    REFRESH_QUERY, isAuthError, parseRefreshResponse, refreshAuth,
    SEARCH_QUERY, cleanImageUrl, parseSearchProducts, searchProducts, searchVariables,
    fetchOrderDetail, fetchOrders, isBackToOk, isOrderTrigger, mergeHistory, milkbasketHeaders, parseAddResponse,
    parseOrderDetail, parseOrders, priceLimitFromEnv, routeMapped, searchHistory, tokenExpiry,
} from '../src/lib/milkbasket/logic.ts';
import { fingerprint, seal, secretKey, unseal } from '../src/lib/server/secretBox.ts';

const NOW = Date.parse('2026-11-27T10:00:00Z');
const HOUR = 3_600_000;
const on = { ...defaultSettings(150), enabled: true };
const mapping = (price, extra = {}) => ({
    itemId: 'milk', milkbasketProductId: 101, productName: 'Toned Milk', size: '500 ml',
    price, defaultQuantity: 1, priceUpdatedAt: NOW, enabled: true, ...extra,
});
const decide = (m, requests = [], settings = on) => decideOnLow({ settings, mapping: m, requests, nowMs: NOW });

/* ─── Decision logic ─────────────────────────────────────────────────── */

test('unmapped item → needs_mapping', () => {
    assert.deepEqual(decide(null), { action: 'create', status: 'needs_mapping', reason: 'unmapped' });
});

test('below the limit → added automatically', () => {
    assert.deepEqual(decide(mapping(149)), { action: 'create', status: 'queued', reason: 'under-limit' });
    assert.deepEqual(decide(mapping(27.5)), { action: 'create', status: 'queued', reason: 'under-limit' });
});

test('exactly 150 needs approval (only strictly below is automatic)', () => {
    assert.deepEqual(decide(mapping(150)), { action: 'create', status: 'pending_approval', reason: 'over-limit' });
    assert.deepEqual(decide(mapping(149.99)).status, 'queued');
});

test('at or above the limit, or price unknown → approval', () => {
    assert.deepEqual(decide(mapping(285)), { action: 'create', status: 'pending_approval', reason: 'over-limit' });
    assert.deepEqual(decide(mapping(null)), { action: 'create', status: 'pending_approval', reason: 'price-unknown' });
});

test('the limit is configurable', () => {
    const s = { ...on, priceLimit: 300 };
    assert.equal(decide(mapping(285), [], s).status, 'queued');
    assert.equal(decide(mapping(300), [], s).status, 'pending_approval');
});

test('duplicate: an open request means nothing new', () => {
    for (const status of ['needs_mapping', 'pending_approval', 'queued', 'adding']) {
        assert.deepEqual(decide(mapping(40), [{ status, addedAt: null }]), { action: 'none', why: 'open-request' }, status);
    }
    assert.deepEqual([...OPEN_STATUSES].sort(), ['adding', 'needs_mapping', 'pending_approval', 'queued']);
});

test('duplicate: added within the window (24 h by default) means nothing new', () => {
    assert.deepEqual(decide(mapping(40), [{ status: 'added', addedAt: NOW - 2 * HOUR }]), { action: 'none', why: 'recently-added' });
    assert.deepEqual(decide(mapping(40), [{ status: 'added', addedAt: NOW - 23.9 * HOUR }]).action, 'none');
    // Outside the window it can be added again.
    assert.equal(decide(mapping(40), [{ status: 'added', addedAt: NOW - 25 * HOUR }]).status, 'queued');
    // A shorter window from settings.
    assert.equal(decide(mapping(40), [{ status: 'added', addedAt: NOW - 3 * HOUR }], { ...on, duplicateWindowHours: 2 }).status, 'queued');
});

test('finished requests (failed, rejected, cancelled) do not block a new one', () => {
    const history = [{ status: 'failed', addedAt: null }, { status: 'rejected', addedAt: null }, { status: 'cancelled', addedAt: null }];
    assert.equal(decide(mapping(40), history).status, 'queued');
});

test('switch off or auto-order off for the item → nothing happens', () => {
    assert.deepEqual(decide(mapping(40), [], { ...on, enabled: false }), { action: 'none', why: 'off' });
    assert.deepEqual(decide(null, [], { ...on, enabled: false }), { action: 'none', why: 'off' });
    assert.deepEqual(decide(mapping(40, { enabled: false })), { action: 'none', why: 'item-off' });
});

test('triggers: only a change to low (Quarter) or empty; same level again is not a change', () => {
    assert.equal(isOrderTrigger({ from: 'full', to: 'quarter' }), true);
    assert.equal(isOrderTrigger({ from: 'half', to: 'empty' }), true);
    assert.equal(isOrderTrigger({ from: 'unknown', to: 'empty' }), true);
    assert.equal(isOrderTrigger({ from: 'quarter', to: 'empty' }), true); // the duplicate check stops a second request
    assert.equal(isOrderTrigger({ from: 'empty', to: 'empty' }), false);
    assert.equal(isOrderTrigger({ from: 'full', to: 'half' }), false);
    assert.equal(isOrderTrigger({ from: 'empty', to: 'full' }), false);
});

test('revert to ok cancels approvals and mapping requests, not queued ones', () => {
    assert.equal(isBackToOk({ from: 'quarter', to: 'full' }), true);
    assert.equal(isBackToOk({ from: 'empty', to: 'half' }), true);
    assert.equal(isBackToOk({ from: 'full', to: 'full' }), false);
    assert.equal(isBackToOk({ from: 'full', to: 'empty' }), false);
    assert.deepEqual([...CANCEL_ON_OK].sort(), ['needs_mapping', 'pending_approval']);
    assert.equal(canMove('pending_approval', 'cancelled'), true);
    assert.equal(canMove('needs_mapping', 'cancelled'), true);
});

test('mapping a waiting item and retrying follow the same rules', () => {
    assert.deepEqual(routeMapped(mapping(60), on), { status: 'queued', reason: 'under-limit' });
    // Price changed on Milkbasket and was updated to ≥ the limit: retry goes to approval.
    assert.deepEqual(routeMapped(mapping(180), on), { status: 'pending_approval', reason: 'over-limit' });
    assert.deepEqual(routeMapped(mapping(60), { ...on, enabled: false }), { status: 'pending_approval', reason: 'auto-off' });
    assert.deepEqual(routeMapped(mapping(60, { enabled: false }), on), { status: 'pending_approval', reason: 'item-off' });
});

test('history is kept: finished requests never move again', () => {
    for (const to of ['queued', 'adding', 'failed', 'cancelled']) {
        assert.equal(canMove('added', to), false);
        assert.equal(canMove('rejected', to), false);
        assert.equal(canMove('cancelled', to), false);
    }
    assert.equal(canMove('failed', 'queued'), true);
    assert.equal(canMove('failed', 'pending_approval'), true);
    assert.equal(canMove('queued', 'adding'), true);
    assert.equal(canMove('adding', 'added'), true);
    assert.equal(canMove('queued', 'added'), false); // only through "adding"
});

test('settings: defaults, cleaning and AUTO_ADD_PRICE_LIMIT', () => {
    assert.deepEqual(cleanSettings(undefined), { enabled: false, priceLimit: 150, deliveryDays: 1, duplicateWindowHours: 24, notify: true });
    assert.equal(cleanSettings({}, 200).priceLimit, 200);
    assert.equal(cleanSettings({ priceLimit: -5 }).priceLimit, 150);
    assert.equal(cleanSettings({ duplicateWindowHours: 1000 }).duplicateWindowHours, 168);
    assert.equal(cleanSettings({ deliveryDays: 7 }).deliveryDays, 1);
    assert.equal(priceLimitFromEnv(undefined), 150);
    assert.equal(priceLimitFromEnv(''), 150);
    assert.equal(priceLimitFromEnv('abc'), 150);
    assert.equal(priceLimitFromEnv('199.5'), 199.5);
});

test('delivery date: tomorrow by default, across month and year ends', () => {
    assert.equal(deliveryDate('2026-11-27'), '2026-11-28');
    assert.equal(deliveryDate('2026-11-30'), '2026-12-01');
    assert.equal(deliveryDate('2026-12-31'), '2027-01-01');
    assert.equal(deliveryDate('2026-11-27', 2), '2026-11-29');
});

/* ─── Milkbasket's answers ───────────────────────────────────────────── */

const ok = (extra = {}) => ({ data: { addToBasket: { isRefreshBasket: false, error: null, basket: null, ...extra } } });

test('success: no errors and no error.errorMsg', () => {
    assert.deepEqual(parseAddResponse(200, ok()), { ok: true, basketQuantity: null });
    assert.deepEqual(parseAddResponse(200, ok({ error: { error: false, errorMsg: null, nextOrderDate: null, parentProductId: null } })), { ok: true, basketQuantity: null });
    assert.deepEqual(parseAddResponse(200, ok({ error: { error: null, errorMsg: '' } })), { ok: true, basketQuantity: null });
});

test('success: reads how many the basket now holds for that product', () => {
    const basket = { id: 1, date: '2026-11-28', products: [{ id: 9, order: { productId: 3030, quantity: 1 } }, { id: 10, order: { productId: 2244, quantity: 3 } }] };
    assert.deepEqual(parseAddResponse(200, ok({ basket }), 2244), { ok: true, basketQuantity: 3 });
    assert.deepEqual(parseAddResponse(200, ok({ basket: [basket] }), 3030), { ok: true, basketQuantity: 1 });
    assert.deepEqual(parseAddResponse(200, ok({ basket }), 7777), { ok: true, basketQuantity: null });
});

test('failure with HTTP 200: error.errorMsg (out of stock, cutoff, price changed)', () => {
    const out = parseAddResponse(200, ok({ error: { error: true, errorMsg: 'Product is out of stock' } }));
    assert.deepEqual(out, { ok: false, kind: 'milkbasket', retryable: false, message: 'Product is out of stock' });
    // An errorMsg counts even if error.error isn't set.
    assert.equal(parseAddResponse(200, ok({ error: { errorMsg: 'Price has changed to ₹32' } })).message, 'Price has changed to ₹32');
    assert.equal(parseAddResponse(200, ok({ error: { error: true, errorMsg: null } })).message, 'Milkbasket did not add the item.');
});

test('failure: GraphQL errors[], and login problems are told apart', () => {
    const gql = parseAddResponse(200, { errors: [{ message: 'Cutoff time passed' }, { message: 'Try tomorrow' }], data: null });
    assert.deepEqual(gql, { ok: false, kind: 'milkbasket', retryable: false, message: 'Cutoff time passed; Try tomorrow' });
    // errors[] wins over a successful-looking body.
    assert.equal(parseAddResponse(200, { errors: [{ message: 'x' }], ...ok() }).ok, false);
    const expired = parseAddResponse(200, { errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }] });
    assert.equal(expired.kind, 'auth');
    assert.match(expired.message, /refresh token in Admin/);
    assert.equal(parseAddResponse(200, { errors: [{ message: 'nope', extensions: { code: 'UNAUTHENTICATED' } }] }).kind, 'auth');
    assert.equal(parseAddResponse(401, null).kind, 'auth');
    assert.equal(parseAddResponse(403, {}).retryable, false);
});

test('failure: 5xx is retryable; odd answers are not', () => {
    assert.deepEqual(parseAddResponse(502, null), { ok: false, kind: 'server', retryable: true, message: 'Milkbasket server error (HTTP 502)' });
    assert.equal(parseAddResponse(500, { errors: [{ message: 'upstream timeout' }] }).message, 'Milkbasket server error (HTTP 500): upstream timeout');
    assert.equal(parseAddResponse(200, null).kind, 'unexpected');
    assert.equal(parseAddResponse(200, { data: {} }).kind, 'unexpected');
    assert.equal(parseAddResponse(404, {}).kind, 'milkbasket');
});

/* ─── Calling (mocked) Milkbasket, with retries ──────────────────────── */

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3OTYwMDAwMDB9.fake-signature-for-tests';

function mockFetch(responses) {
    const calls = [];
    const fetch = async (url, init) => {
        calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
        const next = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (next instanceof Error) throw next;
        return { status: next.status, text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)) };
    };
    return { fetch, calls };
}

const deps = (fetch, extra = {}) => ({
    apiUrl: 'https://mock.example/graphql', token: TOKEN, cityId: '4', hubId: '27', appVersion: '9.0.10.0', fetch, sleep: async () => {}, ...extra,
});
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
const body = { productId: 2244, price: 29, quantity: 2, date: '2026-11-28' };

test('addToBasket sends the web app\'s request: URL, headers, operation and payload', async () => {
    const { fetch, calls } = mockFetch([{ status: 200, body: ok() }]);
    const out = await addToBasket(deps(fetch), body);
    assert.deepEqual(out, { ok: true, basketQuantity: null, attempts: 1 });
    assert.equal(calls.length, 1);
    const { url, init, body: sent } = calls[0];
    assert.equal(url, 'https://mock.example/graphql');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers.cityid, '4');
    assert.equal(init.headers.hubid, '27');
    assert.equal(init.headers.appplatform, 'web');
    assert.equal(init.headers.appversion, '9.0.10.0');
    assert.equal(init.headers.binaryversion, '9.0.10');
    assert.equal(sent.operationName, 'addToBasket');
    assert.equal(sent.query, ADD_TO_BASKET_MUTATION);
    assert.deepEqual(sent.variables, {
        payload: { productId: 2244, quantity: 2, price: 29, date: '2026-11-28', bypassTimeCheck: false, appVersion: '9.0.10.0', offerIds: [], fetchOffers: true, params: {} },
    });
    assert.deepEqual(addToBasketPayload(body, '9.0.10.0'), sent.variables.payload);
});

test('network errors and 5xx are retried with growing waits, at most 3 times', async () => {
    const waits = [];
    const { fetch, calls } = mockFetch([refused(), { status: 503, body: 'down' }, { status: 200, body: ok() }]);
    const out = await addToBasket(deps(fetch, { sleep: async ms => { waits.push(ms); } }), body);
    assert.deepEqual(out, { ok: true, basketQuantity: null, attempts: 3 });
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [1000, 3000]);

    const always = mockFetch([refused()]);
    const waits2 = [];
    const failed = await addToBasket(deps(always.fetch, { sleep: async ms => { waits2.push(ms); } }), body);
    assert.equal(failed.ok, false);
    assert.equal(failed.kind, 'network');
    assert.equal(failed.attempts, MAX_RETRIES + 1);
    assert.deepEqual(waits2, [...RETRY_DELAYS_MS]);
    assert.match(failed.message, /ECONNREFUSED/);
});

test('business errors and login problems are not retried', async () => {
    const { fetch, calls } = mockFetch([{ status: 200, body: ok({ error: { error: true, errorMsg: 'Past cutoff' } }) }]);
    const out = await addToBasket(deps(fetch, { sleep: async () => assert.fail('should not wait') }), body);
    assert.deepEqual(out, { ok: false, kind: 'milkbasket', retryable: false, message: 'Past cutoff', attempts: 1 });
    assert.equal(calls.length, 1);
    const auth = mockFetch([{ status: 401, body: { errors: [{ message: 'jwt expired' }] } }]);
    const denied = await addToBasket(deps(auth.fetch, { sleep: async () => assert.fail('should not wait') }), body);
    assert.equal(denied.kind, 'auth');
    assert.equal(auth.calls.length, 1);
});

test('a timeout is not retried (it may already have been added)', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const { fetch, calls } = mockFetch([timeout]);
    const out = await addToBasket(deps(fetch, { sleep: async () => assert.fail('should not wait'), timeoutMs: 15000 }), body);
    assert.equal(out.ok, false);
    assert.equal(out.kind, 'timeout');
    assert.equal(calls.length, 1);
    assert.match(out.message, /15 seconds/);
});

test('reads: fetchOrders and getOrderDetail send the queries; errors are readable and never show the token', async () => {
    const orders = mockFetch([{ status: 200, body: { data: { getAccountHistory: { orders: [{ id: 403839275, date: '26 Nov 2026', day: 'Thu', amount: 210, details: '3 items' }] } } } }]);
    assert.deepEqual(await fetchOrders(deps(orders.fetch)), [{ id: '403839275', date: '26 Nov 2026' }]);
    assert.equal(orders.calls[0].body.operationName, 'fetchOrders');
    assert.deepEqual(orders.calls[0].body.variables, {});

    const detail = mockFetch([{ status: 200, body: { data: { getOrderDetail: { data: [{ title: 'Dairy', data: [{ id: 1, name: 'Toned Milk', weight: { text: '500 ml' }, order: { productId: 2244, quantity: 1 }, price: { price: { value: 29 } } }] }] } } } }]);
    const products = await fetchOrderDetail(deps(detail.fetch), { id: '403839275', date: '26 Nov 2026' });
    assert.deepEqual(products.map(p => [p.productId, p.price]), [[2244, 29]]);
    assert.equal(detail.calls[0].body.operationName, 'getOrderDetail');
    assert.deepEqual(detail.calls[0].body.variables, { orderId: 403839275 }); // Float!, not a string

    const failures = [
        [refused(), /Couldn't reach Milkbasket/],
        [{ status: 401, body: '' }, /login token \(HTTP 401\)/],
        [{ status: 200, body: { errors: [{ message: 'Unauthorized' }] } }, /login token/],
        [{ status: 200, body: { errors: [{ message: 'Something broke' }] } }, /Milkbasket: Something broke/],
        [{ status: 500, body: '' }, /HTTP 500/],
    ];
    for (const [response, pattern] of failures) {
        const err = await fetchOrders(deps(mockFetch([response]).fetch)).then(() => null, e => e);
        assert.ok(err instanceof Error);
        assert.match(err.message, pattern);
        assert.doesNotMatch(err.message, /fake-signature|eyJ/);
    }
});

test('token: "Bearer " is stripped, unusable values rejected, JWT expiry read', () => {
    assert.equal(cleanToken(`Bearer ${TOKEN}`), TOKEN);
    assert.equal(cleanToken(`  ${TOKEN}\n`), TOKEN);
    assert.equal(cleanToken('YOUR TOKEN'), '');
    assert.equal(cleanToken('short'), '');
    assert.equal(cleanToken(undefined), '');
    assert.equal(tokenExpiry(TOKEN), 1796000000 * 1000);
    assert.equal(tokenExpiry('not-a-jwt-token-value'), null);
    assert.equal(milkbasketHeaders({ token: TOKEN, cityId: '1', hubId: '2', appVersion: '9.1.0.3' }).binaryversion, '9.1.0');
    assert.equal(DEFAULT_API_URL, 'https://consumerbff.milkbasket.com/graphql');
});

/* ─── The Milkbasket basket ──────────────────────────────────────────── */

// Shaped like Milkbasket's getExtendedBasket answer (trimmed).
const basketBody = {
    data: {
        getExtendedBasket: {
            basket: {
                id: 463396538,
                date: '2026-11-28',
                quantity: 1,
                saving: '13.00',
                total: '102.00',
                data: [
                    {
                        key: 'cartProducts',
                        title: '',
                        type: 1,
                        data: [
                            { product: { id: 76555, name: 'Jabsons Khari Sing Salted Peanut', weight: { text: '200 GM' }, price: { price: { amount: '87', value: 87 }, mrp: { amount: '100', value: 100 } }, order: { productId: 76555, quantity: 1 } } },
                            { product: { id: 45657, name: 'Amul Taaza Milk', weight: { text: '500 ML' }, price: { price: { amount: '29', value: 29 } }, order: { productId: 45657, quantity: 2 } } },
                            { product: { id: 1, name: 'Broken line', order: { productId: null, quantity: 1 } } },
                        ],
                    },
                    { key: 'subscriptions', data: [{ product: { name: 'Amul Taaza Milk', order: { productId: 45657, quantity: 1 }, price: { price: { value: 29 } } } }] },
                ],
                billDetails: { subTotalAmount: 100, totalAmount: 102, deliveryFeeAmount: 15, payableAmount: 87, subSavingsAmount: 13 },
            },
        },
    },
};

test('basket: products from every group, one row per product, with the bill', () => {
    const basket = parseBasket(basketBody);
    assert.equal(basket.id, 463396538);
    assert.equal(basket.date, '2026-11-28');
    assert.deepEqual(basket.products, [
        { productId: 76555, name: 'Jabsons Khari Sing Salted Peanut', size: '200 GM', quantity: 1, price: 87, imageUrl: '' },
        { productId: 45657, name: 'Amul Taaza Milk', size: '500 ML', quantity: 3, price: 29, imageUrl: '' },
    ]);
    assert.equal(basket.subTotal, 100);
    assert.equal(basket.deliveryFee, 15);
    assert.equal(basket.savings, 13);
    assert.equal(basket.payable, 87);
    assert.equal(parseBasket({ data: { getExtendedBasket: { basket: null } } }), null);
    assert.equal(parseBasket(null), null);
    // Amounts sent as text ("₹ 87.00") still read.
    const textBill = parseBasket({ data: { getExtendedBasket: { basket: { date: '2026-11-28', data: [], total: '₹ 102.00', billDetails: {} } } } });
    assert.equal(textBill.payable, 102);
    assert.deepEqual(textBill.products, []);
});

test('basket: getExtendedBasket is a read-only query with the same headers', async () => {
    const { fetch, calls } = mockFetch([{ status: 200, body: basketBody }]);
    const basket = await fetchBasket(deps(fetch));
    assert.equal(basket.products.length, 2);
    assert.equal(calls[0].body.operationName, 'getExtendedBasket');
    assert.equal(calls[0].body.query, GET_BASKET_QUERY);
    assert.deepEqual(calls[0].body.variables, {});
    assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
    const refused = mockFetch([{ status: 200, body: { errors: [{ message: 'Unauthorized' }] } }]);
    await assert.rejects(fetchBasket(deps(refused.fetch)), /login token/);
});

/* ─── Renewing the login, and keeping it encrypted ───────────────────── */

const renewed = { data: { refreshAuthToken: { authKey: 'NEW-AUTH-KEY-0123456789==', refreshKey: 'NEW-REFRESH-KEY-0123456789==', authExpiry: 1440, status: null, error: null, __typename: 'AuthTokens' } } };

test('refreshAuthToken: sent like the website does', async () => {
    const { fetch, calls } = mockFetch([{ status: 200, body: renewed }]);
    const out = await refreshAuth(deps(fetch), 'OLD-REFRESH-KEY-0123456789==');
    assert.deepEqual(out, { ok: true, authKey: 'NEW-AUTH-KEY-0123456789==', refreshKey: 'NEW-REFRESH-KEY-0123456789==', expiresInMinutes: 1440 });
    const { body: sent, init } = calls[0];
    assert.equal(sent.operationName, 'refreshAuthToken');
    assert.equal(sent.query, REFRESH_QUERY);
    assert.deepEqual(sent.variables, { appVersion: '9.0.10.0', binaryVersion: '9.0.10', source: 'web', refreshToken: 'OLD-REFRESH-KEY-0123456789==' });
    assert.equal(init.headers.authorization, `Bearer ${TOKEN}`); // the old (maybe expired) login token goes along

    // With no login token at all (only a refresh token saved), no Authorization header is sent.
    const bare = mockFetch([{ status: 200, body: renewed }]);
    await refreshAuth(deps(bare.fetch, { token: '' }), 'OLD-REFRESH-KEY-0123456789==');
    assert.equal('authorization' in bare.calls[0].init.headers, false);
});

test('refreshAuthToken: a refused refresh token means signing in again', () => {
    const signIn = /new refresh token in Admin/;
    const withError = parseRefreshResponse(200, { data: { refreshAuthToken: { authKey: null, refreshKey: null, authExpiry: null, status: 401, error: 'Invalid refresh token' } } });
    assert.equal(withError.ok, false);
    assert.equal(withError.kind, 'auth');
    assert.match(withError.message, signIn);
    assert.match(withError.message, /Invalid refresh token/);
    assert.equal(parseRefreshResponse(200, { data: { refreshAuthToken: { authKey: '', error: null } } }).kind, 'auth');
    assert.equal(parseRefreshResponse(401, null).kind, 'auth');
    assert.equal(parseRefreshResponse(200, { errors: [{ message: 'Unauthorized' }] }).kind, 'auth');
    assert.equal(parseRefreshResponse(200, { errors: [{ message: 'Something broke' }] }).kind, 'milkbasket');
    assert.deepEqual(parseRefreshResponse(503, null).retryable, true);
    // Milkbasket may keep the same refresh token: then the old one is kept.
    const sameRefresh = parseRefreshResponse(200, { data: { refreshAuthToken: { authKey: 'NEW-AUTH-KEY-0123456789==', refreshKey: null, authExpiry: 'soon' } } });
    assert.deepEqual(sameRefresh, { ok: true, authKey: 'NEW-AUTH-KEY-0123456789==', refreshKey: null, expiresInMinutes: null });
});

test('a refused login token is told apart, so the server can renew and retry', async () => {
    const refused = mockFetch([{ status: 401, body: { errors: [{ message: 'Session expired' }] } }]);
    const err = await fetchOrders(deps(refused.fetch)).then(() => null, e => e);
    assert.equal(isAuthError(err), true);
    assert.match(err.message, /HTTP 401: Session expired/);
    const other = await fetchOrders(deps(mockFetch([{ status: 500, body: '' }]).fetch)).then(() => null, e => e);
    assert.equal(isAuthError(other), false);
    // addToBasket reports kind 'auth' (nothing was added), with Milkbasket's reason.
    const add = parseAddResponse(401, { errors: [{ message: 'Session expired' }] });
    assert.equal(add.kind, 'auth');
    assert.match(add.message, /HTTP 401: Session expired/);
});

test('secrets in the database: encrypted, tamper-proof, tied to the key', () => {
    const key = secretKey('a-long-session-secret-for-tests-only-1234', 'milkbasket-tokens');
    const other = secretKey('a-different-session-secret-for-tests-5678', 'milkbasket-tokens');
    const token = '+2Hs/example+token==';
    const box = seal(token, key);
    assert.match(box, /^v1\./);
    assert.doesNotMatch(box, /example/);
    assert.notEqual(seal(token, key), box); // a fresh nonce each time
    assert.equal(unseal(box, key), token);
    assert.equal(unseal(box, other), null);
    const tampered = box.slice(0, -2) + (box.endsWith('A') ? 'B' : 'A') + box.slice(-1);
    assert.equal(unseal(tampered, key), null);
    assert.equal(unseal('plain text', key), null);
    assert.equal(unseal(undefined, key), null);
    // A different purpose gives a different key.
    assert.equal(unseal(box, secretKey('a-long-session-secret-for-tests-only-1234', 'session')), null);
    assert.equal(fingerprint('a'), fingerprint('a'));
    assert.notEqual(fingerprint('a'), fingerprint('b'));
    assert.equal(fingerprint(token).includes('example'), false);
});

/* ─── Searching Milkbasket, and product pictures ─────────────────────── */

const IMG = 'https://static-milkbasket.cdn.jio.com/products/2_0_1705487143.jpeg?policy=comprehensive_portrait_v1&dpr=3';

// Shaped like Milkbasket's getSearchProducts answer (trimmed).
const searchBody = {
    data: {
        getSearchProducts: {
            products: [
                { product: { id: 2, name: 'Amul Taaza Toned Milk Pouch', category: { name: 'Milk', subCategory: { name: 'Fresh Milk', type: 'Toned & Double Toned Milk' } }, availability: { isOos: false, oos: false, forcedOos: false, maxQuantity: 10, cutOff: { text: '12 AM' } }, assets: { image: { url: IMG, type: 1 }, video: null }, weight: { text: '500 ML' }, price: { mrp: { amount: '30', value: 30 }, price: { amount: '28', value: 28 } } }, variant: null },
                { product: { id: 8573, name: 'Amul  Moti Toned Milk Pouch', availability: { isOos: false, oos: false, forcedOos: false, maxQuantity: 10 }, assets: { image: { url: 'http://static-milkbasket.cdn.jio.com/x.png' } }, weight: { text: '450 ML' }, price: { price: { value: 30 } } } },
                { product: { id: 999, name: 'Gone Milk', availability: { isOos: true, oos: true, forcedOos: false, maxQuantity: null }, assets: { image: { url: 'https://evil.example.com/x.png' } }, weight: { text: '1 L' }, price: { price: { value: 60 } } } },
                { product: { id: 2, name: 'Duplicate' } },
                { product: { id: null, name: 'Broken' } },
            ],
            pages: { limit: 20, page: 1, hasNextPage: true, records: 440, pages: 2 },
        },
    },
};

test('search: products with picture, today’s price, MRP and stock', () => {
    const { products, hasNextPage, total } = parseSearchProducts(searchBody);
    assert.equal(hasNextPage, true);
    assert.equal(total, 440);
    assert.deepEqual(products.map(p => p.productId), [2, 8573, 999]);
    assert.deepEqual(products[0], {
        productId: 2, name: 'Amul Taaza Toned Milk Pouch', size: '500 ML', price: 28, mrp: 30, imageUrl: IMG,
        available: true, maxQuantity: 10, category: 'Milk · Toned & Double Toned Milk',
    });
    assert.equal(products[1].name, 'Amul Moti Toned Milk Pouch'); // double spaces tidied
    assert.equal(products[1].imageUrl, ''); // not https
    assert.equal(products[2].available, false);
    assert.equal(products[2].imageUrl, ''); // not Milkbasket's CDN
    assert.deepEqual(parseSearchProducts(null), { products: [], hasNextPage: false, total: null });
});

test('search: sent like the website does', async () => {
    const { fetch, calls } = mockFetch([{ status: 200, body: searchBody }]);
    const result = await searchProducts(deps(fetch), '  toned milk ', '3');
    assert.equal(result.products.length, 3);
    const sent = calls[0].body;
    assert.equal(sent.operationName, 'getSearchProducts');
    assert.equal(sent.query, SEARCH_QUERY);
    assert.deepEqual(sent.variables, { searchPayload: { searchText: 'toned milk', experimentId: 1, suggestedSearchText: '' }, cityId: 3, page: { page: 1, limit: 20 } });
    assert.equal(calls[0].init.headers.cityid, '4'); // the header keeps the configured city
    assert.deepEqual(searchVariables('x'.repeat(100), '1').searchPayload.searchText.length, 60);
    const refused = mockFetch([{ status: 401, body: '' }]);
    const err = await searchProducts(deps(refused.fetch), 'milk', '3').then(() => null, e => e);
    assert.equal(isAuthError(err), true);
});

test('pictures: only https images on Milkbasket’s CDN are kept', () => {
    assert.equal(cleanImageUrl(IMG), IMG);
    assert.equal(cleanImageUrl('https://images.milkbasket.com/a.png'), 'https://images.milkbasket.com/a.png');
    assert.equal(cleanImageUrl('http://static-milkbasket.cdn.jio.com/a.png'), '');
    assert.equal(cleanImageUrl('https://jio.com.evil.example/a.png'), '');
    assert.equal(cleanImageUrl('javascript:alert(1)'), '');
    assert.equal(cleanImageUrl(`https://static-milkbasket.cdn.jio.com/${'a'.repeat(700)}`), '');
    assert.equal(cleanImageUrl(null), '');
    // Order lines and basket products carry their picture too.
    const lines = parseOrderDetail({ data: { getOrderDetail: { data: [{ data: [{ id: 1, name: 'Milk', assets: { image: { url: IMG } }, order: { productId: 2, quantity: 1 }, price: { price: { value: 28 } } }] }] } } }, '26 Nov');
    assert.equal(lines[0].imageUrl, IMG);
    const basket = parseBasket({ data: { getExtendedBasket: { basket: { date: '2026-11-28', data: [{ data: [{ product: { name: 'Milk', assets: { image: { url: IMG } }, order: { productId: 2, quantity: 1 } } }] }] } } } });
    assert.equal(basket.products[0].imageUrl, IMG);
});

/* ─── Order history ──────────────────────────────────────────────────── */

const detail = lines => ({ data: { getOrderDetail: { data: [{ data: lines }] } } });
const line = (lineId, productId, name, size, price, quantity = 1) => ({
    id: lineId, name, weight: { text: size }, order: { productId, quantity }, price: { price: { value: price } },
});

test('orders and order lines: the product id comes from order.productId, not the line id', () => {
    const orders = parseOrders({ data: { getAccountHistory: { orders: [{ id: 9001, date: '26 Nov 2026', day: 'Thu', amount: 210 }, { id: 'bad/id' }] } } });
    assert.deepEqual(orders, [{ id: '9001', date: '26 Nov 2026' }]);
    const products = parseOrderDetail(detail([line(555, 101, 'Toned Milk', '500 ml', 27.5, 2), line(556, null, 'Broken', '', 1)]), '26 Nov 2026');
    assert.deepEqual(products, [{ productId: 101, name: 'Toned Milk', size: '500 ml', price: 27.5, lastOrdered: '26 Nov 2026', orders: 1, imageUrl: '' }]);
    assert.deepEqual(parseOrderDetail({ data: null }, 'x'), []);
});

test('history products: one per product, latest order wins, searchable', () => {
    const latest = parseOrderDetail(detail([line(1, 101, 'Toned Milk', '500 ml', 28), line(2, 202, 'Paneer', '200 g', 90)]), '26 Nov');
    const older = parseOrderDetail(detail([line(3, 101, 'Toned Milk', '500 ml', 27), line(4, 303, 'Curd', '400 g', 45)]), '20 Nov');
    const merged = mergeHistory([latest, older]);
    assert.deepEqual(merged.map(p => [p.productId, p.price, p.lastOrdered, p.orders]), [[101, 28, '26 Nov', 2], [202, 90, '26 Nov', 1], [303, 45, '20 Nov', 1]]);
    assert.deepEqual(searchHistory(merged, 'milk').map(p => p.productId), [101]);
    assert.deepEqual(searchHistory(merged, '200 g').map(p => p.productId), [202]);
    assert.deepEqual(searchHistory(merged, '303').map(p => p.productId), [303]);
    assert.equal(searchHistory(merged, '').length, 3);
});
