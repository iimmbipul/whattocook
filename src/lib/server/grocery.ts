import 'server-only';

import { createHash } from 'node:crypto';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { DocumentData } from 'firebase-admin/firestore';
import type { User } from '@/types/meal';
import { adminFirestore } from './firebaseAdmin';
import { COOKS_COLLECTION } from './currentUser';
import { isSafeDocId } from './guards';
import { findMeals } from './mealLookup';
import { generationProviderOptions, hasAnyAiProvider, runWithFallback } from '../aiModels';
import { mealNameKey } from '../mealPhoto';
import { localTime } from '../ratings/logic';
import { createNotification } from '../notifications';
import { CATEGORIES, DEFAULT_CATALOG, isCategory, itemTerms, type CatalogItem, type Category } from '../grocery/catalog';
import * as G from '../grocery/logic';
import type {
    CatalogRow,
    GroceryAdminView,
    GroceryResult,
    GroceryRow,
    GroceryView,
    IntervalChangeInfo,
    NoteItem,
} from '../grocery/types';

/*
 * Data model:
 *
 *   grocery_catalog/{itemId}                  App-admin overrides of the built-in
 *                                             catalogue (src/lib/grocery/catalog.ts).
 *   dish_ingredients/{key}                    Cache: dish (+ its ingredient list) → item ids.
 *   households/{hid}/pantry/{itemId}          The household's item: names, level,
 *                                             interval and its source, dates.
 *   households/{hid}/pantry/{itemId}/events   History: report, bought, arrived,
 *                                             interval pinned or unpinned.
 *   households/{hid}/settings/grocery         Look-ahead days, daily limit, learning.
 *
 * Only the server reads and writes these (security rules deny the browser).
 * Stock levels are reported by the hired cook, or by the owner of a household
 * that has no hired cook. Anyone in the household can mark items bought.
 */

type Fs = ReturnType<typeof adminFirestore>;

const CATALOG_COLLECTION = 'grocery_catalog';
const DISH_CACHE_COLLECTION = 'dish_ingredients';
const pantryPath = (hid: string) => `households/${hid}/pantry`;
const settingsPath = (hid: string) => `households/${hid}/settings/grocery`;

const OUT_OF_STOCK_MERGE_MS = 30 * 60 * 1000;
const MAX_NAME = 40;

class GroceryNotFound extends Error {}

/* ─── Catalogue ──────────────────────────────────────────────────────── */

interface LoadedCatalog {
    items: Map<string, CatalogItem>;
    index: { term: string; id: string }[];
    /** Firestore overrides: which ids are edited or hidden. */
    overrides: Map<string, { hidden: boolean }>;
}

let catalogCache: { at: number; value: LoadedCatalog } | null = null;
const CATALOG_TTL_MS = 5 * 60 * 1000;

function cleanText(value: unknown, max: number): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function readCatalogItem(id: string, data: DocumentData): CatalogItem | null {
    const en = cleanText(data.en, 60);
    if (!isSafeDocId(id) || !en) return null;
    return {
        id,
        en,
        hi: cleanText(data.hi, 60),
        or: cleanText(data.or, 60),
        category: isCategory(data.category) ? data.category : 'other',
        intervalDays: G.clampInterval(Number(data.intervalDays) || 7),
        aliases: Array.isArray(data.aliases)
            ? data.aliases.map((a: unknown) => cleanText(a, MAX_NAME)).filter(Boolean).slice(0, 20)
            : [],
    };
}

