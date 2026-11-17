'use client';

import { useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebaseAuth';
import { loginWithGoogle, loginWithPhoneAndPin } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useLocale } from '@/context/LocaleContext';
import { ArrowLeft, ChefHat } from 'lucide-react';
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

export default function LoginPage() {
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [view, setView] = useState<'google' | 'cook'>('google');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [pin, setPin] = useState('');
    const router = useRouter();
    const { setUser } = useAuth();
    const { t } = useLocale();

    // The server verifies the Google ID token and only trusts the identity in
    // it — the client never tells the server who it is.
    const finishGoogleLogin = async (idToken: string) => {
        const result = await loginWithGoogle(idToken);

        if (result.status === 'ok') {
            setUser(result.user);
            router.push('/');
        } else if (result.status === 'needs_onboarding') {
            // Display only; onboarding reads the verified email from a signed cookie.
            localStorage.setItem('pendingRegistrationEmail', result.email);
            localStorage.setItem('pendingRegistrationName', result.displayName || '');
            localStorage.setItem('pendingRegistrationPhoto', result.photoURL || '');
            router.push('/onboarding');
        } else {
            setError(result.error);
            setLoading(false);
        }
    };

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
    }, []);

    const handleGoogleSignIn = async () => {
        setLoading(true);
        setError('');

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

        try {
            const result = await signInWithPopup(auth, googleProvider);

            if (!result.user.email) {
                setError(t('login.googleNoEmail'));
                setLoading(false);
                return;
            }

            await finishGoogleLogin(await result.user.getIdToken());
        } catch (err: unknown) {
            const firebaseErr = err as { code?: string };
            if (firebaseErr?.code !== 'auth/popup-closed-by-user' && firebaseErr?.code !== 'auth/cancelled-popup-request') {
                setError(t('login.googleError'));
            }
            setLoading(false);
        }
    };

    const handleCookSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const user = await loginWithPhoneAndPin(phoneNumber, pin);
            if (user) {
                setUser(user);
                router.push('/');
            } else {
                setError(t('login.cookInvalid'));
            }
        } catch (err) {
            setError(t('login.cookFailed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title={t('login.welcome')}
            subtitle={t('login.tagline')}
            footer={view === 'google' ? t('login.newHere') : undefined}
        >
            {error && <Alert tone="error" className="mb-4">{error}</Alert>}

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

                    <Button variant="ghost" fullWidth leadingIcon={<ChefHat size={17} aria-hidden="true" />} onClick={() => { setView('cook'); setError(''); }}>
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
                    <Button variant="ghost" fullWidth leadingIcon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => { setView('google'); setError(''); }}>
                        {t('login.backToGoogle')}
                    </Button>
                </form>
            )}
        </AuthLayout>
    );
}
