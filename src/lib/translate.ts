/**
 * Client-side Google Translate utility.
 * Calls our internal /api/translate route (which keeps the API key server-side).
 *
 * Features:
 * - In-memory cache to avoid duplicate API calls within a session
 * - Batches multiple strings in a single request
 * - Falls back to original text on any error
 */

// In-memory cache: "text||targetLang" -> translatedText
const translationCache = new Map<string, string>();

function cacheKey(text: string, targetLang: string): string {
    return `${text}||${targetLang}`;
}

/**
 * Translate an array of strings to the target language.
 * Returns the originals if targetLang is 'en' or on error.
 */
export async function translateTexts(
    texts: string[],
    targetLang: string
): Promise<string[]> {
    // English — no translation needed
    if (!targetLang || targetLang === 'en') return texts;

    // Separate cached from un-cached
    const results: string[] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    texts.forEach((text, i) => {
        const key = cacheKey(text, targetLang);
        if (translationCache.has(key)) {
            results[i] = translationCache.get(key)!;
        } else {
            uncachedIndices.push(i);
            uncachedTexts.push(text);
        }
    });

    // All served from cache
    if (uncachedTexts.length === 0) return results;

    try {
        const res = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: uncachedTexts, targetLang }),
        });

        if (!res.ok) {
            console.warn('[translate] API error, falling back to originals');
            uncachedIndices.forEach((originalIdx, i) => {
                results[originalIdx] = texts[originalIdx];
            });
            return results;
        }

        const { translations } = await res.json();

        translations.forEach((translated: string, i: number) => {
            const originalIdx = uncachedIndices[i];
            const original = texts[originalIdx];
            translationCache.set(cacheKey(original, targetLang), translated);
            results[originalIdx] = translated;
        });
    } catch (error) {
        console.warn('[translate] Network error, falling back to originals', error);
        uncachedIndices.forEach((originalIdx) => {
            results[originalIdx] = texts[originalIdx];
        });
    }

    return results;
}

/**
 * Translate a single string.
 */
export async function translateText(
    text: string,
    targetLang: string
): Promise<string> {
    const [result] = await translateTexts([text], targetLang);
    return result;
}
