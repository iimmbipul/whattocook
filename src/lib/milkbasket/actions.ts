'use server';

/**
 * Milkbasket server actions (owner only). Each one is a public endpoint: the
 * user and household come from the verified session, and every argument is
 * validated in src/lib/server/milkbasket.ts. The admin view loads through
 * GET /api/milkbasket/admin.
 */

import { getSessionUser } from '../server/currentUser';
import {
    approveRequest,
    getOrderHistory,
    rejectRequest,
    removeMapping,
    retryRequest,
    saveMapping,
    setMappingEnabled,
    testConnection,
    updateMilkbasketSettings,
    type MappingInput,
} from '../server/milkbasket';
import type { MilkbasketResult, OrderHistoryResult, PurchaseRequestRow } from './types';

const noSession = { ok: false, error: 'auth' } as const;

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
