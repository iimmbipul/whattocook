'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Package, RefreshCw, Search } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, TextInput } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { groceryDayLabel, markedAt } from '@/lib/grocery/client';
import { approveMilkbasketRequest, loadMilkbasketOrderHistory, rejectMilkbasketRequest, searchMilkbasketProducts } from '@/lib/milkbasket/actions';
import { MAX_QUANTITY, searchHistory, type HistoryProduct, type RequestStatus, type SearchProduct, type SearchResult } from '@/lib/milkbasket/logic';
import type { OrderHistoryResult, PurchaseRequestRow } from '@/lib/milkbasket/types';

/* Pieces shared by Admin → Milkbasket and the Groceries page. */

export type T = (key: string, vars?: Record<string, string | number>) => string;
export type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

export const rupees = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function errorText(result: { ok: false; error: string; message?: string }, t: T): string {
    if (result.message && (result.error === 'milkbasket' || result.error === 'duplicate')) return result.message;
    return t(`milkbasket.errors.${result.error}`);
}

export const STATUS_TONE: Record<RequestStatus, BadgeTone> = {
    needs_mapping: 'warning',
    pending_approval: 'warning',
    queued: 'accent',
    adding: 'accent',
    added: 'success',
    failed: 'danger',
    rejected: 'neutral',
    cancelled: 'neutral',
};

export type Done = (notice: Notice) => Promise<void>;

/** A product picked from search or recent orders. */
export interface PickedProduct {
    productId: number;
    name: string;
    size: string;
    price: number | null;
    imageUrl: string;
}

/** A Milkbasket product picture (from its CDN), or a placeholder when there is none or it fails. */
export function ProductImage({ url, alt, size = 44, className }: { url: string | null | undefined; alt: string; size?: number; className?: string }) {
    const [failed, setFailed] = useState<string | null>(null);
    const usable = !!url && failed !== url;
    return (
        <span
            className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white text-ink-subtle', className)}
            style={{ width: size, height: size }}
        >
            {usable ? (
                // Milkbasket's CDN serves sized images already, so a plain <img> rather than next/image's proxy.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url!} alt={alt} width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url!)} className="h-full w-full object-contain" />
            ) : (
                <Package size={Math.round(size * 0.45)} aria-hidden="true" />
            )}
        </span>
    );
}

export function LevelChange({ req }: { req: PurchaseRequestRow }) {
    const { t } = useLocale();
    if (!req.trigger) return null;
    return (
        <span>
            {t('milkbasket.level', { from: t(`grocery.level.${req.trigger.from || 'unknown'}`), to: t(`grocery.level.${req.trigger.to || 'unknown'}`) })}
        </span>
    );
}

