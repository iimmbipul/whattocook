'use client';

import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { loginWithGoogleEmail, loginWithPhoneAndPin } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useLocale } from '@/context/LocaleContext';

export default function LoginPage() {
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [view, setView] = useState<'google' | 'cook'>('google');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [pin, setPin] = useState('');
    const router = useRouter();
    const { setUser } = useAuth();
    const { t } = useLocale();

    const handleGoogleSignIn = async () => {
        setLoading(true);
        setError('');

        try {
            // 1. Trigger Firebase Google popup (client-side identity verification)
            const result = await signInWithPopup(auth, googleProvider);
            const email = result.user.email;
            const displayName = result.user.displayName;
            const photoURL = result.user.photoURL;

            if (!email) {
                setError(t('login.googleNoEmail'));
                setLoading(false);
                return;
            }

            // 2. Look up the email in Firestore to determine role & create session cookie
            const user = await loginWithGoogleEmail(email, displayName || undefined, photoURL || undefined);

            if (user) {
                setUser(user);
                router.push('/');
            } else {
                // User not found, redirect to onboarding to create or join household
                localStorage.setItem('pendingRegistrationEmail', email);
                localStorage.setItem('pendingRegistrationName', displayName || '');
                localStorage.setItem('pendingRegistrationPhoto', photoURL || '');
                router.push('/onboarding');
            }
        } catch (err: unknown) {
            // User closed the popup or a network error occurred
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
                setError('Invalid Phone Number or PIN');
            }
        } catch (err) {
            setError('Cook Login failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="text-5xl mb-4">🍽️</div>
                    <h1 className="text-3xl font-bold text-gray-800 mb-2">{t('login.title')}</h1>
                    <p className="text-gray-500 text-sm">{t('login.subtitle')}</p>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mb-6 bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-xl text-sm">
                        {error}
                    </div>
                )}

                {/* Login Views */}
                {view === 'google' ? (
                    <>
                        <button
                            id="google-signin-button"
                            onClick={handleGoogleSignIn}
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 hover:border-indigo-400 hover:shadow-md text-gray-700 font-semibold py-3.5 px-4 rounded-xl transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed group"
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-indigo-600" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    <span>{t('login.googleLoading')}</span>
                                </>
                            ) : (
                                <>
                                    {/* Google "G" Logo */}
                                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                    <span className="group-hover:text-indigo-600 transition-colors">{t('login.googleButton')}</span>
                                </>
                            )}
                        </button>
                        
                        <div className="mt-6 text-center">
                            <button 
                                onClick={() => { setView('cook'); setError(''); }} 
                                className="text-indigo-600 hover:text-indigo-800 text-sm font-semibold transition-colors"
                            >
                                Are you a Cook? Login here
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={handleCookSignIn} className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Phone Number</label>
                            <input
                                type="tel"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-gray-800"
                                required
                                placeholder="+1234567890"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">PIN</label>
                            <input
                                type="password"
                                value={pin}
                                onChange={(e) => setPin(e.target.value)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-gray-800"
                                required
                                placeholder="****"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-200 disabled:opacity-50"
                        >
                            {loading ? 'Logging in...' : 'Login as Cook'}
                        </button>

                        <div className="mt-4 text-center">
                            <button 
                                type="button"
                                onClick={() => { setView('google'); setError(''); }} 
                                className="text-gray-500 hover:text-gray-800 text-sm transition-colors"
                            >
                                Back to Google Login
                            </button>
                        </div>
                    </form>
                )}

                {/* Footer */}
                <div className="mt-8 text-center space-y-2">
                    <p className="text-sm text-gray-500">{t('login.googleFooter')}</p>
                    <p className="text-xs text-gray-400">{t('login.footerHint')}</p>
                </div>
            </div>
        </div>
    );
}