async function loadCatalog(fs: Fs, fresh = false): Promise<LoadedCatalog> {
    if (!fresh && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
    const items = new Map(DEFAULT_CATALOG.map(i => [i.id, i]));
    const overrides = new Map<string, { hidden: boolean }>();
    const snap = await fs.collection(CATALOG_COLLECTION).get();
    snap.forEach(doc => {
        const data = doc.data();
        const hidden = data.hidden === true;
        overrides.set(doc.id, { hidden });
        const item = readCatalogItem(doc.id, data);
        if (hidden) items.delete(doc.id);
        else if (item) items.set(doc.id, item);
    });
    const index = G.buildTermIndex([...items.values()].map(i => ({ id: i.id, names: itemTerms(i) })));
    const value = { items, index, overrides };
    catalogCache = { at: Date.now(), value };
    return value;
}

/* ─── Pantry records ─────────────────────────────────────────────────── */

interface PantryRecord {
    id: string;
    en: string;
    hi: string;
    or: string;
    category: Category;
    active: boolean;
    state: G.PantryState;
    levelAtMs: number | null;
    reportedByName: string | null;
    lastChange: IntervalChangeInfo | null;
    virtual: boolean;
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function readPantry(id: string, data: DocumentData, today: string): PantryRecord {
    const level: G.ItemLevel = G.isStockLevel(data.level) ? data.level : 'unknown';
    const source: G.IntervalSource = data.intervalSource === 'learned' || data.intervalSource === 'pinned' ? data.intervalSource : 'default';
    const change = data.lastChange && typeof data.lastChange === 'object' ? data.lastChange : null;
    return {
        id,
        en: cleanText(data.en, 60) || id,
        hi: cleanText(data.hi, 60),
        or: cleanText(data.or, 60),
        category: isCategory(data.category) ? data.category : 'other',
        active: data.active !== false,
        state: {
            level,
            intervalDays: G.clampInterval(Number(data.intervalDays) || 7),
            intervalSource: source,
            lastRestockDate: isDate(data.lastRestockDate) ? data.lastRestockDate : null,
            lastCheckedDate: isDate(data.lastCheckedDate) ? data.lastCheckedDate : null,
            nextCheckDate: isDate(data.nextCheckDate) ? data.nextCheckDate : today,
            lowReportedThisCycle: data.lowReportedThisCycle === true,
        },
        levelAtMs: typeof data.levelAtMs === 'number' ? data.levelAtMs : null,
        reportedByName: cleanText(data.reportedByName, 80) || null,
        lastChange: change && typeof change.from === 'number' && typeof change.to === 'number' && isDate(change.date)
            ? { from: change.from, to: change.to, observedDays: Number(change.observedDays) || 0, date: change.date }
            : null,
        virtual: false,
    };
}

function recordFromCatalog(item: CatalogItem, today: string): PantryRecord {
    return {
        id: item.id,
        en: item.en,
        hi: item.hi,
        or: item.or,
        category: item.category,
        active: true,
        state: G.newPantryState(item.intervalDays, today),
        levelAtMs: null,
        reportedByName: null,
        lastChange: null,
        virtual: true,
    };
}

function toDoc(rec: PantryRecord, nowMs: number): DocumentData {
    return {
        itemId: rec.id,
        en: rec.en,
        hi: rec.hi,
        or: rec.or,
        category: rec.category,
        active: rec.active,
        level: rec.state.level,
        intervalDays: rec.state.intervalDays,
        intervalSource: rec.state.intervalSource,
        lastRestockDate: rec.state.lastRestockDate,
        lastCheckedDate: rec.state.lastCheckedDate,
        nextCheckDate: rec.state.nextCheckDate,
        lowReportedThisCycle: rec.state.lowReportedThisCycle,
        levelAtMs: rec.levelAtMs,
        reportedByName: rec.reportedByName,
        lastChange: rec.lastChange,
        updatedAtMs: nowMs,
    };
}

function toRow(rec: PantryRecord, needed?: { date: string; dishes: string[] }): GroceryRow {
    return {
        itemId: rec.id,
        en: rec.en,
        hi: rec.hi,
        or: rec.or,
        category: rec.category,
        level: rec.state.level,
        levelAtMs: rec.levelAtMs,
        reportedByName: rec.reportedByName,
        neededOn: needed?.date ?? null,
        dishes: needed?.dishes ?? [],
        intervalDays: rec.state.intervalDays,
        intervalSource: rec.state.intervalSource,
        nextCheckDate: rec.state.nextCheckDate,
        lastCheckedDate: rec.state.lastCheckedDate,
        active: rec.active,
        virtual: rec.virtual,
    };
}

const categoryOrder = (c: Category) => CATEGORIES.indexOf(c);

function actorName(user: User): string {
    return user.displayName?.trim() || (user.email && !user.email.endsWith('@cook.local') ? user.email.split('@')[0] : '') || user.phoneNumber || '';
}

/* ─── Who can do what ────────────────────────────────────────────────── */

async function hasHiredCook(fs: Fs, hid: string): Promise<boolean> {
    const snap = await fs.collection(COOKS_COLLECTION).where('linkedUserId', '==', hid).limit(1).get();
    return !snap.empty;
}

/** The hired cook reports stock; in a household with no cook, the owner does. */
async function canCheckStock(fs: Fs, user: User): Promise<boolean> {
    if (user.role === 'cook') return true;
    if (user.role === 'user') return !(await hasHiredCook(fs, user.householdId));
    return false;
}

const validUser = (user: User) => isSafeDocId(user.uid) && isSafeDocId(user.householdId);

async function readSettings(fs: Fs, hid: string): Promise<G.GrocerySettings> {
    return G.cleanSettings((await fs.doc(settingsPath(hid)).get()).data());
}

/* ─── Menu look-ahead: which items the next few days need ────────────── */

function cacheDocId(key: string): string {
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
    return slug ? `${slug}-${hash}` : hash;
}

const dishMemo = new Map<string, string[]>();

const dishSchema = z.object({ item_ids: z.array(z.string()) });

function catalogList(catalog: LoadedCatalog): string {
    return [...catalog.items.values()].map(i => `${i.id}: ${i.en}`).join('\n');
}

async function aiDishItems(name: string, ingredients: string[], catalog: LoadedCatalog): Promise<string[]> {
    return runWithFallback('dish grocery items', async ({ model, maxRetries }) => {
        const { output } = await generateText({
            model,
            maxRetries,
            output: Output.object({ schema: dishSchema, name: 'dish_grocery_items' }),
            system: `You list the groceries an Indian home kitchen uses to cook a dish.
Choose ids only from this catalogue (id: name):
${catalogList(catalog)}
Return the ids of the items the dish needs: vegetables, flours and grains, pulses, dairy, oil and its main spices.
Leave out water and anything not in the catalogue. At most 15 ids.`,
            prompt: `Dish: ${name}\nIngredients: ${ingredients.join(', ') || '(not listed)'}`,
            temperature: 0.1,
            providerOptions: generationProviderOptions,
        });
        return output.item_ids.filter(id => catalog.items.has(id)).slice(0, 15);
    });
}

interface Dish {
    name: string;
    ingredients: string[];
}

/**
 * Catalogue items for each dish. Ingredients are matched locally first; AI is
 * used only for dishes with no ingredients or with words it can't match, and
 * the answer is cached for every household.
 */
async function itemsForDishes(fs: Fs, dishes: Dish[], catalog: LoadedCatalog): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    const keyed = dishes.map(d => {
        const ingredients = d.ingredients.map(i => cleanText(i, 80)).filter(Boolean).slice(0, 30);
        const key = `${mealNameKey(d.name)}|${ingredients.map(i => i.toLowerCase()).sort().join(',')}`;
        return { name: d.name, ingredients, key };
    });
    const missing = keyed.filter(d => {
        const memo = dishMemo.get(d.key);
        if (memo) result.set(d.name, memo.filter(id => catalog.items.has(id)));
        return !memo;
    });
    if (missing.length === 0) return result;

    const refs = missing.map(d => fs.doc(`${DISH_CACHE_COLLECTION}/${cacheDocId(d.key)}`));
    const snaps = await fs.getAll(...refs);
    await Promise.all(missing.map(async (d, i) => {
        const cached = snaps[i].data()?.itemIds;
        if (Array.isArray(cached)) {
            const ids = cached.filter((id: unknown): id is string => typeof id === 'string');
            dishMemo.set(d.key, ids);
            result.set(d.name, ids.filter(id => catalog.items.has(id)));
            return;
        }
        const local = d.ingredients.map(i => G.matchItem(catalog.index, i));
        let ids = [...new Set(local.filter((id): id is string => !!id))];
        const unmatched = d.ingredients.filter((_, j) => !local[j]);
        let aiUsed = false;
        if ((d.ingredients.length === 0 || unmatched.length > 0) && hasAnyAiProvider()) {
            try {
                ids = [...new Set([...ids, ...(await aiDishItems(d.name, d.ingredients, catalog))])];
                aiUsed = true;
            } catch (err) {
                console.warn('[grocery] dish mapping failed; using local matches only:', (err as Error).message);
                result.set(d.name, ids);
                return; // don't cache a partial answer
            }
        }
        dishMemo.set(d.key, ids);
        result.set(d.name, ids);
        await refs[i].set({ name: d.name.slice(0, 120), ingredients: d.ingredients, itemIds: ids, aiUsed, at: Date.now() });
    }));
    return result;
}

async function neededItems(
    fs: Fs,
    hid: string,
    today: string,
    days: number,
    catalog: LoadedCatalog,
): Promise<Map<string, { date: string; dishes: string[] }>> {
    const dates = Array.from({ length: days }, (_, i) => G.addDays(today, i));
    const meals = await findMeals(fs, hid, dates);
    const perDate = dates.map(date => {
        const meal = meals.get(date);
        const dishes: Dish[] = (meal ? [meal.breakfast, meal.lunch, meal.dinner] : [])
            .filter(item => item && typeof item.item_name === 'string' && item.item_name.trim() && item.item_name !== 'Not Set')
            .map(item => ({ name: item.item_name.trim(), ingredients: Array.isArray(item.ingredients) ? item.ingredients : [] }));
        return { date, dishes };
    });
    const unique = new Map<string, Dish>();
    perDate.forEach(d => d.dishes.forEach(dish => unique.set(dish.name, dish)));
    const byDish = await itemsForDishes(fs, [...unique.values()], catalog);

    const needed = new Map<string, { date: string; dishes: string[] }>();
    for (const { date, dishes } of perDate) {
        for (const dish of dishes) {
            for (const id of byDish.get(dish.name) ?? []) {
                const entry = needed.get(id);
                if (!entry) needed.set(id, { date, dishes: [dish.name] });
                else if (entry.date === date && !entry.dishes.includes(dish.name) && entry.dishes.length < 3) entry.dishes.push(dish.name);
            }
        }
    }
    return needed;
}

/* ─── Views ──────────────────────────────────────────────────────────── */

const byUrgency = (a: GroceryRow, b: GroceryRow) =>
    G.LEVEL_RANK[a.level] - G.LEVEL_RANK[b.level]
    || (a.neededOn ?? '9999').localeCompare(b.neededOn ?? '9999')
    || a.en.localeCompare(b.en);

const byCategoryThenName = (a: GroceryRow, b: GroceryRow) =>
    Number(b.active) - Number(a.active) || categoryOrder(a.category) - categoryOrder(b.category) || a.en.localeCompare(b.en);

/** Everything the grocery screens need, shaped by who is asking. */
export async function getGroceryView(user: User, now: Date = new Date()): Promise<GroceryView> {
    const today = localTime(now).date;
    const fs = adminFirestore();
    const hid = user.householdId;
    const [settings, catalog, pantrySnap, canCheck] = await Promise.all([
        readSettings(fs, hid),
        loadCatalog(fs),
        fs.collection(pantryPath(hid)).get(),
        canCheckStock(fs, user),
    ]);
    const needed = await neededItems(fs, hid, today, settings.lookAheadDays, catalog).catch(err => {
        console.error('[grocery] menu look-ahead failed:', err);
        return new Map<string, { date: string; dishes: string[] }>();
    });

    const records = new Map(pantrySnap.docs.map(d => [d.id, readPantry(d.id, d.data(), today)]));
    for (const id of needed.keys()) {
        const item = catalog.items.get(id);
        if (!records.has(id) && item) records.set(id, recordFromCatalog(item, today));
    }

    let checks: GroceryRow[] = [];
    if (canCheck) {
        const candidates: G.CheckCandidate[] = [...records.values()].map(r => ({
            itemId: r.id,
            active: r.active,
            level: r.state.level,
            nextCheckDate: r.state.nextCheckDate,
            lastCheckedDate: r.state.lastCheckedDate,
            neededOn: needed.get(r.id)?.date ?? null,
            intervalDays: r.state.intervalDays,
        }));
        checks = G.dailyChecks(candidates, today, settings.dailyCheckCap)
            .map(id => toRow(records.get(id)!, needed.get(id)));
    }

    const saved = [...records.values()].filter(r => !r.virtual);
    const list = saved
        .filter(r => r.active && (G.LIST_LEVELS as readonly string[]).includes(r.state.level))
        .map(r => toRow(r, needed.get(r.id)))
        .sort(byUrgency);
    const pantry = canCheck ? saved.map(r => toRow(r, needed.get(r.id))).sort(byCategoryThenName) : [];
    const lastCheckDate = saved.reduce<string | null>((max, r) => {
        const d = r.state.lastCheckedDate;
        return d && (!max || d > max) ? d : max;
    }, null);

    return { today, canCheck, settings, checks, list, pantry, lastCheckDate };
}

/* ─── Cook: reports, notes ───────────────────────────────────────────── */

function tsMillis(value: unknown): number {
    if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
        return (value as { toMillis: () => number }).toMillis();
    }
    return typeof value === 'number' ? value : 0;
}

