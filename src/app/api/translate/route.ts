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

        const numbered = texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n');

        const { text } = await generateText({
            model: groq('openai/gpt-oss-20b'),
            system: `You are a professional translator. Translate the given numbered list of texts from ${languageName(sourceLang)} to ${languageName(targetLang)}.

CRITICAL INSTRUCTIONS:
- Output ONLY a JSON array of translated strings, in the same order as the input.
- The output array MUST contain exactly ${texts.length} items.
- Preserve proper nouns, brand names, and food/dish names naturally (transliterate if needed).
- Keep ALL digits as Western Arabic numerals (0-9). Do NOT convert numbers to native scripts (e.g. Hindi ७, Odia ୭, Bengali ৭). "7" must stay "7" in every language.
- Do NOT include the numbering in the translations.
- Do NOT include markdown, backticks, comments, or any extra text. Output RAW JSON only.

Example output shape: ["translation1", "translation2", ...]`,
            prompt: `Translate the following ${texts.length} texts to ${languageName(targetLang)}:\n\n${numbered}`,
            temperature: 0.2,
        });

        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
            console.error('Groq translation returned no JSON array. Raw:', text);
            return NextResponse.json(
                { error: 'Translation service returned no JSON array' },
                { status: 502 }
            );
        }
        const parsed = JSON.parse(match[0]);

        if (!Array.isArray(parsed) || parsed.length !== texts.length) {
            console.error('Groq translation returned unexpected shape:', parsed);
            return NextResponse.json(
                { error: 'Translation service returned unexpected output' },
                { status: 502 }
            );
        }

        return NextResponse.json({ translations: parsed.map((s) => normalizeDigits(String(s))) });
    } catch (error: any) {
        console.error('Translation route error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
