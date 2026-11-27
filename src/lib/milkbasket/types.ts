import type { HistoryProduct, MilkbasketSettings, ProductMapping, Reason, RequestStatus } from './logic';

/** One purchase request as the admin panel shows it. Times are ms since epoch. */
export interface PurchaseRequestRow {
    id: string;
    pantryItemId: string;
    /** The pantry item's English name when the request was made. */
    itemName: string;
    milkbasketProductId: number | null;
    productName: string | null;
    size: string;
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
        tokenExpiresAt: number | null;
        /** 'expiring' = within 3 days; 'unknown' when the token isn't a JWT with an expiry. */
        tokenStatus: 'ok' | 'expiring' | 'expired' | 'unknown';
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