/** One bell notification per run of Empty reports: later ones within 30 minutes are added to it. */
async function notifyOutOfStock(fs: Fs, user: User, names: string[], nowMs: number): Promise<void> {
    if (names.length === 0) return;
    try {
        const col = fs.collection(`households/${user.householdId}/notifications`);
        const recent = await col.orderBy('createdAt', 'desc').limit(5).get();
        const mine = recent.docs.find(d => {
            const n = d.data();
            return n.type === 'grocery_out' && n.actorId === user.uid && nowMs - tsMillis(n.createdAt) < OUT_OF_STOCK_MERGE_MS;
        });
        if (mine) {
            const existing = String(mine.data().payload?.items ?? '').split(', ').filter(Boolean);
            const merged = [...new Set([...existing, ...names])].slice(0, 20);
            await mine.ref.update({ 'payload.items': merged.join(', '), 'payload.count': merged.length, readBy: [] });
            return;
        }
        await createNotification(user.householdId, {
            type: 'grocery_out',
            actorId: user.uid,
            actorName: '',
            payload: { items: names.join(', '), count: names.length },
        });
    } catch (err) {
        console.error('[grocery] out-of-stock notification failed:', err);
    }
}

/** The cook reports how much of an item is left (from the daily check or the Pantry page). */
export async function reportStock(user: User, itemId: unknown, level: unknown, now: Date = new Date()): Promise<GroceryResult> {
    if (!validUser(user) || !isSafeDocId(itemId) || !G.isStockLevel(level)) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    if (!(await canCheckStock(fs, user))) return { ok: false, error: 'forbidden' };
    const [settings, catalog] = await Promise.all([readSettings(fs, user.householdId), loadCatalog(fs)]);
    const today = localTime(now).date;
    const nowMs = now.getTime();
    const ref = fs.doc(`${pantryPath(user.householdId)}/${itemId}`);
    let emptyName: string | null = null;
    try {
        await fs.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const catalogItem = catalog.items.get(itemId);
            if (!snap.exists && !catalogItem) throw new GroceryNotFound();
            const rec = snap.exists ? readPantry(itemId, snap.data()!, today) : recordFromCatalog(catalogItem!, today);
            const { state, change } = G.applyReport(rec.state, level, today, settings.learning);
            const updated: PantryRecord = {
                ...rec,
                state,
                active: true,
                virtual: false,
                levelAtMs: nowMs,
                reportedByName: actorName(user) || null,
                lastChange: change ? { ...change, date: today } : rec.lastChange,
            };
            tx.set(ref, { ...toDoc(updated, nowMs), ...(snap.exists ? {} : { createdAtMs: nowMs, addedBy: user.uid }) });
            tx.set(ref.collection('events').doc(), { type: 'report', level, by: user.uid, at: nowMs, date: today, change: change ?? null });
            if (level === 'empty') emptyName = updated.en;
        });
    } catch (err) {
        if (err instanceof GroceryNotFound) return { ok: false, error: 'not-found' };
        console.error('[grocery] reportStock failed:', err);
        return { ok: false, error: 'failed' };
    }
    if (emptyName) await notifyOutOfStock(fs, user, [emptyName], nowMs);
    return { ok: true };
}

