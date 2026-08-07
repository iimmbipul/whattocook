import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { backfillCalendarSync } from '@/lib/calendarSync';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!user.householdId) return NextResponse.json({ error: 'No household' }, { status: 400 });

    // Chunked backfill — the client calls this repeatedly with the returned
    // `nextOffset` until it's null. Keeps each invocation short enough to fit
    // inside Vercel's function timeout.
    const url = new URL(req.url);
    const days = Math.min(parseInt(url.searchParams.get('days') || '10', 10), 14);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

    try {
        const result = await backfillCalendarSync(user.householdId, days, offset);
        return NextResponse.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[calendar/backfill] error:', err);
        return NextResponse.json({ error: err?.message ?? 'Backfill failed' }, { status: 500 });
    }
}
