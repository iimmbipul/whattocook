'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CheckCircle2, MessageSquarePlus, X } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, TextArea } from '@/components/ui/Field';
import { MAX_COMMENT_LENGTH } from '@/lib/ratings/logic';
import { skipMealRating, submitMealRating } from '@/lib/ratings/actions';
import type { PendingRating, RatingResult } from '@/lib/ratings/types';
import { StarInput } from './Stars';

/**
 * The "How was dinner?" card. It sits above the tab bar without covering the
 * page or trapping focus, so the app stays fully usable while it's open.
 * Submitting or skipping (including the close button and Escape) records the
 * choice, so the same session is never asked about again.
 */
export default function MealRatingPrompt({
    pending,
    today,
    namesVisible,
    onDone,
}: {
    pending: PendingRating;
    today: string;
    namesVisible: boolean;
    onDone: () => void;
}) {
    const { t } = useLocale();
    const titleId = useId();
    const commentId = useId();
    const [food, setFood] = useState(0);
    const [cook, setCook] = useState(0);
    const [comment, setComment] = useState('');
    const [showComment, setShowComment] = useState(false);
    const [busy, setBusy] = useState<'submit' | 'skip' | null>(null);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);
    const commentRef = useRef<HTMLTextAreaElement>(null);
    const onDoneRef = useRef(onDone);
    useEffect(() => {
        onDoneRef.current = onDone;
    });

    // After "Thanks!", move on by itself.
    useEffect(() => {
        if (!sent) return;
        const timer = window.setTimeout(() => onDoneRef.current(), 1600);
        return () => window.clearTimeout(timer);
    }, [sent]);

    useEffect(() => {
        if (showComment) commentRef.current?.focus();
    }, [showComment]);

    const when = pending.date === today ? 'today' : 'yesterday';
    const title = t(`ratings.prompt.${pending.session}.${when}`);
    const hasCook = pending.cookName !== null;
    const cookLabel = pending.cookName ? t('ratings.cookNamed', { name: pending.cookName }) : t('ratings.cookUnnamed');
    const starLabel = (n: number) => t('ratings.starLabel', { count: n });

    // A rating that already exists, or a session that closed meanwhile, is done too.
    const settled = (r: RatingResult) => r.ok || r.error === 'duplicate' || r.error === 'closed' || r.error === 'not-eligible';

    const submit = async () => {
        if (!food || busy) return;
        setBusy('submit');
        setError('');
        try {
            const result = await submitMealRating({
                date: pending.date,
                session: pending.session,
                food,
                cook: hasCook && cook ? cook : null,
                comment: comment.trim() || undefined,
            });
            if (result.ok) setSent(true);
            else if (settled(result)) onDone();
            else {
                setError(t('ratings.error'));
                setBusy(null);
            }
        } catch {
            setError(t('ratings.error'));
            setBusy(null);
        }
    };

    const skip = async () => {
        if (busy) return;
        setBusy('skip');
        try {
            await skipMealRating(pending.date, pending.session);
        } catch {
            // Hide it anyway; skipping must never get in the way.
        }
        onDone();
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && !sent) {
            e.stopPropagation();
            void skip();
        }
    };

    return (
        <section
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
            className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md animate-sheet-up rounded-2xl border border-line bg-surface p-4 shadow-overlay sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[384px]"
        >
            {sent ? (
                <div role="status" className="flex items-center gap-3 py-1">
                    <CheckCircle2 size={22} className="shrink-0 text-success" aria-hidden="true" />
                    <p className="text-[15px] font-medium text-ink">{t('ratings.thanks')}</p>
                </div>
            ) : (
                <>
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h2 id={titleId} className="text-[15px] font-semibold text-ink">{title}</h2>
                            {pending.dishes.length > 0 && (
                                <p className="mt-0.5 truncate text-sm text-ink-muted">{pending.dishes.join(' · ')}</p>
                            )}
                        </div>
                        <IconButton label={t('ratings.skipAria')} size="sm" onClick={skip} disabled={!!busy} className="-mr-1 -mt-1">
                            <X size={18} aria-hidden="true" />
                        </IconButton>
                    </div>

                    <div className="mt-2 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-sm font-medium text-ink">{t('ratings.food')}</span>
                            <StarInput value={food} onChange={setFood} label={t('ratings.food')} starLabel={starLabel} disabled={!!busy} />
                        </div>
                        {hasCook && (
                            <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 leading-tight">
                                    <span className="block text-sm font-medium text-ink">{t('ratings.cookUnnamed')}</span>
                                    {pending.cookName && <span className="block truncate text-xs text-ink-muted">{pending.cookName}</span>}
                                </span>
                                <StarInput value={cook} onChange={setCook} label={cookLabel} starLabel={starLabel} disabled={!!busy} />
                            </div>
                        )}
                    </div>

                    {showComment ? (
                        <div className="mt-2 space-y-1">
                            <label htmlFor={commentId} className="sr-only">{t('ratings.commentLabel')}</label>
                            <TextArea
                                id={commentId}
                                ref={commentRef}
                                rows={2}
                                maxLength={MAX_COMMENT_LENGTH}
                                value={comment}
                                onChange={e => setComment(e.target.value)}
                                placeholder={t('ratings.commentPlaceholder')}
                                disabled={!!busy}
                            />
                            <p className="text-right text-xs text-ink-subtle" aria-live="polite">
                                {comment.length}/{MAX_COMMENT_LENGTH}
                            </p>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setShowComment(true)}
                            disabled={!!busy}
                            className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-accent-strong hover:text-accent-hover"
                        >
                            <MessageSquarePlus size={16} aria-hidden="true" />
                            {t('ratings.addComment')}
                        </button>
                    )}

                    {error && <Alert tone="error" className="mt-2">{error}</Alert>}

                    <p className="mt-2 text-xs text-ink-subtle">{namesVisible ? t('ratings.namedNote') : t('ratings.anonymousNote')}</p>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={skip} loading={busy === 'skip'} disabled={busy === 'submit'}>
                            {t('ratings.skip')}
                        </Button>
                        <Button onClick={submit} disabled={!food || busy === 'skip'} loading={busy === 'submit'} loadingText={t('ratings.sending')}>
                            {t('ratings.submit')}
                        </Button>
                    </div>
                </>
            )}
        </section>
    );
}
