'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShoppingCart } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Card, EmptyState } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Alert, Field, TextInput } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Spinner';
import { groceryDayLabel, itemName, markedAt, refreshGroceryView, subscribeGroceryView } from '@/lib/grocery/client';
import type { GroceryRow } from '@/lib/grocery/types';
import { addToMilkbasket, linkMilkbasketProduct } from '@/lib/milkbasket/actions';
import { MAX_QUANTITY } from '@/lib/milkbasket/logic';
import type { BasketResult, MilkbasketHouseholdView, MilkbasketItemState, PurchaseRequestRow } from '@/lib/milkbasket/types';
import { ApprovalRow, ProductImage, ProductPicker, errorText, rupees, type Notice, type PickedProduct } from './shared';

/*
 * Milkbasket on the Groceries page, for the owner and members (not the cook):
 * approve what waits for an OK, add any listed item to the basket by hand,
 * and see what is in the Milkbasket basket.
 */

export interface MilkbasketState {
    view: MilkbasketHouseholdView | null;
    notice: Notice;
    setNotice: (notice: Notice) => void;
    reload: () => Promise<void>;
}

async function loadView(): Promise<MilkbasketHouseholdView | null> {
    try {
        const res = await fetch('/api/milkbasket', { credentials: 'same-origin', cache: 'no-store' });
        return res.ok ? ((await res.json()) as MilkbasketHouseholdView) : null;
    } catch {
        return null;
    }
}

/** The household's Milkbasket view; `enabled` is false for the cook (nothing is loaded). */
export function useMilkbasket(enabled: boolean): MilkbasketState {
    const [view, setView] = useState<MilkbasketHouseholdView | null>(null);
    const [notice, setNotice] = useState<Notice>(null);
    const reload = useCallback(async () => {
        if (enabled) setView(await loadView());
    }, [enabled]);
    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const load = () => loadView().then(v => {
            if (alive) setView(v);
        });
        load();
        // Marking an item can open or cancel a Milkbasket request a moment later (it runs
        // after the response), so look again shortly after every grocery change.
        const unsubscribe = subscribeGroceryView(() => {
            timers.push(setTimeout(load, 1500), setTimeout(load, 4000));
        });
        return () => {
            alive = false;
            unsubscribe();
            timers.forEach(clearTimeout);
        };
    }, [enabled]);
    return { view, notice, setNotice, reload };
}

/** After an add: the item is marked bought, so the shopping list and the Milkbasket state both change. */
async function refreshAll(mb: MilkbasketState, uid: string) {
    await Promise.all([mb.reload(), refreshGroceryView(uid)]);
}

function resultNotice(row: PurchaseRequestRow, today: string, t: ReturnType<typeof useLocale>['t'], locale: string): Notice {
    if (row.status === 'added') {
        return { tone: 'success', text: t('milkbasket.member.added', { item: row.itemName, day: groceryDayLabel(row.deliveryDate ?? today, today, t, locale) }) };
    }
    if (row.status === 'failed') return { tone: 'error', text: t('milkbasket.member.failed', { item: row.itemName, message: row.errorMessage ?? '' }) };
    return { tone: 'info', text: t('milkbasket.member.queued', { item: row.itemName }) };
}

/* ─── Waiting for an OK ──────────────────────────────────────────────── */

export function MilkbasketApprovals({ mb, uid }: { mb: MilkbasketState; uid: string }) {
    const { t } = useLocale();
    const view = mb.view;
    if (!view?.available || view.approvals.length === 0) return null;
    return (
        <Card className="mb-4 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <ShoppingCart size={16} aria-hidden="true" className="text-accent-strong" />
                {t('milkbasket.member.approvalsTitle', { count: view.approvals.length })}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">{t('milkbasket.member.approvalsIntro', { limit: rupees(view.priceLimit) })}</p>
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {view.approvals.map(req => (
                    <ApprovalRow
                        key={req.id}
                        req={req}
                        priceLimit={view.priceLimit}
                        today={view.today}
                        onDone={async notice => {
                            mb.setNotice(notice);
                            await refreshAll(mb, uid);
                        }}
                    />
                ))}
            </ul>
        </Card>
    );
}

