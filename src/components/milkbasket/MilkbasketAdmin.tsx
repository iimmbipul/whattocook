'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, PlugZap, ShoppingCart } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Section } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyValue } from '@/components/ui/CopyValue';
import { Dialog } from '@/components/ui/Dialog';
import { Alert, Field, Select, TextInput } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { groceryDayLabel, itemName, markedAt } from '@/lib/grocery/client';
import {
    rejectMilkbasketRequest,
    removeMilkbasketMapping,
    retryMilkbasketRequest,
    saveMilkbasketLogin,
    saveMilkbasketMapping,
    saveMilkbasketSettings,
    setMilkbasketAutoOrder,
    testMilkbasketConnection,
} from '@/lib/milkbasket/actions';
import { MAX_QUANTITY, type HistoryProduct, type MilkbasketSettings } from '@/lib/milkbasket/logic';
import type { MappingRow, MilkbasketAdminView, MilkbasketResult, PurchaseRequestRow } from '@/lib/milkbasket/types';
import { ApprovalRow, LevelChange, OrderHistoryPicker, STATUS_TONE, errorText, rupees, type Done, type Notice } from './shared';

type Tab = 'approvals' | 'map' | 'mappings' | 'activity' | 'settings';

async function loadView(): Promise<MilkbasketAdminView | null> {
    try {
        const res = await fetch('/api/milkbasket/admin', { credentials: 'same-origin', cache: 'no-store' });
        return res.ok ? ((await res.json()) as MilkbasketAdminView) : null;
    } catch {
        return null;
    }
}

