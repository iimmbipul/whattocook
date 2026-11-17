'use client';

import { useState, useEffect, useRef } from 'react';
import { Flame, Scale, Pizza, Sparkles, ChevronRight, RefreshCw, SearchX } from 'lucide-react';
import {
    fetchAlternativeMeals,
    fetchFancyMealsLikeOurs,
    generateMealDetails,
    AlternativeMeal,
    HouseholdMenu,
} from '@/lib/ai';
import { getAllMeals, updateMeal } from '@/lib/firestore';
import { translateTexts } from '@/lib/translate';
import { supportedLocales } from '@/lib/i18n';
import { MealItem, MealItemTranslation } from '@/types/meal';
import { useAuth } from './AuthProvider';
import { actorFromUser } from '@/lib/actor';
import { useLocale } from '@/context/LocaleContext';
import { cn } from '@/lib/cn';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Alert } from './ui/Field';
import { Skeleton, Spinner } from './ui/Spinner';
import { EmptyState } from './ui/Card';

interface AlternativeMealsModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentMealName: string;
    mealId: string;
    mealType: 'breakfast' | 'lunch' | 'dinner';
    householdId: string;
    onRefresh: () => void;
}

type TabType = 'fancy' | 'protein' | 'balanced' | 'unhealthy';

const EMPTY_MEALS: Record<TabType, AlternativeMeal[]> = {
    fancy: [],
    protein: [],
    balanced: [],
    unhealthy: [],
};