/* ─── On each shopping-list row ──────────────────────────────────────── */

/** "In the Milkbasket basket", "Adding…" or "Waiting for an OK", under the item's name. */
export function MilkbasketRowStatus({ row, mb }: { row: GroceryRow; mb: MilkbasketState }) {
    const { t, locale } = useLocale();
    const state = mb.view?.available ? mb.view.items[row.itemId] : undefined;
    if (!state) return null;
    if (state.addedAt) return <Badge tone="success" className="mt-1">{t('milkbasket.member.inBasket', { when: markedAt(state.addedAt, t, locale) })}</Badge>;
    if (state.openStatus === 'queued' || state.openStatus === 'adding') return <Badge tone="accent" className="mt-1">{t('milkbasket.member.adding')}</Badge>;
    if (state.openStatus === 'pending_approval') return <Badge tone="warning" className="mt-1">{t('milkbasket.member.waiting')}</Badge>;
    return null;
}

/** The cart button that opens "Add to Milkbasket" (hidden once the item is in the basket or being added). */
export function MilkbasketRowButton({ row, mb, uid }: { row: GroceryRow; mb: MilkbasketState; uid: string }) {
    const { t, locale } = useLocale();
    const [open, setOpen] = useState(false);
    const view = mb.view;
    if (!view?.available) return null;
    const state = view.items[row.itemId];
    if (state?.addedAt || state?.openStatus === 'queued' || state?.openStatus === 'adding') return null;
    return (
        <>
            <IconButton label={t('milkbasket.member.addAria', { name: itemName(row, locale) })} variant="secondary" size="sm" onClick={() => setOpen(true)}>
                <ShoppingCart size={16} aria-hidden="true" />
            </IconButton>
            {open && (
                <AddDialog
                    row={row}
                    state={state ?? null}
                    view={view}
                    onClose={() => setOpen(false)}
                    onDone={async notice => {
                        setOpen(false);
                        mb.setNotice(notice);
                        await refreshAll(mb, uid);
                    }}
                />
            )}
        </>
    );
}

