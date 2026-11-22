'use client';

import type { ReactNode } from 'react';
import { useLocale } from '@/context/LocaleContext';
import { cn } from '@/lib/cn';
import Header, { MobileTabBar } from './Header';
import MealFeedback from './ratings/MealFeedback';

/**
 * Shared page frame for signed-in screens: skip link, header (desktop nav),
 * a centred content column, and the bottom tab bar on phones.
 */
export default function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
    const { t } = useLocale();
    return (
        <div className="min-h-dvh bg-canvas">
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-raised"
            >
                {t('nav.skipToContent')}
            </a>
            <Header />
            <main
                id="main"
                tabIndex={-1}
                className={cn('mx-auto w-full px-4 pb-28 pt-5 outline-none sm:px-6 sm:pb-16 sm:pt-8', wide ? 'max-w-5xl' : 'max-w-3xl')}
            >
                {children}
            </main>
            <MobileTabBar />
            <MealFeedback />
        </div>
    );
}

/** Page title block used at the top of each screen. */
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
    return (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{title}</h1>
                {subtitle && <p className="mt-1 text-[15px] text-ink-muted">{subtitle}</p>}
            </div>
            {action}
        </div>
    );
}
