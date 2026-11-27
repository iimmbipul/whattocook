import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/currentUser';
import { getHouseholdMilkbasketView } from '@/lib/server/milkbasket';

/** GET /api/milkbasket → MilkbasketHouseholdView. The owner and members (not the cook). */
export async function GET() {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    try {
        const view = await getHouseholdMilkbasketView(user);
        if (!view) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[milkbasket] household view failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
}
