'use server';

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { generationProviderOptions, runWithFallback } from './aiModels';
import { getSessionUser } from './server/currentUser';
import { readPendingSignup } from './server/session';

/** These actions spend the AI provider quota, so they require a signed-in user. */
const MAX_MEAL_NAME_LENGTH = 120;

// Gemini 3.5 Flash-Lite is the primary model, with Groq gpt-oss-20b as the
// fallback (see ./aiModels). Both providers enforce these zod schemas through
// native structured output, so there is no hand-written JSON parsing.

const alternativeMealsSchema = z.object({
    alternatives: z.array(z.object({
        item_name: z.string(),
        description: z.string()
    }))
});

export type AlternativeMeal = z.infer<typeof alternativeMealsSchema>['alternatives'][0];

// Short scalar fields come first: models sometimes close the object early
// after long arrays, so asking for the numbers up front is more reliable.
const mealSchema = z.object({
    calories: z.number(),
    prep_time_minutes: z.number(),
    is_vegetarian: z.boolean(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    fiber_g: z.number(),
    ingredients: z.array(z.string()),
    cooking_instructions: z.array(z.string())
});

export type GeneratedMealData = z.infer<typeof mealSchema>;

export async function generateMealDetails(mealName: string): Promise<GeneratedMealData | null> {
    try {
        if (!(await getSessionUser())) return null;
        if (typeof mealName !== 'string' || !mealName.trim() || mealName.length > MAX_MEAL_NAME_LENGTH) return null;
        return await runWithFallback('meal details', async ({ model, maxRetries }) => {
            const { output } = await generateText({
                model,
                maxRetries,
                output: Output.object({ schema: mealSchema, name: 'meal_details' }),
                system: `You are an expert chef and nutritionist. You will be given the name of a meal.
Provide the estimated total serving calories, prep/cook time in minutes, whether it is vegetarian,
estimated macronutrients in grams (protein_g, carbs_g, fat_g, fiber_g), the likely ingredients,
and step-by-step cooking instructions. Fill in every field.
Be concise and reasonably accurate regarding nutritional estimates.`,
                prompt: `Meal name: ${mealName}`,
                temperature: 0.2,
                providerOptions: generationProviderOptions,
            });
            return output;
        });
    } catch (error) {
        console.error('Error generating meal details:', error);
        return null;
    }
}

export async function fetchAlternativeMeals(
    currentMealName: string,
    type: 'protein' | 'balanced' | 'unhealthy'
): Promise<AlternativeMeal[]> {
    try {
        if (!(await getSessionUser())) return [];
    } catch (error) {
        console.error('Error checking session for alternative meals:', error);
        return [];
    }
    if (typeof currentMealName !== 'string' || currentMealName.length > MAX_MEAL_NAME_LENGTH) return [];
    if (type !== 'protein' && type !== 'balanced' && type !== 'unhealthy') return [];

    let promptTemplate = '';

    switch (type) {
        case 'protein':
            promptTemplate = `You are an expert nutritionist. Provide 5 high-protein meal alternatives that are similar to "${currentMealName}". The alternatives should focus on lean meats, legumes, or high-protein dairy.`;
            break;
        case 'balanced':
            promptTemplate = `You are an expert nutritionist. Provide 5 balanced Indian meal diet alternatives. These should include a good mix of complex carbs, protein, and healthy fats.`;
            break;
        case 'unhealthy':
            promptTemplate = `You are a comfort food chef. Provide 5 extremely tasty, indulgent, and potentially unhealthy meal alternatives. Think deep-fried, cheesy, or super sweet.`;
            break;
    }

    try {
        return await runWithFallback('alternative meals', async ({ model, maxRetries }) => {
            const { output } = await generateText({
                model,
                maxRetries,
                output: Output.object({ schema: alternativeMealsSchema, name: 'alternative_meals' }),
                system: `${promptTemplate}
Return exactly 5 alternatives, each with an item_name and a one-sentence description.`,
                prompt: `Meal name: ${currentMealName}`,
                temperature: 0.7,
                providerOptions: generationProviderOptions,
            });
            return output.alternatives;
        });
    } catch (error) {
        console.error('Error generating alternative meals:', error);
        return [];
    }
}

export interface HouseholdMenu {
    breakfast: string[];
    lunch: string[];
    dinner: string[];
}

const MAX_MENU_ITEMS_PER_SLOT = 40;
const MAX_MENU_NAME_LENGTH = 80;

// Server actions receive whatever the client sends, so clean it before it
// reaches the prompt: strings only, trimmed, de-duplicated and capped.
function cleanMenuNames(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of value) {
        if (typeof v !== 'string') continue;
        const name = v.replace(/\s+/g, ' ').trim().slice(0, MAX_MENU_NAME_LENGTH);
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
        if (out.length >= MAX_MENU_ITEMS_PER_SLOT) break;
    }
    return out;
}