/** Bought (members, owner) or Groceries arrived (cook): the items are full again. */
export async function restockItems(user: User, itemIds: unknown, now: Date = new Date()): Promise<GroceryResult> {
    if (!validUser(user)) return { ok: false, error: 'invalid' };
    const ids = Array.isArray(itemIds) ? [...new Set(itemIds.filter(isSafeDocId))].slice(0, 50) : [];
    if (ids.length === 0) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    const catalog = await loadCatalog(fs);
    const today = localTime(now).date;
    const nowMs = now.getTime();
    const refs = ids.map(id => fs.doc(`${pantryPath(user.householdId)}/${id}`));
    try {
        await fs.runTransaction(async tx => {
            const snaps = await tx.getAll(...refs);
            snaps.forEach((snap, i) => {
                const catalogItem = catalog.items.get(ids[i]);
                if (!snap.exists && !catalogItem) return;
                const rec = snap.exists ? readPantry(ids[i], snap.data()!, today) : recordFromCatalog(catalogItem!, today);
                const updated: PantryRecord = {
                    ...rec,
                    state: G.applyRestock(rec.state, today),
                    active: true,
                    virtual: false,
                    levelAtMs: nowMs,
                    reportedByName: actorName(user) || null,
                };
                tx.set(refs[i], { ...toDoc(updated, nowMs), ...(snap.exists ? {} : { createdAtMs: nowMs, addedBy: user.uid }) });
                tx.set(refs[i].collection('events').doc(), { type: user.role === 'cook' ? 'arrived' : 'bought', level: 'full', by: user.uid, at: nowMs, date: today });
            });
        });
        return { ok: true };
    } catch (err) {
        console.error('[grocery] restockItems failed:', err);
        return { ok: false, error: 'failed' };
    }
}

