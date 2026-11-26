/**
 * Grocery rules shared by the server and the browser: stock levels, when an
 * item is checked next, how its interval learns, the cook's daily list, and
 * matching typed words to catalogue items.
 *
 * Pure functions with no imports, so they can be unit-tested directly with
 * `node --test` (tests/grocery.test.mjs). Firestore access lives in
 * src/lib/server/grocery.ts.
 */

export type StockLevel = 'full' | 'half' | 'quarter' | 'empty';
export type ItemLevel = StockLevel | 'unknown';
export const STOCK_LEVELS: readonly StockLevel[] = ['full', 'half', 'quarter', 'empty'];

export function isStockLevel(value: unknown): value is StockLevel {
    return value === 'full' || value === 'half' || value === 'quarter' || value === 'empty';
}

/** Lower = more urgent. Unknown sits between Half and Full. */
export const LEVEL_RANK: Record<ItemLevel, number> = { empty: 0, quarter: 1, half: 2, unknown: 3, full: 4 };

/** Levels members see on the shopping list, most urgent first. */
export const LIST_LEVELS: readonly StockLevel[] = ['empty', 'quarter', 'half'];

export type IntervalSource = 'default' | 'learned' | 'pinned';

export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 30;

export interface GrocerySettings {
    /** How many days of menu (today included) to look at. */
    lookAheadDays: number;
    /** Most items the cook is asked about in one day. */
    dailyCheckCap: number;
    /** Whether intervals adjust themselves from run-outs. */
    learning: boolean;
}

export const DEFAULT_SETTINGS: GrocerySettings = { lookAheadDays: 3, dailyCheckCap: 8, learning: true };

export function cleanSettings(value: unknown): GrocerySettings {
    const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const int = (x: unknown, min: number, max: number, fallback: number) =>
        typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : fallback;
    return {
        lookAheadDays: int(v.lookAheadDays, 1, 7, DEFAULT_SETTINGS.lookAheadDays),
        dailyCheckCap: int(v.dailyCheckCap, 3, 20, DEFAULT_SETTINGS.dailyCheckCap),
        learning: typeof v.learning === 'boolean' ? v.learning : DEFAULT_SETTINGS.learning,
    };
}

export function clampInterval(days: number): number {
    if (!Number.isFinite(days)) return MIN_INTERVAL_DAYS;
    return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, Math.round(days)));
}

