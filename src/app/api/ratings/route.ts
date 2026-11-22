import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/currentUser';
import { getRatingsStatus } from '@/lib/server/ratings';

/**
 * GET /api/ratings → RatingsStatus: meal sessions the signed-in member can
 * still rate, and new feedback for the signed-in cook.
 *
 * A GET route rather than a Server Action so it runs alongside the page's own
 * data loads instead of queueing behind them.
 */
export async function GET() {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    try {
        return NextResponse.json(await getRatingsStatus(user), { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[ratings] status failed:', err);
        return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
}
