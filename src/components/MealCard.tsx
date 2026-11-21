'use client';

import { MealItem, UserRole } from '@/types/meal';
import { useId, useState } from 'react';
import EditMealModal from './EditMealModal';
import AlternativeMealsModal from './AlternativeMealsModal';
import AttendingMembersModal from './AttendingMembersModal';
import { ChefHat, ChevronDown, Clock, Flame, Leaf, Pencil, Phone, PlayCircle, Shuffle, UserCheck, UserX, Users } from 'lucide-react';
import { toggleMealAttendance } from '@/lib/firestore';
import { useLocale } from '@/context/LocaleContext';
import { useAuth } from './AuthProvider';
import { actorFromUser } from '@/lib/actor';
import { cn } from '@/lib/cn';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Spinner } from './ui/Spinner';
import MealImage, { MealPhotoCredit } from './MealImage';

function getVideoEmbed(url?: string): { src: string; kind: 'youtube' | 'instagram' } | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '');

        if (host === 'youtu.be') {
            const id = u.pathname.slice(1).split('/')[0];
            if (id) return { src: `https://www.youtube.com/embed/${id}`, kind: 'youtube' };
        }
        if (host.endsWith('youtube.com') || host === 'm.youtube.com') {
            const v = u.searchParams.get('v');
            if (v) return { src: `https://www.youtube.com/embed/${v}`, kind: 'youtube' };
            const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
            if (shorts) return { src: `https://www.youtube.com/embed/${shorts[1]}`, kind: 'youtube' };
            const embed = u.pathname.match(/^\/embed\/([^/]+)/);
            if (embed) return { src: `https://www.youtube.com/embed/${embed[1]}`, kind: 'youtube' };
        }
        if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
            const m = u.pathname.match(/^\/(?:p|reel|reels|tv)\/([^/]+)/);
            if (m) return { src: `https://www.instagram.com/p/${m[1]}/embed`, kind: 'instagram' };
        }
    } catch {
        return null;
    }
    return null;
}

const MEAL_ICON: Record<'breakfast' | 'lunch' | 'dinner', string> = { breakfast: '☕', lunch: '🥗', dinner: '🍲' };

interface MealCardProps {
    meal: MealItem;
    mealType: 'breakfast' | 'lunch' | 'dinner';
    mealId: string;
    canEdit: boolean;
    phoneNumber: string;
    attendance?: Record<string, { breakfast: boolean; lunch: boolean; dinner: boolean }>;
    guests?: Record<string, { breakfast?: number; lunch?: number; dinner?: number }>;
    members?: { uid: string; label: string }[];
    totalMembers: number;
    currentUserId: string;
    userRole: UserRole;
    responsibleMemberName?: string;
    responsibleMemberPhone?: string;
    /** uid of the chef for this slot, used to show "you". */
    responsibleMemberId?: string;
    householdId: string;
}

