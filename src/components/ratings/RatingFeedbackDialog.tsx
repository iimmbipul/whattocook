'use client';

import Link from 'next/link';
import { ChefHat, Soup } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { mealDayLabel, plural, sessionLabel } from '@/lib/ratings/client';
import type { FeedbackComment, NewFeedback, RoleFeedback } from '@/lib/ratings/types';
import { StarScore } from './Stars';

/**
 * Shown the next time someone opens the app after new ratings came in: one
 * consolidated summary, however many sessions were rated meanwhile. A cook
 * sees their dishes; a flatmate sees their turns as chef (and their dishes,
 * in a household without a hired cook).
 */
export default function RatingFeedbackDialog({ feedback, today, onClose }: { feedback: NewFeedback; today: string; onClose: () => void }) {
    const { t } = useLocale();
    const { cook, chef } = feedback;
    const count = (cook?.count ?? 0) + (chef?.count ?? 0);

    return (
        <Dialog
            open
            onClose={onClose}
            title={t('ratings.feedback.title')}
            description={plural(t, 'ratings.countRatings', count)}
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
            <div className="space-y-6">
                {cook && <RoleSection role="cook" data={cook} today={today} />}
                {chef && <RoleSection role="chef" data={chef} today={today} />}
            </div>
        </Dialog>
    );
}

function RoleSection({ role, data, today }: { role: 'cook' | 'chef'; data: RoleFeedback; today: string }) {
    const { t, locale } = useLocale();
    const Icon = role === 'cook' ? Soup : ChefHat;
    return (
        <section>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2.5">
                <div className="min-w-0">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                        <Icon size={16} aria-hidden="true" />
                        {t(`ratings.feedback.${role}Section`)}
                    </h3>
                    <p className="text-xs text-ink-muted">
                        {plural(t, 'ratings.countRatings', data.count)} · {plural(t, 'ratings.countMeals', data.sessions.length)}
                    </p>
                </div>
                <StarScore value={data.average} className="text-xl font-bold text-ink" />
            </div>

            <ul className="mt-3 space-y-3">
                {data.sessions.map(s => (
                    <li key={`${s.date}_${s.session}`} className="rounded-xl border border-line p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <p className="text-sm font-semibold text-ink">
                                {sessionLabel(s.session, t)} · {mealDayLabel(s.date, today, t, locale)}
                            </p>
                            {role === 'chef' && <StarScore value={s.average} className="text-sm font-semibold text-ink" />}
                        </div>
                        {role === 'cook' ? (
                            <ul className="mt-1.5 space-y-1">
                                {s.dishScores.map(d => (
                                    <li key={d.slot} className="flex items-baseline justify-between gap-3 text-sm">
                                        <span className="min-w-0 text-ink">{d.name}</span>
                                        <span className="flex shrink-0 items-baseline gap-2">
                                            <StarScore value={d.average} className="font-semibold text-ink" />
                                            <span className="text-xs text-ink-muted">{plural(t, 'ratings.countRatings', d.count)}</span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <>
                                {s.menu.length > 0 && <p className="mt-0.5 text-sm text-ink-muted">{s.menu.join(' · ')}</p>}
                                <p className="mt-0.5 text-xs text-ink-muted">{plural(t, 'ratings.countRatings', s.count)}</p>
                            </>
                        )}
                        <Comments comments={s.comments} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

function Comments({ comments }: { comments: FeedbackComment[] }) {
    if (comments.length === 0) return null;
    return (
        <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
            {comments.map((c, i) => (
                <li key={i} className="text-sm text-ink">
                    <span className="text-ink-muted">“</span>{c.text}<span className="text-ink-muted">”</span>
                    {c.name && <span className="ml-1 text-ink-muted">— {c.name}</span>}
                </li>
            ))}
        </ul>
    );
}
