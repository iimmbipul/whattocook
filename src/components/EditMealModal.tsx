'use client';

import { MealItem, MealItemTranslation } from '@/types/meal';
import { updateMeal } from '@/lib/firestore';
import { useAuth } from './AuthProvider';
import { actorFromUser } from '@/lib/actor';
import { useId, useState, useRef } from 'react';
import { CheckCircle2, ShoppingCart, Sparkles } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { translateTexts } from '@/lib/translate';
import { supportedLocales } from '@/lib/i18n';
import { generateMealDetails } from '@/lib/ai';
import { cn } from '@/lib/cn';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Alert, Field, TextArea, TextInput } from './ui/Field';
import { Spinner } from './ui/Spinner';

interface EditMealModalProps {
    meal: MealItem;
    mealId: string;
    mealType: 'breakfast' | 'lunch' | 'dinner';
    isOpen: boolean;
    onClose: () => void;
    onRefresh?: () => void;
    householdId: string;
}

/**
 * Translates a meal's dynamic text fields (name, ingredients, instructions)
 * into all non-English supported locales and returns the translations map.
 * Called once at save time — results are stored in Firestore.
 */
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
                console.warn(`[EditMealModal] Failed to translate to ${locale}:`, err);
                // Skip this locale — original English will be used as fallback in MealCard
            }
        })
    );

    return translations;
}