/** Admin → Milkbasket (owner): approvals, mappings, activity and settings for auto-ordering low items. */
export default function MilkbasketAdmin() {
    const { t, locale } = useLocale();
    const [view, setView] = useState<MilkbasketAdminView | null | undefined>(undefined);
    const [tab, setTab] = useState<Tab | null>(null);
    const [notice, setNotice] = useState<Notice>(null);
    const [mapping, setMapping] = useState<{ itemId: string; name: string; current: MappingRow | null } | null>(null);
    const polls = useRef(0);

    const reload = useCallback(async () => {
        const next = await loadView();
        setView(next);
        return next;
    }, []);

    useEffect(() => {
        let alive = true;
        loadView().then(v => {
            if (alive) setView(v);
        });
        return () => {
            alive = false;
        };
    }, []);

    // Adds run in the background: while any is queued or adding, look again shortly.
    const busyInBackground = !!view?.activity.some(r => r.status === 'queued' || r.status === 'adding');
    useEffect(() => {
        if (!busyInBackground) {
            polls.current = 0;
            return;
        }
        if (polls.current >= 10) return;
        const timer = setTimeout(() => {
            polls.current += 1;
            void reload();
        }, 3000);
        return () => clearTimeout(timer);
    }, [busyInBackground, view, reload]);

    if (view === undefined) return <Skeleton className="h-48 rounded-2xl" />;

    if (view === null) {
        return (
            <Section icon={<ShoppingCart size={18} />} title={t('milkbasket.title')}>
                <Alert tone="error">{t('milkbasket.loadFailed')}</Alert>
                <div className="mt-3 flex justify-end">
                    <Button variant="secondary" onClick={() => void reload()}>{t('common.retry')}</Button>
                </div>
            </Section>
        );
    }

    if (!view.allowed) {
        return (
            <Section icon={<ShoppingCart size={18} />} title={t('milkbasket.title')} description={t('milkbasket.description')}>
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-ink">{t('milkbasket.notAllowed.title')}</p>
                    <p className="text-sm text-ink-muted">{t('milkbasket.notAllowed.body')}</p>
                    <CopyValue label={t('milkbasket.notAllowed.householdId')} value={view.householdId} />
                </div>
            </Section>
        );
    }

    const waiting = view.approvals.length;
    const needsMapping = view.unmapped.filter(u => u.request).length;
    const shownTab: Tab = tab ?? (waiting > 0 ? 'approvals' : needsMapping > 0 || view.mappings.length === 0 ? 'map' : 'activity');
    const count = (label: string, n: number) => (n > 0 ? `${label} (${n})` : label);
    // Stay on the tab the action was taken from, even when its list empties
    // (unless another tab was picked meanwhile).
    const done = async (n: Notice) => {
        setTab(current => current ?? shownTab);
        setNotice(n);
        await reload();
    };

    return (
        <Section
            icon={<ShoppingCart size={18} />}
            title={t('milkbasket.title')}
            description={t('milkbasket.description')}
            action={waiting + needsMapping > 0 ? <Badge tone="warning">{t('milkbasket.waiting', { count: waiting + needsMapping })}</Badge> : undefined}
        >
            <div className="space-y-3">
                {!view.settings.enabled && (
                    <Alert tone="info">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                            <span>{t('milkbasket.off')}</span>
                            <Button size="sm" variant="secondary" onClick={() => setTab('settings')}>{t('milkbasket.turnOn')}</Button>
                        </span>
                    </Alert>
                )}
                {view.connection.missing.length > 0 && (
                    <Alert tone="warning">{t('milkbasket.notConfigured', { missing: view.connection.missing.join(', ') })}</Alert>
                )}
                {view.connection.missing.length === 0 && !view.connection.hasLogin && (
                    <Alert tone="warning">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                            <span>{t('milkbasket.noLogin')}</span>
                            <Button size="sm" variant="secondary" onClick={() => setTab('settings')}>{t('milkbasket.addLogin')}</Button>
                        </span>
                    </Alert>
                )}
                {view.connection.hasLogin && !view.connection.canRenew && (
                    <Alert tone="info">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                            <span>{t('milkbasket.noRefresh')}</span>
                            <Button size="sm" variant="secondary" onClick={() => setTab('settings')}>{t('milkbasket.addLogin')}</Button>
                        </span>
                    </Alert>
                )}
                {view.connection.loginError && (
                    <Alert tone="warning">{t('milkbasket.loginError', { when: markedAt(view.connection.loginError.atMs, t, locale), message: view.connection.loginError.message })}</Alert>
                )}
                {view.problem && (
                    <Alert tone="warning">
                        <p>{t('milkbasket.problem', { when: markedAt(view.problem.atMs, t, locale), message: view.problem.message })}</p>
                        <p className="mt-1 font-normal">{t('milkbasket.problemHint')}</p>
                    </Alert>
                )}
                {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

                <Segmented<Tab>
                    label={t('milkbasket.tabs.label')}
                    value={shownTab}
                    onChange={next => {
                        setTab(next);
                        setNotice(null);
                    }}
                    options={[
                        { value: 'approvals', label: count(t('milkbasket.tabs.approvals'), waiting) },
                        { value: 'map', label: count(t('milkbasket.tabs.map'), needsMapping) },
                        { value: 'mappings', label: t('milkbasket.tabs.mappings') },
                        { value: 'activity', label: t('milkbasket.tabs.activity') },
                        { value: 'settings', label: t('milkbasket.tabs.settings') },
                    ]}
                />

                {shownTab === 'approvals' && <Approvals view={view} onDone={done} />}
                {shownTab === 'map' && (
                    <ToMap
                        view={view}
                        onMap={(itemId, name) => setMapping({ itemId, name, current: null })}
                        onDone={done}
                    />
                )}
                {shownTab === 'mappings' && (
                    <Mappings
                        view={view}
                        onEdit={m => setMapping({ itemId: m.itemId, name: m.itemName, current: m })}
                        onDone={done}
                    />
                )}
                {shownTab === 'activity' && <Activity view={view} onDone={done} />}
                {shownTab === 'settings' && <SettingsForm view={view} onDone={done} />}
            </div>

            {mapping && (
                <MappingDialog
                    target={mapping}
                    onClose={() => setMapping(null)}
                    onSaved={async () => {
                        setMapping(null);
                        setTab(current => current ?? shownTab);
                        setNotice({ tone: 'success', text: t('milkbasket.map.mapped', { item: mapping.name }) });
                        await reload();
                    }}
                />
            )}
        </Section>
    );
}

/* ─── Approvals ──────────────────────────────────────────────────────── */

function Approvals({ view, onDone }: { view: MilkbasketAdminView; onDone: Done }) {
    const { t } = useLocale();
    if (view.approvals.length === 0) return <p className="py-4 text-sm text-ink-muted">{t('milkbasket.approvals.empty')}</p>;
    return (
        <div className="space-y-2">
            <p className="text-sm text-ink-muted">{t('milkbasket.approvals.intro')}</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
                {view.approvals.map(req => <ApprovalRow key={req.id} req={req} priceLimit={view.settings.priceLimit} today={view.today} onDone={onDone} />)}
            </ul>
        </div>
    );
}

/* ─── To map ─────────────────────────────────────────────────────────── */

function ToMap({ view, onMap, onDone }: { view: MilkbasketAdminView; onMap: (itemId: string, name: string) => void; onDone: Done }) {
    const { t, locale } = useLocale();
    const [busy, setBusy] = useState<string | null>(null);
    if (view.unmapped.length === 0) return <p className="py-4 text-sm text-ink-muted">{t('milkbasket.map.empty')}</p>;

    const dismiss = async (requestId: string) => {
        setBusy(requestId);
        const result = await rejectMilkbasketRequest(requestId).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setBusy(null);
        await onDone(result.ok ? { tone: 'info', text: t('milkbasket.map.dismissed') } : { tone: 'error', text: errorText(result, t) });
    };

    return (
        <div className="space-y-2">
            <p className="text-sm text-ink-muted">{t('milkbasket.map.intro')}</p>
            <ul className="max-h-[520px] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {view.unmapped.map(item => (
                    <li key={item.itemId} className={item.request ? 'flex flex-wrap items-center gap-2 bg-warning-soft/40 p-3' : 'flex flex-wrap items-center gap-2 p-3'}>
                        <div className="min-w-0 flex-1">
                            <p className="font-medium text-ink">
                                {itemName(item, locale)}
                                {locale !== 'en' && item.en !== itemName(item, locale) && <span className="ml-1.5 text-sm font-normal text-ink-muted">{item.en}</span>}
                            </p>
                            <p className="text-xs text-ink-muted">
                                {item.request
                                    ? t('milkbasket.map.waiting', { when: markedAt(item.request.createdAt, t, locale) })
                                    : t(`grocery.level.${item.level}`)}
                                {!item.active && ` · ${t('milkbasket.map.notTracked')}`}
                            </p>
                        </div>
                        {item.request && (
                            <Button size="sm" variant="ghost" loading={busy === item.request.id} onClick={() => dismiss(item.request!.id)}>{t('milkbasket.map.dismiss')}</Button>
                        )}
                        <Button size="sm" variant={item.request ? 'primary' : 'secondary'} onClick={() => onMap(item.itemId, item.en)}>{t('milkbasket.map.map')}</Button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/* ─── Mapping form (with products from recent orders) ────────────────── */

function MappingDialog({
    target,
    onClose,
    onSaved,
}: {
    target: { itemId: string; name: string; current: MappingRow | null };
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const { t } = useLocale();
    const c = target.current;
    const [form, setForm] = useState({
        productId: c ? String(c.milkbasketProductId) : '',
        productName: c?.productName ?? '',
        size: c?.size ?? '',
        price: c?.price !== null && c?.price !== undefined ? String(c.price) : '',
        quantity: String(c?.defaultQuantity ?? 1),
        enabled: c?.enabled ?? true,
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const pick = (p: HistoryProduct) =>
        setForm(f => ({ ...f, productId: String(p.productId), productName: p.name, size: p.size, price: p.price !== null ? String(p.price) : f.price }));

    const save = async () => {
        const productId = Number(form.productId);
        const quantity = Number(form.quantity);
        const price = form.price.trim() === '' ? null : Number(form.price);
        if (!Number.isSafeInteger(productId) || productId <= 0 || !form.productName.trim() || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY || (price !== null && !(price > 0))) {
            setError(t('milkbasket.form.invalid'));
            return;
        }
        setSaving(true);
        setError('');
        const result: MilkbasketResult = await saveMilkbasketMapping({
            itemId: target.itemId,
            milkbasketProductId: productId,
            productName: form.productName,
            size: form.size,
            price,
            defaultQuantity: quantity,
            enabled: form.enabled,
        }).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setSaving(false);
        if (result.ok) await onSaved();
        else setError(result.error === 'invalid' ? t('milkbasket.form.invalid') : errorText(result, t));
    };

    return (
        <Dialog
            open
            onClose={onClose}
            size="lg"
            title={t(c ? 'milkbasket.form.editTitle' : 'milkbasket.form.title', { item: target.name })}
            closeLabel={t('common.close')}
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
                    <Button onClick={save} loading={saving}>{t('common.save')}</Button>
                </div>
            }
        >
            <div className="space-y-4">
                <OrderHistoryPicker onPick={pick} />
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t('milkbasket.form.productId')} required>
                        <TextInput inputMode="numeric" value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value.replace(/[^\d]/g, '') })} />
                    </Field>
                    <Field label={t('milkbasket.form.size')}>
                        <TextInput value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} />
                    </Field>
                </div>
                <Field label={t('milkbasket.form.productName')} required>
                    <TextInput value={form.productName} onChange={e => setForm({ ...form, productName: e.target.value })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                    <Field label={t('milkbasket.form.price')} hint={t('milkbasket.form.priceHint')}>
                        <TextInput type="number" min={0} step="0.01" inputMode="decimal" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
                    </Field>
                    <Field label={t('milkbasket.form.quantity')}>
                        <TextInput type="number" min={1} max={MAX_QUANTITY} inputMode="numeric" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
                    </Field>
                    <Field label={t('milkbasket.form.enabled')}>
                        <Select value={form.enabled ? 'on' : 'off'} onChange={e => setForm({ ...form, enabled: e.target.value === 'on' })}>
                            <option value="on">{t('milkbasket.form.on')}</option>
                            <option value="off">{t('milkbasket.form.off')}</option>
                        </Select>
                    </Field>
                </div>
                {error && <Alert tone="error">{error}</Alert>}
            </div>
        </Dialog>
    );
}

/* ─── Mappings ───────────────────────────────────────────────────────── */

function Mappings({ view, onEdit, onDone }: { view: MilkbasketAdminView; onEdit: (m: MappingRow) => void; onDone: Done }) {
    const { t, locale } = useLocale();
    const { confirm, dialog } = useConfirm();
    const [busy, setBusy] = useState<string | null>(null);
    if (view.mappings.length === 0) return <p className="py-4 text-sm text-ink-muted">{t('milkbasket.mappings.empty')}</p>;

    const toggle = async (m: MappingRow) => {
        setBusy(`toggle-${m.itemId}`);
        const result = await setMilkbasketAutoOrder(m.itemId, !m.enabled).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setBusy(null);
        await onDone(result.ok ? null : { tone: 'error', text: errorText(result, t) });
    };

    const remove = async (m: MappingRow) => {
        const ok = await confirm({
            title: t('milkbasket.mappings.removeTitle'),
            message: t('milkbasket.mappings.removeBody', { item: m.itemName }),
            confirmLabel: t('milkbasket.mappings.remove'),
            tone: 'danger',
        });
        if (!ok) return;
        setBusy(`remove-${m.itemId}`);
        const result = await removeMilkbasketMapping(m.itemId).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setBusy(null);
        await onDone(result.ok ? { tone: 'info', text: t('milkbasket.mappings.removed') } : { tone: 'error', text: errorText(result, t) });
    };

    return (
        <div className="space-y-2">
            {dialog}
            <p className="text-sm text-ink-muted">{t('milkbasket.mappings.intro')}</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
                {view.mappings.map(m => (
                    <li key={m.itemId} className="flex flex-wrap items-center gap-2 p-3">
                        <div className="min-w-0 flex-1">
                            <p className="font-medium text-ink">
                                {m.itemName} <span className="font-normal text-ink-muted">→ {m.productName}{m.size && ` · ${m.size}`}</span>
                            </p>
                            <p className="text-xs text-ink-muted">
                                #{m.milkbasketProductId} · {m.price !== null ? `₹${rupees(m.price)}` : t('milkbasket.mappings.priceUnknown')}
                                {m.price !== null && m.priceUpdatedAt && ` (${t('milkbasket.mappings.priceFrom', { date: markedAt(m.priceUpdatedAt, t, locale) })})`}
                                {' · '}{t('milkbasket.mappings.qty', { count: m.defaultQuantity })}
                                {' · '}{t(`grocery.level.${m.itemLevel}`)}
                            </p>
                        </div>
                        <Badge tone={m.enabled ? 'success' : 'neutral'}>{t(m.enabled ? 'milkbasket.mappings.on' : 'milkbasket.mappings.off')}</Badge>
                        <Button size="sm" variant="ghost" loading={busy === `toggle-${m.itemId}`} onClick={() => toggle(m)}>
                            {t(m.enabled ? 'milkbasket.mappings.turnOff' : 'milkbasket.mappings.turnOn')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onEdit(m)}>{t('milkbasket.mappings.edit')}</Button>
                        <Button size="sm" variant="ghost" loading={busy === `remove-${m.itemId}`} onClick={() => remove(m)}>{t('milkbasket.mappings.remove')}</Button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/* ─── Activity ───────────────────────────────────────────────────────── */

function Activity({ view, onDone }: { view: MilkbasketAdminView; onDone: Done }) {
    const { t, locale } = useLocale();
    const [busy, setBusy] = useState<string | null>(null);
    if (view.activity.length === 0) return <p className="py-4 text-sm text-ink-muted">{t('milkbasket.activity.empty')}</p>;

    const retry = async (req: PurchaseRequestRow) => {
        setBusy(req.id);
        const result = await retryMilkbasketRequest(req.id).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setBusy(null);
        if (!result.ok) return onDone({ tone: 'error', text: errorText(result, t) });
        const row = result.data;
        if (row.status === 'added') {
            return onDone({ tone: 'success', text: t('milkbasket.approvals.added', { date: groceryDayLabel(row.deliveryDate ?? view.today, view.today, t, locale), item: row.itemName }) });
        }
        if (row.status === 'failed') return onDone({ tone: 'error', text: t('milkbasket.approvals.failed', { item: row.itemName, message: row.errorMessage ?? '' }) });
        return onDone({ tone: 'info', text: `${t('milkbasket.activity.retried')} ${t(`milkbasket.status.${row.status}`)}.` });
    };

    return (
        <div className="space-y-2">
            <p className="text-sm text-ink-muted">{t('milkbasket.activity.intro')}</p>
            <ul className="max-h-[560px] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {view.activity.map(req => (
                    <li key={req.id} className="flex flex-wrap items-start gap-2 p-3">
                        <div className="min-w-0 flex-1">
                            <p className="font-medium text-ink">
                                {req.itemName}
                                {req.productName && <span className="font-normal text-ink-muted"> → {req.productName}{req.size && ` · ${req.size}`}</span>}
                            </p>
                            <p className="text-xs text-ink-muted">
                                {[
                                    req.price !== null ? `${req.quantity} × ₹${rupees(req.price)}` : `${req.quantity} ×`,
                                    req.deliveryDate && t('milkbasket.activity.delivery', { date: groceryDayLabel(req.deliveryDate, view.today, t, locale) }),
                                    markedAt(req.updatedAt || req.createdAt, t, locale),
                                    req.decidedByName && t('milkbasket.activity.by', { name: req.decidedByName }),
                                ].filter(Boolean).join(' · ')}
                                {req.trigger && <> · <LevelChange req={req} /></>}
                            </p>
                            {req.errorMessage && <p className="mt-1 text-sm text-danger">{req.errorMessage}</p>}
                        </div>
                        <Badge tone={STATUS_TONE[req.status]}>{t(`milkbasket.status.${req.status}`)}</Badge>
                        {req.status === 'failed' && (
                            <Button size="sm" variant="secondary" loading={busy === req.id} onClick={() => retry(req)}>{t('milkbasket.activity.retry')}</Button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

/* ─── Settings ───────────────────────────────────────────────────────── */

function SettingsForm({ view, onDone }: { view: MilkbasketAdminView; onDone: Done }) {
    const { t, locale } = useLocale();
    const [form, setForm] = useState({
        enabled: view.settings.enabled,
        priceLimit: String(view.settings.priceLimit),
        deliveryDays: view.settings.deliveryDays,
        duplicateWindowHours: String(view.settings.duplicateWindowHours),
        notify: view.settings.notify,
    });
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [test, setTest] = useState<Notice>(null);

    const limit = Number(form.priceLimit);
    const hours = Number(form.duplicateWindowHours);
    const valid = Number.isFinite(limit) && limit > 0 && Number.isInteger(hours) && hours >= 1 && hours <= 168;

    const save = async () => {
        setSaving(true);
        const settings: MilkbasketSettings = { enabled: form.enabled, priceLimit: limit, deliveryDays: form.deliveryDays, duplicateWindowHours: hours, notify: form.notify };
        const result = await saveMilkbasketSettings(settings).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setSaving(false);
        await onDone(result.ok ? { tone: 'success', text: t('milkbasket.settings.saved') } : { tone: 'error', text: errorText(result, t) });
    };

    const testConnection = async () => {
        setTesting(true);
        setTest(null);
        const result = await testMilkbasketConnection().catch(() => ({ ok: false as const, error: 'failed' as const }));
        setTesting(false);
        setTest(result.ok
            ? { tone: 'success', text: [t('milkbasket.settings.testOk'), result.data.message].filter(Boolean).join(' ') }
            : { tone: 'error', text: errorText(result, t) });
        await onDone(null); // the problem banner follows the result
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('milkbasket.settings.enabled')}>
                    <Select value={form.enabled ? 'on' : 'off'} onChange={e => setForm({ ...form, enabled: e.target.value === 'on' })}>
                        <option value="on">{t('milkbasket.settings.on')}</option>
                        <option value="off">{t('milkbasket.settings.off')}</option>
                    </Select>
                </Field>
                <Field label={t('milkbasket.settings.priceLimit')} hint={t('milkbasket.settings.priceLimitHint', { limit: rupees(view.defaultPriceLimit) })}>
                    <TextInput type="number" min={1} step="0.01" inputMode="decimal" value={form.priceLimit} onChange={e => setForm({ ...form, priceLimit: e.target.value })} />
                </Field>
                <Field label={t('milkbasket.settings.delivery')}>
                    <Select value={form.deliveryDays} onChange={e => setForm({ ...form, deliveryDays: e.target.value === '2' ? 2 : 1 })}>
                        <option value={1}>{t('milkbasket.settings.tomorrow')}</option>
                        <option value={2}>{t('milkbasket.settings.dayAfter')}</option>
                    </Select>
                </Field>
                <Field label={t('milkbasket.settings.window')}>
                    <TextInput type="number" min={1} max={168} inputMode="numeric" value={form.duplicateWindowHours} onChange={e => setForm({ ...form, duplicateWindowHours: e.target.value })} />
                </Field>
                <Field label={t('milkbasket.settings.notify')}>
                    <Select value={form.notify ? 'on' : 'off'} onChange={e => setForm({ ...form, notify: e.target.value === 'on' })}>
                        <option value="on">{t('milkbasket.settings.on')}</option>
                        <option value="off">{t('milkbasket.settings.off')}</option>
                    </Select>
                </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" leadingIcon={<PlugZap size={16} aria-hidden="true" />} loading={testing} onClick={testConnection}>{t('milkbasket.settings.test')}</Button>
                    <span className="text-xs text-ink-muted">
                        {view.connection.configured
                            ? [
                                t('milkbasket.settings.connection', { host: view.connection.apiHost }),
                                view.connection.canRenew && t('milkbasket.settings.loginRenews'),
                                view.connection.authExpiresAt !== null && t('milkbasket.settings.loginValid', { when: markedAt(view.connection.authExpiresAt, t, locale) }),
                                view.connection.renewedAt !== null && t('milkbasket.settings.loginRenewed', { when: markedAt(view.connection.renewedAt, t, locale) }),
                            ].filter(Boolean).join(' · ')
                            : t('milkbasket.settings.notConfigured')}
                    </span>
                </div>
                <Button onClick={save} loading={saving} disabled={!valid}>{t('common.save')}</Button>
            </div>
            {test && <Alert tone={test.tone}>{test.text}</Alert>}
            <LoginForm hasLogin={view.connection.hasLogin} onDone={onDone} />
        </div>
    );
}

/** The Milkbasket login the server uses. The tokens are encrypted on the server and never shown again. */
function LoginForm({ hasLogin, onDone }: { hasLogin: boolean; onDone: Done }) {
    const { t } = useLocale();
    const [refreshToken, setRefreshToken] = useState('');
    const [authToken, setAuthToken] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const looksValid = (v: string) => /^[\x21-\x7e]{10,4096}$/.test(v.trim().replace(/^bearer\s+/i, ''));

    const save = async () => {
        if (!looksValid(refreshToken) || (authToken.trim() !== '' && !looksValid(authToken))) {
            setError(t('milkbasket.login.invalid'));
            return;
        }
        setSaving(true);
        setError('');
        const result = await saveMilkbasketLogin(refreshToken, authToken).catch(() => ({ ok: false as const, error: 'failed' as const }));
        setSaving(false);
        if (!result.ok) {
            setError(result.error === 'invalid' ? t('milkbasket.login.invalid') : errorText(result, t));
            return;
        }
        setRefreshToken('');
        setAuthToken('');
        await onDone({ tone: 'success', text: t('milkbasket.login.saved') });
    };

    return (
        <div className="space-y-3 border-t border-line pt-4">
            <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><KeyRound size={15} aria-hidden="true" />{t('milkbasket.login.title')}</h3>
                <p className="mt-0.5 text-sm text-ink-muted">{t(hasLogin ? 'milkbasket.login.saved_status' : 'milkbasket.login.none')}</p>
                <p className="mt-1 text-xs text-ink-muted">{t('milkbasket.login.help')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('milkbasket.login.refreshToken')} hint={t('milkbasket.login.refreshHint')}>
                    <TextInput type="password" autoComplete="off" spellCheck={false} value={refreshToken} onChange={e => setRefreshToken(e.target.value)} />
                </Field>
                <Field label={t('milkbasket.login.authToken')} hint={t('milkbasket.login.authHint')}>
                    <TextInput type="password" autoComplete="off" spellCheck={false} value={authToken} onChange={e => setAuthToken(e.target.value)} />
                </Field>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex justify-end">
                <Button variant="secondary" onClick={save} loading={saving} disabled={!refreshToken.trim()}>{t('milkbasket.login.save')}</Button>
            </div>
        </div>
    );
}
