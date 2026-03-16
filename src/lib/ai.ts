'use server';

import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';

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