function AddDialog({
    row,
    state,
    view,
    onClose,
    onDone,
}: {
    row: GroceryRow;
    state: MilkbasketItemState | null;
    view: MilkbasketHouseholdView;
    onClose: () => void;
    onDone: (notice: Notice) => Promise<void>;
}) {
    const { t, locale } = useLocale();
    const mapped = state?.product ?? null;
    const [picked, setPicked] = useState<PickedProduct | null>(null);
    // Unlinked items start in the picker; linked ones show their product with "Change product".
    const [choosing, setChoosing] = useState(!mapped);
    const [qty, setQty] = useState(String(mapped?.defaultQuantity ?? 1));
    const [price, setPrice] = useState('');
    const [busy, setBusy] = useState<'add' | 'link' | null>(null);
    const [error, setError] = useState('');

    const product = picked
        ? { name: picked.name, size: picked.size, price: picked.price, imageUrl: picked.imageUrl }
        : mapped
            ? { name: mapped.productName, size: mapped.size, price: mapped.price, imageUrl: mapped.imageUrl }
            : null;
    const quantity = Number(qty);
    const qtyValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY;
    const unitPrice = product?.price ?? (price.trim() ? Number(price) : NaN);
    const priceValid = Number.isFinite(unitPrice) && unitPrice > 0;
    const name = itemName(row, locale);
    const pickedInput = picked ? { milkbasketProductId: picked.productId, productName: picked.name, size: picked.size, price: picked.price, imageUrl: picked.imageUrl } : null;

    const pick = (p: PickedProduct) => {
        setPicked(p);
        setChoosing(false);
        setError('');
    };

    const submit = async () => {
        setBusy('add');
        setError('');
        const result = await addToMilkbasket({
            itemId: row.itemId,
            quantity,
            product: pickedInput,
            price: product?.price === null ? unitPrice : null,
        }).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setBusy(null);
        if (!result.ok) {
            setError(errorText(result, t));
            return;
        }
        if (result.data.status === 'failed') {
            // e.g. out of stock or a changed price: stay open so another product can be picked.
            setError(t('milkbasket.member.failedPickAnother', { message: result.data.errorMessage ?? '' }));
            setChoosing(true);
            setPicked(null);
            return;
        }
        await onDone(resultNotice(result.data, view.today, t, locale));
    };

    const saveLink = async () => {
        if (!pickedInput) return;
        setBusy('link');
        setError('');
        const result = await linkMilkbasketProduct(row.itemId, pickedInput).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setBusy(null);
        if (!result.ok) {
            setError(errorText(result, t));
            return;
        }
        await onDone({ tone: 'success', text: t('milkbasket.member.linked', { item: name, product: pickedInput.productName }) });
    };

    return (
        <Dialog
            open
            onClose={onClose}
            title={t('milkbasket.member.dialogTitle', { name })}
            closeLabel={t('common.close')}
            footer={
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
                    {picked && (
                        <Button variant="secondary" onClick={saveLink} loading={busy === 'link'} disabled={busy !== null}>{t('milkbasket.member.saveLink')}</Button>
                    )}
                    <Button onClick={submit} loading={busy === 'add'} disabled={busy !== null || choosing || !product || !qtyValid || !priceValid} leadingIcon={<ShoppingCart size={15} aria-hidden="true" />}>
                        {t('milkbasket.member.confirm')}
                    </Button>
                </div>
            }
        >
            <div className="space-y-4">
                {product && !choosing && (
                    <div className="flex items-center gap-3 rounded-xl bg-surface-muted p-3">
                        <ProductImage url={product.imageUrl} alt={product.name} size={56} />
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-ink">{product.name}</p>
                            <p className="text-sm text-ink-muted">
                                {[product.size, t('milkbasket.member.forDate', { day: groceryDayLabel(view.deliveryDate, view.today, t, locale) })].filter(Boolean).join(' · ')}
                            </p>
                            {picked && mapped && <p className="mt-0.5 text-xs text-accent-strong">{t('milkbasket.member.willRelink', { item: name })}</p>}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>{t('milkbasket.member.change')}</Button>
                    </div>
                )}
                {choosing && (
                    <>
                        <p className="text-sm text-ink-muted">{t(mapped ? 'milkbasket.member.pickOther' : 'milkbasket.member.pickProduct')}</p>
                        <ProductPicker initialQuery={row.en} onPick={pick} />
                        {product && <Button size="sm" variant="ghost" onClick={() => setChoosing(false)}>{t('common.cancel')}</Button>}
                    </>
                )}
                {product && !choosing && (
                    <div className="flex flex-wrap items-end gap-3">
                        <Field label={t('milkbasket.approvals.quantity')}>
                            <TextInput type="number" min={1} max={MAX_QUANTITY} inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} className="w-24" />
                        </Field>
                        {product.price === null ? (
                            <Field label={t('milkbasket.approvals.price')}>
                                <TextInput type="number" min={0} step="0.01" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} className="w-28" />
                            </Field>
                        ) : (
                            <p className="pb-3 text-sm text-ink-muted">× ₹{rupees(product.price)}</p>
                        )}
                        {qtyValid && priceValid && (
                            <p className="ml-auto pb-3 text-base font-semibold text-ink">{t('milkbasket.approvals.total', { total: rupees(Math.round(unitPrice * quantity * 100) / 100) })}</p>
                        )}
                    </div>
                )}
                {error && <Alert tone="error">{error}</Alert>}
            </div>
        </Dialog>
    );
}

/* ─── What is in the Milkbasket basket ───────────────────────────────── */

