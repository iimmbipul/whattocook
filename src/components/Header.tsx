'use client';

import { useAuth } from './AuthProvider';
import { logout } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { Settings, LogOut, UtensilsCrossed } from 'lucide-react';

export default function Header() {
    const { user } = useAuth();
    const router = useRouter();

    const handleLogout = async () => {
        await logout();
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

                {/* Right Side: Greeting & Actions */}
                <div className="flex items-center gap-6">

                    {/* Personalized Greeting */}
                    <div className="hidden sm:flex flex-col items-end border-r border-brand-light/20 pr-6">
                        <span className="text-[10px] uppercase tracking-[0.2em] text-brand-secondary font-bold">
                            Welcome back
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold tracking-wide text-brand-light">
                                {user.email?.split('@')[0]}
                            </span>
                            <span className="bg-brand-light/20 text-brand-light text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                                {user.role}
                            </span>
                        </div>
                    </div>

                    {/* Action Hub */}
                    <nav className="flex items-center gap-2">
                        {user.role === 'user' && (
                            <button
                                onClick={() => router.push('/admin')}
                                className="p-2.5 hover:bg-brand-light/10 rounded-full transition-colors group text-brand-light"
                                title="Admin Settings"
                            >
                                <Settings size={20} className="group-hover:rotate-45 transition-transform duration-300" />
                            </button>
                        )}

                        <button
                            onClick={handleLogout}
                            className="flex items-center gap-2 ml-2 pl-4 pr-5 py-2 bg-brand-primary hover:bg-brand-secondary rounded-full text-sm font-bold transition-all shadow-md active:scale-95 text-white"
                        >
                            <LogOut size={16} />
                            <span>Logout</span>
                        </button>
                    </nav>
                </div>
            </div>
        </header>
    );
}