'use server';

import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';

const alternativeMealsSchema = z.object({
    alternatives: z.array(z.object({
        item_name: z.string(),
        description: z.string()
    }))
});

export type AlternativeMeal = z.infer<typeof alternativeMealsSchema>['alternatives'][0];

// Initialize Groq provider with fallback error check
const getGroqProvider = () => {
    if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is not defined in environment variables');
    }
    return createGroq({
        apiKey: process.env.GROQ_API_KEY,
    });
};

const mealSchema = z.object({
    ingredients: z.array(z.string()),
    cooking_instructions: z.array(z.string()),
    calories: z.number(),
    prep_time_minutes: z.number(),
    is_vegetarian: z.boolean(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    fiber_g: z.number()
});

export type GeneratedMealData = z.infer<typeof mealSchema>;

export async function generateMealDetails(mealName: string): Promise<GeneratedMealData | null> {
    try {
        const groq = getGroqProvider();

        const { text } = await generateText({
            model: groq('llama-3.3-70b-versatile'),
            system: `You are an expert chef and nutritionist. You will be given the name of a meal. 
            Provide the likely ingredients, step-by-step cooking instructions, estimated total serving calories, 
            prep/cook time in minutes, whether it is vegetarian, and estimated macronutrients (protein, carbs, fat, fiber).
            Be concise and reasonably accurate regarding nutritional estimates.
            
            CRITICAL INSTRUCTION: Your output MUST be ONLY valid JSON matching exactly this TypeScript interface:
            {
              "ingredients": string[],
              "cooking_instructions": string[],
              "calories": number,
              "prep_time_minutes": number,
              "is_vegetarian": boolean,
              "protein_g": number,
              "carbs_g": number,
              "fat_g": number,
              "fiber_g": number
            }
            Do NOT include any markdown formatting, markdown backticks, explanations, or extra text. Output RAW JSON only.`,
            prompt: `Meal name: ${mealName}`,
            temperature: 0.2,
        });

        // Parse manually because we are bypassing native unstructured schema locks
        const cleanedText = text.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleanedText);

        // Validate fallback type
        return mealSchema.parse(parsed);
    } catch (error) {
        console.error("Error generating meal details with Groq:", error);
        return null;
    }
}

export async function fetchAlternativeMeals(
    currentMealName: string,
    type: 'protein' | 'balanced' | 'unhealthy'
): Promise<AlternativeMeal[]> {
    try {
        const groq = getGroqProvider();
        let promptTemplate = "";

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

        const { text } = await generateText({
            model: groq('llama-3.3-70b-versatile'),
            system: `${promptTemplate}
            
            CRITICAL INSTRUCTION: Your output MUST be ONLY valid JSON matching exactly this TypeScript interface:
            {
              "alternatives": [
                {
                  "item_name": "string",
                  "description": "string"
                }
              ]
            }
            Do NOT include any markdown formatting, markdown backticks, explanations, or extra text. Output RAW JSON only.`,
            prompt: `Meal name: ${currentMealName}`,
            temperature: 0.7,
        });

        const cleanedText = text.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleanedText);

        const result = alternativeMealsSchema.parse(parsed);
        return result.alternatives;
    } catch (error) {
        console.error("Error generating alternative meals with Groq:", error);
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
        const groq = getGroqProvider();
        
        const { text } = await generateText({
            model: groq('llama-3.3-70b-versatile'),
            system: `You are an expert nutritionist. Create a 30-day meal plan specifically for a ${category} diet. 
            Keep meal names descriptive but concise (max 5 words). 
            Provide estimated reasonable calories for each meal.
            
            CRITICAL INSTRUCTION: Your output MUST be ONLY valid JSON matching exactly this TypeScript interface:
            {
              "days": [
                {
                  "day": 1, // 1 to 30
                  "breakfast_name": "string",
                  "lunch_name": "string",
                  "dinner_name": "string",
                  "breakfast_cal": number,
                  "lunch_cal": number,
                  "dinner_cal": number
                }
              ]
            }
            Do NOT include any markdown formatting, markdown backticks, explanations, or extra text. Output RAW JSON only. Must include exactly 30 items in the days array.`,
            prompt: `Generate a 30-day ${category} meal plan.`,
            temperature: 0.5,
        });

        const cleanedText = text.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleanedText);
        
        const result = monthlyPlanSchema.parse(parsed);
        return result.days;
    } catch (error) {
        console.error("Error generating 30-day plan with Groq:", error);
        return [];
    }
}

