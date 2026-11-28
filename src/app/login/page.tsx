'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getRedirectResult, signInWithPopup, signInWithRedirect, type User as FirebaseUser, type UserCredential } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebaseAuth';
import { loginWithGoogle, loginWithPhoneAndPin } from '@/lib/auth';
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
    signInErrorCode,
    UNKNOWN_IN_APP,
    type SignInProblem,
} from '@/lib/googleSignIn';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useLocale } from '@/context/LocaleContext';
import { ArrowLeft, ChefHat, Copy, ExternalLink } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Alert, Field, TextInput } from '@/components/ui/Field';

declare global {
    interface Window {
        ReactNativeWebView?: { postMessage: (msg: string) => void };
    }
}

const isInReactNativeWebView = () =>
    typeof window !== 'undefined' && !!window.ReactNativeWebView;

/** sessionStorage key: when a redirect sign-in started (ms), so the return trip finishes it. */
const REDIRECT_KEY = 'wtc_google_redirect';

function markRedirectStarted() {
    try { sessionStorage.setItem(REDIRECT_KEY, String(Date.now())); } catch { /* storage unavailable */ }
}

function takeRedirectMark(): boolean {
    try {
        const startedAt = sessionStorage.getItem(REDIRECT_KEY);
        sessionStorage.removeItem(REDIRECT_KEY);
        return redirectStillPending(startedAt, Date.now());
    } catch {
        return false;
    }
}

// One read of the redirect result per return from Google, shared by every run
// of the effect below (React runs effects twice in development).
let redirectResult: Promise<UserCredential | null> | null = null;
function readRedirectResult(): Promise<UserCredential | null> | null {
    if (!redirectResult && takeRedirectMark()) {
        const read = getRedirectResult(auth);
        redirectResult = read;
        read.then(() => { redirectResult = null; }, () => { redirectResult = null; });
    }
    return redirectResult;
}

/** Running as a home-screen web app (iOS "Add to Home Screen", installed PWA). */
function isStandalone(): boolean {
    try {
        return window.matchMedia?.('(display-mode: standalone)').matches
            || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    } catch {
        return false;
    }
}

/** Firebase's sign-in helper is on this site, so neither flow needs third-party storage. */
const firstPartyAuth = () => isFirstPartyAuthDomain(auth.config.authDomain, window.location.host);

// The in-app browser is read from the user agent after hydration (null on the server).
const noSubscribe = () => () => { };
const readInApp = () => (isInReactNativeWebView() ? null : inAppBrowser(navigator.userAgent));

type Message = { tone: 'error' | 'warning'; text: string };

