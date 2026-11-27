import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/server/currentUser';
import { getBasket } from '@/lib/server/milkbasket';

/** GET /api/milkbasket/basket[?refresh=1] → BasketResult: what is in the Milkbasket basket. Owner and members. */
export async function GET(request: NextRequest) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const result = await getBasket(user, request.nextUrl.searchParams.get('refresh') === '1');
    if (!result.ok) {
        const status = result.error === 'forbidden' || result.error === 'not-allowed' ? 403 : 502;
        return NextResponse.json({ error: result.error, message: result.message ?? null }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
