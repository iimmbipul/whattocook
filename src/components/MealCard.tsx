'use client';

import { MealItem, UserRole } from '@/types/meal';
import { useState } from 'react';
import EditMealModal from './EditMealModal';
import { Pencil, Check, Leaf, UserX, UserCheck, Users } from 'lucide-react';
import { toggleMealAttendance } from '@/lib/firestore';

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
    responsibleMemberName?: string; // Name of the person responsible for this meal
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
    onRefresh
}: MealCardProps & { onRefresh: () => void }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loadingAttendance, setLoadingAttendance] = useState(false);

    // Calculate skippers
    // A user is skipping if their ID is in attendance AND attendance[id][mealType] === false
    const skippersCount = attendance
        ? Object.values(attendance).filter(record => record[mealType] === false).length
        : 0;

    const cookingForCount = Math.max(0, totalMembers - skippersCount);

    // Check my status
    // Default is 'eating' (true) if record doesn't exist or value is true.
    const myRecord = attendance?.[currentUserId];
    const amISkipping = myRecord?.[mealType] === false;

    const handleToggleAttendance = async () => {
        if (loadingAttendance) return;
        setLoadingAttendance(true);
        try {
            await toggleMealAttendance(mealId, mealType, currentUserId, !amISkipping);

            // Refresh parent data without reloading page
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
            case 'breakfast': return { label: 'Breakfast', defaultIcon: '☕' };
            case 'lunch': return { label: 'Lunch', defaultIcon: '🥪' };
            case 'dinner': return { label: 'Dinner', defaultIcon: '🍽️' };
            default: return { label: 'Meal', defaultIcon: '🍽️' };
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
                                    <img src={meal.image_url} alt={meal.item_name} className="w-full h-full object-cover" />
                                ) : (
                                    <span>{config.defaultIcon}</span>
                                )}
                            </div>

                            {/* Text Info - Showing BOTH Category and Item Name */}
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-brand-dark uppercase tracking-wider">
                                    {config.label}
                                </span>
                                <h3 className="text-xl font-bold text-brand-darkest leading-tight">
                                    {meal.item_name}
                                </h3>

                                {/* Cooking For Count */}
                                {totalMembers > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-1">
                                        <div className="flex items-center gap-1.5 text-sm font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full w-fit border border-purple-100">
                                            <Users size={14} />
                                            <span>Cooking for {cookingForCount}</span>
                                        </div>

                                        {responsibleMemberName && (
                                            <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full w-fit border border-amber-100">
                                                <span className="text-xs">👑</span>
                                                <span>Chef: {responsibleMemberName}</span>
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
                                            <Leaf size={10} /> Veg
                                        </span>
                                    )}
                                </div>
                                {/* Ingredients List */}
                                {meal.ingredients && meal.ingredients.length > 0 && (
                                    <p className="text-xs text-brand-dark/70 mt-1 line-clamp-1">
                                        {meal.ingredients.join(', ')}
                                    </p>
                                )}

                                {/* Nutrients Section */}
                                {meal.nutrients && (
                                    <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[10px] sm:text-xs w-full">
                                        <div className="bg-brand-light/20 rounded-lg p-1.5 ">
                                            <span className="block font-bold text-brand-secondary">{meal.nutrients.protein_g}g</span>
                                            <span className="text-brand-dark/70">Protein</span>
                                        </div>
                                        <div className="bg-brand-light/20 rounded-lg p-1.5">
                                            <span className="block font-bold text-brand-secondary">{meal.nutrients.carbs_g}g</span>
                                            <span className="text-brand-dark/70">Carbs</span>
                                        </div>
                                        <div className="bg-brand-light/20 rounded-lg p-1.5">
                                            <span className="block font-bold text-brand-secondary">{meal.nutrients.fat_g}g</span>
                                            <span className="text-brand-dark/70">Fat</span>
                                        </div>
                                        <div className="bg-brand-light/20 rounded-lg p-1.5">
                                            <span className="block font-bold text-brand-secondary">{meal.nutrients.fiber_g}g</span>
                                            <span className="text-brand-dark/70">Fiber</span>
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
                                        I'm Skipping
                                    </>
                                ) : (
                                    <>
                                        <UserCheck size={16} />
                                        I'm Eating
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                    {/* Cooking Instructions Section */}
                    {meal.cooking_instructions && meal.cooking_instructions.length > 0 && (
                        <div className="border-t border-brand-light/20 pt-3">
                            <h4 className="text-xs font-bold text-brand-darkest mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                                <span className="text-sm">👩‍🍳</span> Instructions
                            </h4>
                            <ul className="text-xs text-brand-dark space-y-1.5 list-disc list-inside bg-brand-light/10 p-3 rounded-xl leading-relaxed">
                                {meal.cooking_instructions.map((step, idx) => (
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
                                style={{ width: '60%' }} // Replace with dynamic: (current/total)*100
                            />
                        </div>
                        <div className="flex justify-between items-center text-brand-darkest font-bold">
                            <span className="text-[13px]">Total calorie</span>
                            <span className="text-[13px]">195 left</span>
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
            />
        </>
    );
}