export default function EditMealModal({ meal, mealId, mealType, isOpen, onClose, onRefresh, householdId }: EditMealModalProps) {
    const { t } = useLocale();
    const { user: authUser } = useAuth();

    const [formData, setFormData] = useState({
        item_name: meal.item_name || '',
        ingredients: (meal.ingredients || []).join(', '),
        recipe_url: meal.recipe_url || '',
        image_url: meal.image_url || '',
        calories: (meal.calories || 0).toString(),
        prep_time_minutes: (meal.prep_time_minutes || 0).toString(),
        is_vegetarian: meal.is_vegetarian || false,
        cooking_instructions: meal.cooking_instructions?.join('\n') || '',
        protein_g: meal.nutrients?.protein_g?.toString() || '',
        carbs_g: meal.nutrients?.carbs_g?.toString() || '',
        fat_g: meal.nutrients?.fat_g?.toString() || '',
        fiber_g: meal.nutrients?.fiber_g?.toString() || '',
    });
    const [applyToAllMonths, setApplyToAllMonths] = useState(false);
    const [loading, setLoading] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState('');
    const [showSuccess, setShowSuccess] = useState(false);

    // Track original name to only trigger AI if they change it manually
    const originalNameRef = useRef(meal.item_name);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const ingredientsList = formData.ingredients.split(',').map((i) => i.trim());
            const instructionsList = formData.cooking_instructions.trim()
                ? formData.cooking_instructions.split('\n').map(s => s.trim()).filter(s => s.length > 0)
                : [];

            // Build the base meal object
            const updatedMeal: MealItem = {
                item_name: formData.item_name,
                ingredients: ingredientsList,
                recipe_url: formData.recipe_url,
                image_url: formData.image_url,
                calories: parseInt(formData.calories) || 0,
                prep_time_minutes: parseInt(formData.prep_time_minutes) || 0,
                is_vegetarian: formData.is_vegetarian,
                ...(instructionsList.length > 0 ? { cooking_instructions: instructionsList } : {}),
            };

            const hasNutrients = formData.protein_g || formData.carbs_g || formData.fat_g || formData.fiber_g;
            if (hasNutrients) {
                updatedMeal.nutrients = {
                    protein_g: parseFloat(formData.protein_g) || 0,
                    carbs_g: parseFloat(formData.carbs_g) || 0,
                    fat_g: parseFloat(formData.fat_g) || 0,
                    fiber_g: parseFloat(formData.fiber_g) || 0,
                };
            }

            // Translate into all non-English locales at save time
            setTranslating(true);
            const translations = await buildTranslations(
                formData.item_name,
                ingredientsList,
                instructionsList
            );
            setTranslating(false);

            // Include translations in the saved meal object
            if (Object.keys(translations).length > 0) {
                updatedMeal.translations = translations;
            }

            const success = await updateMeal(mealId, {
                [mealType]: updatedMeal,
            } as any, householdId, applyToAllMonths, actorFromUser(authUser));

            if (success) {


                if (onRefresh) onRefresh();
                setShowSuccess(true);
            } else {
                setError(t('editMeal.failedToUpdate'));
            }
        } catch (err) {
            setTranslating(false);
            setError(t('editMeal.errorOccurred'));
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setShowSuccess(false);
        onClose();
    };

    const handleNameBlur = async () => {
        const currentName = formData.item_name.trim();

        // Only generate if name is not empty
        // And if it actually changed from the original modal load
        if (!currentName || currentName === originalNameRef.current) return;

        setIsGenerating(true);
        setError('');

        try {
            const data = await generateMealDetails(currentName);
            if (data) {
                setFormData(prev => ({
                    ...prev,
                    ingredients: data.ingredients.join(', '),
                    cooking_instructions: data.cooking_instructions.join('\n'),
                    calories: data.calories.toString(),
                    prep_time_minutes: data.prep_time_minutes.toString(),
                    is_vegetarian: data.is_vegetarian,
                    protein_g: data.protein_g.toString(),
                    carbs_g: data.carbs_g.toString(),
                    fat_g: data.fat_g.toString(),
                    fiber_g: data.fiber_g.toString(),
                }));
                // Update original name to prevent redundant fetch on multiple blurs
                originalNameRef.current = currentName;
            } else {
                console.warn('AI generation returned null');
            }
        } catch (err) {
            console.error('Failed to generate AI data:', err);
        } finally {
            setIsGenerating(false);
        }
    };

    const formId = useId();

    // Loading state covers both saving + translating
    const isBusy = loading || translating;
    const busyLabel = translating ? t('editMeal.translating') : t('editMeal.savingButton');
    const mealLabel = t(`mealCard.${mealType}`);
    const set = (patch: Partial<typeof formData>) => setFormData(prev => ({ ...prev, ...patch }));

    if (showSuccess) {
        return (
            <Dialog open={isOpen} onClose={handleClose} title={t('editMeal.successTitle')} size="sm" closeLabel={t('common.close')}
                footer={<Button fullWidth onClick={handleClose}>{t('editMeal.gotItButton')}</Button>}
            >
                <div className="flex flex-col items-center py-2 text-center">
                    <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true">
                        <CheckCircle2 size={28} />
                    </span>
                    <p className="text-[15px] text-ink">{t('editMeal.successMessage')}</p>
                    <p className="mt-4 flex items-center gap-2 rounded-xl bg-surface-muted px-4 py-3 text-sm font-medium text-ink">
                        <ShoppingCart size={16} className="shrink-0 text-accent-strong" aria-hidden="true" />
                        {t('editMeal.groceryReminder')}
                    </p>
                </div>
            </Dialog>
        );
    }

    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            dismissible={!isBusy}
            title={t('mealCard.edit', { meal: mealLabel.toLowerCase() })}
            description={t('editMeal.subtitle')}
            closeLabel={t('common.close')}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={isBusy}>{t('editMeal.cancelButton')}</Button>
                    <Button type="submit" form={formId} loading={isBusy} loadingText={busyLabel} disabled={isGenerating}>
                        {t('editMeal.saveButton')}
                    </Button>
                </>
            }
        >
            <form id={formId} onSubmit={handleSubmit} className="space-y-5" noValidate={false}>
                {error && <Alert tone="error">{error}</Alert>}

                <p className="flex items-start gap-2 rounded-xl bg-accent-soft/60 px-3.5 py-3 text-sm text-accent-strong">
                    <Sparkles size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{t('editMeal.aiHint')}</span>
                </p>

                {formData.image_url && (
                    <div className="relative h-32 w-full overflow-hidden rounded-2xl border border-line bg-surface-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={formData.image_url}
                            alt={t('editMeal.livePreview')}
                            className="h-full w-full object-cover"
                            onError={(e) => (e.currentTarget.style.display = 'none')}
                        />
                    </div>
                )}

                <Field
                    label={t('editMeal.mealNameLabel')}
                    required
                    hint={isGenerating ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-accent-strong"><Spinner size={12} /> {t('editMeal.aiWriting')}</span>
                    ) : undefined}
                >
                    <TextInput
                        value={formData.item_name}
                        onChange={(e) => set({ item_name: e.target.value })}
                        onBlur={handleNameBlur}
                        placeholder={t('editMeal.mealNamePlaceholder')}
                        disabled={isGenerating}
                        aria-busy={isGenerating || undefined}
                        autoComplete="off"
                    />
                </Field>

                <div className={cn('space-y-5 transition-opacity', isGenerating && 'pointer-events-none opacity-50')} aria-hidden={isGenerating || undefined}>
                    <Field label={t('editMeal.ingredientsLabel')} required>
                        <TextArea
                            rows={2}
                            value={formData.ingredients}
                            onChange={(e) => set({ ingredients: e.target.value })}
                            placeholder={t('editMeal.ingredientsPlaceholder')}
                        />
                    </Field>

                    <Field label={t('editMeal.instructionsLabel')}>
                        <TextArea
                            rows={4}
                            value={formData.cooking_instructions}
                            onChange={(e) => set({ cooking_instructions: e.target.value })}
                            placeholder={t('editMeal.instructionsPlaceholder')}
                        />
                    </Field>

                    <fieldset>
                        <legend className="mb-2 text-sm font-semibold text-ink">{t('editMeal.detailsSection')}</legend>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label={t('editMeal.caloriesLabel')} required>
                                <TextInput type="number" inputMode="numeric" min="0" value={formData.calories} onChange={(e) => set({ calories: e.target.value })} />
                            </Field>
                            <Field label={`${t('editMeal.prepTimeLabel')} (${t('editMeal.prepTimeUnit')})`} required>
                                <TextInput type="number" inputMode="numeric" min="0" value={formData.prep_time_minutes} onChange={(e) => set({ prep_time_minutes: e.target.value })} />
                            </Field>
                        </div>
                    </fieldset>

                    <fieldset>
                        <legend className="mb-2 text-sm font-semibold text-ink">{t('editMeal.nutritionalInfoLabel')}</legend>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {([
                                ['protein_g', 'editMeal.proteinLabel'],
                                ['carbs_g', 'editMeal.carbsLabel'],
                                ['fat_g', 'editMeal.fatLabel'],
                                ['fiber_g', 'editMeal.fiberLabel'],
                            ] as const).map(([key, labelKey]) => (
                                <Field key={key} label={t(labelKey)}>
                                    <TextInput
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        step="0.1"
                                        placeholder="0"
                                        value={formData[key]}
                                        onChange={(e) => set({ [key]: e.target.value } as Partial<typeof formData>)}
                                    />
                                </Field>
                            ))}
                        </div>
                    </fieldset>

                    <fieldset className="space-y-3">
                        <legend className="mb-2 text-sm font-semibold text-ink">{t('editMeal.linksSection')}</legend>
                        <Field label={t('editMeal.recipeUrlLabel')}>
                            <TextInput type="url" inputMode="url" value={formData.recipe_url} onChange={(e) => set({ recipe_url: e.target.value })} placeholder={t('editMeal.recipeUrlPlaceholder')} />
                        </Field>
                        <Field label={t('editMeal.imageUrlLabel')}>
                            <TextInput type="url" inputMode="url" value={formData.image_url} onChange={(e) => set({ image_url: e.target.value })} placeholder={t('editMeal.imageUrlPlaceholder')} />
                        </Field>
                    </fieldset>

                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4 transition-colors hover:bg-surface-muted">
                        <input
                            type="checkbox"
                            checked={formData.is_vegetarian}
                            onChange={(e) => set({ is_vegetarian: e.target.checked })}
                            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-[var(--color-accent)]"
                        />
                        <span>
                            <span className="block text-sm font-semibold text-ink">{t('editMeal.vegetarianLabel')}</span>
                            <span className="text-sm text-ink-muted">{t('editMeal.vegetarianDescription')}</span>
                        </span>
                    </label>

                    <fieldset>
                        <legend className="mb-2 text-sm font-semibold text-ink">{t('editMeal.scopeTitle')}</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {([
                                { all: false, title: t('editMeal.scopeThisDay'), hint: t('editMeal.scopeThisDayHint', { date: mealId }) },
                                { all: true, title: t('editMeal.scopeEveryMonth'), hint: t('editMeal.scopeEveryMonthHint') },
                            ]).map(opt => (
                                <label
                                    key={String(opt.all)}
                                    className={cn(
                                        'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
                                        applyToAllMonths === opt.all ? 'border-accent bg-accent-soft/50' : 'border-line hover:bg-surface-muted',
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name={`${formId}-scope`}
                                        checked={applyToAllMonths === opt.all}
                                        onChange={() => setApplyToAllMonths(opt.all)}
                                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
                                    />
                                    <span>
                                        <span className="block text-sm font-semibold text-ink">{opt.title}</span>
                                        <span className="text-xs text-ink-muted">{opt.hint}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                </div>
            </form>
        </Dialog>
    );
}
