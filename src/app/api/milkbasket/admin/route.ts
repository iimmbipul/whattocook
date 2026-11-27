import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/currentUser';
import { getMilkbasketAdminView } from '@/lib/server/milkbasket';

/** GET /api/milkbasket/admin → MilkbasketAdminView. Owner only. */
export async function GET() {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    try {
        const view = await getMilkbasketAdminView(user);
        if (!view) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[milkbasket] admin view failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
}
