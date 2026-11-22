'use client';

import { useState } from 'react';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Field';
import { reportGroceryLevel } from '@/lib/grocery/actions';
import { groceryDayLabel, itemName, refreshGroceryView } from '@/lib/grocery/client';
import type { StockLevel } from '@/lib/grocery/logic';
import type { GroceryRow, GroceryView } from '@/lib/grocery/types';
import LevelPicker from './LevelPicker';

/**
 * The cook's daily stock check: a short list (menu needs + items due), one
 * tap per item. The list is fixed when the card opens, so rows don't jump
 * while the cook works through them; other screens refresh after each tap.
 */
export default function StockCheckCard({ uid, view }: { uid: string; view: GroceryView }) {
    const { t, locale } = useLocale();
    const [rows] = useState<GroceryRow[]>(() => view.checks);
    const [done, setDone] = useState<Record<string, StockLevel>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [error, setError] = useState('');

    if (rows.length === 0) return null;
    const doneCount = rows.filter(r => done[r.itemId]).length;
    const allDone = doneCount === rows.length;

    const pick = async (row: GroceryRow, level: StockLevel) => {
        const previous = done[row.itemId];
        setDone(d => ({ ...d, [row.itemId]: level }));
        setSaving(row.itemId);
        setError('');
        try {
            const result = await reportGroceryLevel(row.itemId, level);
            if (!result.ok) throw new Error(result.error);
            void refreshGroceryView(uid);
        } catch {
            setDone(d => {
                const next = { ...d };
                if (previous) next[row.itemId] = previous;
                else delete next[row.itemId];
                return next;
            });
            setError(t('grocery.check.failed', { name: itemName(row, locale) }));
        }
        setSaving(null);
    };

    return (
        <Card className="mb-5 p-4 sm:p-5">
            <div className="mb-3 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong" aria-hidden="true">
                    {allDone ? <CheckCircle2 size={18} /> : <ClipboardCheck size={18} />}
                </span>
                <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink">{t('grocery.check.title')}</h2>
                    <p className="text-sm text-ink-muted" aria-live="polite">
                        {allDone ? t('grocery.check.allDone') : t('grocery.check.progress', { done: doneCount, total: rows.length })}
                    </p>
                </div>
            </div>

            <ul className="space-y-4">
                {rows.map(row => {
                    const picked = done[row.itemId];
                    const name = itemName(row, locale);
                    return (
                        <li key={row.itemId} className="space-y-2">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                <p className="text-[15px] font-semibold text-ink">
                                    {name}
                                    {locale !== 'en' && <span className="ml-1.5 text-sm font-normal text-ink-muted">{row.en}</span>}
                                </p>
                                {picked && <span className="text-xs font-semibold text-success">✓ {t(`grocery.level.${picked}`)}</span>}
                            </div>
                            {row.neededOn && (
                                <p className="text-xs text-ink-muted">
                                    {t('grocery.neededFor', { day: groceryDayLabel(row.neededOn, view.today, t, locale), dishes: row.dishes.join(', ') })}
                                </p>
                            )}
                            <LevelPicker value={picked ?? null} onChange={level => pick(row, level)} label={name} disabled={saving === row.itemId} />
                        </li>
                    );
                })}
            </ul>

            {error && <Alert tone="error" className="mt-3">{error}</Alert>}
        </Card>
    );
}
