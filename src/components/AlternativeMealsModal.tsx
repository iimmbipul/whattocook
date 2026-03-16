'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Flame, Scale, Pizza, Search, CheckCircle, Utensils } from 'lucide-react';
import { fetchAlternativeMeals, generateMealDetails, AlternativeMeal } from '@/lib/ai';
import { updateMeal } from '@/lib/firestore';
import { translateTexts } from '@/lib/translate';
import { supportedLocales } from '@/lib/i18n';
import { MealItem, MealItemTranslation } from '@/types/meal';

interface AlternativeMealsModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentMealName: string;
    mealId: string;
    mealType: 'breakfast' | 'lunch' | 'dinner';
    householdId: string;
    onRefresh: () => void;
}

type TabType = 'protein' | 'balanced' | 'unhealthy';

async function buildTranslations(
    item_name: string,
    ingredients: string[],
    cooking_instructions: string[]
): Promise<Record<string, MealItemTranslation>> {
    const translations: Record<string, MealItemTranslation> = {};
    const nonEnglishLocales = supportedLocales.filter(l => l !== 'en');

    await Promise.all(
        nonEnglishLocales.map(async (locale) => {
            try {
                const allTexts = [item_name, ...ingredients, ...cooking_instructions];
                const results = await translateTexts(allTexts, locale);

                const translatedName = results[0];
                const translatedIngredients = results.slice(1, 1 + ingredients.length);
                const translatedInstructions =
                    cooking_instructions.length > 0
                        ? results.slice(1 + ingredients.length)
                        : undefined;

                translations[locale] = {
                    item_name: translatedName,
                    ingredients: translatedIngredients,
                    ...(translatedInstructions ? { cooking_instructions: translatedInstructions } : {}),
                };
            } catch (err) {
                console.warn(`[AlternativeMeals] Failed to translate to ${locale}:`, err);
            }
        })
    );
    return translations;
}

