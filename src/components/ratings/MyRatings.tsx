'use client';

import { useEffect, useState } from 'react';
import { ChefHat, EyeOff, Soup, Users } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { EmptyState, Section } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Spinner';
import { formatAverage, loadRatingsDashboard, mealDayLabel, plural, sessionLabel } from '@/lib/ratings/client';
import type { RatingRole, RatingsDashboard, RoleDashboard } from '@/lib/ratings/types';
import RatingTrendChart from './RatingTrendChart';
import { StarScore } from './Stars';

const HISTORY_PREVIEW = 8;
const DISHES_PREVIEW = 6;

const COLOR: Record<RatingRole, { line: string; bar: string }> = {
    cook: { line: 'var(--color-series-dish)', bar: 'bg-series-dish' },
    chef: { line: 'var(--color-series-chef)', bar: 'bg-series-chef' },
};

/**
 * Ratings on the profile page, split by what was rated:
 *   - "Ratings for my dishes": every dish this person cooked. Always shown to
 *     a hired cook; shown to a flatmate only once they have some (in a
 *     household without a hired cook, the chef cooks).
 *   - "My chef ratings": how flatmates rated this person's turns as chef on
 *     duty. Shown to every flatmate, never to a hired cook.
 */
export default function MyRatings({ uid, isHiredCook }: { uid: string; isHiredCook: boolean }) {
    const { t } = useLocale();
    const [data, setData] = useState<RatingsDashboard | null | undefined>(undefined);

    useEffect(() => {
        let alive = true;
        loadRatingsDashboard(uid).then(d => {
            if (alive) setData(d);
        });
        return () => {
            alive = false;
        };
    }, [uid]);

    if (data === undefined) return <Skeleton className="h-40 rounded-2xl" />;
    if (!data || (!data.cook && !data.chef)) return null;

    const footer = (
        <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
            {data.namesVisible ? <Users size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            {data.namesVisible ? t('ratings.my.namedNote') : t('ratings.my.anonymousNote')}
        </p>
    );

    return (
        <section id="my-ratings" className="scroll-mt-24 space-y-4">
            {data.cook && <RoleRatings role="cook" data={data.cook} today={data.today} footer={footer} isHiredCook={isHiredCook} />}
            {data.chef && <RoleRatings role="chef" data={data.chef} today={data.today} footer={footer} isHiredCook={isHiredCook} />}
        </section>
    );
}

function RoleRatings({
    role,
    data,
    today,
    footer,
    isHiredCook,
}: {
    role: RatingRole;
    data: RoleDashboard;
    today: string;
    footer: React.ReactNode;
    isHiredCook: boolean;
}) {
    const { t, locale } = useLocale();
    const [showAll, setShowAll] = useState(false);
    const [allDishes, setAllDishes] = useState(false);
    const { history, comments, dishes } = data;
    const visibleHistory = showAll ? history : history.slice(0, HISTORY_PREVIEW);
    const visibleDishes = allDishes ? dishes : dishes.slice(0, DISHES_PREVIEW);
    const Icon = role === 'cook' ? Soup : ChefHat;
    const what = t(`ratings.my.${role}What`);

    return (
        <Section
            icon={<Icon size={18} />}
            title={t(`ratings.my.${role}Title`)}
            description={role === 'cook' && !isHiredCook ? t('ratings.my.cookDescriptionFlatmate') : t(`ratings.my.${role}Description`)}
        >
            {!data.hasRatings ? (
                <EmptyState icon={<Icon size={22} />} title={t(`ratings.my.${role}Empty`)} body={t(`ratings.my.${role}EmptyBody`)} />
            ) : (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-2">
                        <Tile label={t(`ratings.my.${role}Average`)}>
                            <StarScore value={data.average} className="text-2xl font-bold text-ink" />
                        </Tile>
                        <Tile label={t('ratings.my.received')}>
                            <p className="text-2xl font-bold tabular-nums text-ink">{data.count}</p>
                            <p className="text-xs text-ink-muted">{plural(t, 'ratings.countMeals', data.sessionCount)}</p>
                        </Tile>
                    </div>

                    <div>
                        <h3 className="mb-2 text-sm font-semibold text-ink">{t('ratings.my.breakdown')}</h3>
                        <Breakdown counts={data.hist} color={COLOR[role].bar} />
                    </div>

                    {role === 'cook' && dishes.length > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-ink">{t('ratings.my.byDish')}</h3>
                            <p className="mb-2 text-xs text-ink-muted">{t('ratings.my.byDishNote')}</p>
                            <ul className="divide-y divide-line rounded-xl border border-line">
                                {visibleDishes.map(d => (
                                    <li key={d.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-ink">{d.name}</p>
                                            <p className="text-xs text-ink-muted">
                                                {plural(t, 'ratings.countRatings', d.count)} · {plural(t, 'ratings.countServed', d.times)}
                                            </p>
                                        </div>
                                        <StarScore value={d.average} className="shrink-0 text-sm font-semibold text-ink" />
                                    </li>
                                ))}
                            </ul>
                            {dishes.length > DISHES_PREVIEW && (
                                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAllDishes(v => !v)}>
                                    {allDishes ? t('ratings.my.showLess') : t('ratings.my.showAll', { count: dishes.length })}
                                </Button>
                            )}
                        </div>
                    )}

                    <div>
                        <h3 className="mb-2 text-sm font-semibold text-ink">{t('ratings.my.trend')}</h3>
                        <RatingTrendChart points={data.trend} color={COLOR[role].line} label={what} ariaLabel={t(`ratings.my.${role}TrendAria`)} />
                    </div>

                    <div>
                        <h3 className="mb-2 text-sm font-semibold text-ink">{t('ratings.my.history')}</h3>
                        <ul className="divide-y divide-line rounded-xl border border-line">
                            {visibleHistory.map(s => (
                                <li key={`${s.date}_${s.session}`} className="px-3 py-2.5">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="min-w-0 text-sm font-medium text-ink">
                                            {sessionLabel(s.session, t)} · {mealDayLabel(s.date, today, t, locale)}
                                        </p>
                                        {role === 'chef' && (
                                            <span className="flex shrink-0 items-center gap-2 text-sm text-ink">
                                                <StarScore value={s.average} label={`${what} ${formatAverage(s.average)} / 5`} />
                                                <Count count={s.count} />
                                            </span>
                                        )}
                                    </div>
                                    {role === 'cook' ? (
                                        <ul className="mt-1 space-y-0.5">
                                            {s.dishScores.map(d => (
                                                <li key={d.slot} className="flex items-center justify-between gap-3 text-xs">
                                                    <span className="min-w-0 truncate text-ink-muted">{d.name}</span>
                                                    <span className="flex shrink-0 items-center gap-2 text-sm text-ink">
                                                        <StarScore value={d.average} label={`${d.name} ${formatAverage(d.average)} / 5`} />
                                                        <Count count={d.count} />
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        s.menu.length > 0 && <p className="truncate text-xs text-ink-muted">{s.menu.join(' · ')}</p>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {history.length > HISTORY_PREVIEW && (
                            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(v => !v)}>
                                {showAll ? t('ratings.my.showLess') : t('ratings.my.showAll', { count: history.length })}
                            </Button>
                        )}
                    </div>

                    <div>
                        <h3 className="mb-2 text-sm font-semibold text-ink">{t('ratings.my.comments')}</h3>
                        {comments.length === 0 ? (
                            <p className="text-sm text-ink-muted">{t('ratings.my.noComments')}</p>
                        ) : (
                            <ul className="space-y-2">
                                {comments.map((c, i) => (
                                    <li key={i} className="rounded-xl bg-surface-muted px-3 py-2.5">
                                        <p className="text-sm text-ink">“{c.text}”</p>
                                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                                            <span>{sessionLabel(c.session, t)} · {mealDayLabel(c.date, today, t, locale)}</span>
                                            {c.stars !== null && <StarScore value={c.stars} label={`${formatAverage(c.stars)} / 5`} />}
                                            {c.name && <span>— {c.name}</span>}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {footer}
                </div>
            )}
        </Section>
    );
}

function Count({ count }: { count: number }) {
    const { t } = useLocale();
    return (
        <span className="w-6 text-right text-xs text-ink-muted tabular-nums" title={plural(t, 'ratings.countRatings', count)}>
            <span aria-hidden="true">×{count}</span>
            <span className="sr-only">{plural(t, 'ratings.countRatings', count)}</span>
        </span>
    );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0 rounded-xl bg-surface-muted px-3 py-2.5">
            <p className="text-xs font-medium leading-tight text-ink-muted">{label}</p>
            <div className="mt-0.5">{children}</div>
        </div>
    );
}

/** Count of 5-star … 1-star ratings as horizontal bars, value at the tip. */
function Breakdown({ counts, color }: { counts: number[]; color: string }) {
    const { t } = useLocale();
    const max = Math.max(1, ...counts);
    return (
        <ul className="space-y-1.5">
            {[5, 4, 3, 2, 1].map(stars => {
                const count = counts[stars - 1] ?? 0;
                return (
                    <li key={stars} className="flex items-center gap-2 text-xs text-ink">
                        <span className="w-7 shrink-0 tabular-nums" aria-hidden="true">{stars}★</span>
                        <span className="sr-only">{t('ratings.starLabel', { count: stars })}:</span>
                        <span className="h-3 flex-1 rounded-r bg-surface-muted" aria-hidden="true">
                            {count > 0 && <span className={`block h-3 rounded-r ${color}`} style={{ width: `${(count / max) * 100}%` }} />}
                        </span>
                        <span className="w-6 shrink-0 text-right tabular-nums">{count}</span>
                    </li>
                );
            })}
        </ul>
    );
}
