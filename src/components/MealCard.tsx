'use client';

import { MealItem, UserRole } from '@/types/meal';
import { useState } from 'react';
import EditMealModal from './EditMealModal';
import AlternativeMealsModal from './AlternativeMealsModal';
import AttendingMembersModal from './AttendingMembersModal';
import { Pencil, Check, Leaf, UserX, UserCheck, Users, Phone, Sparkles, Youtube, Instagram, X } from 'lucide-react';
import { toggleMealAttendance } from '@/lib/firestore';
import { useLocale } from '@/context/LocaleContext';
import { useAuth } from './AuthProvider';
import { actorFromUser } from '@/lib/actor';

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
    householdId: string;
}

export default function MealCard({
    meal,
    mealType,
    mealId,
    canEdit,
    phoneNumber,
    attendance,
    guests,
    members,
    totalMembers,
    currentUserId,
    userRole,
    responsibleMemberName,
    responsibleMemberPhone,
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

    const getMealConfig = () => {
        switch (mealType) {
            case 'breakfast': return { label: t('mealCard.breakfast'), defaultIcon: '☕' };
            case 'lunch': return { label: t('mealCard.lunch'), defaultIcon: '🥪' };
            case 'dinner': return { label: t('mealCard.dinner'), defaultIcon: '🍽️' };
            default: return { label: t('mealCard.meal'), defaultIcon: '🍽️' };
        }
    };

    const config = getMealConfig();

    const videoEmbed = getVideoEmbed(meal.recipe_url);

    return (
        <>
            <div className="bg-white rounded-xl p-5 md:p-10 mb-4 shadow-sm border border-brand-light">
                <div className="flex flex-col gap-6">

                    {/* Top Section: Icon, Meal Names, and Action */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            {/* Circular Icon Container */}
                            <div className="w-14 h-14 bg-brand-light/30 rounded-full flex items-center justify-center shadow-sm overflow-hidden text-2xl text-brand-darkest">
                                {meal.image_url ? (
                                    <img src={meal.image_url} alt={displayName} className="w-full h-full object-cover" />
                                ) : (
                                    <span>{config.defaultIcon}</span>
                                )}
                            </div>

                            {/* Text Info */}
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-brand-dark uppercase tracking-wider">
                                    {config.label}
                                </span>
                                <h3 className="text-xl font-bold text-brand-darkest leading-tight">
                                    {displayName}
                                </h3>

                                {/* Cooking For Count & Responsibilities */}
                                {(totalMembers > 0 || responsibleMemberName) && (
                                    <div className="flex flex-wrap gap-2 mt-1">
                                        {totalMembers > 0 && (
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); setIsMembersOpen(true); }}
                                                className="flex items-center gap-1.5 text-sm font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full w-fit border border-purple-100 hover:bg-purple-100 transition-colors"
                                            >
                                                <Users size={14} />
                                                <span>{t('mealCard.cookingFor')} {cookingForCount}</span>
                                            </button>
                                        )}

                                        {responsibleMemberName && (
                                            <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full w-fit border border-amber-100">
                                                <span className="text-xs">👑</span>
                                                <span>{t('mealCard.chef')} {responsibleMemberName}</span>
                                                {responsibleMemberPhone && (
                                                    <a
                                                        href={`tel:${responsibleMemberPhone}`}
                                                        className="ml-1 p-1 bg-green-100 text-green-600 rounded-full hover:bg-green-200 transition-colors"
                                                        title={`Call ${responsibleMemberName}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <Phone size={12} fill="currentColor" />
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="flex items-center gap-2 mt-1.5">
                                    <div className="flex items-center gap-1 text-brand-dark">
                                        <span className="text-xs">🔥</span>
                                        <span className="text-sm font-semibold">{meal.calories} kcal</span>
                                    </div>
                                    {meal.is_vegetarian && (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-brand-secondary bg-brand-secondary/10 px-2 py-0.5 rounded-full uppercase tracking-wide">
                                            <Leaf size={10} /> {t('mealCard.veg')}
                                        </span>
                                    )}
                                </div>
                                {/* Ingredients List */}
                                {displayIngredients && displayIngredients.length > 0 && (
                                    <p className="text-xs text-brand-dark/70 mt-1 line-clamp-1">
                                        {displayIngredients.join(', ')}
                                    </p>
                                )}

                                {/* Nutrients Section */}
                                {meal.nutrients && (
                                    <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[10px] sm:text-xs w-full">
                                        <div className="bg-brand-light/20 rounded-lg p-1.5 ">
                                            <span className="block font-bold text-brand-secondary">{meal.nutrients.protein_g}g</span>
                                            <span className="text-brand-dark/70">{t('mealCard.protein')}</span>
                                        </div>
                                        <div className="bg-brand-light/20 rounded-lg p-1.5">
                                            <span className="block font-bold text-brand-secondary">{meal.nutrients.carbs_g}g</span>
                                            <span className="text-brand-dark/70">{t('mealCard.carbs')}</span>
                                        </div>
                                        <div className="bg-brand-light/20 rounded-lg p-1.5">
                                            <span className="block font-bold text-brand-secondary">{meal.nutrients.fat_g}g</span>
                                            <span className="text-brand-dark/70">{t('mealCard.fat')}</span>
                                        </div>
                                        <div className="bg-brand-light/20 rounded-lg p-1.5">
                                            <span className="block font-bold text-brand-secondary">{meal.nutrients.fiber_g}g</span>
                                            <span className="text-brand-dark/70">{t('mealCard.fiber')}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                        {videoEmbed && (
                            <button
                                type="button"
                                onClick={() => setIsVideoOpen(true)}
                                title={videoEmbed.kind === 'youtube' ? 'Watch recipe video' : 'Watch recipe reel'}
                                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                                    videoEmbed.kind === 'youtube'
                                        ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100'
                                        : 'bg-pink-50 text-pink-600 hover:bg-pink-100 border border-pink-100'
                                }`}
                            >
                                {videoEmbed.kind === 'youtube' ? <Youtube size={18} /> : <Instagram size={18} />}
                            </button>
                        )}
                        {/* Action Circle */}
                        <button
                            onClick={() => canEdit && setIsModalOpen(true)}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shrink-0 ${canEdit
                                ? "bg-brand-primary text-white hover:bg-brand-dark"
                                : "bg-white text-brand-light shadow-sm border border-brand-light"
                                }`}
                        >
                            {canEdit ? <Pencil size={20} /> : <Check size={20} />}
                        </button>
                        </div>
                    </div>

                    {/* Secondary Actions (Attendance & I am bored) */}
                    {canEdit && (
                        <div className="flex items-center justify-between mt-2">
                            <button
                                onClick={() => setIsBoredOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-brand-light/20 text-brand-darkest hover:bg-amber-100 hover:text-amber-800 border border-brand-light/40 hover:border-amber-200 transition-all"
                            >
                                <Sparkles size={16} />
                                I'm bored
                            </button>

                            {(userRole === 'user' || userRole === 'member') && (
                                <button
                                    onClick={handleToggleAttendance}
                                    disabled={loadingAttendance}
                                    className={`
                                        flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all
                                        ${amISkipping
                                            ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                                            : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'}
                                    `}
                                >
                                    {loadingAttendance ? (
                                        <span className="animate-spin text-xs">⌛</span>
                                    ) : amISkipping ? (
                                        <>
                                            <UserX size={16} />
                                            {t('mealCard.imSkipping')}
                                        </>
                                    ) : (
                                        <>
                                            <UserCheck size={16} />
                                            {t('mealCard.imEating')}
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    )}

                    {/* Cooking Instructions Section */}
                    {displayInstructions && displayInstructions.length > 0 && (
                        <div className="border-t border-brand-light/20 pt-3">
                            <h4 className="text-xs font-bold text-brand-darkest mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                                <span className="text-sm">👩‍🍳</span> {t('mealCard.instructions')}
                            </h4>
                            <ul className="text-xs text-brand-dark space-y-1.5 list-disc list-inside bg-brand-light/10 p-3 rounded-xl leading-relaxed">
                                {displayInstructions.map((step, idx) => (
                                    <li key={idx} className="pl-1"><span className="-ml-1">{step}</span></li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Calorie Progress Bar Section */}
                    <div className="space-y-3">
                        <div className="h-[10px] w-full bg-brand-light rounded-full overflow-hidden">
                            <div
                                className="h-full bg-brand-primary rounded-full transition-all duration-700 shadow-[0_0_8px_rgba(82,121,111,0.3)]"
                                style={{ width: '60%' }}
                            />
                        </div>
                        <div className="flex justify-between items-center text-brand-darkest font-bold">
                            <span className="text-[13px]">{t('mealCard.totalCalorie')}</span>
                            <span className="text-[13px]">{t('mealCard.kcalLeft', { amount: 195 })}</span>
                        </div>
                    </div>
                </div>
            </div>

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

            {videoEmbed && isVideoOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                    onClick={() => setIsVideoOpen(false)}
                >
                    <div
                        className="relative w-full max-w-3xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setIsVideoOpen(false)}
                            className="absolute -top-10 right-0 text-white/90 hover:text-white flex items-center gap-1 text-sm"
                            aria-label="Close video"
                        >
                            <X size={20} /> Close
                        </button>
                        <div
                            className="relative w-full overflow-hidden rounded-xl bg-black shadow-2xl"
                            style={{
                                paddingTop: videoEmbed.kind === 'instagram' ? '125%' : '56.25%',
                                maxHeight: '85vh',
                            }}
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
                    </div>
                </div>
            )}

            <AttendingMembersModal
                isOpen={isMembersOpen}
                onClose={() => setIsMembersOpen(false)}
                mealId={mealId}
                mealType={mealType}
                mealLabel={config.label}
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