/** Read the household's 30-day menu from Firestore as meal names per slot. */
async function loadHouseholdMenu(householdId: string): Promise<HouseholdMenu> {
    const days = await getAllMeals(householdId);
    days.sort((a, b) => a.id.localeCompare(b.id));
    const names = (slot: keyof HouseholdMenu) =>
        days.map((d) => d[slot]?.item_name?.trim()).filter((n): n is string => !!n);
    return { breakfast: names('breakfast'), lunch: names('lunch'), dinner: names('dinner') };
}

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
    const { user: authUser } = useAuth();
    const { t } = useLocale();
    const [activeTab, setActiveTab] = useState<TabType>('fancy');
    const [mealsMap, setMealsMap] = useState<Record<TabType, AlternativeMeal[]>>(EMPTY_MEALS);
    const fetchedTabs = useRef<Set<string>>(new Set());
    // The 30-day menu is read once per modal opening and reused.
    const menuRef = useRef<HouseholdMenu | null>(null);
    const [isLoadingMeals, setIsLoadingMeals] = useState<boolean>(false);
    const [loadError, setLoadError] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    // A suggestion the user picked but hasn't confirmed yet.
    const [pending, setPending] = useState<AlternativeMeal | null>(null);
    const [updatingMealName, setUpdatingMealName] = useState<string | null>(null);
    const [swapError, setSwapError] = useState(false);

    // Reset fetched tabs when the modal closes or meal name changes
    useEffect(() => {
        if (!isOpen) {
            fetchedTabs.current.clear();
            menuRef.current = null;
            setMealsMap(EMPTY_MEALS);
            setActiveTab('fancy');
            setPending(null);
            setSwapError(false);
            setLoadError(false);
        }
    }, [isOpen, currentMealName]);

    useEffect(() => {
        if (!isOpen) return;

        const cacheKey = `${currentMealName}-${activeTab}`;
        if (fetchedTabs.current.has(cacheKey)) return;

        let cancelled = false;
        const loadMeals = async () => {
            setIsLoadingMeals(true);
            setLoadError(false);
            try {
                let results: AlternativeMeal[];
                if (activeTab === 'fancy') {
                    if (!menuRef.current) menuRef.current = await loadHouseholdMenu(householdId);
                    results = await fetchFancyMealsLikeOurs(currentMealName, mealType, menuRef.current);
                } else {
                    results = await fetchAlternativeMeals(currentMealName, activeTab);
                }
                if (cancelled) return;
                setMealsMap(prev => ({
                    ...prev,
                    [activeTab]: results
                }));
                fetchedTabs.current.add(cacheKey);
            } catch (err) {
                console.error("Failed to load alternatives:", err);
                if (!cancelled) setLoadError(true);
            } finally {
                if (!cancelled) setIsLoadingMeals(false);
            }
        };

        loadMeals();
        return () => { cancelled = true; };
    }, [isOpen, activeTab, currentMealName, mealType, householdId, reloadToken]);

    const mealLabel = t(`mealCard.${mealType}`);
    const tabs = [
        { id: 'fancy' as TabType, label: t('swap.tabFancy'), icon: Sparkles },
        { id: 'protein' as TabType, label: t('swap.tabProtein'), icon: Flame },
        { id: 'balanced' as TabType, label: t('swap.tabBalanced'), icon: Scale },
        { id: 'unhealthy' as TabType, label: t('swap.tabTreat'), icon: Pizza },
    ];

    const currentMeals = mealsMap[activeTab];

    const handleSelectMeal = async (selectedMeal: AlternativeMeal) => {
        if (updatingMealName) return; // Prevent multiple clicks
        setUpdatingMealName(selectedMeal.item_name);
        setSwapError(false);

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
            } as any, householdId, false, actorFromUser(authUser));

            if (onRefresh) onRefresh();
            onClose();

        } catch (error) {
            console.error("Error updating meal:", error);
            setSwapError(true);
        } finally {
            setUpdatingMealName(null);
        }
    };

    const busy = !!updatingMealName;

    // Step 2: confirm the chosen dish before anything is overwritten.
    const confirmFooter = pending ? (
        <>
            <Button variant="secondary" onClick={() => { setPending(null); setSwapError(false); }} disabled={busy}>
                {t('common.back')}
            </Button>
            <Button onClick={() => handleSelectMeal(pending)} loading={busy} loadingText={t('swap.updating', { name: pending.item_name })}>
                {t('swap.confirmButton')}
            </Button>
        </>
    ) : undefined;

    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            dismissible={!busy}
            title={pending ? t('swap.confirmTitle', { name: pending.item_name }) : t('swap.title', { meal: mealLabel.toLowerCase() })}
            description={pending ? undefined : t('swap.subtitle', { name: currentMealName })}
            closeLabel={t('common.close')}
            footer={confirmFooter}
        >
            {pending ? (
                <div className="space-y-4">
                    {pending.description && <p className="text-[15px] leading-relaxed text-ink">{pending.description}</p>}
                    <p className="text-sm text-ink-muted">
                        {t('swap.confirmBody', { name: pending.item_name, meal: mealLabel.toLowerCase() })}
                    </p>
                    {swapError && <Alert tone="error">{t('swap.failed')}</Alert>}
                    {busy && (
                        <div className="flex items-center gap-2 text-sm text-ink-muted" role="status">
                            <Spinner size={16} /> {t('editMeal.aiWriting')}
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <div role="group" aria-label={t('swap.title', { meal: mealLabel.toLowerCase() })} className="-mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1 scrollbar-hide sm:-mx-6 sm:px-6">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    aria-pressed={isActive}
                                    className={cn(
                                        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors duration-150',
                                        isActive ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                                    )}
                                >
                                    <Icon size={15} aria-hidden="true" />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    {isLoadingMeals ? (
                        <div className="space-y-2" role="status" aria-label={activeTab === 'fancy' ? t('swap.loadingMenu') : t('swap.loading')}>
                            <p className="mb-3 flex items-center gap-2 text-sm text-ink-muted">
                                <Spinner size={14} />
                                {activeTab === 'fancy' ? t('swap.loadingMenu') : t('swap.loading')}
                            </p>
                            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[72px] w-full rounded-2xl" />)}
                        </div>
                    ) : loadError ? (
                        <EmptyState
                            icon={<SearchX size={22} />}
                            title={t('swap.error')}
                            action={
                                <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={15} aria-hidden="true" />} onClick={() => setReloadToken(n => n + 1)}>
                                    {t('common.retry')}
                                </Button>
                            }
                        />
                    ) : currentMeals.length === 0 ? (
                        <EmptyState icon={<SearchX size={22} />} title={t('swap.empty')} />
                    ) : (
                        <div className="space-y-2">
                            {activeTab === 'fancy' && <p className="mb-3 text-sm text-ink-muted">{t('swap.fancyIntro')}</p>}
                            <ul className="space-y-2">
                                {currentMeals.map((m, idx) => (
                                    <li key={idx}>
                                        <button
                                            type="button"
                                            onClick={() => setPending(m)}
                                            className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-ink">{m.item_name}</p>
                                                {m.description && <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-ink-muted">{m.description}</p>}
                                            </div>
                                            <ChevronRight size={18} className="shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </Dialog>
    );
}