/**
 * "I'm bored" suggestions: 5 fancier dishes in the same style as what the
 * household already eats over its 30-day menu, without repeating any of it.
 */
export async function fetchFancyMealsLikeOurs(
    currentMealName: string,
    mealType: 'breakfast' | 'lunch' | 'dinner',
    menu: HouseholdMenu,
): Promise<AlternativeMeal[]> {
    try {
        if (!(await getSessionUser())) return [];
    } catch (error) {
        console.error('Error checking session for fancy meals:', error);
        return [];
    }
    if (typeof currentMealName !== 'string' || currentMealName.length > MAX_MEAL_NAME_LENGTH) return [];

    const slots: (keyof HouseholdMenu)[] = ['breakfast', 'lunch', 'dinner'];
    const cleaned = Object.fromEntries(
        slots.map((slot) => [slot, cleanMenuNames(menu?.[slot])]),
    ) as unknown as HouseholdMenu;
    const slot: keyof HouseholdMenu = slots.includes(mealType) ? mealType : 'lunch';
    const current = String(currentMealName ?? '').slice(0, MAX_MENU_NAME_LENGTH);

    const menuText = slots
        .map((s) => `${s[0].toUpperCase()}${s.slice(1)}: ${cleaned[s].join('; ') || '(none listed)'}`)
        .join('\n');

    try {
        return await runWithFallback('fancy meals', async ({ model, maxRetries }) => {
            const { output } = await generateText({
                model,
                maxRetries,
                output: Output.object({ schema: alternativeMealsSchema, name: 'fancy_meals' }),
                system: `You are a creative home chef. A family is bored of their usual food and wants something special, but it must still feel like their kind of food.

Their current 30-day menu:
${menuText}

Suggest 5 fancier ${slot} dishes that fit this family's taste:
- Match the cuisines, regional style, main ingredients and vegetarian/non-vegetarian balance seen in the menu.
- Make them feel like a treat: restaurant-style, festive, or a creative upgrade of a dish they already eat.
- Keep them cookable at home with ingredients they already use.
- Do NOT repeat any dish from the menu above, and do not suggest "${current}".
- Each item_name is the dish name (max 6 words); each description is one short, appetising sentence saying why it suits them.`,
                prompt: `Today's ${slot} is "${current}". Suggest 5 fancy dishes like the ones we eat.`,
                temperature: 0.9,
                providerOptions: generationProviderOptions,
            });
            return output.alternatives.slice(0, 5);
        });
    } catch (error) {
        console.error('Error generating fancy meals:', error);
        return [];
    }
}

const monthlyPlanSchema = z.object({
    days: z.array(z.object({
        day: z.number(),
        breakfast_name: z.string(),
        lunch_name: z.string(),
        dinner_name: z.string(),
        breakfast_cal: z.number(),
        lunch_cal: z.number(),
        dinner_cal: z.number()
    }))
});

export type MonthlyPlanDay = z.infer<typeof monthlyPlanSchema>['days'][0];

export async function generate30DayPlan(category: string): Promise<MonthlyPlanDay[]> {
    try {
        // Signed-in owners (diet change) or a verified Google sign-up in progress (onboarding).
        if (!(await getSessionUser()) && !(await readPendingSignup())) return [];
        if (typeof category !== 'string' || !category.trim() || category.length > 40) return [];
        return await runWithFallback('30-day plan', async ({ model, maxRetries }) => {
            const { output } = await generateText({
                model,
                maxRetries,
                output: Output.object({ schema: monthlyPlanSchema, name: 'monthly_meal_plan' }),
                system: `You are an expert nutritionist. Create a 30-day meal plan specifically for a ${category} diet.
Keep meal names descriptive but concise (max 5 words).
Provide estimated reasonable calories for each meal.
The days array must contain exactly 30 items, with "day" numbered 1 to 30.`,
                prompt: `Generate a 30-day ${category} meal plan.`,
                temperature: 0.5,
                providerOptions: generationProviderOptions,
            });
            return output.days;
        });
    } catch (error) {
        console.error('Error generating 30-day plan:', error);
        return [];
    }
}
