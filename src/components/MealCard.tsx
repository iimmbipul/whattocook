'use client';

import { MealItem, UserRole } from '@/types/meal';
import { useState } from 'react';
import EditMealModal from './EditMealModal';
import { Pencil, Check, Leaf, UserX, UserCheck, Users, Phone } from 'lucide-react';
import { toggleMealAttendance } from '@/lib/firestore';
import { useLocale } from '@/context/LocaleContext';

interface MealCardProps {
    meal: MealItem;
    mealType: 'breakfast' | 'lunch' | 'dinner';
    mealId: string;
    canEdit: boolean;
    phoneNumber: string;
    attendance?: Record<string, { breakfast: boolean; lunch: boolean; dinner: boolean }>;
    totalMembers: number;
    currentUserId: string;
    userRole: UserRole;
    responsibleMemberName?: string;
    responsibleMemberPhone?: string;
}

export default function MealCard({
    meal,
    mealType,
    mealId,
    canEdit,
    phoneNumber,
    attendance,
    totalMembers,
    currentUserId,
    userRole,
    responsibleMemberName,
    responsibleMemberPhone,
    onRefresh
}: MealCardProps & { onRefresh: () => void }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loadingAttendance, setLoadingAttendance] = useState(false);
    const { t, locale } = useLocale();

    // Resolve translated fields: use stored translation if available, fall back to English original
    const tx = (locale !== 'en' && meal.translations?.[locale]) ? meal.translations[locale] : null;
    const displayName = tx?.item_name ?? meal.item_name;
    const displayIngredients = tx?.ingredients ?? meal.ingredients;
    const displayInstructions = tx?.cooking_instructions ?? meal.cooking_instructions;

    // Calculate skippers
    const skippersCount = attendance
        ? Object.values(attendance).filter(record => record[mealType] === false).length
        : 0;

    const cookingForCount = Math.max(0, totalMembers - skippersCount);

    // Check my status
    const myRecord = attendance?.[currentUserId];
    const amISkipping = myRecord?.[mealType] === false;

    const handleToggleAttendance = async () => {
        if (loadingAttendance) return;
        setLoadingAttendance(true);
        try {
            await toggleMealAttendance(mealId, mealType, currentUserId, !amISkipping);
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

                                {/* Cooking For Count */}
                                {totalMembers > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-1">
                                        <div className="flex items-center gap-1.5 text-sm font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full w-fit border border-purple-100">
                                            <Users size={14} />
                                            <span>{t('mealCard.cookingFor')} {cookingForCount}</span>
                                        </div>

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

                    {/* Attendance Toggle for Members/Owners */}
                    {(userRole === 'user' || userRole === 'member') && canEdit && (
                        <div className="flex justify-end">
                            <button
                                onClick={handleToggleAttendance}
                                disabled={loadingAttendance}
                                className={`
                                    flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all
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
            />
        </>
    );
}