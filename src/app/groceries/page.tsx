'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ClipboardCheck, Share2, ShoppingBasket } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import AppShell, { PageHeader } from '@/components/AppShell';
import { useLocale } from '@/context/LocaleContext';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Segmented';
import { JarIcon } from '@/components/grocery/LevelPicker';
import { GrocerySearch, InventoryList, useGroceryMarking } from '@/components/grocery/GroceryMarking';
import { useGroceryView } from '@/components/grocery/useGroceryView';
import { markGroceriesRestocked } from '@/lib/grocery/actions';
import { groceryDayLabel, itemName, refreshGroceryView, reportedAgo } from '@/lib/grocery/client';
import type { StockLevel } from '@/lib/grocery/logic';
import type { GroceryRow } from '@/lib/grocery/types';

const GROUPS: { level: StockLevel; key: string }[] = [
    { level: 'empty', key: 'out' },
    { level: 'quarter', key: 'low' },
    { level: 'half', key: 'getting' },
];

/**
 * Groceries for everyone in the household: mark any item Out of stock or Full
 * (or add one), the shopping list, and the full inventory with who marked what.
 */
export default function GroceriesPage() {
    const { user } = useAuth();
    const { t, locale } = useLocale();
    const view = useGroceryView(user?.uid);
    const marking = useGroceryMarking(user?.uid ?? '');
    const [tab, setTab] = useState<'list' | 'inventory'>('list');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');

    if (!user) return null;

    const bought = async (row: GroceryRow) => {
        setBusy(row.itemId);
        setError('');
        try {
            const result = await markGroceriesRestocked([row.itemId]);
            if (!result.ok) throw new Error(result.error);
            await refreshGroceryView(user.uid);
        } catch {
            setError(t('grocery.list.boughtFailed', { name: itemName(row, locale) }));
        }
        setBusy(null);
    };

    const shareText = view
        ? [
            t('grocery.list.shareTitle'),
            ...GROUPS.flatMap(g => {
                const rows = view.list.filter(r => r.level === g.level);
                return rows.length ? [`${t(`grocery.list.${g.key}`)}: ${rows.map(r => itemName(r, locale)).join(', ')}`] : [];
            }),
        ].join('\n')
        : '';

    return (
        <AppShell>
            <PageHeader
                title={t('grocery.list.title')}
                subtitle={t('grocery.list.subtitle')}
                action={view && view.list.length > 0 ? (
                    <a
                        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink hover:border-line-strong"
                    >
                        <Share2 size={15} aria-hidden="true" /> {t('grocery.list.share')}
                    </a>
                ) : undefined}
            />

            {view?.canCheck && (
                <Link href="/pantry" className="mb-4 flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent-strong">
                    <ClipboardCheck size={16} aria-hidden="true" /> {t('grocery.list.doCheck')}
                </Link>
            )}

            {error && <Alert tone="error" className="mb-4">{error}</Alert>}

            {view === undefined ? (
                <div className="space-y-3" aria-busy="true">
                    <Skeleton className="h-20 rounded-2xl" />
                    <Skeleton className="h-20 rounded-2xl" />
                </div>
            ) : !view ? (
                <Alert tone="error">{t('grocery.loadFailed')}</Alert>
            ) : (
                <>
                    <GrocerySearch view={view} marking={marking} />
                    {marking.notice && <Alert tone={marking.notice.tone} className="mb-4">{marking.notice.text}</Alert>}
                    <Segmented
                        label={t('grocery.tabs.label')}
                        value={tab}
                        onChange={setTab}
                        className="mb-4"
                        options={[
                            { value: 'list', label: t('grocery.tabs.toBuy', { count: view.list.length }) },
                            { value: 'inventory', label: t('grocery.tabs.inventory', { count: view.pantry.filter(r => r.active).length }) },
                        ]}
                    />
                    {tab === 'inventory' ? (
                        <InventoryList view={view} marking={marking} />
                    ) : view.list.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={<ShoppingBasket size={22} />}
                        title={t('grocery.list.emptyTitle')}
                        body={view.lastCheckDate
                            ? t('grocery.list.emptyBody', { day: groceryDayLabel(view.lastCheckDate, view.today, t, locale) })
                            : t('grocery.list.emptyNever')}
                    />
                </Card>
            ) : (
                <div className="space-y-6">
                    {view.lastCheckDate && view.lastCheckDate < view.today && (
                        <p className="text-sm text-ink-muted">{t('grocery.list.lastChecked', { day: groceryDayLabel(view.lastCheckDate, view.today, t, locale) })}</p>
                    )}
                    {GROUPS.map(group => {
                        const rows = view.list.filter(r => r.level === group.level);
                        if (rows.length === 0) return null;
                        return (
                            <section key={group.level} aria-labelledby={`grocery-${group.key}`}>
                                <h2 id={`grocery-${group.key}`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                                    <span className={group.level === 'empty' ? 'text-danger' : 'text-warning'}><JarIcon level={group.level} size={18} /></span>
                                    {t(`grocery.list.${group.key}`)} <span className="font-normal text-ink-muted">({rows.length})</span>
                                </h2>
                                <Card className="divide-y divide-line">
                                    {rows.map(row => (
                                        <div key={row.itemId} className="flex items-center gap-3 px-4 py-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-ink">
                                                    {itemName(row, locale)}
                                                    {locale !== 'en' && <span className="ml-1.5 text-sm font-normal text-ink-muted">{row.en}</span>}
                                                </p>
                                                {row.neededOn && (
                                                    <p className="text-sm font-medium text-warning">
                                                        {t('grocery.neededFor', { day: groceryDayLabel(row.neededOn, view.today, t, locale), dishes: row.dishes.join(', ') })}
                                                    </p>
                                                )}
                                                {row.reportedByName && (
                                                    <p className="text-xs text-ink-muted">
                                                        {t('grocery.list.reportedBy', { name: row.reportedByName, when: reportedAgo(row.levelAtMs, t, locale) })}
                                                    </p>
                                                )}
                                            </div>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                loading={busy === row.itemId}
                                                disabled={busy !== null && busy !== row.itemId}
                                                leadingIcon={<Check size={15} aria-hidden="true" />}
                                                onClick={() => bought(row)}
                                                aria-label={t('grocery.list.boughtAria', { name: itemName(row, locale) })}
                                            >
                                                {user.role === 'cook' ? t('grocery.list.arrived') : t('grocery.list.bought')}
                                            </Button>
                                        </div>
                                    ))}
                                </Card>
                            </section>
                        );
                    })}
                </div>
                    )}
                </>
            )}
        </AppShell>
    );
}