/** Stop (or resume) asking about an item. The cook, or the owner. */
export async function setItemTracking(user: User, itemId: unknown, active: unknown): Promise<GroceryResult> {
    if (!validUser(user) || !isSafeDocId(itemId) || typeof active !== 'boolean') return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    if (user.role !== 'user' && !(await canCheckStock(fs, user))) return { ok: false, error: 'forbidden' };
    const catalog = await loadCatalog(fs);
    const ref = fs.doc(`${pantryPath(user.householdId)}/${itemId}`);
    const today = localTime(new Date()).date;
    const snap = await ref.get();
    const catalogItem = catalog.items.get(itemId);
    if (!snap.exists && !catalogItem) return { ok: false, error: 'not-found' };
    const rec = snap.exists ? readPantry(itemId, snap.data()!, today) : recordFromCatalog(catalogItem!, today);
    await ref.set({ ...toDoc({ ...rec, active, virtual: false }, Date.now()), ...(snap.exists ? {} : { createdAtMs: Date.now(), addedBy: user.uid }) });
    return { ok: true };
}

const noteSchema = z.object({
    items: z.array(z.object({
        source: z.string(),
        catalog_id: z.string(),
        name_en: z.string(),
        name_hi: z.string(),
        name_or: z.string(),
        category: z.enum(CATEGORIES),
        interval_days: z.number(),
        level: z.enum(['full', 'half', 'quarter', 'empty', 'none']),
    })),
});

