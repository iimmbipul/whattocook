import { NextRequest, NextResponse } from 'next/server';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import {
    translationProviderOptions,
    getModelChain,
    hasAnyAiProvider,
    type ModelChoice,
} from '@/lib/aiModels';

// Translation strategy:
//   1. Gemini (gemini-3.5-flash-lite): structured output, up to
//      GEMINI_ITEMS_PER_CALL strings per call, so a meal translates in one call
//      per language.
//   2. Groq (openai/gpt-oss-20b) fallback: the original numbered-line,
//      TPM-paced chunking, sized for the Free plan's 8000 tokens-per-minute cap.

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

// ---------------------------------------------------------------------------
// Gemini path
// ---------------------------------------------------------------------------

const GEMINI_ITEMS_PER_CALL = 40;

const translationSchema = z.object({
    translations: z.array(z.string()),
});

async function translateWithGemini(
    choice: ModelChoice,
    texts: string[],
    sourceLang: string,
    targetLang: string,
): Promise<string[]> {
    const out: string[] = [];
    for (let start = 0; start < texts.length; start += GEMINI_ITEMS_PER_CALL) {
        const batch = texts.slice(start, start + GEMINI_ITEMS_PER_CALL);
        const { output } = await generateText({
            model: choice.model,
            maxRetries: choice.maxRetries,
            output: Output.object({ schema: translationSchema, name: 'translations' }),
            system: `You are a professional translator. Translate each string in the given JSON array from ${languageName(sourceLang)} to ${languageName(targetLang)}.

Rules:
- Return "translations" with exactly ${batch.length} strings, in the same order as the input.
- Each translation is a single line, with no line breaks.
- Preserve proper nouns and brand names. Write food and dish names the way ${languageName(targetLang)} speakers naturally write them (transliterate if needed).
- Keep ALL digits as Western Arabic numerals (0-9). Do NOT convert numbers to native scripts (e.g. Hindi ७, Odia ୭, Bengali ৭). "7" must stay "7".
- Do not add numbering, notes, or commentary.`,
            prompt: JSON.stringify(batch),
            temperature: 0.2,
            providerOptions: translationProviderOptions,
        });

        const got = output.translations;
        if (got.length !== batch.length || got.some((t) => !t || !t.trim())) {
            throw new Error(
                `Gemini returned ${got.length} translations for ${batch.length} inputs (or blank items)`,
            );
        }
        out.push(...got.map((t) => normalizeDigits(t.replace(/\r?\n/g, ' ').trim())));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Groq fallback path (unchanged behaviour from the Groq-only version)
// ---------------------------------------------------------------------------

// Module-scoped rolling-window TPM tracker. Shared across concurrent
// requests in the same Node process so we don't collectively bust the
// Free plan's 8000-tokens-per-minute cap on openai/gpt-oss-20b.
// Note: on Vercel each serverless instance has its own copy. If you move
// Groq to the paid Developer plan (250K TPM), raise these numbers.
const TPM_LIMIT = 8000;
const TPM_SOFT_LIMIT = TPM_LIMIT * 0.9; // leave headroom for estimate error
const TPM_WINDOW_MS = 60_000;
const rateWindow: { ts: number; tokens: number }[] = [];

function trimRateWindow(now: number) {
    while (rateWindow.length && now - rateWindow[0].ts > TPM_WINDOW_MS) {
        rateWindow.shift();
    }
}

async function waitForTpmBudget(needTokens: number): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const now = Date.now();
        trimRateWindow(now);
        const used = rateWindow.reduce((s, e) => s + e.tokens, 0);
        if (used + needTokens <= TPM_SOFT_LIMIT || rateWindow.length === 0) return;
        const oldest = rateWindow[0];
        const waitMs = Math.max(250, oldest.ts + TPM_WINDOW_MS - now + 250);
        await new Promise((r) => setTimeout(r, waitMs));
    }
}

function recordTpmUsage(tokens: number) {
    rateWindow.push({ ts: Date.now(), tokens });
}

