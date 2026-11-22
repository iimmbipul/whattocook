import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/currentUser';
import { getRatingsDashboard } from '@/lib/server/ratings';

/** GET /api/ratings/summary → RatingsDashboard for the signed-in user's own cooking. */
export async function GET() {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    try {
        return NextResponse.json(await getRatingsDashboard(user), { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[ratings] summary failed:', err);
        return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
}
