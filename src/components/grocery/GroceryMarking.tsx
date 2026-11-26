'use client';

import { useId, useMemo, useState } from 'react';
import { Check, CircleSlash, Plus, Search } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { TextInput } from '@/components/ui/Field';
import { addGroceryItem, markGroceryItem } from '@/lib/grocery/actions';
import { itemName, markedAt, refreshGroceryView } from '@/lib/grocery/client';
import { CATEGORIES, type Category } from '@/lib/grocery/catalog';
import { exactItem, searchItems, type ItemLevel, type MemberLevel } from '@/lib/grocery/logic';
import type { GroceryResult, GroceryRow, GroceryView, MarkedItem } from '@/lib/grocery/types';
import { JarIcon } from './LevelPicker';

/**
 * Members (and everyone else) mark items Out of stock or Full from a search
 * box, add items that aren't listed yet, and see the whole inventory with who
 * marked each item last. The server applies the same rules as the cook's stock
 * check, so the shopping list and check schedule follow.
 */

export const LEVEL_TONE: Record<ItemLevel, string> = {
    empty: 'text-danger',
    quarter: 'text-warning',
    half: 'text-warning',
    full: 'text-success',
    unknown: 'text-ink-subtle',
};

/** Shared busy/notice state for marking from the search box and the Inventory list. */
export function useGroceryMarking(uid: string) {
    const { t, locale } = useLocale();
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

    const run = async (key: string, name: string, level: MemberLevel, call: () => Promise<GroceryResult<MarkedItem>>): Promise<boolean> => {
        setBusy(key);
        setNotice(null);
        try {
            const result = await call();
            if (!result.ok) throw new Error(result.error);
            const done = result.data.isNew ? (level === 'empty' ? 'addedOut' : 'addedFull') : level === 'empty' ? 'markedOut' : 'markedFull';
            setNotice({ tone: 'success', text: t(`grocery.mark.${done}`, { name: itemName(result.data, locale) }) });
            await refreshGroceryView(uid);
            return true;
        } catch {
            setNotice({ tone: 'error', text: t('grocery.mark.failed', { name }) });
            return false;
        } finally {
            setBusy(null);
        }
    };

    return {
        busy,
        notice,
        mark: (itemId: string, name: string, level: MemberLevel) => run(`${itemId}:${level}`, name, level, () => markGroceryItem(itemId, level)),
        add: (name: string, level: MemberLevel) => run(`new:${level}`, name, level, () => addGroceryItem(name, level)),
    };
}

export type GroceryMarking = ReturnType<typeof useGroceryMarking>;

function MarkButtons({ marking, busyKey, name, onMark }: { marking: GroceryMarking; busyKey: string; name: string; onMark: (level: MemberLevel) => void }) {
    const { t } = useLocale();
    const blocked = (level: MemberLevel) => marking.busy !== null && marking.busy !== `${busyKey}:${level}`;
    return (
        <div className="flex shrink-0 gap-2">
            <Button
                size="sm"
                variant="danger-soft"
                loading={marking.busy === `${busyKey}:empty`}
                disabled={blocked('empty')}
                leadingIcon={<CircleSlash size={14} aria-hidden="true" />}
                onClick={() => onMark('empty')}
                aria-label={t('grocery.mark.outAria', { name })}
            >
                {t('grocery.mark.out')}
            </Button>
            <Button
                size="sm"
                variant="secondary"
                loading={marking.busy === `${busyKey}:full`}
                disabled={blocked('full')}
                leadingIcon={<Check size={14} aria-hidden="true" />}
                onClick={() => onMark('full')}
                aria-label={t('grocery.mark.fullAria', { name })}
            >
                {t('grocery.mark.full')}
            </Button>
        </div>
    );
}

/** "Empty · Marked today, 10:30 by Asha" */
export function ItemStatus({ row }: { row: GroceryRow }) {
    const { t, locale } = useLocale();
    const who = row.reportedByName
        ? row.reportedByRole === 'cook'
            ? t('grocery.inventory.byCook', { name: row.reportedByName })
            : row.reportedByName
        : null;
    return (
        <p className="text-xs text-ink-muted">
            <span className={cn('font-semibold', LEVEL_TONE[row.level])}>{t(`grocery.level.${row.level}`)}</span>
            {' · '}
            {row.levelAtMs
                ? who
                    ? t('grocery.inventory.markedBy', { when: markedAt(row.levelAtMs, t, locale), name: who })
                    : t('grocery.inventory.marked', { when: markedAt(row.levelAtMs, t, locale) })
                : t('grocery.inventory.neverMarked')}
        </p>
    );
}

interface SearchEntry {
    id: string;
    names: string[];
    item: { en: string; hi: string; or: string; category: Category };
    row?: GroceryRow;
}

