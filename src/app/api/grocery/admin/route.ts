import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/currentUser';
import { isAppAdmin } from '@/lib/server/guards';
import { getGroceryAdminView } from '@/lib/server/grocery';

/** GET /api/grocery/admin → GroceryAdminView. Owner only; the catalogue is included for app admins. */
export async function GET() {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    try {
        const view = await getGroceryAdminView(user, await isAppAdmin());
        return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[grocery] admin view failed:', err);
        return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
}
