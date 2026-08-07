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
    if (!clientId) {
        return NextResponse.json(
            { error: 'Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID.' },
            { status: 500 }
        );
    }

    // Derive the redirect URI from the incoming request so a single OAuth
    // client works across localhost, preview, and production without env
    // swaps. Prefer the standard proxy headers if present (Vercel, Cloudflare,
    // etc), otherwise fall back to the request URL's origin.
    const forwardedProto = req.headers.get('x-forwarded-proto');
    const forwardedHost = req.headers.get('x-forwarded-host');
    const origin = forwardedHost
        ? `${forwardedProto ?? 'https'}://${forwardedHost}`
        : url.origin;
    const redirectUri = `${origin}/api/calendar/oauth/callback`;

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