/** One request waiting for approval: change the quantity (and the price if none is known), then Approve or Reject. */
export function ApprovalRow({ req, priceLimit, today, onDone }: { req: PurchaseRequestRow; priceLimit: number; today: string; onDone: Done }) {
    const { t, locale } = useLocale();
    const [qty, setQty] = useState(String(req.quantity));
    const [price, setPrice] = useState('');
    const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
    const quantity = Number(qty);
    const qtyValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY;
    const unitPrice = req.price ?? (price.trim() ? Number(price) : NaN);
    const priceValid = Number.isFinite(unitPrice) && unitPrice > 0;

    const approve = async () => {
        setBusy('approve');
        const result = await approveMilkbasketRequest(req.id, quantity, req.price === null ? unitPrice : null).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setBusy(null);
        if (!result.ok) return onDone({ tone: 'error', text: errorText(result, t) });
        const row = result.data;
        if (row.status === 'added') {
            return onDone({ tone: 'success', text: t('milkbasket.approvals.added', { date: groceryDayLabel(row.deliveryDate ?? today, today, t, locale), item: row.itemName }) });
        }
        if (row.status === 'failed') return onDone({ tone: 'error', text: t('milkbasket.approvals.failed', { item: row.itemName, message: row.errorMessage ?? '' }) });
        return onDone({ tone: 'info', text: t('milkbasket.approvals.queued') });
    };

    const reject = async () => {
        setBusy('reject');
        const result = await rejectMilkbasketRequest(req.id).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setBusy(null);
        await onDone(result.ok ? { tone: 'info', text: t('milkbasket.approvals.rejected') } : { tone: 'error', text: errorText(result, t) });
    };

    return (
        <li className="p-3">
            <div className="flex items-start gap-3">
                <ProductImage url={req.imageUrl} alt={req.productName ?? req.itemName} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="font-semibold text-ink">{req.itemName}</p>
                            <p className="text-sm text-ink-muted">
                                {req.productName}{req.size && ` · ${req.size}`}
                                {req.milkbasketProductId !== null && <span className="text-ink-subtle"> · #{req.milkbasketProductId}</span>}
                            </p>
                            <p className="text-xs text-ink-muted">
                                {t(`milkbasket.reason.${req.reason}`, { price: req.price !== null ? rupees(req.price) : '', limit: rupees(priceLimit) })}
                                {' · '}<LevelChange req={req} />{' · '}{markedAt(req.createdAt, t, locale)}
                            </p>
                        </div>
                        {priceValid && qtyValid && (
                            <p className="text-sm font-semibold text-ink">{t('milkbasket.approvals.total', { total: rupees(Math.round(unitPrice * quantity * 100) / 100) })}</p>
                        )}
                    </div>
                </div>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex items-center gap-2 text-sm text-ink">
                    {t('milkbasket.approvals.quantity')}
                    <TextInput type="number" min={1} max={MAX_QUANTITY} inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} className="h-9 w-20" />
                </label>
                {req.price === null ? (
                    <label className="flex items-center gap-2 text-sm text-ink">
                        {t('milkbasket.approvals.price')}
                        <TextInput type="number" min={0} step="0.01" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} className="h-9 w-24" />
                    </label>
                ) : (
                    <span className="pb-2 text-sm text-ink-muted">× ₹{rupees(req.price)}</span>
                )}
                <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="ghost" loading={busy === 'reject'} disabled={busy !== null} onClick={reject}>{t('milkbasket.approvals.reject')}</Button>
                    <Button size="sm" loading={busy === 'approve'} disabled={busy !== null || !qtyValid || !priceValid} onClick={approve}>{t('milkbasket.approvals.approve')}</Button>
                </div>
            </div>
        </li>
    );
}

/** A row in a product list: picture, name, size and details, price (with MRP struck through when higher). */
function ProductOption({
    product,
    details,
    mrp,
    picked,
    disabled,
    badge,
    onPick,
}: {
    product: PickedProduct;
    details: string;
    mrp?: number | null;
    picked: boolean;
    disabled?: boolean;
    badge?: string;
    onPick: () => void;
}) {
    return (
        <li>
            <button
                type="button"
                onClick={onPick}
                disabled={disabled}
                aria-pressed={picked}
                className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60',
                    picked && 'bg-accent-soft',
                )}
            >
                <ProductImage url={product.imageUrl} alt={product.name} size={40} />
                <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{product.name}</span>
                    <span className="block text-xs text-ink-muted">{details}</span>
                    {badge && <Badge tone="danger" className="mt-1 h-5 text-[11px]">{badge}</Badge>}
                </span>
                {product.price !== null && (
                    <span className="shrink-0 text-right">
                        <span className="block font-semibold text-ink">₹{rupees(product.price)}</span>
                        {mrp != null && mrp > product.price && <span className="block text-xs text-ink-subtle line-through">₹{rupees(mrp)}</span>}
                    </span>
                )}
            </button>
        </li>
    );
}

/** Search Milkbasket's products by name (today's price and stock); out-of-stock products can't be picked. */
export function MilkbasketSearch({ initialQuery = '', onPick }: { initialQuery?: string; onPick: (p: PickedProduct) => void }) {
    const { t } = useLocale();
    const [query, setQuery] = useState(initialQuery);
    const [result, setResult] = useState<SearchResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [picked, setPicked] = useState<number | null>(null);
    const started = useRef(false);

    const run = async (text: string) => {
        if (text.trim().length < 2) return;
        setLoading(true);
        setError('');
        const res = await searchMilkbasketProducts(text).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setLoading(false);
        if (res.ok) setResult(res.data);
        else setError(t('milkbasket.pick.failed', { message: errorText(res, t) }));
    };

    // Search once for the item's own name when the picker opens.
    useEffect(() => {
        if (started.current || initialQuery.trim().length < 2) return;
        started.current = true;
        void run(initialQuery);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialQuery]);

    const describe = (p: SearchProduct) => [p.size, p.category, `#${p.productId}`].filter(Boolean).join(' · ');

    return (
        <div className="space-y-2">
            <form
                className="flex gap-2"
                onSubmit={e => {
                    e.preventDefault();
                    void run(query);
                }}
            >
                <TextInput value={query} onChange={e => setQuery(e.target.value)} placeholder={t('milkbasket.pick.placeholder')} aria-label={t('milkbasket.pick.placeholder')} className="flex-1" />
                <Button type="submit" variant="secondary" loading={loading} leadingIcon={<Search size={15} aria-hidden="true" />} disabled={query.trim().length < 2}>{t('milkbasket.pick.go')}</Button>
            </form>
            {error && <Alert tone="error">{error}</Alert>}
            {result && (result.products.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('milkbasket.pick.none')}</p>
            ) : (
                <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                    {result.products.map(p => (
                        <ProductOption
                            key={p.productId}
                            product={p}
                            details={describe(p)}
                            mrp={p.mrp}
                            picked={picked === p.productId}
                            disabled={!p.available}
                            badge={p.available ? undefined : t('milkbasket.pick.oos')}
                            onPick={() => {
                                setPicked(p.productId);
                                onPick(p);
                            }}
                        />
                    ))}
                </ul>
            ))}
        </div>
    );
}

