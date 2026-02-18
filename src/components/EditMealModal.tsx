'use client';

import { MealItem } from '@/types/meal';
import { updateMeal, updateMealResponsibility } from '@/lib/firestore';
import { getCurrentUser } from '@/lib/auth';
import { useState } from 'react';
import { X, Utensils, Clock, Flame, Link as LinkIcon, Image as ImageIcon } from 'lucide-react';

interface EditMealModalProps {
    meal: MealItem;
    mealId: string;
    mealType: 'breakfast' | 'lunch' | 'dinner';
    isOpen: boolean;
    onClose: () => void;
}

export default function EditMealModal({ meal, mealId, mealType, isOpen, onClose }: EditMealModalProps) {
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
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // Construct base meal
            const updatedMeal: MealItem = {
                item_name: formData.item_name,
                ingredients: formData.ingredients.split(',').map((i) => i.trim()),
                recipe_url: formData.recipe_url,
                image_url: formData.image_url,
                calories: parseInt(formData.calories) || 0,
                prep_time_minutes: parseInt(formData.prep_time_minutes) || 0,
                is_vegetarian: formData.is_vegetarian,
            };

            // Process Cooking Instructions
            if (formData.cooking_instructions.trim()) {
                updatedMeal.cooking_instructions = formData.cooking_instructions
                    .split('\n')
                    .map(step => step.trim())
                    .filter(step => step.length > 0);
            }

            // Process Nutrients
            const hasNutrients = formData.protein_g || formData.carbs_g || formData.fat_g || formData.fiber_g;
            if (hasNutrients) {
                updatedMeal.nutrients = {
                    protein_g: parseFloat(formData.protein_g) || 0,
                    carbs_g: parseFloat(formData.carbs_g) || 0,
                    fat_g: parseFloat(formData.fat_g) || 0,
                    fiber_g: parseFloat(formData.fiber_g) || 0,
                };
            }


            const success = await updateMeal(mealId, {
                [mealType]: updatedMeal,
            } as any);

            if (success) {
                // Auto-assign responsibility to current user
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
                    // Don't block the main success flow, but maybe log it
                }

                onClose();
                window.location.reload();
            } else {
                setError('Failed to update meal. Please try again.');
            }
        } catch (err) {
            setError('An error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const inputClasses = "w-full px-4 py-2.5 bg-brand-light/10 border border-brand-light/30 rounded-xl focus:ring-2 focus:ring-brand-primary focus:bg-white focus:border-transparent transition-all outline-none text-brand-darkest placeholder:text-brand-dark/50";
    const labelClasses = "flex items-center gap-2 text-sm font-medium text-brand-dark mb-1.5 ml-1";

    return (
        <div className="fixed inset-0 bg-brand-darkest/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-hidden flex flex-col border border-white/20">

                {/* Header */}
                <div className="px-6 py-5 border-b border-brand-light/20 flex items-center justify-between bg-white sticky top-0 z-10">
                    <div>
                        <h2 className="text-xl font-bold text-brand-darkest flex items-center gap-2">
                            <span className="p-2 bg-brand-light/30 text-brand-primary rounded-lg">
                                <Utensils size={20} />
                            </span>
                            Edit {mealType.charAt(0).toUpperCase() + mealType.slice(1)}
                        </h2>
                        <p className="text-xs text-brand-dark mt-0.5">Update your meal details and nutritional info</p>
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
                                Live Preview
                            </span>
                        </div>
                    )}

                    <div>
                        <label className={labelClasses}>Meal Name</label>
                        <input
                            type="text"
                            value={formData.item_name}
                            onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                            className={inputClasses}
                            placeholder="e.g. Avocado Toast"
                            required
                        />
                    </div>

                    <div>
                        <label className={labelClasses}>Ingredients</label>
                        <textarea
                            value={formData.ingredients}
                            onChange={(e) => setFormData({ ...formData, ingredients: e.target.value })}
                            className={`${inputClasses} resize-none`}
                            rows={2}
                            placeholder="Salt, pepper, olive oil..."
                            required
                        />
                    </div>

                    <div>
                        <label className={labelClasses}>Cooking Instructions (Optional)</label>
                        <textarea
                            value={formData.cooking_instructions}
                            onChange={(e) => setFormData({ ...formData, cooking_instructions: e.target.value })}
                            className={`${inputClasses} resize-none`}
                            rows={3}
                            placeholder="Step 1: Prep ingredients... (One step per line)"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelClasses}><Flame size={14} className="text-brand-secondary" /> Calories</label>
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
                            <label className={labelClasses}><Clock size={14} className="text-brand-primary" /> Prep Time</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={formData.prep_time_minutes}
                                    onChange={(e) => setFormData({ ...formData, prep_time_minutes: e.target.value })}
                                    className={inputClasses}
                                    required
                                    min="0"
                                />
                                <span className="absolute right-3 top-2.5 text-xs text-brand-dark/50 mt-0.5">min</span>
                            </div>
                        </div>
                    </div>

                    {/* Nutrients Section */}
                    <div className="bg-brand-light/10 p-4 rounded-2xl border border-brand-light/30">
                        <label className="text-sm font-semibold text-brand-dark mb-3 block">Nutritional Info (Optional)</label>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-brand-dark/70 mb-1 block">Protein (g)</label>
                                <input
                                    type="number"
                                    value={formData.protein_g}
                                    onChange={(e) => setFormData({ ...formData, protein_g: e.target.value })}
                                    className={inputClasses}
                                    placeholder="0"
                                    min="0"
                                    step="0.1"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-brand-dark/70 mb-1 block">Carbs (g)</label>
                                <input
                                    type="number"
                                    value={formData.carbs_g}
                                    onChange={(e) => setFormData({ ...formData, carbs_g: e.target.value })}
                                    className={inputClasses}
                                    placeholder="0"
                                    min="0"
                                    step="0.1"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-brand-dark/70 mb-1 block">Fat (g)</label>
                                <input
                                    type="number"
                                    value={formData.fat_g}
                                    onChange={(e) => setFormData({ ...formData, fat_g: e.target.value })}
                                    className={inputClasses}
                                    placeholder="0"
                                    min="0"
                                    step="0.1"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-brand-dark/70 mb-1 block">Fiber (g)</label>
                                <input
                                    type="number"
                                    value={formData.fiber_g}
                                    onChange={(e) => setFormData({ ...formData, fiber_g: e.target.value })}
                                    className={inputClasses}
                                    placeholder="0"
                                    min="0"
                                    step="0.1"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className={labelClasses}><LinkIcon size={14} /> Recipe URL</label>
                            <input
                                type="url"
                                value={formData.recipe_url}
                                onChange={(e) => setFormData({ ...formData, recipe_url: e.target.value })}
                                className={inputClasses}
                                placeholder="https://recipe.com/..."
                            />
                        </div>
                        <div>
                            <label className={labelClasses}><ImageIcon size={14} /> Image URL</label>
                            <input
                                type="url"
                                value={formData.image_url}
                                onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                                className={inputClasses}
                                placeholder="https://images.com/meal.jpg"
                            />
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
                            <span className="block text-sm font-bold text-brand-darkest">Vegetarian Option</span>
                            <span className="text-xs text-brand-dark">Check if this meal contains no meat</span>
                        </div>
                        <span className="ml-auto text-xl group-hover:scale-110 transition-transform">🌱</span>
                    </label>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-2 sticky bottom-0 bg-white">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-6 py-3 border border-brand-light/30 text-brand-dark font-semibold rounded-xl hover:bg-brand-light/10 transition-all active:scale-95"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-[2] px-6 py-3 bg-brand-primary hover:bg-brand-dark text-white font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                'Save Changes'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}