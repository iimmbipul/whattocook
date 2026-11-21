import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/currentUser';
import { getMealPhoto, UnsplashUnavailableError } from '@/lib/server/mealImages';

/**
 * GET /api/meal-image?q=<meal name> → { photo: MealPhoto | null }
 *
 * A GET route (not a Server Action) so image lookups run in parallel with
 * each other and with page data, and can be cached by the browser.
 * Signed-in users only, to protect the Unsplash rate limit.
 */
export async function GET(req: NextRequest) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ photo: null }, { status: 401 });

    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q || q.length > 120) {
        return NextResponse.json({ photo: null, error: 'Invalid meal name' }, { status: 400 });
    }

    try {
        const photo = await getMealPhoto(q);
        return NextResponse.json(
            { photo },
            // Found photos are stable: let the browser keep them for a week.
            { headers: { 'Cache-Control': photo ? 'private, max-age=604800' : 'private, max-age=3600' } },
        );
    } catch (err) {
        if (!(err instanceof UnsplashUnavailableError)) console.error('[meal-image] lookup failed:', err);
        else console.warn('[meal-image]', err.message);
        return NextResponse.json({ photo: null }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
}
