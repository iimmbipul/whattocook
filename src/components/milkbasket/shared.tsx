'use client';

import { useMemo, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, TextInput } from '@/components/ui/Field';
import { groceryDayLabel, markedAt } from '@/lib/grocery/client';
import { approveMilkbasketRequest, loadMilkbasketOrderHistory, rejectMilkbasketRequest } from '@/lib/milkbasket/actions';
import { MAX_QUANTITY, searchHistory, type HistoryProduct, type RequestStatus } from '@/lib/milkbasket/logic';
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

/** Products from recent Milkbasket orders, searchable; picking one calls onPick. */
export function OrderHistoryPicker({ onPick }: { onPick: (p: HistoryProduct) => void }) {
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
        <div className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink"><History size={16} aria-hidden="true" />{t('milkbasket.form.fromHistory')}</p>
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
                                <li key={p.productId}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPicked(p.productId);
                                            onPick(p);
                                        }}
                                        aria-pressed={picked === p.productId}
                                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted ${picked === p.productId ? 'bg-accent-soft' : ''}`}
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-medium text-ink">{p.name}</span>
                                            <span className="block text-xs text-ink-muted">
                                                {[p.size, `#${p.productId}`, p.lastOrdered && t('milkbasket.form.lastOrdered', { date: p.lastOrdered })].filter(Boolean).join(' · ')}
                                            </span>
                                        </span>
                                        {p.price !== null && <span className="shrink-0 font-semibold text-ink">₹{rupees(p.price)}</span>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
