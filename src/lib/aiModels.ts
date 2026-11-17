/**
 * Server-only AI model selection with automatic fallback.
 *
 * Primary:  Google Gemini API, gemini-3.5-flash-lite (free tier)
 *           env: GOOGLE_GENERATIVE_AI_API_KEY
 * Fallback: Groq, openai/gpt-oss-20b (Free plan; Developer plan if you add billing)
 *           env: GROQ_API_KEY
 *
 * Either key may be missing; the chain uses whichever providers are configured.
 * If the primary call fails for any reason (rate limit, quota, outage, invalid
 * output), the same request is retried once on the next provider.
 */
import type { LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';

export const GEMINI_MODEL_ID = 'gemini-3.5-flash-lite';
export const GROQ_MODEL_ID = 'openai/gpt-oss-20b';

export type AiProviderName = 'gemini' | 'groq';

export interface ModelChoice {
    provider: AiProviderName;
    modelId: string;
    model: LanguageModel;
    /**
     * AI SDK retries for this attempt. The primary gets 0 when a fallback exists,
     * so a rate-limited Gemini call moves to Groq straight away instead of
     * backing off first.
     */
    maxRetries: number;
}

/**
 * Provider-specific options. Each provider only reads its own key, so the same
 * object can be passed to every model in the chain.
 */
const geminiOptions = {
    // Thinking tokens are billed as output and count against free limits.
    thinkingConfig: { thinkingLevel: 'low' as const },
};

/**
 * For structured generation (meal details, alternatives, 30-day plan).
 * Groq keeps gpt-oss's default reasoning effort: with 'low', it often closes
 * the JSON early on long recipes and Groq rejects it (json_validate_failed).
 */
export const generationProviderOptions = {
    google: geminiOptions,
    groq: {},
};

/**
 * For translation. gpt-oss is a reasoning model; without low effort most of
 * the output budget goes to chain-of-thought and translations get truncated.
 */
export const translationProviderOptions = {
    google: geminiOptions,
    groq: {
        reasoningEffort: 'low' as const,
        reasoningFormat: 'hidden' as const,
    },
};

export function hasAnyAiProvider(): boolean {
    return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GROQ_API_KEY);
}

export function getModelChain(): ModelChoice[] {
    const chain: Omit<ModelChoice, 'maxRetries'>[] = [];

    const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (geminiKey) {
        const google = createGoogleGenerativeAI({ apiKey: geminiKey });
        chain.push({ provider: 'gemini', modelId: GEMINI_MODEL_ID, model: google(GEMINI_MODEL_ID) });
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
        const groq = createGroq({ apiKey: groqKey });
        chain.push({ provider: 'groq', modelId: GROQ_MODEL_ID, model: groq(GROQ_MODEL_ID) });
    }

    if (chain.length === 0) {
        throw new Error(
            'No AI provider configured. Set GOOGLE_GENERATIVE_AI_API_KEY (Gemini) and/or GROQ_API_KEY (Groq).',
        );
    }

    return chain.map((choice, i) => ({
        ...choice,
        maxRetries: i < chain.length - 1 ? 0 : 2,
    }));
}

function describeError(err: unknown): string {
    const e = err as { statusCode?: number; name?: string; message?: string };
    const status = e?.statusCode ? `${e.statusCode} ` : '';
    return `${status}${e?.name ?? 'Error'}: ${(e?.message ?? String(err)).slice(0, 200)}`;
}

/**
 * True when the model answered but its JSON didn't match the schema, either
 * rejected by the provider (Groq returns 400 `json_validate_failed`) or by
 * the AI SDK's own validation. These are usually one-off, so they are worth
 * one more try on the same provider. Rate limits and auth errors are not.
 */
export function isOutputValidationError(err: unknown): boolean {
    const e = err as { name?: string; responseBody?: string; message?: string };
    if (
        e?.name === 'AI_NoObjectGeneratedError' ||
        e?.name === 'AI_TypeValidationError' ||
        e?.name === 'AI_JSONParseError'
    ) {
        return true;
    }
    return /json_validate_failed|does not match the expected schema/i.test(
        `${e?.responseBody ?? ''} ${e?.message ?? ''}`,
    );
}

const ATTEMPTS_ON_INVALID_OUTPUT = 2;

/**
 * Run `task` on each configured model in order until one succeeds.
 * A schema-validation failure is retried once on the same model first.
 * Throws the last error if every provider fails.
 */
export async function runWithFallback<T>(
    label: string,
    task: (choice: ModelChoice) => Promise<T>,
    chain: ModelChoice[] = getModelChain(),
): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < chain.length; i++) {
        const choice = chain[i];
        for (let attempt = 1; attempt <= ATTEMPTS_ON_INVALID_OUTPUT; attempt++) {
            try {
                return await task(choice);
            } catch (err) {
                lastError = err;
                const retrySame = attempt < ATTEMPTS_ON_INVALID_OUTPUT && isOutputValidationError(err);
                const next = chain[i + 1];
                console.warn(
                    `[ai] ${label}: ${choice.provider}/${choice.modelId} failed (${describeError(err)})` +
                        (retrySame
                            ? '; retrying once'
                            : next
                              ? `; falling back to ${next.provider}/${next.modelId}`
                              : ''),
                );
                if (!retrySame) break;
            }
        }
    }
    throw lastError;
}