function parseRetryAfterMs(err: any): number | null {
    // Groq returns "Please try again in 5.07s" and/or a retry-after header
    const msg: string | undefined = err?.message ?? err?.responseBody;
    if (typeof msg === 'string') {
        const m = msg.match(/try again in\s+([\d.]+)s/i);
        if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 250;
    }
    const header = err?.responseHeaders?.['retry-after'];
    if (header) {
        const n = parseFloat(header);
        if (!Number.isNaN(n)) return Math.ceil(n * 1000) + 250;
    }
    return null;
}

async function translateWithGroq(
    choice: ModelChoice,
    texts: string[],
    sourceLang: string,
    targetLang: string,
): Promise<string[]> {
    // Groq gpt-oss-20b on the Free plan caps at 8000 TPM, where
    // "tokens" = input + declared maxOutputTokens. Budget both sides
    // so a single request stays well under the ceiling.
    const TPM_BUDGET = 7000;               // leave headroom under 8000
    const SYSTEM_OVERHEAD_TOKENS = 400;    // rough est of system+scaffold
    const OUTPUT_EXPANSION = 4.0;          // non-Latin scripts + JSON quoting
    const MAX_OUTPUT_PER_CHUNK = 4500;
    const MAX_ITEMS_PER_CHUNK = 5;         // cap batch size independent of tokens
    const MIN_OUTPUT_TOKENS = 1024;        // floor covers residual reasoning + output

    const estimateTokens = (s: string) => Math.ceil(s.length / 4);

    // Greedy chunking: pack as many texts as fit under the budget.
    const chunks: string[][] = [];
    let current: string[] = [];
    let currentInputTokens = 0;
    for (const t of texts) {
        const tTokens = estimateTokens(t) + 6; // +numbering/newline
        const projectedInput = currentInputTokens + tTokens;
        const projectedOutput = Math.min(
            MAX_OUTPUT_PER_CHUNK,
            Math.ceil(projectedInput * OUTPUT_EXPANSION) + 64,
        );
        const projectedTotal = SYSTEM_OVERHEAD_TOKENS + projectedInput + projectedOutput;
        const wouldExceedItems = current.length >= MAX_ITEMS_PER_CHUNK;
        if (current.length > 0 && (projectedTotal > TPM_BUDGET || wouldExceedItems)) {
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
            Math.max(MIN_OUTPUT_TOKENS, Math.ceil(inputTokens * OUTPUT_EXPANSION) + 256),
        );

        // Reserve budget before firing so we don't collectively bust TPM.
        const reservation = SYSTEM_OVERHEAD_TOKENS + inputTokens + maxOutputTokens;

        const callModel = async () => generateText({
            model: choice.model,
            // gpt-oss-20b is a reasoning model; without low effort, ~90% of the
            // output budget is spent on chain-of-thought and translations
            // get truncated. Translation doesn't need reasoning.
            providerOptions: translationProviderOptions,
            system: `You are a professional translator. Translate the given numbered list of texts from ${languageName(sourceLang)} to ${languageName(targetLang)}.

CRITICAL INSTRUCTIONS:
- Output exactly ${chunk.length} lines, each formatted as: "<N>. <translation>"
- <N> is the same number as the input line. Numbers must run 1..${chunk.length} in order.
- Each translation must be on ONE line — no line breaks inside a translation.
- Preserve proper nouns, brand names, and food/dish names naturally (transliterate if needed).
- Keep ALL digits as Western Arabic numerals (0-9). Do NOT convert numbers to native scripts (e.g. Hindi ७, Odia ୭, Bengali ৭). "7" must stay "7" in every language.
- Do NOT add any preamble, epilogue, headings, markdown, backticks, or commentary. Output ONLY the numbered lines.

Example output for 2 items:
1. first translation
2. second translation`,
            prompt: `Translate the following ${chunk.length} texts to ${languageName(targetLang)}:\n\n${numbered}`,
            temperature: 0.2,
            maxOutputTokens,
        });

        let text = '';
        let finishReason: string | undefined;
        let usage: any;
        for (let attempt = 0; attempt < 4; attempt++) {
            await waitForTpmBudget(reservation);
            try {
                const resp = await callModel();
                text = resp.text;
                finishReason = resp.finishReason;
                usage = resp.usage;
                const actualTokens =
                    (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) || reservation;
                recordTpmUsage(actualTokens);
                break;
            } catch (err: any) {
                // Assume the model consumed the reservation even on failure —
                // pessimistic accounting so we don't undercount and re-bust.
                recordTpmUsage(reservation);
                const retryAfter = parseRetryAfterMs(err);
                const isRateLimit =
                    err?.statusCode === 429 ||
                    /rate limit|TPM|tokens per minute/i.test(err?.message ?? '');
                if (!isRateLimit || attempt === 3) throw err;
                const backoff = retryAfter ?? Math.min(15_000, 2000 * (attempt + 1));
                console.warn(
                    `[translate] rate-limited, backing off ${backoff}ms (attempt ${attempt + 1})`,
                );
                await new Promise((r) => setTimeout(r, backoff));
            }
        }

        // Parse numbered lines: "<n>. <translation>". Robust to model
        // preamble, blank lines, and partial (truncated) output.
        const results: (string | undefined)[] = new Array(chunk.length);
        for (const line of text.split(/\r?\n/)) {
            const m = line.match(/^\s*(\d+)[.)]\s*(.*)$/);
            if (!m) continue;
            const idx = parseInt(m[1], 10) - 1;
            if (idx < 0 || idx >= chunk.length) continue;
            if (results[idx] === undefined) results[idx] = m[2].trim();
        }

        const missing = results.reduce<number[]>((acc, v, i) => {
            if (v === undefined || v === '') acc.push(i + 1);
            return acc;
        }, []);

        if (missing.length > 0) {
            const diag = {
                finishReason,
                usage,
                maxOutputTokens,
                chunkSize: chunk.length,
                missingLines: missing,
                rawPreview: text.slice(0, 500),
            };
            console.error('[translate] incomplete output', diag);
            const err: any = new Error(
                finishReason === 'length'
                    ? `Translation truncated: missing lines ${missing.join(',')} of ${chunk.length}`
                    : `Translation incomplete: missing lines ${missing.join(',')} of ${chunk.length}`,
            );
            err.diag = diag;
            throw err;
        }

        return results.map((s) => normalizeDigits(String(s)));
    };

    const translations: string[] = [];
    for (const chunk of chunks) {
        const out = await translateChunk(chunk);
        translations.push(...out);
    }
    return translations;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
    if (!hasAnyAiProvider()) {
        return NextResponse.json(
            {
                error:
                    'Translation not configured. Add GOOGLE_GENERATIVE_AI_API_KEY and/or GROQ_API_KEY to .env.local',
            },
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

        const inputs = (texts as unknown[]).map((t) => String(t));
        const chain = getModelChain();
        let lastError: unknown;

        for (let i = 0; i < chain.length; i++) {
            const choice = chain[i];
            try {
                const translations =
                    choice.provider === 'gemini'
                        ? await translateWithGemini(choice, inputs, sourceLang, targetLang)
                        : await translateWithGroq(choice, inputs, sourceLang, targetLang);
                return NextResponse.json({ translations });
            } catch (err: unknown) {
                lastError = err;
                const next = chain[i + 1];
                const message = err instanceof Error ? err.message : String(err);
                console.warn(
                    `[translate] ${choice.provider}/${choice.modelId} failed: ${message}` +
                        (next ? `; falling back to ${next.provider}/${next.modelId}` : ''),
                );
            }
        }

        throw lastError;
    } catch (error: any) {
        console.error('Translation route error:', error);
        return NextResponse.json(
            { error: error?.message ?? 'Translation failed', diag: error?.diag },
            { status: 500 },
        );
    }
}