export default function AlternativeMealsModal({
    isOpen,
    onClose,
    currentMealName,
    mealId,
    mealType,
    householdId,
    onRefresh
}: AlternativeMealsModalProps) {
    const [activeTab, setActiveTab] = useState<TabType>('protein');
    const [mealsMap, setMealsMap] = useState<Record<TabType, AlternativeMeal[]>>({
        protein: [],
        balanced: [],
        unhealthy: []
    });
    const fetchedTabs = useRef<Set<string>>(new Set());
    const [isLoadingMeals, setIsLoadingMeals] = useState<boolean>(false);
    const [updatingMealName, setUpdatingMealName] = useState<string | null>(null);

    // Reset fetched tabs when the modal closes or meal name changes
    useEffect(() => {
        if (!isOpen) {
            fetchedTabs.current.clear();
            setMealsMap({ protein: [], balanced: [], unhealthy: [] });
            setActiveTab('protein');
        }
    }, [isOpen, currentMealName]);

    useEffect(() => {
        if (!isOpen) return;

        const cacheKey = `${currentMealName}-${activeTab}`;
        if (fetchedTabs.current.has(cacheKey)) return;

        const loadMeals = async () => {
            setIsLoadingMeals(true);
            try {
                const results = await fetchAlternativeMeals(currentMealName, activeTab);
                setMealsMap(prev => ({
                    ...prev,
                    [activeTab]: results
                }));
                fetchedTabs.current.add(cacheKey);
            } catch (err) {
                console.error("Failed to load alternatives:", err);
            } finally {
                setIsLoadingMeals(false);
            }
        };

        loadMeals();
    }, [isOpen, activeTab, currentMealName]);

    if (!isOpen) return null;

    const tabs = [
        { id: 'protein' as TabType, label: 'High on protein', icon: Flame },
        { id: 'balanced' as TabType, label: 'Balanced meal', icon: Scale },
        { id: 'unhealthy' as TabType, label: 'no no no', icon: Pizza },
    ];

    const currentMeals = mealsMap[activeTab];

    const handleSelectMeal = async (selectedMeal: AlternativeMeal) => {
        if (updatingMealName) return; // Prevent multiple clicks
        setUpdatingMealName(selectedMeal.item_name);

        try {
            // 1. Generate full meal details via AI
            const data = await generateMealDetails(selectedMeal.item_name);
            if (!data) throw new Error("Failed to generate meal details");

            // 2. Build translations
            const translations = await buildTranslations(
                selectedMeal.item_name,
                data.ingredients,
                data.cooking_instructions
            );

            // 3. Create updated meal object
            const updatedMeal: MealItem = {
                item_name: selectedMeal.item_name,
                ingredients: data.ingredients,
                recipe_url: "",
                image_url: "",
                calories: data.calories,
                prep_time_minutes: data.prep_time_minutes,
                is_vegetarian: data.is_vegetarian,
                cooking_instructions: data.cooking_instructions,
                nutrients: {
                    protein_g: data.protein_g,
                    carbs_g: data.carbs_g,
                    fat_g: data.fat_g,
                    fiber_g: data.fiber_g,
                },
                translations: Object.keys(translations).length > 0 ? translations : undefined,
            };

            // 4. Update in Firestore
            await updateMeal(mealId, {
                [mealType]: updatedMeal,
            } as any, householdId, false);

            if (onRefresh) onRefresh();
            onClose();

        } catch (error) {
            console.error("Error updating meal:", error);
            alert("Failed to update meal. Please try again.");
        } finally {
            setUpdatingMealName(null);
        }
    };

    return (
        <div className="fixed inset-0 bg-brand-darkest/60 backdrop-blur-md flex items-end sm:items-center justify-center z-[60] sm:p-4 animate-in fade-in duration-200">
            {/* Half modal on mobile, centered modal on desktop */}
            <div className="bg-white/95 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border border-white/20">
                {/* Drag handle for mobile */}
                <div className="w-full flex justify-center pt-3 pb-1 sm:hidden">
                    <div className="w-12 h-1.5 bg-brand-light/40 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-6 py-4 border-b border-brand-light/20 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-brand-darkest flex items-center gap-2">
                            <Utensils size={20} className="text-brand-primary" />
                            Alternative Meals
                        </h2>
                        <p className="text-xs text-brand-dark mt-0.5">We will swap your <strong>{currentMealName}</strong></p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-brand-light/20 rounded-full text-brand-dark/50 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="px-4 py-3 border-b border-brand-light/20 bg-brand-light/5 flex overflow-x-auto custom-scrollbar gap-2 shrink-0">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                disabled={!!updatingMealName}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap ${isActive
                                    ? 'bg-brand-primary text-white shadow-md shadow-brand-primary/20 scale-105'
                                    : 'bg-white text-brand-dark border border-brand-light/30 hover:bg-brand-light/20'
                                    }`}
                            >
                                <Icon size={16} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Body / Meals List */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar relative">
                    {updatingMealName && (
                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center shrink-0">
                            <div className="w-10 h-10 border-4 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin mb-4" />
                            <p className="font-bold text-brand-darkest text-lg">Updating details...</p>
                            <p className="text-sm text-brand-dark mt-1 text-center max-w-xs">Generating recipe & translations for {updatingMealName}</p>
                        </div>
                    )}

                    {isLoadingMeals ? (
                        <div className="flex flex-col items-center justify-center py-12 text-brand-dark">
                            <Search className="animate-bounce text-brand-primary mb-2" size={32} />
                            <p className="font-medium animate-pulse">Finding nice options...</p>
                        </div>
                    ) : currentMeals.length === 0 ? (
                        <div className="text-center py-10 text-brand-dark/60">
                            No suggestions found.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {currentMeals.map((m, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleSelectMeal(m)}
                                    disabled={!!updatingMealName}
                                    className="w-full text-left bg-white border border-brand-light/40 rounded-2xl p-4 hover:border-brand-primary/50 hover:shadow-md transition-all group flex items-start gap-4"
                                >
                                    <div className="w-10 h-10 rounded-full bg-brand-light/20 flex items-center justify-center shrink-0 text-xl group-hover:bg-brand-light/50 transition-colors">
                                        ✨
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="font-bold text-brand-darkest group-hover:text-brand-primary transition-colors">
                                            {m.item_name}
                                        </h4>
                                        <p className="text-xs text-brand-dark/70 mt-1 line-clamp-2 leading-relaxed">
                                            {m.description}
                                        </p>
                                    </div>
                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity self-center">
                                        <CheckCircle className="text-brand-primary" size={20} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Safe area padding for mobile */}
                <div className="pb-safe sm:pb-0" />
            </div>
        </div>
    );
}
