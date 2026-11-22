'use client';

import Link from 'next/link';
import { ChevronRight, ShoppingBasket } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useLocale } from '@/context/LocaleContext';
import { Card } from '@/components/ui/Card';
import { itemName } from '@/lib/grocery/client';
import StockCheckCard from './StockCheckCard';
import { useGroceryView } from './useGroceryView';

/**
 * Grocery cards at the top of Today: the stock check for whoever reports
 * stock (the cook), and a "to buy" summary for members and the owner.
 */
export default function GroceryToday() {
    const { user } = useAuth();
    const { t, locale } = useLocale();
    const view = useGroceryView(user?.uid);
    if (!user || !view) return null;

    const out = view.list.filter(r => r.level === 'empty');
    const low = view.list.filter(r => r.level !== 'empty');
    const showList = user.role !== 'cook' && view.list.length > 0;

    return (
        <>
            {/* The card keeps the list it opened with, so it stays to show "All done". */}
            {view.canCheck && <StockCheckCard key={view.today} uid={user.uid} view={view} />}
            {showList && (
                <Link href="/groceries" className="mb-5 block rounded-2xl focus-visible:outline-2">
                    <Card className="flex items-center gap-3 p-4 transition-colors hover:border-line-strong">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning" aria-hidden="true">
                            <ShoppingBasket size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-base font-semibold text-ink">{t('grocery.card.title', { count: view.list.length })}</p>
                            <p className="truncate text-sm text-ink-muted">
                                {out.length > 0 && <span className="font-medium text-danger">{t('grocery.card.out', { count: out.length })}</span>}
                                {out.length > 0 && low.length > 0 && ' · '}
                                {low.length > 0 && t('grocery.card.low', { count: low.length })}
                                {' — '}
                                {view.list.slice(0, 3).map(r => itemName(r, locale)).join(', ')}
                            </p>
                        </div>
                        <ChevronRight size={18} className="shrink-0 text-ink-subtle" aria-hidden="true" />
                    </Card>
                </Link>
            )}
        </>
    );
}
