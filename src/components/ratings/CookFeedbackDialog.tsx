'use client';

import Link from 'next/link';
import { useLocale } from '@/context/LocaleContext';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { mealDayLabel, plural, sessionLabel } from '@/lib/ratings/client';
import type { CookFeedback } from '@/lib/ratings/types';
import { StarScore } from './Stars';

/**
 * Shown to the cook the next time they open the app after new ratings came
 * in: one consolidated summary, however many sessions were rated meanwhile.
 */
export default function CookFeedbackDialog({ feedback, today, onClose }: { feedback: CookFeedback; today: string; onClose: () => void }) {
    const { t, locale } = useLocale();
    const { totals, sessions } = feedback;

    return (
        <Dialog
            open
            onClose={onClose}
            title={t('ratings.feedback.title')}
            description={`${plural(t, 'ratings.countRatings', totals.count)} · ${plural(t, 'ratings.countMeals', sessions.length)}`}
            closeLabel={t('common.close')}
            footer={
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <Link
                        href="/profile#my-ratings"
                        onClick={onClose}
                        className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-semibold text-accent-strong hover:bg-accent-soft"
                    >
                        {t('ratings.feedback.seeAll')}
                    </Link>
                    <Button onClick={onClose}>{t('ratings.feedback.gotIt')}</Button>
                </div>
            }
        >
            <div className="grid grid-cols-2 gap-2">
                <Average label={t('ratings.food')} value={totals.food} />
                <Average label={t('ratings.cookUnnamed')} value={totals.cook} />
            </div>

            <ul className="mt-4 space-y-3">
                {sessions.map(s => (
                    <li key={`${s.date}_${s.session}`} className="rounded-xl border border-line p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <p className="text-sm font-semibold text-ink">
                                {sessionLabel(s.session, t)} · {mealDayLabel(s.date, today, t, locale)}
                            </p>
                            <p className="text-xs text-ink-muted">{plural(t, 'ratings.countRatings', s.count)}</p>
                        </div>
                        {s.dishes.length > 0 && <p className="mt-0.5 text-sm text-ink-muted">{s.dishes.join(' · ')}</p>}
                        <div className="mt-2 flex gap-4 text-sm text-ink">
                            <span>{t('ratings.food')} <StarScore value={s.food} className="ml-1 font-semibold" /></span>
                            <span>{t('ratings.cookUnnamed')} <StarScore value={s.cook} className="ml-1 font-semibold" /></span>
                        </div>
                        {s.comments.length > 0 && (
                            <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
                                {s.comments.map((c, i) => (
                                    <li key={i} className="text-sm text-ink">
                                        <span className="text-ink-muted">“</span>{c.text}<span className="text-ink-muted">”</span>
                                        {c.name && <span className="ml-1 text-ink-muted">— {c.name}</span>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </li>
                ))}
            </ul>
        </Dialog>
    );
}

function Average({ label, value }: { label: string; value: number | null }) {
    return (
        <div className="rounded-xl bg-surface-muted px-3 py-2.5">
            <p className="text-xs font-medium text-ink-muted">{label}</p>
            <StarScore value={value} className="mt-0.5 text-xl font-bold text-ink" />
        </div>
    );
}