export default function MealCard({
    meal,
    mealType,
    mealId,
    canEdit,
    attendance,
    guests,
    members,
    totalMembers,
    currentUserId,
    userRole,
    responsibleMemberName,
    responsibleMemberPhone,
    responsibleMemberId,
    householdId,
    onRefresh
}: MealCardProps & { onRefresh: () => void }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isBoredOpen, setIsBoredOpen] = useState(false);
    const [isMembersOpen, setIsMembersOpen] = useState(false);
    const [isVideoOpen, setIsVideoOpen] = useState(false);
    const [loadingAttendance, setLoadingAttendance] = useState(false);
    const { t, locale } = useLocale();
    const { user: authUser } = useAuth();
    const titleId = useId();

    // Resolve translated fields: use stored translation if available, fall back to English original
    const tx = (locale !== 'en' && meal.translations?.[locale]) ? meal.translations[locale] : null;
    const displayName = tx?.item_name ?? meal.item_name;
    const displayIngredients = tx?.ingredients ?? meal.ingredients;
    const displayInstructions = tx?.cooking_instructions ?? meal.cooking_instructions;

    // Calculate skippers
    const skippersCount = attendance
        ? Object.values(attendance).filter(record => record[mealType] === false).length
        : 0;

    const guestTotal = guests
        ? Object.values(guests).reduce((sum, g) => sum + (g?.[mealType] ?? 0), 0)
        : 0;

    const cookingForCount = Math.max(0, totalMembers - skippersCount) + guestTotal;

    // Check my status
    const myRecord = attendance?.[currentUserId];
    const amISkipping = myRecord?.[mealType] === false;

    const handleToggleAttendance = async () => {
        if (loadingAttendance) return;
        setLoadingAttendance(true);
        try {
            await toggleMealAttendance(mealId, mealType, currentUserId, !amISkipping, householdId, actorFromUser(authUser));
            if (onRefresh) {
                onRefresh();
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingAttendance(false);
        }
    };

    const label = t(`mealCard.${mealType}`);
    const videoEmbed = getVideoEmbed(meal.recipe_url);
    const canSetAttendance = canEdit && (userRole === 'user' || userRole === 'member');
    const chefIsMe = !!responsibleMemberId && responsibleMemberId === currentUserId;
    const steps = displayInstructions ?? [];

    return (
        <>
            <Card className="p-4 sm:p-5">
                <article aria-labelledby={titleId}>
                    <div className="flex items-start gap-3 sm:gap-4">
                        {/* A hand-set image_url wins; otherwise a photo matched to the dish name.
                            Uses the untranslated name, which gives the best search results. */}
                        <MealImage
                            mealName={meal.item_name}
                            imageUrl={meal.image_url || undefined}
                            size={64}
                            fallback={<span className="text-2xl">{MEAL_ICON[mealType]}</span>}
                            className="rounded-2xl"
                        />

                        <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                                <p className="pt-0.5 text-xs font-semibold uppercase tracking-wider text-accent-strong">{label}</p>
                                <div className="-mr-2 -mt-2 flex shrink-0 items-center">
                                    {videoEmbed && (
                                        <IconButton
                                            label={videoEmbed.kind === 'youtube' ? t('mealCard.watchVideo') : t('mealCard.watchReel')}
                                            size="sm"
                                            onClick={() => setIsVideoOpen(true)}
                                        >
                                            <PlayCircle size={19} />
                                        </IconButton>
                                    )}
                                    {canEdit && (
                                        <IconButton label={t('mealCard.edit', { meal: label })} size="sm" onClick={() => setIsModalOpen(true)}>
                                            <Pencil size={17} />
                                        </IconButton>
                                    )}
                                </div>
                            </div>
                            <h3 id={titleId} className="text-lg font-semibold leading-snug text-ink">{displayName}</h3>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
                                <span className="inline-flex items-center gap-1">
                                    <Flame size={14} aria-hidden="true" /> {meal.calories} kcal
                                </span>
                                {meal.prep_time_minutes > 0 && (
                                    <span className="inline-flex items-center gap-1">
                                        <Clock size={14} aria-hidden="true" /> {t('mealCard.prepTime', { minutes: meal.prep_time_minutes })}
                                    </span>
                                )}
                                {meal.is_vegetarian && (
                                    <Badge tone="success"><Leaf size={12} aria-hidden="true" /> {t('mealCard.veg')}</Badge>
                                )}
                            </div>
                        </div>
                    </div>

                    {displayIngredients && displayIngredients.length > 0 && (
                        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-muted">{displayIngredients.join(', ')}</p>
                    )}

                    {meal.nutrients && (
                        <dl className="mt-3 grid grid-cols-4 gap-2">
                            {([
                                ['protein', meal.nutrients.protein_g],
                                ['carbs', meal.nutrients.carbs_g],
                                ['fat', meal.nutrients.fat_g],
                                ['fiber', meal.nutrients.fiber_g],
                            ] as const).map(([key, grams]) => (
                                <div key={key} className="rounded-xl bg-surface-muted px-1 py-2 text-center">
                                    <dt className="text-[11px] font-medium text-ink-muted">{t(`mealCard.${key}`)}</dt>
                                    <dd className="text-sm font-semibold text-ink">{grams}g</dd>
                                </div>
                            ))}
                        </dl>
                    )}

                    {/* Who's eating & who's cooking */}
                    {(totalMembers > 0 || responsibleMemberName) && (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            {totalMembers > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setIsMembersOpen(true)}
                                    aria-haspopup="dialog"
                                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-muted"
                                >
                                    <Users size={14} aria-hidden="true" />
                                    {t('mealCard.cookingFor')} {cookingForCount}
                                </button>
                            )}
                            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-muted pl-3 pr-1 text-[13px] text-ink-muted">
                                <ChefHat size={14} aria-hidden="true" />
                                <span>
                                    {t('mealCard.cookedBy')}:{' '}
                                    <span className="font-semibold text-ink">
                                        {responsibleMemberName ? (chefIsMe ? `${responsibleMemberName} (${t('mealCard.you')})` : responsibleMemberName) : t('mealCard.noChef')}
                                    </span>
                                </span>
                                {responsibleMemberPhone && responsibleMemberName && !chefIsMe ? (
                                    <a
                                        href={`tel:${responsibleMemberPhone}`}
                                        className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-surface text-accent-strong transition-colors hover:bg-accent-soft"
                                        aria-label={t('mealCard.callChef', { name: responsibleMemberName })}
                                        title={t('mealCard.callChef', { name: responsibleMemberName })}
                                    >
                                        <Phone size={12} aria-hidden="true" />
                                    </a>
                                ) : (
                                    <span className="w-2" aria-hidden="true" />
                                )}
                            </span>
                        </div>
                    )}

                    {/* Primary actions */}
                    {canEdit && (
                        <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
                            {canSetAttendance && (
                                <div role="group" aria-label={t('mealCard.attendanceLabel', { meal: label.toLowerCase() })} className="flex flex-1 rounded-xl bg-surface-muted p-1 sm:flex-none">
                                    {([
                                        { skipping: false, text: t('mealCard.eating'), Icon: UserCheck },
                                        { skipping: true, text: t('mealCard.skipping'), Icon: UserX },
                                    ]).map(({ skipping, text, Icon }) => {
                                        const active = amISkipping === skipping;
                                        return (
                                            <button
                                                key={text}
                                                type="button"
                                                aria-pressed={active}
                                                disabled={loadingAttendance}
                                                onClick={() => { if (!active) handleToggleAttendance(); }}
                                                className={cn(
                                                    'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 disabled:cursor-wait sm:flex-none',
                                                    active
                                                        ? skipping ? 'bg-surface text-danger shadow-card' : 'bg-surface text-success shadow-card'
                                                        : 'text-ink-muted hover:text-ink',
                                                )}
                                            >
                                                {loadingAttendance && !active ? <Spinner size={14} /> : <Icon size={15} aria-hidden="true" />}
                                                {text}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            {/* Icon-only on phones (with an accessible name), labelled from `sm` up */}
                            <Button
                                variant="secondary"
                                size="sm"
                                className="ml-auto h-11 w-11 shrink-0 px-0 sm:h-9 sm:w-auto sm:px-3"
                                leadingIcon={<Shuffle size={16} aria-hidden="true" />}
                                onClick={() => setIsBoredOpen(true)}
                                aria-haspopup="dialog"
                                title={t('mealCard.swap')}
                            >
                                <span className="sr-only sm:not-sr-only">{t('mealCard.swap')}</span>
                            </Button>
                        </div>
                    )}

                    {/* Recipe steps, collapsed by default to keep the day scannable */}
                    {steps.length > 0 && (
                        <details className="group mt-4 rounded-xl border border-line">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
                                <span>{t('mealCard.recipeSteps')} <span className="font-normal text-ink-muted">({steps.length})</span></span>
                                <ChevronDown size={18} className="text-ink-muted transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
                            </summary>
                            <ol className="list-decimal space-y-2 px-4 pb-4 pl-9 text-sm leading-relaxed text-ink-muted marker:font-semibold marker:text-ink-subtle">
                                {steps.map((step, idx) => (
                                    <li key={idx} className="pl-1">{step}</li>
                                ))}
                            </ol>
                        </details>
                    )}

                    {!meal.image_url && <MealPhotoCredit mealName={meal.item_name} className="mt-3 text-right" />}
                </article>
            </Card>

            <EditMealModal
                meal={meal}
                mealId={mealId}
                mealType={mealType}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onRefresh={onRefresh}
                householdId={householdId}
            />

            <AlternativeMealsModal
                isOpen={isBoredOpen}
                onClose={() => setIsBoredOpen(false)}
                currentMealName={displayName}
                mealId={mealId}
                mealType={mealType}
                householdId={householdId}
                onRefresh={onRefresh}
            />

            {videoEmbed && (
                <Dialog open={isVideoOpen} onClose={() => setIsVideoOpen(false)} title={displayName} size="lg" closeLabel={t('common.close')}>
                    <div
                        className="relative w-full overflow-hidden rounded-xl bg-black"
                        style={{ paddingTop: videoEmbed.kind === 'instagram' ? '125%' : '56.25%' }}
                    >
                        <iframe
                            src={videoEmbed.src}
                            title={`${displayName} video`}
                            className="absolute inset-0 h-full w-full"
                            frameBorder={0}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                        />
                    </div>
                </Dialog>
            )}

            <AttendingMembersModal
                isOpen={isMembersOpen}
                onClose={() => setIsMembersOpen(false)}
                mealId={mealId}
                mealType={mealType}
                mealLabel={label}
                householdId={householdId}
                currentUserId={currentUserId}
                members={members ?? []}
                attendance={attendance}
                guests={guests}
                onRefresh={onRefresh}
            />
        </>
    );
}