/** Calendar arithmetic on YYYY-MM-DD strings (no time zone involved). */
export function addDays(date: string, days: number): string {
    const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
    return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Learning rule: an item that ran low sooner than its interval gets that
 * shorter interval straight away (running out is worse than one extra
 * question); one that lasted longer moves halfway towards what was observed,
 * so a single slow week doesn't stretch it too far.
 */
export function learnInterval(current: number, observedDays: number): number {
    const observed = clampInterval(observedDays);
    if (observed < current) return observed;
    if (observed > current) return clampInterval(Math.ceil((current + observed) / 2));
    return current;
}

/** What the server keeps per household item. Dates are household-local YYYY-MM-DD. */
export interface PantryState {
    level: ItemLevel;
    intervalDays: number;
    intervalSource: IntervalSource;
    /** Start of the current cycle: last Bought / Groceries arrived / Full after being low. */
    lastRestockDate: string | null;
    lastCheckedDate: string | null;
    nextCheckDate: string;
    /** The first low report of a cycle teaches the interval; later ones in the same cycle don't. */
    lowReportedThisCycle: boolean;
}

export function newPantryState(intervalDays: number, today: string): PantryState {
    const interval = clampInterval(intervalDays);
    return {
        level: 'unknown',
        intervalDays: interval,
        intervalSource: 'default',
        lastRestockDate: null,
        lastCheckedDate: null,
        nextCheckDate: today,
        lowReportedThisCycle: false,
    };
}

export interface IntervalChange {
    from: number;
    to: number;
    observedDays: number;
}

/** Apply the cook's report of a level (scheduled check or reported on their own). */
export function applyReport(
    state: PantryState,
    level: StockLevel,
    today: string,
    learning: boolean = true,
): { state: PantryState; change: IntervalChange | null } {
    const next: PantryState = { ...state, level, lastCheckedDate: today };
    let change: IntervalChange | null = null;

    if (level === 'full') {
        // Full after being low means it was restocked; it starts a new cycle.
        const wasLow = state.level === 'half' || state.level === 'quarter' || state.level === 'empty';
        if (wasLow || !state.lastRestockDate) {
            next.lastRestockDate = today;
            next.lowReportedThisCycle = false;
        }
        next.nextCheckDate = addDays(today, state.intervalDays);
    } else if (level === 'half') {
        next.nextCheckDate = addDays(today, Math.max(1, Math.ceil(state.intervalDays / 2)));
    } else {
        // Quarter or Empty: the item ran low. Learn once per cycle.
        if (learning && state.intervalSource !== 'pinned' && state.lastRestockDate && !state.lowReportedThisCycle) {
            const observed = Math.max(1, daysBetween(state.lastRestockDate, today));
            const to = learnInterval(state.intervalDays, observed);
            if (to !== state.intervalDays) {
                change = { from: state.intervalDays, to, observedDays: observed };
                next.intervalDays = to;
                next.intervalSource = 'learned';
            }
        }
        next.lowReportedThisCycle = true;
        // Empty waits on the shopping list; Quarter is looked at again soon.
        next.nextCheckDate = addDays(today, level === 'quarter' ? Math.max(1, Math.ceil(next.intervalDays / 4)) : next.intervalDays);
    }
    return { state: next, change };
}

/** Bought (members) or Groceries arrived (cook): full, and a new cycle starts. */
export function applyRestock(state: PantryState, today: string): PantryState {
    return {
        ...state,
        level: 'full',
        lastRestockDate: today,
        lastCheckedDate: today,
        nextCheckDate: addDays(today, state.intervalDays),
        lowReportedThisCycle: false,
    };
}

/** Owner sets an interval in Admin: it is pinned and never changes by itself. */
export function applyPinnedInterval(state: PantryState, days: number, today: string): PantryState {
    const interval = clampInterval(days);
    const base = state.lastCheckedDate ?? today;
    const nextCheck = addDays(base, interval);
    return { ...state, intervalDays: interval, intervalSource: 'pinned', nextCheckDate: nextCheck < today ? today : nextCheck };
}

export interface CheckCandidate {
    itemId: string;
    active: boolean;
    level: ItemLevel;
    nextCheckDate: string;
    lastCheckedDate: string | null;
    /** Earliest date within the look-ahead when a planned dish uses it. */
    neededOn: string | null;
    /** Shorter intervals run out faster, so they are asked first among equals. */
    intervalDays: number;
}

/**
 * The cook's list for today, most urgent first, at most `cap` items:
 * - due by interval (next check today or earlier), or
 * - needed by the menu soon while its level is unknown or below Full.
 * Items already checked today, and Empty items waiting to be bought, are skipped.
 * Order: needed soonest, lowest level, fastest-running (shortest interval), most overdue.
 */
export function dailyChecks(candidates: CheckCandidate[], today: string, cap: number): string[] {
    const picked = candidates.filter(c => {
        if (!c.active || c.lastCheckedDate === today || c.level === 'empty') return false;
        const due = c.nextCheckDate <= today;
        const neededAndUnsure = c.neededOn !== null && c.level !== 'full';
        return due || neededAndUnsure;
    });
    picked.sort((a, b) =>
        (a.neededOn ?? '9999-12-31').localeCompare(b.neededOn ?? '9999-12-31')
        || LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
        || a.intervalDays - b.intervalDays
        || a.nextCheckDate.localeCompare(b.nextCheckDate)
        || a.itemId.localeCompare(b.itemId),
    );
    return picked.slice(0, Math.max(0, cap)).map(c => c.itemId);
}

/* ─── Matching typed words to catalogue items ─────────────────────────── */

/** Lowercase, NFKC, punctuation to spaces; keeps Devanagari and Odia letters and marks. */
export function normalizeTerm(text: string): string {
    return text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export interface CatalogTerms {
    id: string;
    names: string[];
}

/** term → item id, longest terms first so "green chilli" wins over "chilli". */
export function buildTermIndex(items: CatalogTerms[]): { term: string; id: string }[] {
    const seen = new Set<string>();
    const out: { term: string; id: string }[] = [];
    for (const item of items) {
        for (const name of item.names) {
            const term = normalizeTerm(name);
            if (!term || seen.has(term)) continue;
            seen.add(term);
            out.push({ term, id: item.id });
        }
    }
    return out.sort((a, b) => b.term.length - a.term.length);
}

/** Find the catalogue item a phrase mentions, as a whole word or words. */
export function matchItem(index: { term: string; id: string }[], phrase: string): string | null {
    const text = ` ${normalizeTerm(phrase)} `;
    if (text.trim() === '') return null;
    for (const { term, id } of index) {
        if (text.includes(` ${term} `)) return id;
        // Simple English plurals: "onions", "tomatoes".
        if (text.includes(` ${term}s `) || text.includes(` ${term}es `)) return id;
    }
    return null;
}

const LEVEL_WORDS: { level: StockLevel; words: string[] }[] = [
    { level: 'empty', words: ['khatam', 'khatm', 'khtm', 'finished', 'empty', 'over', 'nahi hai', 'nahin hai', 'nhi hai', 'khali', 'out', 'out of stock', 'nil', 'zero', 'खत्म', 'ख़त्म', 'खतम', 'खाली', 'नहीं है', 'ସରିଗଲା', 'ସରିଛି', 'ନାହିଁ', 'ଖାଲି'] },
    { level: 'quarter', words: ['thoda', 'thora', 'kam', 'low', 'quarter', 'little', 'bas thoda', 'थोड़ा', 'थोडा', 'कम', 'ଅଳ୍ପ', 'ଟିକେ', 'କମ୍'] },
    { level: 'half', words: ['aadha', 'adha', 'aada', 'half', 'आधा', 'ଅଧା'] },
    { level: 'full', words: ['full', 'bhara', 'bhra', 'pura', 'poora', 'plenty', 'enough', 'भरा', 'पूरा', 'ଭର୍ତ୍ତି', 'ପୂରା'] },
];

/** The stock level a note mentions ("pyaz khatam" → empty), or null. Longest phrase wins. */
export function parseLevelWords(phrase: string): StockLevel | null {
    const text = ` ${normalizeTerm(phrase)} `;
    let best: { level: StockLevel; length: number } | null = null;
    for (const { level, words } of LEVEL_WORDS) {
        for (const word of words) {
            const w = normalizeTerm(word);
            if (w && text.includes(` ${w} `) && (!best || w.length > best.length)) best = { level, length: w.length };
        }
    }
    return best?.level ?? null;
}

/** Split a note into parts: commas, new lines, "and", "aur", "&", "+", "।". */
export function splitNote(text: string): string[] {
    return text
        .split(/[,\n;।+&]|\s(?:and|aur|or|और|ଏବଂ|ଓ)\s/giu)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 5);
}

export const MAX_NOTE_LENGTH = 120;
export const MAX_ITEMS_PER_NOTE = 5;

/* ─── Members: Out of stock / Full, and searching items by name ───────── */

/** The two statuses any household member can set. */
export type MemberLevel = 'empty' | 'full';

export function isMemberLevel(value: unknown): value is MemberLevel {
    return value === 'empty' || value === 'full';
}

export interface NamedItem {
    id: string;
    /** English, Hindi and Odia names plus other spellings. */
    names: string[];
}

/**
 * How well a typed query matches an item's names: 100 exact, 95 exact once a
 * plural ending is dropped, 80 name starts with it, 60 a word starts with it,
 * 40 contains it (3+ letters). 0 = no match.
 */
export function matchScore(names: string[], query: string): number {
    const q = normalizeTerm(query);
    if (!q) return 0;
    const singular = q.replace(/(es|s)$/u, '');
    const variants = singular && singular !== q ? [q, singular] : [q];
    let best = 0;
    for (const name of names) {
        const n = normalizeTerm(name);
        if (!n) continue;
        for (const v of variants) {
            if (n === v) best = Math.max(best, v === q ? 100 : 95);
            else if (n.startsWith(v)) best = Math.max(best, 80);
            else if (` ${n}`.includes(` ${v}`)) best = Math.max(best, 60);
            else if (v.length >= 3 && n.includes(v)) best = Math.max(best, 40);
        }
    }
    return best;
}

/** Items matching a typed query, best first (ties by first name). */
export function searchItems<T extends NamedItem>(items: T[], query: string, limit = 8): T[] {
    return items
        .map(item => ({ item, score: matchScore(item.names, query) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || (a.item.names[0] ?? '').localeCompare(b.item.names[0] ?? ''))
        .slice(0, Math.max(0, limit))
        .map(x => x.item);
}

/** The item a typed name means exactly (same name, spelling or its plural), so a new one isn't added twice. */
export function exactItem<T extends NamedItem>(items: T[], name: string): T | null {
    let best: T | null = null;
    let bestScore = 0;
    for (const item of items) {
        const s = matchScore(item.names, name);
        if (s >= 95 && s > bestScore) {
            best = item;
            bestScore = s;
        }
    }
    return best;
}

/**
 * The cook's list is fixed once a day (so the daily limit holds and the list
 * ends); what is still pending is the listed items that are tracked and have
 * not been checked today by anyone.
 */
export function pendingChecks(
    listed: string[],
    items: Map<string, { active: boolean; lastCheckedDate: string | null }>,
    today: string,
): string[] {
    return listed.filter(id => {
        const item = items.get(id);
        return !!item && item.active && item.lastCheckedDate !== today;
    });
}