export function MilkbasketBasket({ mb }: { mb: MilkbasketState }) {
    const { t, locale } = useLocale();
    const [result, setResult] = useState<BasketResult | null | undefined>(undefined);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async (refresh: boolean) => {
        try {
            const res = await fetch(`/api/milkbasket/basket${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                setError(t('milkbasket.member.basketFailed', { message: (body && typeof body.message === 'string' && body.message) || t('milkbasket.errors.milkbasket') }));
                setResult(prev => (prev === undefined ? null : prev));
                return;
            }
            setError('');
            setResult(body as BasketResult);
        } catch {
            setError(t('milkbasket.member.basketFailed', { message: t('milkbasket.errors.milkbasket') }));
            setResult(prev => (prev === undefined ? null : prev));
        }
    }, [t]);

    useEffect(() => {
        let alive = true;
        fetch('/api/milkbasket/basket', { credentials: 'same-origin', cache: 'no-store' })
            .then(async res => {
                const body = await res.json().catch(() => null);
                if (!alive) return;
                if (res.ok) setResult(body as BasketResult);
                else {
                    setError(t('milkbasket.member.basketFailed', { message: (body && typeof body.message === 'string' && body.message) || t('milkbasket.errors.milkbasket') }));
                    setResult(null);
                }
            })
            .catch(() => {
                if (alive) {
                    setError(t('milkbasket.member.basketFailed', { message: t('milkbasket.errors.milkbasket') }));
                    setResult(null);
                }
            });
        return () => {
            alive = false;
        };
    }, [t]);

    const refresh = async () => {
        setRefreshing(true);
        await load(true);
        setRefreshing(false);
    };

    if (result === undefined) return <Skeleton className="h-40 rounded-2xl" />;
    const basket = result?.basket ?? null;
    const today = mb.view?.today ?? '';
    const money = (n: number) => `₹${rupees(n)}`;

    return (
        <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <ShoppingCart size={16} aria-hidden="true" className="text-accent-strong" />
                        {basket?.date ? t('milkbasket.member.basketTitle', { day: groceryDayLabel(basket.date, today || basket.date, t, locale) }) : t('milkbasket.member.basketTitlePlain')}
                    </h2>
                    {result && <p className="text-xs text-ink-muted">{t('milkbasket.member.basketUpdated', { when: markedAt(result.fetchedAtMs, t, locale) })}</p>}
                </div>
                <Button size="sm" variant="ghost" loading={refreshing} leadingIcon={<RefreshCw size={14} aria-hidden="true" />} onClick={refresh}>{t('milkbasket.member.refresh')}</Button>
            </div>
            {error && <Alert tone="error" className="mt-3">{error}</Alert>}
            {basket && basket.products.length > 0 ? (
                <>
                    <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                        {basket.products.map(p => (
                            <li key={p.productId} className="flex items-center gap-3 px-3 py-2.5">
                                <ProductImage url={p.imageUrl} alt={p.name} size={40} />
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium text-ink">{p.name}</p>
                                    <p className="text-xs text-ink-muted">
                                        {[p.size, p.price !== null ? t('milkbasket.member.each', { qty: p.quantity, price: rupees(p.price) }) : t('milkbasket.member.qty', { qty: p.quantity })].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                                {p.price !== null && <p className="shrink-0 text-sm font-semibold text-ink">{money(Math.round(p.price * p.quantity * 100) / 100)}</p>}
                            </li>
                        ))}
                    </ul>
                    <dl className="mt-3 space-y-1 text-sm">
                        {basket.subTotal !== null && (
                            <div className="flex justify-between text-ink-muted"><dt>{t('milkbasket.member.subtotal')}</dt><dd>{money(basket.subTotal)}</dd></div>
                        )}
                        {basket.savings !== null && basket.savings > 0 && (
                            <div className="flex justify-between text-success"><dt>{t('milkbasket.member.savings')}</dt><dd>−{money(basket.savings)}</dd></div>
                        )}
                        {basket.deliveryFee !== null && (
                            <div className="flex justify-between text-ink-muted"><dt>{t('milkbasket.member.deliveryFee')}</dt><dd>{basket.deliveryFee > 0 ? money(basket.deliveryFee) : t('milkbasket.member.free')}</dd></div>
                        )}
                        {basket.payable !== null && (
                            <div className="flex justify-between border-t border-line pt-1 font-semibold text-ink"><dt>{t('milkbasket.member.payable')}</dt><dd>{money(basket.payable)}</dd></div>
                        )}
                    </dl>
                </>
            ) : (
                !error && <EmptyState icon={<ShoppingCart size={22} />} title={t('milkbasket.member.basketEmpty')} />
            )}
            <p className="mt-3 text-xs text-ink-muted">{t('milkbasket.member.basketHint')}</p>
        </Card>
    );
}
