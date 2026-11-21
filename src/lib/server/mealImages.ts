import 'server-only';

import { createHash } from 'node:crypto';
import { db, doc, getDoc, setDoc } from './db';
import { mealNameKey, type MealPhoto } from '../mealPhoto';

/**
 * Meal name → Unsplash photo, via the official Search API.
 *
 * - The access key stays on the server (UNSPLASH_ACCESS_KEY).
 * - Results are cached in Firestore (`meal_images/{key}`), shared by every
 *   household, so each distinct dish costs at most a few API calls ever —
 *   Unsplash's demo tier allows 50 requests/hour, production 5,000/hour.
 * - A small in-memory layer avoids repeat Firestore reads within an instance,
 *   and concurrent lookups for the same dish share one request.
 * - When a photo is chosen for a dish, Unsplash's download endpoint is
 *   triggered once, as their API guidelines require.
 */

const COLLECTION = 'meal_images';
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // re-check found photos monthly
const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;   // retry dishes with no match after 3 days
const API = 'https://api.unsplash.com';

type CacheEntry = { photo: MealPhoto | null; fetchedAt: number };

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<MealPhoto | null>>();

export class UnsplashUnavailableError extends Error {}

function isFresh(entry: CacheEntry): boolean {
    return Date.now() - entry.fetchedAt < (entry.photo ? HIT_TTL_MS : MISS_TTL_MS);
}

/** Firestore doc id: readable slug, plus a hash so non-Latin names stay unique. */
function docIdFor(key: string): string {
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 10);
    return slug ? `${slug}-${hash}` : hash;
}

/**
 * Queries to try, most specific first. Combo dishes fall back to their main
 * part ("dal tadka & jeera rice" → "dal tadka"); "food" steers results away
 * from non-food photos (e.g. "toast").
 */
function candidateQueries(key: string): string[] {
    const primary = key.split(/\s+(?:&|and|with|\+)\s+|,|\/|\(/)[0].trim();
    const queries = [`${key} food`];
    if (primary && primary !== key) queries.push(`${primary} food`);
    queries.push(primary || key);
    return Array.from(new Set(queries));
}

interface UnsplashSearchPhoto {
    id: string;
    color?: string | null;
    alt_description?: string | null;
    description?: string | null;
    urls: { raw: string };
    links: { download_location: string };
    user: { name: string; links: { html: string } };
    tags?: { title?: string }[];
}

/** Prefer results whose description/tags mention the dish's words; keep API order on ties. */
function pickBest(results: UnsplashSearchPhoto[], query: string): UnsplashSearchPhoto | null {
    const words = query.split(/\s+/).filter(w => w.length > 2 && w !== 'food' && w !== 'and' && w !== 'with');
    let best: UnsplashSearchPhoto | null = null;
    let bestScore = -1;
    for (const r of results) {
        const text = [r.alt_description, r.description, ...(r.tags ?? []).map(t => t.title)].join(' ').toLowerCase();
        const score = words.filter(w => text.includes(w)).length;
        if (score > bestScore) {
            best = r;
            bestScore = score;
        }
    }
    return best;
}

function withUtm(url: string): string {
    const app = process.env.UNSPLASH_APP_NAME || 'whattocook';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}utm_source=${encodeURIComponent(app)}&utm_medium=referral`;
}

async function unsplashFetch(path: string): Promise<Response> {
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) throw new UnsplashUnavailableError('UNSPLASH_ACCESS_KEY is not set');
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
        headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
    });
    // 401/403 = bad key or rate limit exceeded; don't cache those as "no photo".
    if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw new UnsplashUnavailableError(`Unsplash responded ${res.status} (${res.headers.get('x-ratelimit-remaining') ?? '?'} requests left)`);
    }
    return res;
}

async function search(key: string): Promise<{ photo: MealPhoto; downloadLocation: string } | null> {
    for (const query of candidateQueries(key)) {
        const res = await unsplashFetch(
            `/search/photos?query=${encodeURIComponent(query)}&per_page=8&content_filter=high`,
        );
        if (!res.ok) continue;
        const body = (await res.json()) as { results?: UnsplashSearchPhoto[] };
        const best = pickBest(body.results ?? [], key);
        if (!best) continue;
        return {
            photo: {
                id: best.id,
                raw: best.urls.raw,
                color: best.color ?? null,
                alt: best.alt_description ?? null,
                photographer: best.user.name,
                photographerUrl: withUtm(best.user.links.html),
                unsplashUrl: withUtm('https://unsplash.com/'),
            },
            downloadLocation: best.links.download_location,
        };
    }
    return null;
}

async function resolve(key: string): Promise<MealPhoto | null> {
    const ref = doc(db, COLLECTION, docIdFor(key));
    const snap = await getDoc(ref);
    const stored = snap.exists() ? (snap.data() as CacheEntry) : null;
    if (stored && isFresh(stored)) {
        memory.set(key, stored);
        return stored.photo;
    }

    let found: Awaited<ReturnType<typeof search>>;
    try {
        found = await search(key);
    } catch (err) {
        // Rate-limited or misconfigured: serve the stale entry if we have one.
        if (stored) {
            memory.set(key, stored);
            return stored.photo;
        }
        throw err;
    }

    const entry: CacheEntry = { photo: found?.photo ?? null, fetchedAt: Date.now() };
    memory.set(key, entry);
    await setDoc(ref, { ...entry, name: key });

    // Unsplash asks apps to trigger a download when a photo is used.
    if (found && found.photo.id !== stored?.photo?.id) {
        unsplashFetch(found.downloadLocation).catch(() => {});
    }
    return entry.photo;
}

/** Photo for a meal name, or null when Unsplash has nothing suitable. */
export async function getMealPhoto(mealName: string): Promise<MealPhoto | null> {
    const key = mealNameKey(mealName);
    if (!key) return null;

    const cached = memory.get(key);
    if (cached && isFresh(cached)) return cached.photo;

    const pending = inflight.get(key);
    if (pending) return pending;

    const request = resolve(key).finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
}
