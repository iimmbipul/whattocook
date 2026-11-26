'use server';

/**
 * Grocery server actions. Each one is a public endpoint: the acting user and
 * household always come from the verified session, and every argument is
 * validated in src/lib/server/grocery.ts. Reads go through GET /api/grocery
 * and /api/grocery/admin so they load alongside the page's own data.
 */

import { getSessionUser } from '../server/currentUser';
import { authorizeAppAdmin } from '../server/guards';
import {
    addItem,
    addNoteItems,
    changeCatalogItem,
    markItem,
    parseGroceryNote,
    reportStock,
    restockItems,
    saveCatalogItem,
    setItemInterval,
    setItemTracking,
    updateGrocerySettings,
} from '../server/grocery';
import type { GroceryResult, MarkedItem, NoteItem } from './types';

const noSession = { ok: false, error: 'auth' } as const;

/** Anyone in the household: mark an item Out of stock ('empty') or Full ('full'). */
export async function markGroceryItem(itemId: string, level: string): Promise<GroceryResult<MarkedItem>> {
    const user = await getSessionUser();
    return user ? markItem(user, itemId, level) : noSession;
}

/** Anyone in the household: add an item that isn't listed yet, with its status. */
export async function addGroceryItem(name: string, level: string): Promise<GroceryResult<MarkedItem>> {
    const user = await getSessionUser();
    return user ? addItem(user, name, level) : noSession;
}

/** Cook: how much of an item is left (full, half, quarter, empty). */
export async function reportGroceryLevel(itemId: string, level: string): Promise<GroceryResult> {
    const user = await getSessionUser();
    return user ? reportStock(user, itemId, level) : noSession;
}

/** Members: Bought. Cook: Groceries arrived. */
export async function markGroceriesRestocked(itemIds: string[]): Promise<GroceryResult> {
    const user = await getSessionUser();
    return user ? restockItems(user, itemIds) : noSession;
}

/** Cook or owner: stop asking about an item (or start again). */
export async function setGroceryTracking(itemId: string, active: boolean): Promise<GroceryResult> {
    const user = await getSessionUser();
    return user ? setItemTracking(user, itemId, active) : noSession;
}

/** Cook: understand a typed note; nothing is saved until confirmed. */
export async function understandGroceryNote(text: string): Promise<GroceryResult<NoteItem[]>> {
    const user = await getSessionUser();
    return user ? parseGroceryNote(user, text) : noSession;
}

/** Cook: save the items confirmed from a note. */
export async function saveGroceryNoteItems(items: NoteItem[]): Promise<GroceryResult> {
    const user = await getSessionUser();
    return user ? addNoteItems(user, items) : noSession;
}

/** Owner: look-ahead days, daily limit, learning on or off. */
export async function saveGrocerySettings(settings: { lookAheadDays: number; dailyCheckCap: number; learning: boolean }): Promise<GroceryResult> {
    const user = await getSessionUser();
    return user ? updateGrocerySettings(user, settings) : noSession;
}

/** Owner: pin an item's check interval in days, or pass null to let it learn again. */
export async function setGroceryInterval(itemId: string, days: number | null): Promise<GroceryResult> {
    const user = await getSessionUser();
    return user ? setItemInterval(user, itemId, days) : noSession;
}

/** App admin: add or edit a default catalogue item. */
export async function saveGroceryCatalogItem(item: {
    id: string;
    en: string;
    hi: string;
    or: string;
    category: string;
    intervalDays: number;
    aliases: string[];
}): Promise<GroceryResult> {
    if (!(await authorizeAppAdmin('saveGroceryCatalogItem'))) return { ok: false, error: 'forbidden' };
    return saveCatalogItem(item);
}

/** App admin: hide, show or reset a catalogue item. */
export async function changeGroceryCatalogItem(id: string, action: 'hide' | 'show' | 'reset'): Promise<GroceryResult> {
    if (!(await authorizeAppAdmin('changeGroceryCatalogItem'))) return { ok: false, error: 'forbidden' };
    return changeCatalogItem(id, action);
}
