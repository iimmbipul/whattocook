import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCalendarStatusFor } from '@/lib/server/calendarTokens';

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ connected: false }, { status: 401 });
    const status = await getCalendarStatusFor(user.uid);
    return NextResponse.json(status);
}