/** Search the household's items and the catalogue; mark one, or add what isn't there. */
export function GrocerySearch({ view, marking }: { view: GroceryView; marking: GroceryMarking }) {
    const { t, locale } = useLocale();
    const inputId = useId();
    const [query, setQuery] = useState('');

    const entries = useMemo<SearchEntry[]>(() => {
        const rows = new Map(view.pantry.map(r => [r.itemId, r]));
        const catalogIds = new Set(view.catalog.map(c => c.id));
        return [
            ...view.catalog.map(c => ({ id: c.id, names: [c.en, c.hi, c.or, ...c.aliases].filter(Boolean), item: c, row: rows.get(c.id) })),
            ...view.pantry.filter(r => !catalogIds.has(r.itemId)).map(r => ({ id: r.itemId, names: [r.en, r.hi, r.or].filter(Boolean), item: r, row: r })),
        ];
    }, [view]);

    const q = query.trim();
    const results = q ? searchItems(entries, q, 6) : [];
    const canAdd = q.length >= 2 && !exactItem(entries, q);
    const clearOnSuccess = (ok: boolean) => {
        if (ok) setQuery('');
    };

    return (
        <Card className="mb-5 p-4 sm:p-5">
            <label htmlFor={inputId} className="text-base font-semibold text-ink">
                {t('grocery.mark.title')}
            </label>
            <p className="mt-0.5 text-sm text-ink-muted">{t('grocery.mark.hint')}</p>
            <div className="relative mt-3">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
                <TextInput
                    id={inputId}
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value.slice(0, 40))}
                    placeholder={t('grocery.mark.placeholder')}
                    autoComplete="off"
                    className="pl-9"
                />
            </div>

            {q && (
                <ul className="mt-2 divide-y divide-line" aria-live="polite">
                    {results.map(entry => {
                        const name = itemName(entry.item, locale);
                        return (
                            <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-ink">
                                        {name}
                                        {locale !== 'en' && name !== entry.item.en && <span className="ml-1.5 text-sm font-normal text-ink-muted">{entry.item.en}</span>}
                                    </p>
                                    {entry.row && !entry.row.virtual ? (
                                        <ItemStatus row={entry.row} />
                                    ) : (
                                        <p className="text-xs text-ink-muted">{t(`grocery.category.${entry.item.category}`)} · {t('grocery.mark.notTracked')}</p>
                                    )}
                                </div>
                                <MarkButtons marking={marking} busyKey={entry.id} name={name} onMark={level => marking.mark(entry.id, name, level).then(clearOnSuccess)} />
                            </li>
                        );
                    })}
                    {canAdd && (
                        <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 font-semibold text-ink">
                                    <Plus size={15} aria-hidden="true" /> {t('grocery.mark.add', { name: q })}
                                </p>
                                <p className="text-xs text-ink-muted">{t('grocery.mark.addHint')}</p>
                            </div>
                            <MarkButtons marking={marking} busyKey="new" name={q} onMark={level => marking.add(q, level).then(clearOnSuccess)} />
                        </li>
                    )}
                    {results.length === 0 && !canAdd && <li className="py-3 text-sm text-ink-muted">{t('grocery.mark.tooShort')}</li>}
                </ul>
            )}
        </Card>
    );
}

/** Every tracked item, by category: status, when it was last marked and by whom. */
export function InventoryList({ view, marking }: { view: GroceryView; marking: GroceryMarking }) {
    const { t, locale } = useLocale();
    const tracked = view.pantry.filter(r => r.active);
    if (tracked.length === 0) {
        return (
            <Card>
                <EmptyState icon={<Search size={22} />} title={t('grocery.inventory.emptyTitle')} body={t('grocery.inventory.emptyBody')} />
            </Card>
        );
    }
    return (
        <div className="space-y-6">
            {CATEGORIES.map(category => {
                const rows = tracked.filter(r => r.category === category);
                if (rows.length === 0) return null;
                return (
                    <section key={category} aria-labelledby={`inventory-${category}`}>
                        <h2 id={`inventory-${category}`} className="mb-2 text-sm font-semibold text-ink">
                            {t(`grocery.category.${category}`)} <span className="font-normal text-ink-muted">({rows.length})</span>
                        </h2>
                        <Card className="divide-y divide-line">
                            {rows.map(row => {
                                const name = itemName(row, locale);
                                return (
                                    <div key={row.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                                        <span className={LEVEL_TONE[row.level]}>
                                            <JarIcon level={row.level} size={22} />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-ink">
                                                {name}
                                                {locale !== 'en' && name !== row.en && <span className="ml-1.5 text-sm font-normal text-ink-muted">{row.en}</span>}
                                            </p>
                                            <ItemStatus row={row} />
                                        </div>
                                        <MarkButtons marking={marking} busyKey={row.itemId} name={name} onMark={level => void marking.mark(row.itemId, name, level)} />
                                    </div>
                                );
                            })}
                        </Card>
                    </section>
                );
            })}
        </div>
    );
}
