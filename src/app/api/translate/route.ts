import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';

const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    or: 'Odia',
    bn: 'Bengali',
    ta: 'Tamil',
    te: 'Telugu',
    mr: 'Marathi',
    gu: 'Gujarati',
    kn: 'Kannada',
    ml: 'Malayalam',
    pa: 'Punjabi',
    ur: 'Urdu',
};

function languageName(code: string): string {
    return LANGUAGE_NAMES[code] || code;
}

// Force any native-script digits back to ASCII 0-9.
// Covers Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu,
// Kannada, Malayalam, Arabic-Indic, and Extended Arabic-Indic ranges.
function normalizeDigits(input: string): string {
    return input.replace(/[٠-٩۰-۹०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g, (ch) => {
        const code = ch.charCodeAt(0);
        return String(code % 10);
    });
}

export async function POST(req: NextRequest) {
    if (!process.env.GROQ_API_KEY) {
        return NextResponse.json(
            { error: 'Translation not configured. Add GROQ_API_KEY to .env.local' },
            { status: 500 }
        );
    }

    try {
        const { texts, targetLang, sourceLang = 'en' } = await req.json();

        if (!texts || !Array.isArray(texts) || texts.length === 0) {
            return NextResponse.json({ error: 'texts array is required' }, { status: 400 });
        }

        if (!targetLang) {
            return NextResponse.json({ error: 'targetLang is required' }, { status: 400 });
        }

        if (targetLang === sourceLang || targetLang === 'en') {
            return NextResponse.json({ translations: texts });
        }

        const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

        // Groq gpt-oss-20b on the on_demand tier caps at 8000 TPM, where
        // "tokens" = input + declared maxOutputTokens. Budget both sides
        // so a single request stays well under the ceiling.
        const TPM_BUDGET = 7000;               // leave headroom under 8000
        const SYSTEM_OVERHEAD_TOKENS = 400;    // rough est of system+scaffold
        const OUTPUT_EXPANSION = 2.2;          // non-Latin scripts can be 1.5-2x
        const MAX_OUTPUT_PER_CHUNK = 2000;

        const estimateTokens = (s: string) => Math.ceil(s.length / 4);

        // Greedy chunking: pack as many texts as fit under the budget.
        const chunks: string[][] = [];
        let current: string[] = [];
        let currentInputTokens = 0;
        for (const t of texts as string[]) {
            const tTokens = estimateTokens(t) + 6; // +numbering/newline
            const projectedInput = currentInputTokens + tTokens;
            const projectedOutput = Math.min(
                MAX_OUTPUT_PER_CHUNK,
                Math.ceil(projectedInput * OUTPUT_EXPANSION) + 64,
            );
            const projectedTotal = SYSTEM_OVERHEAD_TOKENS + projectedInput + projectedOutput;
            if (current.length > 0 && projectedTotal > TPM_BUDGET) {
                chunks.push(current);
                current = [t];
                currentInputTokens = tTokens;
            } else {
                current.push(t);
                currentInputTokens = projectedInput;
            }
        }
        if (current.length > 0) chunks.push(current);

        const translateChunk = async (chunk: string[]): Promise<string[]> => {
            const numbered = chunk.map((t, i) => `${i + 1}. ${t}`).join('\n');
            const inputTokens = estimateTokens(numbered);
            const maxOutputTokens = Math.min(
                MAX_OUTPUT_PER_CHUNK,
                Math.max(256, Math.ceil(inputTokens * OUTPUT_EXPANSION) + 128),
            );

            const { text } = await generateText({
                model: groq('openai/gpt-oss-20b'),
                system: `You are a professional translator. Translate the given numbered list of texts from ${languageName(sourceLang)} to ${languageName(targetLang)}.

CRITICAL INSTRUCTIONS:
- Output ONLY a JSON array of translated strings, in the same order as the input.
- The output array MUST contain exactly ${chunk.length} items.
- Preserve proper nouns, brand names, and food/dish names naturally (transliterate if needed).
- Keep ALL digits as Western Arabic numerals (0-9). Do NOT convert numbers to native scripts (e.g. Hindi ७, Odia ୭, Bengali ৭). "7" must stay "7" in every language.
- Do NOT include the numbering in the translations.
- Do NOT include markdown, backticks, comments, or any extra text. Output RAW JSON only.

Example output shape: ["translation1", "translation2", ...]`,
                prompt: `Translate the following ${chunk.length} texts to ${languageName(targetLang)}:\n\n${numbered}`,
                temperature: 0.2,
                maxOutputTokens,
            });

            const match = text.match(/\[[\s\S]*\]/);
            if (!match) {
                throw new Error('Translation service returned no JSON array');
            }
            const parsed = JSON.parse(match[0]);
            if (!Array.isArray(parsed) || parsed.length !== chunk.length) {
                throw new Error(
                    `Translation service returned ${Array.isArray(parsed) ? parsed.length : 'non-array'} items, expected ${chunk.length}`,
                );
            }
            return parsed.map((s) => normalizeDigits(String(s)));
        };

        const translations: string[] = [];
        for (const chunk of chunks) {
            const out = await translateChunk(chunk);
            translations.push(...out);
        }

        return NextResponse.json({ translations });
    } catch (error: any) {
        console.error('Translation route error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
