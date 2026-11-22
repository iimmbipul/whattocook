'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, PackageCheck, PackageOpen } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import AppShell, { PageHeader } from '@/components/AppShell';
import { useLocale } from '@/context/LocaleContext';
import { Card, EmptyState, Section } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Spinner';
import AddItemBox from '@/components/grocery/AddItemBox';
import LevelPicker, { JarIcon } from '@/components/grocery/LevelPicker';
import StockCheckCard from '@/components/grocery/StockCheckCard';
import { useGroceryView } from '@/components/grocery/useGroceryView';
import { markGroceriesRestocked, reportGroceryLevel, setGroceryTracking } from '@/lib/grocery/actions';
import { groceryDayLabel, itemName, refreshGroceryView } from '@/lib/grocery/client';
import { CATEGORIES } from '@/lib/grocery/catalog';
import type { StockLevel } from '@/lib/grocery/logic';
import type { GroceryRow } from '@/lib/grocery/types';
import { cn } from '@/lib/cn';

/** The cook's pantry: every tracked item, updated at any time. */
export default function PantryPage() {
    const { user } = useAuth();
    const { t, locale } = useLocale();
    const view = useGroceryView(user?.uid);
    const [open, setOpen] = useState<string | null>(null);
    const [arrivedMode, setArrivedMode] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [showUntracked, setShowUntracked] = useState(false);

    if (!user) return null;
    const refresh = () => refreshGroceryView(user.uid);

    const run = async (key: string, action: () => Promise<{ ok: boolean }>, failure: string) => {
        setBusy(key);
        setError('');
        try {
            const result = await action();
            if (!result.ok) throw new Error('failed');
            await refresh();
        } catch {
            setError(failure);
        }
        setBusy(null);
    };

    const update = (row: GroceryRow, level: StockLevel) =>
        run(row.itemId, () => reportGroceryLevel(row.itemId, level), t('grocery.check.failed', { name: itemName(row, locale) }));

    const markArrived = () =>
        run('arrived', () => markGroceriesRestocked([...selected]), t('grocery.pantry.arrivedFailed')).then(() => {
            setSelected(new Set());
            setArrivedMode(false);
        });

    const toggle = (id: string) =>
        setSelected(s => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    if (view && !view.canCheck) {
        return (
            <AppShell>
                <PageHeader title={t('grocery.pantry.title')} />
                <Card>
                    <EmptyState icon={<PackageOpen size={22} />} title={t('grocery.pantry.cookOnly')} action={<Link href="/groceries" className="font-semibold text-accent-strong">{t('grocery.list.title')}</Link>} />
                </Card>
            </AppShell>
        );
    }

    const tracked = view?.pantry.filter(r => r.active) ?? [];
    const untracked = view?.pantry.filter(r => !r.active) ?? [];
    const lowIds = tracked.filter(r => r.level === 'half' || r.level === 'quarter' || r.level === 'empty').map(r => r.itemId);

    return (
        <AppShell>
            <PageHeader
                title={t('grocery.pantry.title')}
                subtitle={t('grocery.pantry.subtitle')}
                action={lowIds.length > 0 && !arrivedMode ? (
                    <Button variant="secondary" leadingIcon={<PackageCheck size={15} aria-hidden="true" />} onClick={() => { setArrivedMode(true); setSelected(new Set(lowIds)); }}>
                        {t('grocery.pantry.arrived')}
                    </Button>
                ) : undefined}
            />

            {view === undefined ? (
                <div className="space-y-3" aria-busy="true">
                    <Skeleton className="h-40 rounded-2xl" />
                    <Skeleton className="h-24 rounded-2xl" />
                </div>
            ) : !view ? (
                <Alert tone="error">{t('grocery.loadFailed')}</Alert>
            ) : (
                <div className="space-y-4">
                    {arrivedMode && (
                        <Card className="space-y-3 p-4">
                            <p className="text-sm text-ink">{t('grocery.pantry.arrivedHelp')}</p>
                            <div className="flex flex-wrap gap-2">
                                {tracked.filter(r => lowIds.includes(r.itemId)).map(r => (
                                    <label key={r.itemId} className={cn('inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium', selected.has(r.itemId) ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-muted')}>
                                        <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={selected.has(r.itemId)} onChange={() => toggle(r.itemId)} />
                                        {itemName(r, locale)}
                                    </label>
                                ))}
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button variant="ghost" onClick={() => setArrivedMode(false)}>{t('common.cancel')}</Button>
                                <Button onClick={markArrived} loading={busy === 'arrived'} disabled={selected.size === 0}>
                                    {t('grocery.pantry.markFull', { count: selected.size })}
                                </Button>
                            </div>
                        </Card>
                    )}

                    <StockCheckCard key={view.today} uid={user.uid} view={view} />

                    <Section title={t('grocery.note.title')} description={t('grocery.note.description')}>
                        <AddItemBox onSaved={refresh} />
                    </Section>

                    {error && <Alert tone="error">{error}</Alert>}

                    {tracked.length === 0 ? (
                        <Card><EmptyState icon={<PackageOpen size={22} />} title={t('grocery.pantry.emptyTitle')} body={t('grocery.pantry.emptyBody')} /></Card>
                    ) : (
                        CATEGORIES.map(category => {
                            const rows = tracked.filter(r => r.category === category);
                            if (rows.length === 0) return null;
                            return (
                                <section key={category} aria-labelledby={`cat-${category}`}>
                                    <h2 id={`cat-${category}`} className="mb-2 text-sm font-semibold text-ink-muted">{t(`grocery.category.${category}`)}</h2>
                                    <Card className="divide-y divide-line">
                                        {rows.map(row => {
                                            const expanded = open === row.itemId;
                                            const name = itemName(row, locale);
                                            return (
                                                <div key={row.itemId} className="px-4 py-3">
                                                    <button
                                                        type="button"
                                                        aria-expanded={expanded}
                                                        onClick={() => setOpen(expanded ? null : row.itemId)}
                                                        className="flex w-full items-center gap-3 text-left"
                                                    >
                                                        <span className={cn(row.level === 'empty' ? 'text-danger' : row.level === 'full' ? 'text-success' : row.level === 'unknown' ? 'text-ink-subtle' : 'text-warning')}>
                                                            <JarIcon level={row.level} />
                                                        </span>
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block font-semibold text-ink">{name}</span>
                                                            <span className="block text-xs text-ink-muted">
                                                                {t(`grocery.level.${row.level}`)} · {t('grocery.pantry.nextCheck', { day: groceryDayLabel(row.nextCheckDate < view.today ? view.today : row.nextCheckDate, view.today, t, locale) })}
                                                            </span>
                                                        </span>
                                                        <ChevronDown size={18} className={cn('shrink-0 text-ink-subtle transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
                                                    </button>
                                                    {expanded && (
                                                        <div className="mt-3 space-y-2">
                                                            <LevelPicker compact value={row.level} onChange={level => update(row, level)} label={name} disabled={busy === row.itemId} />
                                                            <div className="flex justify-end">
                                                                <Button variant="ghost" size="sm" loading={busy === `stop-${row.itemId}`} onClick={() => run(`stop-${row.itemId}`, () => setGroceryTracking(row.itemId, false), t('grocery.pantry.trackFailed'))}>
                                                                    {t('grocery.pantry.stopTracking')}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </Card>
                                </section>
                            );
                        })
                    )}

                    {untracked.length > 0 && (
                        <div>
                            <Button variant="ghost" size="sm" onClick={() => setShowUntracked(v => !v)} aria-expanded={showUntracked}>
                                {t('grocery.pantry.untracked', { count: untracked.length })}
                            </Button>
                            {showUntracked && (
                                <Card className="mt-2 divide-y divide-line">
                                    {untracked.map(row => (
                                        <div key={row.itemId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                                            <span className="text-sm text-ink-muted">{itemName(row, locale)}</span>
                                            <Button variant="secondary" size="sm" loading={busy === `track-${row.itemId}`} onClick={() => run(`track-${row.itemId}`, () => setGroceryTracking(row.itemId, true), t('grocery.pantry.trackFailed'))}>
                                                {t('grocery.pantry.trackAgain')}
                                            </Button>
                                        </div>
                                    ))}
                                </Card>
                            )}
                        </div>
                    )}
                </div>
            )}
        </AppShell>
    );
}
