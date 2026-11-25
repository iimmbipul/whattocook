'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CheckCircle2, ChefHat, MessageSquarePlus, X } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, TextArea } from '@/components/ui/Field';
import { MAX_COMMENT_LENGTH, type MealSlot } from '@/lib/ratings/logic';
import { skipMealRating, submitMealRating } from '@/lib/ratings/actions';
import type { PendingRating, RatingResult } from '@/lib/ratings/types';
import { StarInput } from './Stars';

/**
 * The "How was dinner?" card. Each dish is rated for the cook who made it,
 * and the flatmate on duty is rated separately for managing the meal. Every
 * row is optional; one rating is enough to send.
 *
 * It sits above the tab bar without covering the page or trapping focus, so
 * the app stays fully usable while it's open. Submitting or skipping
 * (including the close button and Escape) records the choice, so the same
 * session is never asked about again.
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
    const noteId = useId();
    const [dishStars, setDishStars] = useState<Partial<Record<MealSlot, number>>>({});
    const [chefStars, setChefStars] = useState(0);
    const [cookNote, setCookNote] = useState('');
    const [chefNote, setChefNote] = useState('');
    const [showNotes, setShowNotes] = useState(false);
    const [busy, setBusy] = useState<'submit' | 'skip' | null>(null);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);
    const firstNoteRef = useRef<HTMLTextAreaElement>(null);
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
        if (showNotes) firstNoteRef.current?.focus();
    }, [showNotes]);

    const when = pending.date === today ? 'today' : 'yesterday';
    const title = t(`ratings.prompt.${pending.session}.${when}`);
    const starLabel = (n: number) => t('ratings.starLabel', { count: n });
    const { dishes, chef } = pending;
    const chefName = chef?.name ?? '';

    const cookedBy = pending.chefCooked
        ? chefName ? t('ratings.cookedBy', { names: chefName }) : ''
        : pending.cookNames.filter(Boolean).length > 0 ? t('ratings.cookedBy', { names: pending.cookNames.filter(Boolean).join(', ') }) : '';

    const ratedDishes = dishes.filter(d => dishStars[d.slot]).map(d => ({ slot: d.slot, stars: dishStars[d.slot] as number }));
    const canSend = ratedDishes.length > 0 || chefStars > 0;

    // A rating that already exists, or a session that closed meanwhile, is done too.
    const settled = (r: RatingResult) => r.ok || r.error === 'duplicate' || r.error === 'closed' || r.error === 'not-eligible';

    const submit = async () => {
        if (!canSend || busy) return;
        setBusy('submit');
        setError('');
        try {
            const result = await submitMealRating({
                date: pending.date,
                session: pending.session,
                dishes: ratedDishes,
                chef: chef && chefStars ? chefStars : null,
                cookNote: ratedDishes.length > 0 ? cookNote.trim() || undefined : undefined,
                chefNote: chef && chefStars ? chefNote.trim() || undefined : undefined,
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
            className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto max-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] max-w-md animate-sheet-up overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-overlay sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-h-[calc(100dvh-3rem)] sm:w-[384px]"
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
                            {cookedBy && <p className="mt-0.5 text-sm text-ink-muted">{cookedBy}</p>}
                        </div>
                        <IconButton label={t('ratings.skipAria')} size="sm" onClick={skip} disabled={!!busy} className="-mr-1 -mt-1">
                            <X size={18} aria-hidden="true" />
                        </IconButton>
                    </div>

                    {dishes.length > 0 && (
                        <ul className="mt-2 space-y-0.5" aria-label={t('ratings.dishesHeading')}>
                            {dishes.map(d => (
                                <li key={d.slot} className="flex items-center justify-between gap-2">
                                    <span className="min-w-0 leading-tight">
                                        <span className="block text-xs text-ink-muted">{t(`ratings.slot.${d.slot}`)}</span>
                                        <span className="line-clamp-2 text-sm font-medium text-ink">{d.name}</span>
                                    </span>
                                    <StarInput
                                        value={dishStars[d.slot] ?? 0}
                                        onChange={n => setDishStars(s => ({ ...s, [d.slot]: n }))}
                                        label={t('ratings.rateDishAria', { dish: d.name })}
                                        starLabel={starLabel}
                                        disabled={!!busy}
                                    />
                                </li>
                            ))}
                        </ul>
                    )}

                    {chef && (
                        <div className={`flex items-center justify-between gap-2 ${dishes.length > 0 ? 'mt-2 border-t border-line pt-2' : 'mt-2'}`}>
                            <span className="min-w-0 leading-tight">
                                <span className="flex items-center gap-1 text-xs text-ink-muted">
                                    <ChefHat size={13} aria-hidden="true" />
                                    {t('ratings.chefOnDuty')}
                                </span>
                                {chefName && <span className="block truncate text-sm font-medium text-ink">{chefName}</span>}
                                <span className="block text-xs text-ink-muted">{t('ratings.chefHint')}</span>
                            </span>
                            <StarInput
                                value={chefStars}
                                onChange={setChefStars}
                                label={chefName ? t('ratings.rateChefAria', { name: chefName }) : t('ratings.chefOnDuty')}
                                starLabel={starLabel}
                                disabled={!!busy}
                            />
                        </div>
                    )}

                    {showNotes ? (
                        <div className="mt-3 space-y-2">
                            {dishes.length > 0 && (
                                <NoteField
                                    id={`${noteId}-cook`}
                                    inputRef={firstNoteRef}
                                    label={t('ratings.cookNoteLabel')}
                                    placeholder={ratedDishes.length > 0 ? t('ratings.cookNotePlaceholder') : t('ratings.rateDishFirst')}
                                    value={cookNote}
                                    onChange={setCookNote}
                                    disabled={!!busy || ratedDishes.length === 0}
                                />
                            )}
                            {chef && (
                                <NoteField
                                    id={`${noteId}-chef`}
                                    inputRef={dishes.length > 0 ? undefined : firstNoteRef}
                                    label={t('ratings.chefNoteLabel')}
                                    placeholder={chefStars > 0 ? t('ratings.chefNotePlaceholder') : t('ratings.rateChefFirst')}
                                    value={chefNote}
                                    onChange={setChefNote}
                                    disabled={!!busy || chefStars === 0}
                                />
                            )}
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setShowNotes(true)}
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
                        <Button onClick={submit} disabled={!canSend || busy === 'skip'} loading={busy === 'submit'} loadingText={t('ratings.sending')}>
                            {t('ratings.submit')}
                        </Button>
                    </div>
                </>
            )}
        </section>
    );
}

function NoteField({
    id,
    inputRef,
    label,
    placeholder,
    value,
    onChange,
    disabled,
}: {
    id: string;
    inputRef?: React.Ref<HTMLTextAreaElement>;
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
}) {
    return (
        <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
                <label htmlFor={id} className="text-xs font-medium text-ink">{label}</label>
                {value.length > 0 && (
                    <span className="text-xs text-ink-subtle tabular-nums" aria-live="polite">{value.length}/{MAX_COMMENT_LENGTH}</span>
                )}
            </div>
            <TextArea
                id={id}
                ref={inputRef}
                rows={2}
                maxLength={MAX_COMMENT_LENGTH}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
            />
        </div>
    );
}
