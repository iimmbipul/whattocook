'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId } from 'react';
import { CalendarDays, LogOut, Package, Settings, ShoppingBasket, User as UserIcon, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { logout } from '@/lib/auth';
import { useLocale } from '@/context/LocaleContext';
import { supportedLocales, localeLabels, type SupportedLocale } from '@/lib/i18n';
import { clearDashboardCache } from '@/lib/dashboardCache';
import { cn } from '@/lib/cn';
import NotificationBell from './NotificationBell';
import { Avatar } from './ui/Badge';
import { usePopover } from './ui/usePopover';
import { CopyValue } from './ui/CopyValue';

interface NavItem {
    href: string;
    label: string;
    icon: LucideIcon;
}

/** Top-level destinations; Admin only for household owners. */
export function useNavItems(): NavItem[] {
    const { user } = useAuth();
    const { t } = useLocale();
    const items: NavItem[] = [
        { href: '/', label: t('nav.today'), icon: CalendarDays },
        { href: '/my-plates', label: t('nav.myPlates'), icon: UtensilsCrossed },
        // The cook keeps the pantry; everyone else sees the shopping list.
        user?.role === 'cook'
            ? { href: '/pantry', label: t('nav.pantry'), icon: Package }
            : { href: '/groceries', label: t('nav.groceries'), icon: ShoppingBasket },
        { href: '/profile', label: t('nav.profile'), icon: UserIcon },
    ];
    if (user?.role === 'user') items.push({ href: '/admin', label: t('nav.admin'), icon: Settings });
    return items;
}

export function displayNameOf(user: { displayName?: string | null; email?: string | null }): string {
    return user.displayName?.trim() || user.email?.split('@')[0] || '';
}

export default function Header() {
    const { user } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const { t, locale, setLocale } = useLocale();
    const nav = useNavItems();
    const { open: menuOpen, setOpen: setMenuOpen, toggle: toggleMenu, containerRef: menuContainerRef, triggerRef: menuTriggerRef } = usePopover();
    const menuId = useId();
    const languageId = useId();

    // Warm the pages reachable from the header so navigating to them doesn't
    // wait on a route fetch after the click (no-op in development).
    const role = user?.role;
    useEffect(() => {
        if (!role) return;
        const routes = ['/', '/profile', '/my-plates'];
        if (role === 'user') routes.push('/admin');
        routes.forEach((route) => router.prefetch(route));
    }, [role, router]);

    const handleLogout = async () => {
        await logout();
        // Clear Firebase/Google auth session. The Auth SDK is loaded on demand so
        // it isn't part of the initial bundle of every page with a header.
        await Promise.all([import('firebase/auth'), import('@/lib/firebaseAuth')])
            .then(([{ signOut }, { auth }]) => signOut(auth))
            .catch(() => {});
        localStorage.removeItem('meal_planner_user');
        clearDashboardCache();
        router.push('/login');
    };

    if (!user) return null;
    const name = displayNameOf(user);

    return (
        <header className="sticky top-0 z-40 border-b border-line bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur-md supports-[backdrop-filter]:bg-surface/75">
            <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:h-16 sm:px-6">
                <Link href="/" className="flex shrink-0 items-center gap-2 rounded-lg" aria-label="WhatToCook — home">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-darkest text-brand-light">
                        <UtensilsCrossed size={17} strokeWidth={2.25} aria-hidden="true" />
                    </span>
                    <span className="text-[17px] font-bold tracking-tight text-ink">
                        WhatTo<span className="text-accent">Cook</span>
                    </span>
                </Link>

                <nav aria-label={t('nav.mainNav')} className="ml-4 hidden items-center gap-1 sm:flex">
                    {nav.map(item => {
                        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                                    active ? 'bg-accent-soft text-accent-strong' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                                )}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="ml-auto flex items-center gap-1">
                    <NotificationBell />

                    <div className="relative" ref={menuContainerRef}>
                        <button
                            ref={menuTriggerRef}
                            type="button"
                            onClick={toggleMenu}
                            aria-expanded={menuOpen}
                            aria-controls={menuId}
                            aria-label={t('nav.account')}
                            className="flex h-11 items-center gap-2 rounded-full pl-1 pr-1 transition-colors hover:bg-surface-muted sm:pr-3"
                        >
                            <Avatar name={name} photoURL={user.photoURL} size={32} />
                            <span className="hidden max-w-[10rem] truncate text-sm font-semibold text-ink sm:block">{name.split(' ')[0]}</span>
                        </button>

                        {menuOpen && (
                            <div
                                id={menuId}
                                className="absolute right-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] animate-pop-in rounded-2xl border border-line bg-surface p-2 shadow-overlay"
                            >
                                <div className="flex items-center gap-3 px-2 py-2">
                                    <Avatar name={name} photoURL={user.photoURL} size={40} />
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-ink">{name}</div>
                                        {user.email && <div className="truncate text-xs text-ink-muted">{user.email}</div>}
                                    </div>
                                </div>

                                {user.houseCode && user.housePin && (
                                    <div className="space-y-1.5 px-1 pb-2">
                                        <CopyValue label={t('nav.houseCode')} value={user.houseCode} />
                                        <CopyValue label={t('nav.housePin')} value={user.housePin} />
                                    </div>
                                )}

                                <div className="border-t border-line px-2 py-2.5">
                                    <label htmlFor={languageId} className="mb-1 block text-xs font-medium text-ink-muted">
                                        {t('nav.language')}
                                    </label>
                                    <select
                                        id={languageId}
                                        value={locale}
                                        onChange={(e) => setLocale(e.target.value as SupportedLocale)}
                                        className="h-10 w-full cursor-pointer rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                                    >
                                        {supportedLocales.map(loc => (
                                            <option key={loc} value={loc}>{localeLabels[loc].replace('🌐 ', '')}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="border-t border-line pt-1">
                                    <button
                                        type="button"
                                        onClick={() => { setMenuOpen(false); handleLogout(); }}
                                        className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft"
                                    >
                                        <LogOut size={17} aria-hidden="true" />
                                        {t('nav.logout')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}

/** Bottom navigation for phones (the header nav is hidden below `sm`). */
export function MobileTabBar() {
    const { user } = useAuth();
    const pathname = usePathname();
    const { t } = useLocale();
    const nav = useNavItems();
    if (!user) return null;

    return (
        <nav
            aria-label={t('nav.mainNav')}
            className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-safe backdrop-blur-md sm:hidden"
        >
            <ul className="mx-auto flex max-w-md">
                {nav.map(item => {
                    const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                        <li key={item.href} className="flex-1">
                            <Link
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors',
                                    active ? 'text-accent-strong' : 'text-ink-muted hover:text-ink',
                                )}
                            >
                                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-accent-soft')}>
                                    <Icon size={20} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                                </span>
                                {item.label}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
