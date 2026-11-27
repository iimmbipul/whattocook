'use server';

/**
 * Milkbasket server actions. Each one is a public endpoint: the user and
 * household come from the verified session, and every argument is validated in
 * src/lib/server/milkbasket.ts. Approving, rejecting, adding by hand and the
 * order history are for the owner and members; the rest is owner only. Views
 * load through GET /api/milkbasket, /api/milkbasket/basket and /api/milkbasket/admin.
 */

import { getSessionUser } from '../server/currentUser';
import {
    addManually,
    approveRequest,
    getOrderHistory,
    linkProduct,
    rejectRequest,
    removeMapping,
    retryRequest,
    saveMapping,
    searchMilkbasket,
    setMappingEnabled,
    testConnection,
    updateMilkbasketLogin,
    updateMilkbasketSettings,
    type ManualAddInput,
    type MappingInput,
} from '../server/milkbasket';
import type { SearchResult } from './logic';
import type { MilkbasketResult, OrderHistoryResult, PurchaseRequestRow } from './types';

const noSession = { ok: false, error: 'auth' } as const;

/** Owner or member: add a listed item to the Milkbasket basket now (no approval needed). */
export async function addToMilkbasket(input: ManualAddInput): Promise<MilkbasketResult<PurchaseRequestRow>> {
    const user = await getSessionUser();
    return user ? addManually(user, input) : noSession;
}

export async function saveMilkbasketMapping(input: MappingInput): Promise<MilkbasketResult> {
    const user = await getSessionUser();
    return user ? saveMapping(user, input) : noSession;
}

export async function removeMilkbasketMapping(itemId: string): Promise<MilkbasketResult> {
    const user = await getSessionUser();
    return user ? removeMapping(user, itemId) : noSession;
}

export async function setMilkbasketAutoOrder(itemId: string, enabled: boolean): Promise<MilkbasketResult> {
    const user = await getSessionUser();
    return user ? setMappingEnabled(user, itemId, enabled) : noSession;
}

/** Approve a waiting request (quantity can be changed; price only when none is known). */
export async function approveMilkbasketRequest(requestId: string, quantity: number, price: number | null): Promise<MilkbasketResult<PurchaseRequestRow>> {
    const user = await getSessionUser();
    return user ? approveRequest(user, requestId, quantity, price) : noSession;
}

export async function rejectMilkbasketRequest(requestId: string): Promise<MilkbasketResult> {
    const user = await getSessionUser();
    return user ? rejectRequest(user, requestId) : noSession;
}

export async function retryMilkbasketRequest(requestId: string): Promise<MilkbasketResult<PurchaseRequestRow>> {
    const user = await getSessionUser();
    return user ? retryRequest(user, requestId) : noSession;
}

export async function saveMilkbasketSettings(settings: {
    enabled: boolean;
    priceLimit: number;
    deliveryDays: 1 | 2;
    duplicateWindowHours: number;
    notify: boolean;
}): Promise<MilkbasketResult> {
    const user = await getSessionUser();
    return user ? updateMilkbasketSettings(user, settings) : noSession;
}

export async function testMilkbasketConnection(): Promise<MilkbasketResult<{ message: string }>> {
    const user = await getSessionUser();
    return user ? testConnection(user) : noSession;
}

export async function loadMilkbasketOrderHistory(refresh: boolean): Promise<MilkbasketResult<OrderHistoryResult>> {
    const user = await getSessionUser();
    return user ? getOrderHistory(user, refresh) : noSession;
}

/** Owner: save the Milkbasket login. The tokens are encrypted on the server and never sent back. */
export async function saveMilkbasketLogin(refreshToken: string, authToken: string): Promise<MilkbasketResult> {
    const user = await getSessionUser();
    return user ? updateMilkbasketLogin(user, refreshToken, authToken) : noSession;
}

/** Owner or member: search Milkbasket's products by name. */
export async function searchMilkbasketProducts(searchText: string): Promise<MilkbasketResult<SearchResult>> {
    const user = await getSessionUser();
    return user ? searchMilkbasket(user, searchText) : noSession;
}

/** Owner or member: link an item to a Milkbasket product (from search or recent orders) without adding it. */
export async function linkMilkbasketProduct(itemId: string, product: { milkbasketProductId: number; productName: string; size?: string; price: number | null; imageUrl?: string }): Promise<MilkbasketResult> {
    const user = await getSessionUser();
    return user ? linkProduct(user, itemId, product) : noSession;
}
