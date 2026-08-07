import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { isCalendarConnected } from '@/lib/calendarTokens';

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ connected: false }, { status: 401 });
    const status = await isCalendarConnected(user.uid);
    return NextResponse.json(status);
}
