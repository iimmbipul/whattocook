'use client';

import { useEffect, useState } from 'react';
import { EyeOff, Star, Users } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { EmptyState, Section } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Spinner';
import { formatAverage, loadRatingsDashboard, mealDayLabel, plural, sessionLabel } from '@/lib/ratings/client';
import type { RatingsDashboard } from '@/lib/ratings/types';
import RatingTrendChart from './RatingTrendChart';
import { StarScore } from './Stars';

const HISTORY_PREVIEW = 8;

/**
 * "My ratings" on the profile page: how the household rated the meals this
 * person cooked. Hidden for members who have never been rated; a hired cook
 * always sees it, with an empty state until the first rating.
 */
export default function MyRatings({ uid, isHiredCook }: { uid: string; isHiredCook: boolean }) {
    const { t, locale } = useLocale();
    const [data, setData] = useState<RatingsDashboard | null | undefined>(undefined);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        let alive = true;
        loadRatingsDashboard(uid).then(d => {
            if (alive) setData(d);
        });
        return () => {
            alive = false;
        };
    }, [uid]);

    if (data === undefined) {
        return isHiredCook ? <Skeleton className="h-40 rounded-2xl" /> : null;
    }
    if (!data || (!data.hasRatings && !isHiredCook)) return null;

    const { totals, history, feedback, today } = data;
    const visibleHistory = showAll ? history : history.slice(0, HISTORY_PREVIEW);

    return (
        <section id="my-ratings" className="scroll-mt-24">
            <Section icon={<Star size={18} />} title={t('ratings.my.title')} description={t('ratings.my.description')}>
                {!data.hasRatings ? (
                    <EmptyState icon={<Star size={22} />} title={t('ratings.my.empty')} body={t('ratings.my.emptyBody')} />
                ) : (
                    <div className="space-y-6">
                        <div className="grid grid-cols-3 gap-2">
                            <Tile label={t('ratings.my.foodAverage')}>
                                <StarScore value={totals.food} className="text-2xl font-bold text-ink" />
                            </Tile>
                            <Tile label={t('ratings.my.cookAverage')}>
                                <StarScore value={totals.cook} className="text-2xl font-bold text-ink" />
                            </Tile>
                            <Tile label={t('ratings.my.received')}>
                                <p className="text-2xl font-bold tabular-nums text-ink">{totals.count}</p>
                                <p className="text-xs text-ink-muted">{plural(t, 'ratings.countMeals', totals.sessionCount)}</p>
                            </Tile>
                        </div>

                        <div>
                            <h3 className="mb-2 text-sm font-semibold text-ink">{t('ratings.my.breakdown')}</h3>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Breakdown title={t('ratings.food')} counts={totals.foodHist} color="bg-series-food" />
                                <Breakdown title={t('ratings.cookUnnamed')} counts={totals.cookHist} color="bg-series-cook" />
                            </div>
                        </div>

                        <div>
                            <h3 className="mb-2 text-sm font-semibold text-ink">{t('ratings.my.trend')}</h3>
                            <RatingTrendChart points={data.trend} />
                        </div>

                        <div>
                            <h3 className="mb-2 text-sm font-semibold text-ink">{t('ratings.my.history')}</h3>
                            <ul className="divide-y divide-line rounded-xl border border-line">
                                {visibleHistory.map(s => (
                                    <li key={`${s.date}_${s.session}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-ink">
                                                {sessionLabel(s.session, t)} · {mealDayLabel(s.date, today, t, locale)}
                                            </p>
                                            <p className="truncate text-xs text-ink-muted">{s.dishes.join(' · ')}</p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-3 text-sm text-ink">
                                            <StarScore value={s.food} label={`${t('ratings.food')} ${formatAverage(s.food)} / 5`} />
                                            <StarScore value={s.cook} label={`${t('ratings.cookUnnamed')} ${formatAverage(s.cook)} / 5`} className="text-ink-muted" />
                                            <span className="w-6 text-right text-xs text-ink-muted tabular-nums" title={plural(t, 'ratings.countRatings', s.count)}>
                                                <span aria-hidden="true">×{s.count}</span>
                                                <span className="sr-only">{plural(t, 'ratings.countRatings', s.count)}</span>
                                            </span>
                                        </div>
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
                            {feedback.length === 0 ? (
                                <p className="text-sm text-ink-muted">{t('ratings.my.noComments')}</p>
                            ) : (
                                <ul className="space-y-2">
                                    {feedback.map((c, i) => (
                                        <li key={i} className="rounded-xl bg-surface-muted px-3 py-2.5">
                                            <p className="text-sm text-ink">“{c.text}”</p>
                                            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                                                <span>{sessionLabel(c.session, t)} · {mealDayLabel(c.date, today, t, locale)}</span>
                                                <StarScore value={c.food} label={`${t('ratings.food')} ${c.food} / 5`} />
                                                {c.name && <span>— {c.name}</span>}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
                            {data.namesVisible ? <Users size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                            {data.namesVisible ? t('ratings.my.namedNote') : t('ratings.my.anonymousNote')}
                        </p>
                    </div>
                )}
            </Section>
        </section>
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
function Breakdown({ title, counts, color }: { title: string; counts: number[]; color: string }) {
    const { t } = useLocale();
    const max = Math.max(1, ...counts);
    return (
        <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">{title}</p>
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
        </div>
    );
}
