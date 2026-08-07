import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { clearCalendarConnection, getCalendarConnection } from '@/lib/calendarTokens';
import { revokeRefreshToken } from '@/lib/googleCalendar';

export async function POST() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const conn = await getCalendarConnection(user.uid);
    if (conn?.refreshToken) {
        await revokeRefreshToken(conn.refreshToken);
    }
    await clearCalendarConnection(user.uid);

    return NextResponse.json({ success: true });
}