/** Products from recent Milkbasket orders, searchable; picking one calls onPick. */
export function OrderHistoryPicker({ onPick, bare = false }: { onPick: (p: HistoryProduct) => void; bare?: boolean }) {
    const { t, locale } = useLocale();
    const [history, setHistory] = useState<OrderHistoryResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState<number | null>(null);

    const load = async (refresh: boolean) => {
        setLoading(true);
        setError('');
        const result = await loadMilkbasketOrderHistory(refresh).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setLoading(false);
        if (result.ok) setHistory(result.data);
        else setError(t('milkbasket.form.historyFailed', { message: errorText(result, t) }));
    };

    const shown = useMemo(() => (history ? searchHistory(history.products, query).slice(0, 60) : []), [history, query]);

    return (
        <div className={bare ? 'space-y-2' : 'rounded-xl border border-line p-3'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                {!bare && <p className="flex items-center gap-2 text-sm font-semibold text-ink"><History size={16} aria-hidden="true" />{t('milkbasket.form.fromHistory')}</p>}
                {history ? (
                    <Button size="sm" variant="ghost" loading={loading} leadingIcon={<RefreshCw size={14} aria-hidden="true" />} onClick={() => load(true)}>{t('milkbasket.form.refresh')}</Button>
                ) : (
                    <Button size="sm" variant="secondary" loading={loading} onClick={() => load(false)}>{t('milkbasket.form.loadHistory')}</Button>
                )}
            </div>
            {error && <Alert tone="error" className="mt-2">{error}</Alert>}
            {history && (
                <div className="mt-2 space-y-2">
                    <p className="text-xs text-ink-muted">{t('milkbasket.form.fetched', { count: history.products.length, orders: history.orderCount, when: markedAt(history.fetchedAtMs, t, locale) })}</p>
                    <TextInput value={query} onChange={e => setQuery(e.target.value)} placeholder={t('milkbasket.form.search')} aria-label={t('milkbasket.form.search')} />
                    {shown.length === 0 ? (
                        <p className="text-sm text-ink-muted">{t('milkbasket.form.historyEmpty')}</p>
                    ) : (
                        <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                            {shown.map(p => (
                                <ProductOption
                                    key={p.productId}
                                    product={{ ...p, imageUrl: p.imageUrl ?? '' }}
                                    details={[p.size, `#${p.productId}`, p.lastOrdered && t('milkbasket.form.lastOrdered', { date: p.lastOrdered })].filter(Boolean).join(' · ')}
                                    picked={picked === p.productId}
                                    onPick={() => {
                                        setPicked(p.productId);
                                        onPick(p);
                                    }}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

/** Pick a Milkbasket product: search Milkbasket (default) or choose from recent orders. */
export function ProductPicker({ initialQuery, onPick }: { initialQuery?: string; onPick: (p: PickedProduct) => void }) {
    const { t } = useLocale();
    const [source, setSource] = useState<'search' | 'orders'>('search');
    return (
        <div className="space-y-3 rounded-xl border border-line p-3">
            <Segmented<'search' | 'orders'>
                label={t('milkbasket.pick.label')}
                value={source}
                onChange={setSource}
                size="sm"
                options={[
                    { value: 'search', label: t('milkbasket.pick.search') },
                    { value: 'orders', label: t('milkbasket.pick.orders') },
                ]}
            />
            {source === 'search'
                ? <MilkbasketSearch initialQuery={initialQuery} onPick={onPick} />
                : <OrderHistoryPicker bare onPick={p => onPick({ ...p, imageUrl: p.imageUrl ?? '' })} />}
        </div>
    );
}
