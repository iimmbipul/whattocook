'use server';

/**
 * Thin server-side wrapper around Google's OAuth2 + Calendar REST APIs.
 * Uses fetch directly to avoid pulling in the full googleapis SDK.
 *
 * NOTE: refresh tokens are stored in Firestore alongside the user doc
 * (see calendarTokens.ts). For a production deployment you should encrypt
 * them at rest and lock down Firestore rules so only the server can read.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env var: ${name}`);
    return v;
}

/**
 * Exchange an authorization code for tokens. Returns refresh_token when
 * the consent was granted with access_type=offline + prompt=consent.
 */
export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
    scope: string;
    token_type: string;
}> {
    const body = new URLSearchParams({
        code,
        client_id: requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
        client_secret: requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
        // Must match the redirect_uri used in the authorize request exactly.
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
    });

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    return res.json();
}

/**
 * Trade a refresh_token for a fresh short-lived access_token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
}> {
    const body = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
        client_secret: requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
        grant_type: 'refresh_token',
    });

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }
    return res.json();
}

/**
 * Best-effort revoke — the user disconnected calendar.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
        await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
    } catch (err) {
        console.warn('[googleCalendar] revoke failed (ignored):', err);
    }
}

export interface CalendarEventInput {
    summary: string;
    description?: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    reminders?: {
        useDefault?: boolean;
        overrides?: { method: 'popup' | 'email'; minutes: number }[];
    };
    // Including "confirmed" on PATCH un-cancels an event the user soft-deleted
    // from their calendar (deleted events sit in Trash with status=cancelled
    // for 30 days; PATCHing without a status field silently keeps them
    // invisible).
    status?: 'confirmed' | 'tentative' | 'cancelled';
}

/**
 * Create an event on the user's primary calendar. Returns the new event's ID.
 */
export async function createCalendarEvent(
    accessToken: string,
    event: CalendarEventInput
): Promise<string> {
    const res = await fetch(`${CALENDAR_BASE}/calendars/primary/events`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Calendar insert failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    return data.id as string;
}

/**
 * Patch an existing event. Returns:
 *   - true  if the event was patched successfully
 *   - false if the event no longer exists (404 or 410 — deleted from calendar)
 * Throws on any other failure so callers can decide whether to retry.
 */
export async function updateCalendarEvent(
    accessToken: string,
    eventId: string,
    event: Partial<CalendarEventInput>
): Promise<boolean> {
    const res = await fetch(
        `${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`,
        {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
        }
    );
    if (res.ok) return true;
    if (res.status === 404 || res.status === 410) return false;
    const text = await res.text();
    throw new Error(`Calendar patch failed (${res.status}): ${text}`);
}

/**
 * Delete an event. 404/410 are treated as success (already gone).
 */
export async function deleteCalendarEvent(
    accessToken: string,
    eventId: string
): Promise<void> {
    const res = await fetch(
        `${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`,
        {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
        }
    );
    if (!res.ok && res.status !== 404 && res.status !== 410) {
        const text = await res.text();
        throw new Error(`Calendar delete failed (${res.status}): ${text}`);
    }
}

/**
 * Fetch the id_token's email claim so we can show the user which Google
 * account is currently connected.
 */
export async function fetchUserinfo(accessToken: string): Promise<{ email?: string; sub?: string }> {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return {};
    return res.json();
}
