'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useLocale } from '@/context/LocaleContext';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Spinner';
import { useGroceryView } from './useGroceryView';

/**
 * The hired cook sees the menu only after today's stock check is done. While
 * items are left, this shows a "Stock check first" card instead of `children`.
 * If the grocery view can't load, the menu is shown: the cook still has to cook.
 */
export default function CookMenuGate({ children, onShowCheck, checkIsAbove = false }: {
    children: ReactNode;
    /** Jump to today's check (Today on another date). Without it, a link to Today is shown. */
    onShowCheck?: () => void;
    /** The stock check card is right above, on this screen. */
    checkIsAbove?: boolean;
}) {
    const { user } = useAuth();
    const { t } = useLocale();
    const isCook = user?.role === 'cook';
    const view = useGroceryView(isCook ? user.uid : undefined);

    if (!isCook) return <>{children}</>;
    if (view === undefined) {
        return (
            <div className="space-y-4" aria-busy="true">
                <Skeleton className="h-32 rounded-2xl" />
                <Skeleton className="h-32 rounded-2xl" />
            </div>
        );
    }
    const left = view?.checks.length ?? 0;
    if (left === 0) return <>{children}</>;

    return (
        <Card>
            <EmptyState
                icon={<ClipboardCheck size={22} />}
                title={t('grocery.gate.title')}
                body={t(checkIsAbove ? 'grocery.gate.bodyAbove' : 'grocery.gate.body', { count: left })}
                action={checkIsAbove ? undefined : onShowCheck ? (
                    <Button onClick={onShowCheck}>{t('grocery.gate.open')}</Button>
                ) : (
                    <Link href="/" className="font-semibold text-accent-strong">{t('grocery.gate.open')}</Link>
                )}
            />
        </Card>
    );
}