function customId(nameEn: string): string {
    const slug = nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return `custom-${slug || createHash('sha1').update(nameEn).digest('hex').slice(0, 10)}`;
}

function fromCatalog(item: CatalogItem, level: G.StockLevel | null, source: string): NoteItem {
    return { itemId: item.id, en: item.en, hi: item.hi, or: item.or, category: item.category, intervalDays: item.intervalDays, level, isNew: false, source };
}

/**
 * Understand the cook's typed note ("pyaz khatam, aata aadha") without saving
 * anything: catalogue words are matched locally; only the rest goes to AI,
 * which names new items in English, Hindi and Odia.
 */
export async function parseGroceryNote(user: User, text: unknown): Promise<GroceryResult<NoteItem[]>> {
    if (!validUser(user) || typeof text !== 'string') return { ok: false, error: 'invalid' };
    const note = text.replace(/\s+/g, ' ').trim();
    if (!note || note.length > G.MAX_NOTE_LENGTH) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    if (!(await canCheckStock(fs, user))) return { ok: false, error: 'forbidden' };
    const catalog = await loadCatalog(fs);

    const found: NoteItem[] = [];
    const unmatched: string[] = [];
    for (const part of G.splitNote(note)) {
        const id = G.matchItem(catalog.index, part);
        const item = id ? catalog.items.get(id) : undefined;
        if (item) found.push(fromCatalog(item, G.parseLevelWords(part), part));
        else unmatched.push(part);
    }

    if (unmatched.length > 0) {
        if (!hasAnyAiProvider()) {
            if (found.length === 0) return { ok: false, error: 'ai-unavailable' };
        } else {
            try {
                const ai = await runWithFallback('grocery note', async ({ model, maxRetries }) => {
                    const { output } = await generateText({
                        model,
                        maxRetries,
                        output: Output.object({ schema: noteSchema, name: 'grocery_note' }),
                        system: `A cook in an Indian home typed a short note about kitchen stock, in Hindi, Odia, English or a mix (Hinglish).
For each grocery or kitchen supply item mentioned:
- source: the words of the note it came from.
- catalog_id: the id from the catalogue below if it is the same item, otherwise "".
- name_en: its plain English name (at most 4 words, first letter capital).
- name_hi: its name in Hindi (Devanagari). name_or: its name in Odia (Odia script).
- category: one of ${CATEGORIES.join(', ')}.
- interval_days: how often a household should check how much is left (1 to 30).
- level: "empty" if it has run out (khatam, finished, nahi hai), "quarter" if only a little is left (thoda, kam), "half" if about half (aadha), "full" if full, otherwise "none".
Ignore anything that is not a grocery or kitchen supply. At most ${G.MAX_ITEMS_PER_NOTE} items.
Catalogue (id: name):
${catalogList(catalog)}`,
                        prompt: `Note parts:\n- ${unmatched.join('\n- ')}`,
                        temperature: 0.1,
                        providerOptions: generationProviderOptions,
                    });
                    return output.items;
                });
                for (const a of ai.slice(0, G.MAX_ITEMS_PER_NOTE)) {
                    const level = G.isStockLevel(a.level) ? a.level : null;
                    const known = catalog.items.get(a.catalog_id);
                    if (known) {
                        found.push(fromCatalog(known, level, cleanText(a.source, G.MAX_NOTE_LENGTH)));
                        continue;
                    }
                    const en = cleanText(a.name_en, MAX_NAME);
                    if (!en) continue;
                    found.push({
                        itemId: customId(en),
                        en,
                        hi: cleanText(a.name_hi, MAX_NAME),
                        or: cleanText(a.name_or, MAX_NAME),
                        category: isCategory(a.category) ? a.category : 'other',
                        intervalDays: G.clampInterval(a.interval_days),
                        level,
                        isNew: true,
                        source: cleanText(a.source, G.MAX_NOTE_LENGTH),
                    });
                }
            } catch (err) {
                console.error('[grocery] note parsing failed:', err);
                if (found.length === 0) return { ok: false, error: 'ai-unavailable' };
            }
        }
    }

    const unique = new Map<string, NoteItem>();
    found.forEach(item => { if (!unique.has(item.itemId)) unique.set(item.itemId, item); });
    return { ok: true, data: [...unique.values()].slice(0, G.MAX_ITEMS_PER_NOTE) };
}

