import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { backfillCalendarSync } from '@/lib/calendarSync';

export const maxDuration = 60;

export async function POST() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!user.householdId) return NextResponse.json({ error: 'No household' }, { status: 400 });

    try {
        const result = await backfillCalendarSync(user.householdId, 30);
        return NextResponse.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[calendar/backfill] error:', err);
        return NextResponse.json({ error: err?.message ?? 'Backfill failed' }, { status: 500 });
    }
}
