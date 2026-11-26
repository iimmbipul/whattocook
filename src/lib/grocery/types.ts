import type { Category } from './catalog';
import type { GrocerySettings, IntervalSource, ItemLevel, StockLevel } from './logic';

/** One grocery item as the screens show it. Dates are household-local YYYY-MM-DD. */
export interface GroceryRow {
    itemId: string;
    en: string;
    hi: string;
    or: string;
    category: Category;
    level: ItemLevel;
    /** When the level was last reported (ms), and by whom. */
    levelAtMs: number | null;
    reportedByName: string | null;
    /** Role of whoever reported it, so the cook's reports can be told apart. */
    reportedByRole: 'user' | 'member' | 'cook' | null;
    /** Earliest menu date in the look-ahead that needs it, and those dishes. */
    neededOn: string | null;
    dishes: string[];
    intervalDays: number;
    intervalSource: IntervalSource;
    nextCheckDate: string;
    lastCheckedDate: string | null;
    active: boolean;
    /** Not in the household pantry yet (only known from the menu). */
    virtual: boolean;
}

/** GET /api/grocery */
export interface GroceryView {
    today: string;
    /** The cook, or the owner of a household with no hired cook. */
    canCheck: boolean;
    settings: GrocerySettings;
    /** Today's stock check still to do (only when canCheck). The list is fixed once per day. */
    checks: GroceryRow[];
    /** Shopping list: Empty, then Quarter, then Half. */
    list: GroceryRow[];
    /** Every item the household has (tracked first), for the Inventory tab and the Pantry page. */
    pantry: GroceryRow[];
    /** Catalogue items for the search box (with spellings), so anything common can be found and marked. */
    catalog: CatalogEntry[];
    /** Most recent stock check in the household, if any. */
    lastCheckDate: string | null;
}

export interface CatalogEntry {
    id: string;
    en: string;
    hi: string;
    or: string;
    category: Category;
    aliases: string[];
}

/** What a member marked or added, to confirm on screen. */
export interface MarkedItem {
    itemId: string;
    en: string;
    hi: string;
    or: string;
    /** It was not in the household yet: added now. */
    isNew: boolean;
}

export interface IntervalChangeInfo {
    from: number;
    to: number;
    observedDays: number;
    date: string;
}

/** GET /api/grocery/admin: the owner's settings page. */
export interface GroceryAdminView {
    today: string;
    settings: GrocerySettings;
    items: (GroceryRow & { lastChange: IntervalChangeInfo | null })[];
    /** Present only for the app admin. */
    catalog?: CatalogRow[];
}

export interface CatalogRow {
    id: string;
    en: string;
    hi: string;
    or: string;
    category: Category;
    intervalDays: number;
    aliases: string[];
    /** Edited in Firestore (otherwise a built-in default). */
    overridden: boolean;
    hidden: boolean;
}

/** One item understood from the cook's typed note, shown for confirmation. */
export interface NoteItem {
    /** Catalogue id, or a new custom id. */
    itemId: string;
    en: string;
    hi: string;
    or: string;
    category: Category;
    intervalDays: number;
    level: StockLevel | null;
    isNew: boolean;
    /** The words it came from. */
    source: string;
}

export type GroceryError = 'auth' | 'forbidden' | 'invalid' | 'not-found' | 'ai-unavailable' | 'failed';
export type GroceryResult<T = undefined> = ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: GroceryError };
