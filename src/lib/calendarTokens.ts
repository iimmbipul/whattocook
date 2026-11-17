'use server';

import { getSessionUser } from './server/currentUser';
import { getCalendarStatusFor } from './server/calendarTokens';

/**
 * Google Calendar connection status for the signed-in user.
 *
 * The `uid` argument is kept for backward compatibility but ignored: the
 * status is always the caller's own, taken from the verified session. Token
 * storage helpers live in ./server/calendarTokens (not callable from the
 * browser).
 */
export async function isCalendarConnected(_uid?: string): Promise<{ connected: boolean; email?: string }> {
    void _uid;
    const user = await getSessionUser();
    if (!user) return { connected: false };
    return getCalendarStatusFor(user.uid);
}