/** Save the items the cook confirmed from a note: add them and record any level given. */
export async function addNoteItems(user: User, items: unknown, now: Date = new Date()): Promise<GroceryResult> {
    if (!validUser(user) || !Array.isArray(items) || items.length === 0 || items.length > G.MAX_ITEMS_PER_NOTE) {
        return { ok: false, error: 'invalid' };
    }
    const fs = adminFirestore();
    if (!(await canCheckStock(fs, user))) return { ok: false, error: 'forbidden' };
    const [settings, catalog] = await Promise.all([readSettings(fs, user.householdId), loadCatalog(fs)]);
    const today = localTime(now).date;
    const nowMs = now.getTime();

    // Validate everything before writing anything.
    const clean: { rec: PantryRecord; level: G.StockLevel | null }[] = [];
    for (const raw of items) {
        if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid' };
        const r = raw as Record<string, unknown>;
        const level = r.level === null || r.level === undefined ? null : G.isStockLevel(r.level) ? r.level : undefined;
        if (level === undefined || !isSafeDocId(r.itemId)) return { ok: false, error: 'invalid' };
        const known = catalog.items.get(r.itemId);
        if (known) {
            clean.push({ rec: recordFromCatalog(known, today), level });
            continue;
        }
        const en = cleanText(r.en, MAX_NAME);
        if (!r.itemId.startsWith('custom-') || r.itemId !== customId(en) || !isCategory(r.category)) return { ok: false, error: 'invalid' };
        const rec = recordFromCatalog({
            id: r.itemId,
            en,
            hi: cleanText(r.hi, MAX_NAME),
            or: cleanText(r.or, MAX_NAME),
            category: r.category,
            intervalDays: G.clampInterval(Number(r.intervalDays) || 7),
            aliases: [],
        }, today);
        clean.push({ rec, level });
    }

    const refs = clean.map(c => fs.doc(`${pantryPath(user.householdId)}/${c.rec.id}`));
    const emptyNames: string[] = [];
    try {
        await fs.runTransaction(async tx => {
            const snaps = await tx.getAll(...refs);
            snaps.forEach((snap, i) => {
                const { level } = clean[i];
                let rec = snap.exists ? readPantry(clean[i].rec.id, snap.data()!, today) : clean[i].rec;
                let change: G.IntervalChange | null = null;
                if (level) {
                    const applied = G.applyReport(rec.state, level, today, settings.learning);
                    change = applied.change;
                    rec = { ...rec, state: applied.state, levelAtMs: nowMs, reportedByName: actorName(user) || null, lastChange: change ? { ...change, date: today } : rec.lastChange };
                    if (level === 'empty') emptyNames.push(rec.en);
                }
                tx.set(refs[i], { ...toDoc({ ...rec, active: true, virtual: false }, nowMs), ...(snap.exists ? {} : { createdAtMs: nowMs, addedBy: user.uid }) });
                tx.set(refs[i].collection('events').doc(), { type: snap.exists ? 'report' : 'add', level, by: user.uid, at: nowMs, date: today, change });
            });
        });
    } catch (err) {
        console.error('[grocery] addNoteItems failed:', err);
        return { ok: false, error: 'failed' };
    }
    await notifyOutOfStock(fs, user, emptyNames, nowMs);
    return { ok: true };
}

/* ─── Owner: settings and intervals ──────────────────────────────────── */

