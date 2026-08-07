import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const STATE_COOKIE = 'gcal_oauth_state';
const CALENDAR_SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'openid',
    'email',
].join(' ');

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    // `?force=1` forces a fresh consent screen — used from the profile UI's
    // Reconnect action when Google didn't return a refresh_token last time.
    const forceConsent = url.searchParams.get('force') === '1';

    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (!clientId || !redirectUri) {
        return NextResponse.json(
            { error: 'Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_REDIRECT_URI.' },
            { status: 500 }
        );
    }

    // CSRF-guard the callback by binding a random nonce + the caller's uid
    // into a signed cookie, checked in the callback route.
    const nonce = randomBytes(16).toString('hex');
    const state = `${user.uid}:${nonce}`;

    const cookieStore = await cookies();
    cookieStore.set(STATE_COOKIE, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 10,
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: CALENDAR_SCOPES,
        access_type: 'offline',
        include_granted_scopes: 'true',
        state,
    });
    if (forceConsent) {
        // Guarantees a refresh_token on every attempt but shows the consent
        // screen even for users who already granted the scope at login.
        params.set('prompt', 'consent');
    }

    return NextResponse.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
}
