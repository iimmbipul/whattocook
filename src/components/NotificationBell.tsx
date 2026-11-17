'use client';

import { useEffect, useId, useMemo } from 'react';
import { Bell, BellOff, UserPlus, UserMinus, UserX, UserCheck, Utensils, Users } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useAuth } from './AuthProvider';
import { useLocale } from '@/context/LocaleContext';
import { useNotifications } from '@/hooks/useNotifications';
import { markNotificationsRead } from '@/lib/notifications';
import { NotificationDoc } from '@/types/meal';
import { cn } from '@/lib/cn';
import { usePopover } from './ui/usePopover';

function TypeIcon({ type }: { type: NotificationDoc['type'] }) {
    const props = { size: 16, 'aria-hidden': true } as const;
    switch (type) {
        case 'meal_updated': return <Utensils {...props} />;
        case 'meal_skipped': return <UserX {...props} />;
        case 'meal_unskipped': return <UserCheck {...props} />;
        case 'guest_added': return <UserPlus {...props} />;
        case 'guest_removed': return <UserMinus {...props} />;
        case 'responsibility_changed':
        case 'responsibility_bulk_changed':
            return <Users {...props} />;
        default: return <Bell {...props} />;
    }
}

function typeTone(type: NotificationDoc['type']): string {
    switch (type) {
        case 'meal_skipped': return 'bg-danger-soft text-danger';
        case 'meal_unskipped': return 'bg-success-soft text-success';
        case 'responsibility_changed':
        case 'responsibility_bulk_changed':
            return 'bg-warning-soft text-warning';
        default: return 'bg-accent-soft text-accent-strong';
    }
}

/**
 * Render a plain-text message for a notification. Keys live under
 * `notifications.*` in locale files with {{actor}}, {{mealName}} etc.
 */
function useMessage() {
    const { t } = useLocale();

    return (n: NotificationDoc): string => {
        const mealTypeKey = n.mealType ? `notifications.mealType.${n.mealType}` : '';
        const mealTypeLabel = mealTypeKey ? t(mealTypeKey) : '';
        const p = n.payload ?? {};
        switch (n.type) {
            case 'meal_updated':
                return t('notifications.mealUpdated', {
                    actor: n.actorName,
                    mealType: mealTypeLabel,
                    fromName: String(p.fromName ?? ''),
                    toName: String(p.toName ?? ''),
                });
            case 'meal_skipped':
                return t('notifications.mealSkipped', {
                    actor: n.actorName,
                    mealType: mealTypeLabel,
                    mealName: String(p.mealName ?? ''),
                });
            case 'meal_unskipped':
                return t('notifications.mealUnskipped', {
                    actor: n.actorName,
                    mealType: mealTypeLabel,
                    mealName: String(p.mealName ?? ''),
                });
            case 'guest_added':
                return t('notifications.guestAdded', {
                    actor: n.actorName,
                    mealType: mealTypeLabel,
                    mealName: String(p.mealName ?? ''),
                });
            case 'guest_removed':
                return t('notifications.guestRemoved', {
                    actor: n.actorName,
                    mealType: mealTypeLabel,
                    mealName: String(p.mealName ?? ''),
                });
            case 'responsibility_changed': {
                const slotKey = p.slot === 'dinnerId'
                    ? 'notifications.slot.dinner'
                    : 'notifications.slot.breakfastLunch';
                return t('notifications.respChanged', {
                    actor: n.actorName,
                    slot: t(slotKey),
                    toName: String(p.toName ?? ''),
                });
            }
            case 'responsibility_bulk_changed': {
                return t('notifications.respBulkChanged', {
                    actor: n.actorName,
                    count: Number(p.count ?? 0),
                });
            }
            default:
                return n.actorName;
        }
    };
}

/** "Wed, Nov 18" for the meal date a notification is about. */
function formatMealDate(date: string): string {
    const d = new Date(`${date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? date : format(d, 'EEE, MMM d');
}

export default function NotificationBell() {
    const { user } = useAuth();
    const { t } = useLocale();
    const { notifications, unreadCount } = useNotifications(user?.householdId, user?.uid);
    const {
        open: popoverOpen,
        toggle: togglePopover,
        containerRef: popoverContainerRef,
        triggerRef: popoverTriggerRef,
    } = usePopover();
    const panelId = useId();
    const titleId = useId();
    const buildMessage = useMessage();

    const unreadIds = useMemo(
        () => notifications.filter(n => user?.uid && !n.readBy.includes(user.uid)).map(n => n.id),
        [notifications, user?.uid],
    );

    // When the panel opens, mark visible unread notifications as read.
    useEffect(() => {
        if (!popoverOpen || !user?.householdId || !user?.uid || unreadIds.length === 0) return;
        markNotificationsRead(user.householdId, user.uid, unreadIds).catch(() => {});
    }, [popoverOpen, unreadIds, user?.householdId, user?.uid]);

    if (!user) return null;

    const bellLabel = unreadCount > 0
        ? `${t('notifications.ariaBell')} (${t('notifications.newCount', { count: unreadCount })})`
        : t('notifications.ariaBell');

    return (
        <div className="relative" ref={popoverContainerRef}>
            <button
                ref={popoverTriggerRef}
                type="button"
                onClick={togglePopover}
                aria-expanded={popoverOpen}
                aria-controls={panelId}
                aria-label={bellLabel}
                title={t('notifications.ariaBell')}
                className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
                <Bell size={20} aria-hidden="true" />
                {unreadCount > 0 && (
                    <span
                        className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-surface bg-danger px-1 text-[10px] font-bold text-white"
                        aria-hidden="true"
                    >
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {popoverOpen && (
                <div
                    id={panelId}
                    role="region"
                    aria-labelledby={titleId}
                    className={cn(
                        'z-50 animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay',
                        'fixed inset-x-3 top-[calc(3.75rem+env(safe-area-inset-top))]',
                        'sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96',
                    )}
                >
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                        <h2 id={titleId} className="text-sm font-semibold text-ink">{t('notifications.title')}</h2>
                        {unreadCount > 0 && (
                            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">
                                {t('notifications.newCount', { count: unreadCount })}
                            </span>
                        )}
                    </div>

                    <div className="max-h-[min(70dvh,32rem)] overflow-y-auto overscroll-contain">
                        {notifications.length === 0 ? (
                            <div className="flex flex-col items-center px-6 py-10 text-center">
                                <BellOff size={22} className="mb-2 text-ink-subtle" aria-hidden="true" />
                                <p className="text-sm text-ink-muted">{t('notifications.empty')}</p>
                            </div>
                        ) : (
                            <ul className="divide-y divide-line">
                                {notifications.map(n => {
                                    const isUnread = !n.readBy.includes(user.uid);
                                    return (
                                        <li key={n.id} className={cn('flex gap-3 px-4 py-3', isUnread && 'bg-accent-soft/40')}>
                                            <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', typeTone(n.type))}>
                                                <TypeIcon type={n.type} />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm leading-snug text-ink">{isUnread && <span className="sr-only">New: </span>}{buildMessage(n)}</p>
                                                <p className="mt-1 text-xs text-ink-muted">
                                                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                                                    {n.date && <> · {formatMealDate(n.date)}</>}
                                                </p>
                                            </div>
                                            {isUnread && (
                                                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
