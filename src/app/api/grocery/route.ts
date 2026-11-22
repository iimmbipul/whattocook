import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/currentUser';
import { getGroceryView } from '@/lib/server/grocery';

/**
 * GET /api/grocery → GroceryView: today's stock check (cook), the shopping
 * list (everyone) and the pantry (cook). A GET route so it loads alongside
 * the page's own data instead of queueing behind Server Actions.
 */
export async function GET() {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    try {
        return NextResponse.json(await getGroceryView(user), { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[grocery] view failed:', err);
        return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
}