export default function LoginPage() {
    const [message, setMessage] = useState<Message | null>(null);
    const [offerSameTab, setOfferSameTab] = useState(false);
    const [loading, setLoading] = useState(false);
    const [view, setView] = useState<'google' | 'cook'>('google');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [pin, setPin] = useState('');
    const [linkCopied, setLinkCopied] = useState(false);
    const router = useRouter();
    const { setUser } = useAuth();
    const { t } = useLocale();
    const inApp = useSyncExternalStore(noSubscribe, readInApp, () => null);

    const setError = (text: string) => setMessage(text ? { tone: 'error', text } : null);

    // The server verifies the Google ID token and only trusts the identity in
    // it — the client never tells the server who it is.
    const finishGoogleLogin = async (idToken: string) => {
        const result = await loginWithGoogle(idToken);

        if (result.status === 'ok') {
            setUser(result.user);
            router.replace('/');
        } else if (result.status === 'needs_onboarding') {
            // Display only; onboarding reads the verified email from a signed cookie.
            localStorage.setItem('pendingRegistrationEmail', result.email);
            localStorage.setItem('pendingRegistrationName', result.displayName || '');
            localStorage.setItem('pendingRegistrationPhoto', result.photoURL || '');
            router.replace('/onboarding');
        } else {
            setError(result.error);
            setLoading(false);
        }
    };

    const finishWithFirebaseUser = async (firebaseUser: FirebaseUser) => {
        if (!firebaseUser.email) {
            setError(t('login.googleNoEmail'));
            setLoading(false);
            return;
        }
        try {
            await finishGoogleLogin(await firebaseUser.getIdToken());
        } catch (err) {
            console.error('[login] Could not finish Google sign-in', err);
            setError(t('login.googleError'));
            setLoading(false);
        }
    };

    /** Say what stopped the sign-in instead of silently resetting the button. */
    const showProblem = (problem: SignInProblem, err: unknown, canUseSameTab: boolean) => {
        setLoading(false);
        if (problem === 'superseded') return;
        console.warn('[login] Google sign-in did not finish:', signInErrorCode(err) || err);
        switch (problem) {
            case 'closed':
                setMessage({ tone: 'warning', text: t(canUseSameTab ? 'login.googleClosed' : 'login.googleClosedBrowser') });
                setOfferSameTab(canUseSameTab);
                return;
            case 'blocked':
                setError(t('login.googleBlocked'));
                return;
            case 'unsupported':
                setError(t('login.googleUnsupported'));
                return;
            case 'domain':
                setError(t('login.googleDomain', { host: window.location.host }));
                return;
            case 'network':
                setError(t('login.googleNetwork'));
                return;
            default:
                setError(t('login.googleError'));
        }
    };

    /** Sign in on Google's page in this tab; the result is read when the page loads again. */
    const startRedirect = async () => {
        setLoading(true);
        setMessage(null);
        setOfferSameTab(false);
        markRedirectStarted();
        try {
            await signInWithRedirect(auth, googleProvider);
        } catch (err) {
            takeRedirectMark();
            showProblem(classifySignInError(err), err, false);
        }
    };

    // Coming back from a redirect sign-in: finish it.
    useEffect(() => {
        if (isInReactNativeWebView()) return;
        const pending = readRedirectResult();
        if (!pending) return;
        let active = true;
        setLoading(true);
        pending
            .then(async result => {
                if (!active) return;
                if (result?.user) await finishWithFirebaseUser(result.user);
                else setLoading(false); // came back without finishing (e.g. pressed Back)
            })
            .catch(err => {
                if (active) showProblem(classifySignInError(err), err, false);
            });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- run once, on the return from Google
    }, []);

    // When embedded inside the React Native WebView (mobile app), the native
    // side does the Google Sign-In and posts the profile back here.
    useEffect(() => {
        if (!isInReactNativeWebView()) return;

        const handler = async (event: Event) => {
            const detail = (event as CustomEvent).detail as {
                ok: boolean;
                /** Google (or Firebase) ID token from the native sign-in — required. */
                idToken?: string;
                email?: string;
                displayName?: string | null;
                photoURL?: string | null;
                error?: string;
            };
            if (!detail) return;

            if (!detail.ok) {
                if (detail.error && detail.error !== 'cancelled') {
                    setError(detail.error);
                }
                setLoading(false);
                return;
            }

            if (!detail.idToken) {
                // Older app builds only sent the profile, which the server can't verify.
                setError('Please update the app to sign in with Google.');
                setLoading(false);
                return;
            }

            try {
                await finishGoogleLogin(detail.idToken);
            } catch {
                setError(t('login.googleError'));
                setLoading(false);
            }
        };

        window.addEventListener('nativeGoogleSignIn', handler as EventListener);
        return () => window.removeEventListener('nativeGoogleSignIn', handler as EventListener);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one listener for the page's lifetime
    }, []);

    const handleGoogleSignIn = async () => {
        setLoading(true);
        setMessage(null);
        setOfferSameTab(false);

        // Inside the mobile app: ask the native side to run Google Sign-In.
        // The response comes back via the `nativeGoogleSignIn` event above.
        if (isInReactNativeWebView()) {
            try {
                window.ReactNativeWebView!.postMessage(JSON.stringify({ type: 'GOOGLE_SIGN_IN' }));
            } catch {
                setError(t('login.googleError'));
                setLoading(false);
            }
            return;
        }

        const sameSiteHelper = firstPartyAuth();
        const mobile = isMobileBrowser(navigator.userAgent, navigator.maxTouchPoints);
        if (firstSignInFlow({ standalone: isStandalone(), mobile, firstPartyAuth: sameSiteHelper }) === 'redirect') {
            await startRedirect();
            return;
        }

        // The popup must open straight from the click (no await before it), or
        // Safari and Firefox block it.
        let firebaseUser: FirebaseUser;
        try {
            firebaseUser = (await signInWithPopup(auth, googleProvider)).user;
        } catch (err) {
            const problem = classifySignInError(err);
            if (afterPopupFailure(problem, sameSiteHelper) === 'redirect') {
                await startRedirect();
            } else {
                showProblem(problem, err, sameSiteHelper);
            }
            return;
        }
        await finishWithFirebaseUser(firebaseUser);
    };

    const copyLink = () => {
        navigator.clipboard?.writeText(window.location.href).then(() => {
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        }).catch(() => { });
    };

    const handleCookSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            const user = await loginWithPhoneAndPin(phoneNumber, pin);
            if (user) {
                setUser(user);
                router.replace('/');
            } else {
                setError(t('login.cookInvalid'));
            }
        } catch {
            setError(t('login.cookFailed'));
        } finally {
            setLoading(false);
        }
    };

    const chromeLink = inApp && typeof window !== 'undefined' && isAndroid(navigator.userAgent)
        ? chromeIntentUrl(window.location.href)
        : null;

    return (
        <AuthLayout
            title={t('login.welcome')}
            subtitle={t('login.tagline')}
            footer={view === 'google' ? t('login.newHere') : undefined}
        >
            {message && (
                <Alert tone={message.tone} className="mb-4">
                    <p>{message.text}</p>
                    {offerSameTab && view === 'google' && (
                        <Button variant="secondary" size="sm" className="mt-3" onClick={startRedirect} disabled={loading}>
                            {t('login.googleSameTab')}
                        </Button>
                    )}
                </Alert>
            )}

            {inApp && view === 'google' && (
                <Alert tone="warning" className="mb-4">
                    <p className="font-semibold">{t('login.inAppTitle')}</p>
                    <p className="mt-1 font-normal">
                        {inApp === UNKNOWN_IN_APP ? t('login.inAppBodyGeneric') : t('login.inAppBody', { app: inApp })}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {chromeLink && (
                            <a
                                href={chromeLink}
                                className="inline-flex h-9 items-center gap-2 rounded-xl bg-surface px-3 text-sm font-semibold text-ink border border-line shadow-card"
                            >
                                <ExternalLink size={15} aria-hidden="true" /> {t('login.openInChrome')}
                            </a>
                        )}
                        <Button variant="secondary" size="sm" leadingIcon={<Copy size={15} aria-hidden="true" />} onClick={copyLink}>
                            {linkCopied ? t('common.copied') : t('login.copyLink')}
                        </Button>
                    </div>
                </Alert>
            )}

            {view === 'google' ? (
                <div className="space-y-4">
                    <Button
                        id="google-signin-button"
                        variant="secondary"
                        size="lg"
                        fullWidth
                        onClick={handleGoogleSignIn}
                        loading={loading}
                        loadingText={t('login.googleLoading')}
                        leadingIcon={
                            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                        }
                    >
                        {t('login.googleButton')}
                    </Button>

                    <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-ink-subtle" aria-hidden="true">
                        <span className="h-px flex-1 bg-line" /> {t('login.orDivider')} <span className="h-px flex-1 bg-line" />
                    </div>

                    <Button variant="ghost" fullWidth leadingIcon={<ChefHat size={17} aria-hidden="true" />} onClick={() => { setView('cook'); setMessage(null); setOfferSameTab(false); }}>
                        {t('login.cookLink')}
                    </Button>
                </div>
            ) : (
                <form onSubmit={handleCookSignIn} className="space-y-4">
                    <h2 className="text-base font-semibold text-ink">{t('login.cookTitle')}</h2>
                    <Field label={t('login.phoneLabel')} required>
                        <TextInput
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            placeholder="+919876543210"
                        />
                    </Field>
                    <Field label={t('login.pinLabel')} required>
                        <TextInput
                            type="password"
                            inputMode="numeric"
                            autoComplete="current-password"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            placeholder="••••"
                        />
                    </Field>
                    <Button type="submit" size="lg" fullWidth loading={loading} loadingText={t('login.cookSubmitting')}>
                        {t('login.cookSubmit')}
                    </Button>
                    <Button variant="ghost" fullWidth leadingIcon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => { setView('google'); setMessage(null); }}>
                        {t('login.backToGoogle')}
                    </Button>
                </form>
            )}
        </AuthLayout>
    );
}
