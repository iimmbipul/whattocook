import type { BasketView, HistoryProduct, MilkbasketSettings, ProductMapping, Reason, RequestStatus } from './logic';

/** One purchase request as the admin panel shows it. Times are ms since epoch. */
export interface PurchaseRequestRow {
    id: string;
    pantryItemId: string;
    /** The pantry item's English name when the request was made. */
    itemName: string;
    milkbasketProductId: number | null;
    productName: string | null;
    size: string;
    /** The product picture on Milkbasket’s CDN, or ''. */
    imageUrl: string;
    quantity: number;
    /** ₹ per unit used (or to be used) for the add. */
    price: number | null;
    status: RequestStatus;
    reason: Reason;
    errorMessage: string | null;
    deliveryDate: string | null;
    createdAt: number;
    updatedAt: number;
    addedAt: number | null;
    decidedBy: string | null;
    decidedByName: string | null;
    decidedAt: number | null;
    /** The level change that started it. */
    trigger: { from: string; to: string } | null;
    attempts: number;
}

export interface MappingRow extends ProductMapping {
    itemName: string;
    itemLevel: string;
    itemActive: boolean;
}

export interface UnmappedItem {
    itemId: string;
    en: string;
    hi: string;
    or: string;
    level: string;
    active: boolean;
    /** Its open "needs mapping" request, if a low report is waiting for this mapping. */
    request: PurchaseRequestRow | null;
}

/** GET /api/milkbasket/admin (owner only). */
export interface MilkbasketAdminView {
    /** This household may use the Milkbasket account (MB_HOUSEHOLD_IDS). Everything else is empty when false. */
    allowed: boolean;
    householdId: string;
    /** Server setup: which environment variables are missing, the API host, and when the login token expires. */
    connection: {
        configured: boolean;
        missing: string[];
        apiHost: string;
        /** A login is saved (encrypted in Firestore), and whether it has a refresh token to renew itself. */
        hasLogin: boolean;
        canRenew: boolean;
        /** When the current login token runs out, and when it was last renewed (ms). */
        authExpiresAt: number | null;
        renewedAt: number | null;
        source: 'env' | 'admin' | 'renewed' | null;
        /** The last renewal problem, cleared by the next success. */
        loginError: { message: string; atMs: number } | null;
    };
    today: string;
    settings: MilkbasketSettings;
    /** AUTO_ADD_PRICE_LIMIT, or 150. */
    defaultPriceLimit: number;
    /** Last Milkbasket problem (unreachable, token refused, not set up), cleared by the next success. */
    problem: { message: string; atMs: number } | null;
    approvals: PurchaseRequestRow[];
    unmapped: UnmappedItem[];
    mappings: MappingRow[];
    activity: PurchaseRequestRow[];
}

export interface OrderHistoryResult {
    products: HistoryProduct[];
    fetchedAtMs: number;
    orderCount: number;
}

export type MilkbasketError =
    | 'auth'
    | 'forbidden'
    | 'not-allowed'
    | 'invalid'
    | 'not-found'
    | 'conflict'
    | 'duplicate'
    | 'price-needed'
    | 'unmapped'
    | 'milkbasket'
    | 'failed';

export type MilkbasketResult<T = undefined> =
    | ({ ok: true } & (T extends undefined ? object : { data: T }))
    | { ok: false; error: MilkbasketError; message?: string };

/** One pantry item's Milkbasket state, for the Groceries list. */
export interface MilkbasketItemState {
    /** The product it orders, or null if it isn't mapped yet. */
    product: { milkbasketProductId: number; productName: string; size: string; price: number | null; defaultQuantity: number; imageUrl: string } | null;
    /** Its open request (waiting, being added), if any. */
    openStatus: RequestStatus | null;
    /** When it was last added to the basket, within the duplicate window. */
    addedAt: number | null;
}

/** GET /api/milkbasket: what owners and members see on the Groceries page. */
export interface MilkbasketHouseholdView {
    /** This household can use Milkbasket and the server is set up. Nothing else is filled when false. */
    available: boolean;
    today: string;
    /** The date new adds are for (tomorrow by default). */
    deliveryDate: string;
    priceLimit: number;
    approvals: PurchaseRequestRow[];
    /** By pantry item id: mapped items and items with an open or recent request. */
    items: Record<string, MilkbasketItemState>;
}

/** GET /api/milkbasket/basket */
export interface BasketResult {
    basket: BasketView | null;
    fetchedAtMs: number;
}
