import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { cookies } from 'next/headers';
import { exchangeCodeForTokens, fetchUserinfo } from '@/lib/googleCalendar';
import { saveCalendarConnection } from '@/lib/calendarTokens';

const STATE_COOKIE = 'gcal_oauth_state';

function html(status: 'ok' | 'error', message: string) {
    const color = status === 'ok' ? '#16a34a' : '#dc2626';
    return `<!doctype html><html><body style="font-family:system-ui;padding:2rem;text-align:center">
<h2 style="color:${color}">${status === 'ok' ? 'Google Calendar connected' : 'Connection failed'}</h2>
<p>${message}</p>
<p><a href="/profile">Return to profile</a></p>
</body></html>`;
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
        return new NextResponse(html('error', `Google returned: ${error}`), {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
        });
    }

    if (!code || !state) {
        return new NextResponse(html('error', 'Missing code or state.'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
        });
    }

    const cookieStore = await cookies();
    const savedState = cookieStore.get(STATE_COOKIE)?.value;
    cookieStore.delete(STATE_COOKIE);

    if (!savedState || savedState !== state) {
        return new NextResponse(html('error', 'State mismatch. Try again from your profile.'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
        });
    }

    const [stateUid] = savedState.split(':');
    const user = await getCurrentUser();
    if (!user || user.uid !== stateUid) {
        return new NextResponse(html('error', 'Session mismatch. Log in and try again.'), {
            status: 401,
            headers: { 'Content-Type': 'text/html' },
        });
    }

    try {
        const tokens = await exchangeCodeForTokens(code);
        if (!tokens.refresh_token) {
            // Happens when the user previously connected offline and Google
            // is only returning access tokens on subsequent grants. Force a
            // fresh consent to reissue the refresh_token.
            return new NextResponse(
                html('error', 'No refresh token from Google. <a href="/api/calendar/oauth/start?force=1">Click here to reconnect with full consent</a>.'),
                { status: 400, headers: { 'Content-Type': 'text/html' } }
            );
        }

        let email: string | undefined;
        try {
            const info = await fetchUserinfo(tokens.access_token);
            email = info.email;
        } catch {
            // non-fatal — email is only used for UI display
        }

        const saved = await saveCalendarConnection(user.uid, tokens.refresh_token, email);
        if (!saved) {
            return new NextResponse(
                html('error', 'Could not persist tokens — user record not found.'),
                { status: 500, headers: { 'Content-Type': 'text/html' } }
            );
        }

        // Success — bounce back to the app root so the user lands where
        // they'd normally be after login. Profile page still shows the
        // detailed connected status.
        const origin = new URL(req.url).origin;
        return NextResponse.redirect(`${origin}/?calendar=connected`);
    } catch (err: any) {
        console.error('[calendar/oauth/callback] error:', err);
        return new NextResponse(
            html('error', err?.message ?? 'Unknown error during token exchange.'),
            { status: 500, headers: { 'Content-Type': 'text/html' } }
        );
    }
}
