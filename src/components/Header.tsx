'use client';

import { useAuth } from './AuthProvider';
import { logout } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { Settings, LogOut, UtensilsCrossed } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { supportedLocales, localeLabels, type SupportedLocale } from '@/lib/i18n';

export default function Header() {
    const { user } = useAuth();
    const router = useRouter();
    const { t, locale, setLocale } = useLocale();

    const handleLogout = async () => {
        await logout();
        localStorage.removeItem('meal_planner_user');
        router.push('/login');
    };

    if (!user) return null;

    return (
        <header className="sticky top-0 z-50 w-full border-b border-brand-light/10 bg-brand-darkest/95 backdrop-blur-md text-brand-light pt-[env(safe-area-inset-top)]">
            <div className="container mx-auto px-4 h-16 flex items-center justify-between">

                {/* Logo Section */}
                <div
                    className="flex items-center gap-2.5 cursor-pointer group"
                    onClick={() => router.push('/')}
                >
                    <div className="bg-brand-light text-brand-darkest p-2 rounded-xl shadow-lg transition-all group-hover:rotate-12">
                        <UtensilsCrossed size={20} strokeWidth={2.5} />
                    </div>
                    <span className="text-xl font-black tracking-tight italic text-brand-light">
                        WhatTo<span className="text-brand-secondary">Cook</span>
                    </span>
                </div>

                {/* Right Side */}
                <div className="flex items-center gap-3">

                    {/* Language Selector */}
                    <div className="relative flex items-center">
                        <span className="text-base mr-1 hidden sm:inline">🌐</span>
                        <select
                            value={locale}
                            onChange={(e) => setLocale(e.target.value as SupportedLocale)}
                            className="appearance-none bg-brand-light/10 hover:bg-brand-light/20 border border-brand-light/20 text-brand-light text-xs font-semibold rounded-full pl-2 pr-6 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-secondary/50 cursor-pointer transition-all"
                            aria-label={t('header.selectLanguage')}
                        >
                            {supportedLocales.map((loc) => (
                                <option key={loc} value={loc} className="bg-brand-darkest text-brand-light">
                                    {localeLabels[loc]}
                                </option>
                            ))}
                        </select>
                        {/* Custom arrow */}
                        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-brand-light/60">
                            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                    </div>

                    {/* Action Hub */}
                    <nav className="flex items-center gap-2">
                        {user.role === 'user' && (
                            <button
                                onClick={() => router.push('/admin')}
                                className="p-2.5 hover:bg-brand-light/10 rounded-full transition-colors group text-brand-light"
                                title={t('header.adminSettings')}
                            >
                                <Settings size={20} className="group-hover:rotate-45 transition-transform duration-300" />
                            </button>
                        )}

                        {/* Profile Dropdown */}
                        <div className="relative group/profile ml-2">
                            <button className="flex items-center gap-3 pl-3 pr-4 py-1.5 bg-brand-light/10 hover:bg-brand-light/20 rounded-full transition-all border border-brand-light/10">
                                <div className="text-right hidden sm:block">
                                    <div className="text-xs text-brand-secondary font-bold uppercase tracking-wider">{t('header.welcome')}</div>
                                    <div className="text-sm font-bold text-brand-light">{user.email?.split('@')[0]}</div>
                                </div>
                                <div className="w-8 h-8 bg-brand-secondary text-brand-darkest rounded-full flex items-center justify-center font-bold shadow-sm">
                                    {user.email?.charAt(0).toUpperCase()}
                                </div>
                            </button>

                            {/* Dropdown Menu */}
                            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-brand-light/20 overflow-hidden opacity-0 invisible group-hover/profile:opacity-100 group-hover/profile:visible transition-all transform origin-top-right z-50">
                                <div className="p-2 space-y-1">
                                    <button
                                        onClick={() => router.push('/my-plates')}
                                        className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-brand-dark hover:bg-brand-light/20 rounded-lg transition-colors"
                                    >
                                        <UtensilsCrossed size={16} />
                                        <span>{t('header.myPlates')}</span>
                                    </button>

                                    <div className="h-px bg-brand-light/20 my-1" />

                                    <button
                                        onClick={handleLogout}
                                        className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <LogOut size={16} />
                                        <span>{t('header.logout')}</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                    </nav>
                </div>
            </div>
        </header>
    );
}