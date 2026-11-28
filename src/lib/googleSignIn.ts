/**
 * Decisions for the Google sign-in on the login page. Pure functions with no
 * imports, so they can be unit-tested with `node --test`.
 *
 * Background: the Google window (popup) or the redirect hands its result back
 * through Firebase's sign-in helper, which runs on the auth domain. When that is
 * <project>.firebaseapp.com, a different site from the app, browsers that block
 * or partition third-party storage (Safari and iOS home-screen apps, Brave,
 * Firefox in strict mode, Chrome without third-party cookies) can lose the
 * result: the popup closes and, 8 seconds later, Firebase reports
 * `auth/popup-closed-by-user` as if the person had closed it. Serving the helper
 * from the app's own domain (see next.config.ts) avoids this, and then the
 * redirect flow works everywhere too.
 */

/** What went wrong with a popup or redirect sign-in, from Firebase's error code. */
export type SignInProblem =
    /** The Google window closed without a result: closed by the person, or the result was lost. */
    | 'closed'
    /** A newer sign-in attempt replaced this one; nothing to show. */
    | 'superseded'
    /** The browser blocked the Google window. */
    | 'blocked'
    /** The browser can't run this kind of sign-in (no popups, or no storage). */
    | 'unsupported'
    /** This web address isn't an authorized domain in Firebase Authentication. */
    | 'domain'
    | 'network'
    | 'other';

/** Firebase's error code (e.g. `auth/popup-blocked`), or '' when there is none. */
export function signInErrorCode(err: unknown): string {
    if (!err || typeof err !== 'object' || !('code' in err)) return '';
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : '';
}

export function classifySignInError(err: unknown): SignInProblem {
    switch (signInErrorCode(err)) {
        case 'auth/popup-closed-by-user':
        case 'auth/user-cancelled':
            return 'closed';
        case 'auth/cancelled-popup-request':
            return 'superseded';
        case 'auth/popup-blocked':
            return 'blocked';
        case 'auth/operation-not-supported-in-this-environment':
        case 'auth/web-storage-unsupported':
            return 'unsupported';
        case 'auth/unauthorized-domain':
            return 'domain';
        case 'auth/network-request-failed':
        case 'auth/timeout':
            return 'network';
        default:
            return 'other';
    }
}

/**
 * True when Firebase's sign-in helper is served from the site the page is on
 * (`authDomain` is this host), so the sign-in never depends on third-party storage.
 */
export function isFirstPartyAuthDomain(authDomain: string | undefined | null, host: string): boolean {
    const clean = (s: string) => s.trim().toLowerCase().replace(/\.$/, '');
    return !!authDomain && !!host && clean(authDomain) === clean(host);
}

/**
 * How to start the sign-in. Popups are fragile on phones: home-screen web apps
 * open them in a separate browser with its own storage, and mobile browsers
 * open them as a new tab and may unload the page that is waiting for the
 * result. There the redirect flow is used instead, which needs a first-party
 * auth domain to work; without one the popup stays.
 */
export function firstSignInFlow(opts: { standalone: boolean; mobile: boolean; firstPartyAuth: boolean }): 'popup' | 'redirect' {
    return opts.firstPartyAuth && (opts.standalone || opts.mobile) ? 'redirect' : 'popup';
}

/** Phones and tablets (iPadOS reports itself as a Mac, but with touch). */
export function isMobileBrowser(userAgent: string, maxTouchPoints = 0): boolean {
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
    return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** After a failed popup: switch to the redirect flow on its own, or show the problem. */
export function afterPopupFailure(problem: SignInProblem, firstPartyAuth: boolean): 'redirect' | 'show' {
    return firstPartyAuth && (problem === 'blocked' || problem === 'unsupported') ? 'redirect' : 'show';
}

/** Generic in-app browser (an app's embedded WebView whose name we don't know). */
export const UNKNOWN_IN_APP = 'app';

const IN_APP_BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
    [/Instagram/i, 'Instagram'],
    [/FBAN|FBAV|FB_IAB|FBIOS/, 'Facebook'],
    [/LinkedInApp/i, 'LinkedIn'],
    [/Snapchat/i, 'Snapchat'],
    [/\bLine\//, 'LINE'],
    [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
    [/Pinterest/i, 'Pinterest'],
    [/MicroMessenger/i, 'WeChat'],
];

/**
 * The app whose built-in browser this is, or null for a normal browser.
 * Google refuses sign-in inside embedded WebViews ("disallowed_useragent"),
 * so these visitors need to open the page in Chrome or Safari.
 * Returns UNKNOWN_IN_APP for an Android WebView we can't name.
 */
export function inAppBrowser(userAgent: string): string | null {
    if (!userAgent) return null;
    for (const [pattern, name] of IN_APP_BROWSERS) {
        if (pattern.test(userAgent)) return name;
    }
    // Android System WebView marks itself with "; wv)".
    if (/Android/i.test(userAgent) && /;\s*wv\)/.test(userAgent)) return UNKNOWN_IN_APP;
    return null;
}

export function isAndroid(userAgent: string): boolean {
    return /Android/i.test(userAgent);
}

/** An Android link that opens `href` in Chrome (falling back to the page itself). */
export function chromeIntentUrl(href: string): string | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:') return null;
    const rest = `${url.host}${url.pathname}${url.search}`;
    return `intent://${rest}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
}

/** A redirect sign-in started this long ago is no longer waited for. */
export const REDIRECT_PENDING_MAX_MS = 10 * 60 * 1000;

/** Whether a redirect sign-in started at `startedAt` (ms, as stored) is still worth finishing. */
export function redirectStillPending(startedAt: string | null, now: number): boolean {
    const at = Number(startedAt);
    return Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < REDIRECT_PENDING_MAX_MS;
}
