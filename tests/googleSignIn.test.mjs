import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    afterPopupFailure,
    chromeIntentUrl,
    classifySignInError,
    firstSignInFlow,
    inAppBrowser,
    isAndroid,
    isFirstPartyAuthDomain,
    isMobileBrowser,
    redirectStillPending,
    REDIRECT_PENDING_MAX_MS,
    signInErrorCode,
    UNKNOWN_IN_APP,
} from '../src/lib/googleSignIn.ts';

const err = code => Object.assign(new Error('Firebase: Error'), { code });

const UA = {
    androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
    desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone15,2; iOS 18_1; en_IN; en; scale=3.00; 1179x2556; 662367186)',
    facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.86 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/487.0.0.53.109;]',
    linkedinIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1',
    androidWebView: 'Mozilla/5.0 (Linux; Android 13; SM-A536E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36',
};

test('popup errors are classified so the page can say what happened', () => {
    assert.equal(classifySignInError(err('auth/popup-closed-by-user')), 'closed');
    assert.equal(classifySignInError(err('auth/user-cancelled')), 'closed');
    assert.equal(classifySignInError(err('auth/cancelled-popup-request')), 'superseded');
    assert.equal(classifySignInError(err('auth/popup-blocked')), 'blocked');
    assert.equal(classifySignInError(err('auth/operation-not-supported-in-this-environment')), 'unsupported');
    assert.equal(classifySignInError(err('auth/web-storage-unsupported')), 'unsupported');
    assert.equal(classifySignInError(err('auth/unauthorized-domain')), 'domain');
    assert.equal(classifySignInError(err('auth/network-request-failed')), 'network');
    assert.equal(classifySignInError(err('auth/internal-error')), 'other');
    assert.equal(classifySignInError(new Error('boom')), 'other');
    assert.equal(classifySignInError(undefined), 'other');
    assert.equal(signInErrorCode(err('auth/popup-blocked')), 'auth/popup-blocked');
    assert.equal(signInErrorCode('auth/popup-blocked'), '');
    assert.equal(signInErrorCode({ code: 42 }), '');
});

test('the sign-in helper counts as first-party only on the same host', () => {
    assert.equal(isFirstPartyAuthDomain('whattocook-amber.vercel.app', 'whattocook-amber.vercel.app'), true);
    assert.equal(isFirstPartyAuthDomain('WhatToCook-Amber.vercel.app.', 'whattocook-amber.vercel.app'), true);
    assert.equal(isFirstPartyAuthDomain('my-project.firebaseapp.com', 'whattocook-amber.vercel.app'), false);
    assert.equal(isFirstPartyAuthDomain('whattocook-amber.vercel.app', 'whattocook-git-master-x.vercel.app'), false);
    assert.equal(isFirstPartyAuthDomain(undefined, 'whattocook-amber.vercel.app'), false);
    assert.equal(isFirstPartyAuthDomain('', ''), false);
});

test('phones and home-screen apps use the redirect only when it can work', () => {
    assert.equal(firstSignInFlow({ standalone: true, mobile: true, firstPartyAuth: true }), 'redirect');
    assert.equal(firstSignInFlow({ standalone: false, mobile: true, firstPartyAuth: true }), 'redirect');
    assert.equal(firstSignInFlow({ standalone: true, mobile: false, firstPartyAuth: true }), 'redirect');
    assert.equal(firstSignInFlow({ standalone: false, mobile: false, firstPartyAuth: true }), 'popup');
    // With the helper on firebaseapp.com the redirect loses its result in Safari, so keep the popup.
    assert.equal(firstSignInFlow({ standalone: true, mobile: true, firstPartyAuth: false }), 'popup');
    assert.equal(firstSignInFlow({ standalone: false, mobile: true, firstPartyAuth: false }), 'popup');
    assert.equal(firstSignInFlow({ standalone: false, mobile: false, firstPartyAuth: false }), 'popup');
});

test('phones and tablets are told apart from desktops', () => {
    assert.equal(isMobileBrowser(UA.androidChrome), true);
    assert.equal(isMobileBrowser(UA.iosSafari), true);
    assert.equal(isMobileBrowser(UA.iosChrome), true);
    assert.equal(isMobileBrowser(UA.desktopChrome), false);
    const iPadSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
    assert.equal(isMobileBrowser(iPadSafari, 5), true);
    assert.equal(isMobileBrowser(iPadSafari, 0), false);
});

test('a blocked popup falls back to the redirect, other problems are shown', () => {
    assert.equal(afterPopupFailure('blocked', true), 'redirect');
    assert.equal(afterPopupFailure('unsupported', true), 'redirect');
    assert.equal(afterPopupFailure('blocked', false), 'show');
    // A closed window may be on purpose, so it is never followed by a surprise redirect.
    assert.equal(afterPopupFailure('closed', true), 'show');
    assert.equal(afterPopupFailure('network', true), 'show');
    assert.equal(afterPopupFailure('domain', true), 'show');
});

test('in-app browsers that Google refuses are recognised', () => {
    assert.equal(inAppBrowser(UA.instagramIos), 'Instagram');
    assert.equal(inAppBrowser(UA.facebookAndroid), 'Facebook');
    assert.equal(inAppBrowser(UA.linkedinIos), 'LinkedIn');
    assert.equal(inAppBrowser(UA.androidWebView), UNKNOWN_IN_APP);
    for (const ua of [UA.androidChrome, UA.iosSafari, UA.iosChrome, UA.desktopChrome, '']) {
        assert.equal(inAppBrowser(ua), null, ua);
    }
    assert.equal(isAndroid(UA.facebookAndroid), true);
    assert.equal(isAndroid(UA.instagramIos), false);
});

test('the Open in Chrome link keeps the page address', () => {
    const link = chromeIntentUrl('https://whattocook-amber.vercel.app/login?from=wa');
    assert.equal(
        link,
        'intent://whattocook-amber.vercel.app/login?from=wa#Intent;scheme=https;package=com.android.chrome;'
        + 'S.browser_fallback_url=https%3A%2F%2Fwhattocook-amber.vercel.app%2Flogin%3Ffrom%3Dwa;end',
    );
    assert.equal(chromeIntentUrl('http://localhost:3000/login'), null);
    assert.equal(chromeIntentUrl('not a url'), null);
});

test('a redirect sign-in is only finished shortly after it started', () => {
    const now = 1_800_000_000_000;
    assert.equal(redirectStillPending(String(now - 30_000), now), true);
    assert.equal(redirectStillPending(String(now - REDIRECT_PENDING_MAX_MS), now), false);
    assert.equal(redirectStillPending(String(now + 5_000), now), false);
    assert.equal(redirectStillPending(null, now), false);
    assert.equal(redirectStillPending('junk', now), false);
});
