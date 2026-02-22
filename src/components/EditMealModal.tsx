'use client';

import { MealItem, MealItemTranslation } from '@/types/meal';
import { updateMeal, updateMealResponsibility } from '@/lib/firestore';
import { getCurrentUser } from '@/lib/auth';
import { useState } from 'react';
import { X, Utensils, Clock, Flame, Link as LinkIcon, Image as ImageIcon, CheckCircle, ShoppingCart } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { translateTexts } from '@/lib/translate';
import { supportedLocales } from '@/lib/i18n';

interface EditMealModalProps {
    meal: MealItem;
    mealId: string;
    mealType: 'breakfast' | 'lunch' | 'dinner';
    isOpen: boolean;
    onClose: () => void;
    onRefresh?: () => void;
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

export default function EditMealModal({ meal, mealId, mealType, isOpen, onClose, onRefresh }: EditMealModalProps) {
    const { t } = useLocale();

    const [formData, setFormData] = useState({
        item_name: meal.item_name,
        ingredients: meal.ingredients.join(', '),
        recipe_url: meal.recipe_url,
        image_url: meal.image_url,
        calories: meal.calories.toString(),
        prep_time_minutes: meal.prep_time_minutes.toString(),
        is_vegetarian: meal.is_vegetarian,
        cooking_instructions: meal.cooking_instructions?.join('\n') || '',
        protein_g: meal.nutrients?.protein_g?.toString() || '',
        carbs_g: meal.nutrients?.carbs_g?.toString() || '',
        fat_g: meal.nutrients?.fat_g?.toString() || '',
        fiber_g: meal.nutrients?.fiber_g?.toString() || '',
    });
    const [loading, setLoading] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [error, setError] = useState('');
    const [showSuccess, setShowSuccess] = useState(false);

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
            } as any);

            if (success) {
                try {
                    const currentUser = await getCurrentUser();
                    if (currentUser) {
                        const slot = (mealType === 'breakfast' || mealType === 'lunch')
                            ? 'breakfastLunchId'
                            : 'dinnerId';
                        await updateMealResponsibility(mealId, slot, currentUser.uid);
                    }
                } catch (respError) {
                    console.error('Failed to auto-assign responsibility:', respError);
                }

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

    if (!isOpen) return null;

    const inputClasses = "w-full px-4 py-2.5 bg-brand-light/10 border border-brand-light/30 rounded-xl focus:ring-2 focus:ring-brand-primary focus:bg-white focus:border-transparent transition-all outline-none text-brand-darkest placeholder:text-brand-dark/50";
    const labelClasses = "flex items-center gap-2 text-sm font-medium text-brand-dark mb-1.5 ml-1";

    // Loading state covers both saving + translating
    const isBusy = loading || translating;
    const busyLabel = translating
        ? '🌐 Translating...'
        : t('editMeal.savingButton');

    return (
        <div className="fixed inset-0 bg-brand-darkest/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-hidden flex flex-col border border-white/20">

                {showSuccess ? (
                    <div className="p-8 flex flex-col items-center justify-center text-center space-y-6 animate-in zoom-in-50 duration-300">
                        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-2">
                            <CheckCircle size={40} />
                        </div>
                        <div>
                            <h3 className="text-2xl font-bold text-brand-darkest mb-2">{t('editMeal.successTitle')}</h3>
                            <p className="text-brand-dark text-lg">{t('editMeal.successMessage')}</p>
                            <div className="mt-4 p-4 bg-brand-light/10 rounded-xl border border-brand-light/20 flex flex-col items-center gap-2">
                                <ShoppingCart className="text-brand-primary" size={24} />
                                <p className="font-semibold text-brand-primary">{t('editMeal.groceryReminder')}</p>
                            </div>
                        </div>
                        <button
                            onClick={handleClose}
                            className="w-full py-3 bg-brand-primary text-white font-bold rounded-xl hover:bg-brand-dark transition-all active:scale-95 shadow-lg shadow-brand-primary/20"
                        >
                            {t('editMeal.gotItButton')}
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-brand-light/20 flex items-center justify-between bg-white sticky top-0 z-10">
                            <div>
                                <h2 className="text-xl font-bold text-brand-darkest flex items-center gap-2">
                                    <span className="p-2 bg-brand-light/30 text-brand-primary rounded-lg">
                                        <Utensils size={20} />
                                    </span>
                                    {t('editMeal.editTitle')} {mealType.charAt(0).toUpperCase() + mealType.slice(1)}
                                </h2>
                                <p className="text-xs text-brand-dark mt-0.5">{t('editMeal.subtitle')}</p>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-brand-light/20 rounded-full text-brand-dark/50 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Form Body */}
                        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
                            {error && (
                                <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm font-medium">
                                    {error}
                                </div>
                            )}

                            {/* Translation notice */}
                            <div className="bg-brand-light/10 border border-brand-light/20 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-brand-dark">
                                <span>🌐</span>
                                <span>Translations for all languages will be generated automatically when you save.</span>
                            </div>

                            {/* Image Preview Card */}
                            {formData.image_url && (
                                <div className="relative h-32 w-full rounded-2xl overflow-hidden border border-brand-light/30 group">
                                    <img
                                        src={formData.image_url}
                                        alt="Preview"
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        onError={(e) => (e.currentTarget.style.display = 'none')}
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                                    <span className="absolute bottom-3 left-3 text-white text-xs font-medium bg-black/20 backdrop-blur-md px-2 py-1 rounded-md">
                                        {t('editMeal.livePreview')}
                                    </span>
                                </div>
                            )}

                            <div>
                                <label className={labelClasses}>{t('editMeal.mealNameLabel')}</label>
                                <input
                                    type="text"
                                    value={formData.item_name}
                                    onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                                    className={inputClasses}
                                    placeholder={t('editMeal.mealNamePlaceholder')}
                                    required
                                />
                            </div>

                            <div>
                                <label className={labelClasses}>{t('editMeal.ingredientsLabel')}</label>
                                <textarea
                                    value={formData.ingredients}
                                    onChange={(e) => setFormData({ ...formData, ingredients: e.target.value })}
                                    className={`${inputClasses} resize-none`}
                                    rows={2}
                                    placeholder={t('editMeal.ingredientsPlaceholder')}
                                    required
                                />
                            </div>

                            <div>
                                <label className={labelClasses}>{t('editMeal.instructionsLabel')}</label>
                                <textarea
                                    value={formData.cooking_instructions}
                                    onChange={(e) => setFormData({ ...formData, cooking_instructions: e.target.value })}
                                    className={`${inputClasses} resize-none`}
                                    rows={3}
                                    placeholder={t('editMeal.instructionsPlaceholder')}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={labelClasses}><Flame size={14} className="text-brand-secondary" /> {t('editMeal.caloriesLabel')}</label>
                                    <input
                                        type="number"
                                        value={formData.calories}
                                        onChange={(e) => setFormData({ ...formData, calories: e.target.value })}
                                        className={inputClasses}
                                        required
                                        min="0"
                                    />
                                </div>
                                <div>
                                    <label className={labelClasses}><Clock size={14} className="text-brand-primary" /> {t('editMeal.prepTimeLabel')}</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={formData.prep_time_minutes}
                                            onChange={(e) => setFormData({ ...formData, prep_time_minutes: e.target.value })}
                                            className={inputClasses}
                                            required
                                            min="0"
                                        />
                                        <span className="absolute right-3 top-2.5 text-xs text-brand-dark/50 mt-0.5">{t('editMeal.prepTimeUnit')}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Nutrients Section */}
                            <div className="bg-brand-light/10 p-4 rounded-2xl border border-brand-light/30">
                                <label className="text-sm font-semibold text-brand-dark mb-3 block">{t('editMeal.nutritionalInfoLabel')}</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-brand-dark/70 mb-1 block">{t('editMeal.proteinLabel')}</label>
                                        <input type="number" value={formData.protein_g} onChange={(e) => setFormData({ ...formData, protein_g: e.target.value })} className={inputClasses} placeholder="0" min="0" step="0.1" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-brand-dark/70 mb-1 block">{t('editMeal.carbsLabel')}</label>
                                        <input type="number" value={formData.carbs_g} onChange={(e) => setFormData({ ...formData, carbs_g: e.target.value })} className={inputClasses} placeholder="0" min="0" step="0.1" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-brand-dark/70 mb-1 block">{t('editMeal.fatLabel')}</label>
                                        <input type="number" value={formData.fat_g} onChange={(e) => setFormData({ ...formData, fat_g: e.target.value })} className={inputClasses} placeholder="0" min="0" step="0.1" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-brand-dark/70 mb-1 block">{t('editMeal.fiberLabel')}</label>
                                        <input type="number" value={formData.fiber_g} onChange={(e) => setFormData({ ...formData, fiber_g: e.target.value })} className={inputClasses} placeholder="0" min="0" step="0.1" />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className={labelClasses}><LinkIcon size={14} /> {t('editMeal.recipeUrlLabel')}</label>
                                    <input type="url" value={formData.recipe_url} onChange={(e) => setFormData({ ...formData, recipe_url: e.target.value })} className={inputClasses} placeholder={t('editMeal.recipeUrlPlaceholder')} />
                                </div>
                                <div>
                                    <label className={labelClasses}><ImageIcon size={14} /> {t('editMeal.imageUrlLabel')}</label>
                                    <input type="url" value={formData.image_url} onChange={(e) => setFormData({ ...formData, image_url: e.target.value })} className={inputClasses} placeholder={t('editMeal.imageUrlPlaceholder')} />
                                </div>
                            </div>

                            <label className="flex items-center p-4 bg-brand-light/10 border border-brand-light/20 rounded-2xl cursor-pointer hover:bg-brand-light/20 transition-colors group">
                                <input
                                    type="checkbox"
                                    checked={formData.is_vegetarian}
                                    onChange={(e) => setFormData({ ...formData, is_vegetarian: e.target.checked })}
                                    className="w-5 h-5 text-brand-primary border-brand-secondary rounded-lg focus:ring-brand-primary"
                                />
                                <div className="ml-3">
                                    <span className="block text-sm font-bold text-brand-darkest">{t('editMeal.vegetarianLabel')}</span>
                                    <span className="text-xs text-brand-dark">{t('editMeal.vegetarianDescription')}</span>
                                </div>
                                <span className="ml-auto text-xl group-hover:scale-110 transition-transform">🌱</span>
                            </label>

                            {/* Action Buttons */}
                            <div className="flex gap-3 pt-2 sticky bottom-0 bg-white">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 px-6 py-3 border border-brand-light/30 text-brand-dark font-semibold rounded-xl hover:bg-brand-light/10 transition-all active:scale-95"
                                    disabled={isBusy}
                                >
                                    {t('editMeal.cancelButton')}
                                </button>
                                <button
                                    type="submit"
                                    className="flex-[2] px-6 py-3 bg-brand-primary hover:bg-brand-dark text-white font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20"
                                    disabled={isBusy}
                                >
                                    {isBusy ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            {busyLabel}
                                        </>
                                    ) : (
                                        t('editMeal.saveButton')
                                    )}
                                </button>
                            </div>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}