export async function getGroceryAdminView(user: User, isAppAdmin: boolean, now: Date = new Date()): Promise<GroceryAdminView | null> {
    if (!validUser(user) || user.role !== 'user') return null;
    const fs = adminFirestore();
    const today = localTime(now).date;
    const [settings, pantrySnap, catalog] = await Promise.all([
        readSettings(fs, user.householdId),
        fs.collection(pantryPath(user.householdId)).get(),
        isAppAdmin ? loadCatalog(fs, true) : Promise.resolve(null),
    ]);
    const items = pantrySnap.docs
        .map(d => readPantry(d.id, d.data(), today))
        .map(rec => ({ ...toRow(rec), lastChange: rec.lastChange }))
        .sort(byCategoryThenName);
    const view: GroceryAdminView = { today, settings, items };
    if (catalog) {
        const all = new Map<string, CatalogRow>();
        for (const item of DEFAULT_CATALOG) all.set(item.id, { ...item, overridden: false, hidden: false });
        for (const [id, o] of catalog.overrides) {
            const item = catalog.items.get(id) ?? all.get(id);
            if (item) all.set(id, { ...item, overridden: true, hidden: o.hidden });
        }
        view.catalog = [...all.values()].sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.en.localeCompare(b.en));
    }
    return view;
}

export async function updateGrocerySettings(user: User, input: unknown): Promise<GroceryResult> {
    if (!validUser(user) || user.role !== 'user' || !input || typeof input !== 'object') return { ok: false, error: 'invalid' };
    await adminFirestore().doc(settingsPath(user.householdId)).set({ ...G.cleanSettings(input), updatedAtMs: Date.now() });
    return { ok: true };
}

/** Owner sets an item's interval (pinned), or hands it back to learning (days = null). */
export async function setItemInterval(user: User, itemId: unknown, days: unknown, now: Date = new Date()): Promise<GroceryResult> {
    if (!validUser(user) || user.role !== 'user' || !isSafeDocId(itemId)) return { ok: false, error: 'invalid' };
    if (days !== null && (typeof days !== 'number' || !Number.isFinite(days))) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    const today = localTime(now).date;
    const ref = fs.doc(`${pantryPath(user.householdId)}/${itemId}`);
    try {
        await fs.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw new GroceryNotFound();
            const rec = readPantry(itemId, snap.data()!, today);
            const state = days === null
                ? { ...rec.state, intervalSource: (rec.lastChange ? 'learned' : 'default') as G.IntervalSource }
                : G.applyPinnedInterval(rec.state, days, today);
            tx.set(ref, toDoc({ ...rec, state }, now.getTime()), { merge: true });
            tx.set(ref.collection('events').doc(), { type: days === null ? 'unpin' : 'pin', intervalDays: state.intervalDays, by: user.uid, at: now.getTime(), date: today });
        });
        return { ok: true };
    } catch (err) {
        if (err instanceof GroceryNotFound) return { ok: false, error: 'not-found' };
        console.error('[grocery] setItemInterval failed:', err);
        return { ok: false, error: 'failed' };
    }
}

/* ─── App admin: the default catalogue ───────────────────────────────── */

/** Save (or add) a catalogue item. The caller must already be verified as an app admin. */
export async function saveCatalogItem(input: unknown): Promise<GroceryResult> {
    if (!input || typeof input !== 'object') return { ok: false, error: 'invalid' };
    const r = input as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(id) || !isCategory(r.category)) return { ok: false, error: 'invalid' };
    const item = readCatalogItem(id, { ...r, aliases: Array.isArray(r.aliases) ? r.aliases : [] });
    if (!item) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    await fs.doc(`${CATALOG_COLLECTION}/${id}`).set({ ...item, hidden: false, updatedAtMs: Date.now() });
    catalogCache = null;
    return { ok: true };
}

/** Hide a catalogue item from every household, show it again, or reset a built-in item to its default. */
export async function changeCatalogItem(id: unknown, action: unknown): Promise<GroceryResult> {
    if (!isSafeDocId(id) || (action !== 'hide' && action !== 'show' && action !== 'reset')) return { ok: false, error: 'invalid' };
    const fs = adminFirestore();
    const ref = fs.doc(`${CATALOG_COLLECTION}/${id}`);
    if (action === 'reset') await ref.delete();
    else {
        const builtIn = DEFAULT_CATALOG.find(i => i.id === id);
        const snap = await ref.get();
        if (!snap.exists && !builtIn) return { ok: false, error: 'not-found' };
        await ref.set({ ...(snap.exists ? {} : builtIn), hidden: action === 'hide', updatedAtMs: Date.now() }, { merge: true });
    }
    catalogCache = null;
    return { ok: true };
}
