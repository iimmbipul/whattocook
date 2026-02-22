import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;
const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';

export async function POST(req: NextRequest) {
    if (!GOOGLE_TRANSLATE_API_KEY) {
        return NextResponse.json(
            { error: 'Translation API key not configured. Add GOOGLE_TRANSLATE_API_KEY to .env.local' },
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

        // If target is English (same as source), skip API call
        if (targetLang === sourceLang || targetLang === 'en') {
            return NextResponse.json({ translations: texts });
        }

        const response = await fetch(`${TRANSLATE_URL}?key=${GOOGLE_TRANSLATE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                q: texts,
                target: targetLang,
                source: sourceLang,
                format: 'text',
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Google Translate API error:', errorData);
            return NextResponse.json(
                { error: 'Translation service error', details: errorData },
                { status: response.status }
            );
        }

        const data = await response.json();
        const translations = data.data.translations.map(
            (t: { translatedText: string }) => t.translatedText
        );

        return NextResponse.json({ translations });
    } catch (error: any) {
        console.error('Translation route error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
