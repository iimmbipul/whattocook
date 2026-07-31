'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, UserPlus, UserMinus, UserX, UserCheck, Utensils, Users } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from './AuthProvider';
import { useLocale } from '@/context/LocaleContext';
import { useNotifications } from '@/hooks/useNotifications';
import { markNotificationsRead } from '@/lib/notifications';
import { NotificationDoc } from '@/types/meal';

const mealTypeIcon = (t?: string) => {
    switch (t) {
        case 'breakfast': return '☕';
        case 'lunch': return '🥪';
        case 'dinner': return '🍽️';
        default: return '';
    }
};

function TypeIcon({ type }: { type: NotificationDoc['type'] }) {
    const cls = 'w-4 h-4';
    switch (type) {
        case 'meal_updated': return <Utensils className={cls} />;
        case 'meal_skipped': return <UserX className={cls} />;
        case 'meal_unskipped': return <UserCheck className={cls} />;
        case 'guest_added': return <UserPlus className={cls} />;
        case 'guest_removed': return <UserMinus className={cls} />;
        case 'responsibility_changed':
        case 'responsibility_bulk_changed':
            return <Users className={cls} />;
        default: return <Bell className={cls} />;
    }
}

function typeAccentClass(type: NotificationDoc['type']): string {
    switch (type) {
        case 'meal_updated': return 'bg-brand-primary/10 text-brand-primary';
        case 'meal_skipped': return 'bg-red-50 text-red-600';
        case 'meal_unskipped': return 'bg-green-50 text-green-700';
        case 'guest_added': return 'bg-purple-50 text-purple-700';
        case 'guest_removed': return 'bg-brand-light/40 text-brand-darkest';
        case 'responsibility_changed':
        case 'responsibility_bulk_changed':
            return 'bg-amber-50 text-amber-700';
        default: return 'bg-brand-light/30 text-brand-dark';
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

export default function NotificationBell() {
    const { user } = useAuth();
    const { t } = useLocale();
    const { notifications, unreadCount } = useNotifications(user?.householdId, user?.uid);
    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const buildMessage = useMessage();

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const unreadIds = useMemo(
        () => notifications.filter(n => user?.uid && !n.readBy.includes(user.uid)).map(n => n.id),
        [notifications, user?.uid],
    );

    // When the panel opens, mark visible unread notifications as read.
    useEffect(() => {
        if (!open || !user?.householdId || !user?.uid || unreadIds.length === 0) return;
        markNotificationsRead(user.householdId, user.uid, unreadIds).catch(() => {});
    }, [open, unreadIds, user?.householdId, user?.uid]);

    if (!user) return null;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setOpen(v => !v)}
                className="relative p-2.5 hover:bg-brand-light/10 rounded-full transition-colors text-brand-light"
                aria-label={t('notifications.ariaBell')}
                title={t('notifications.ariaBell')}
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-brand-darkest">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            <div
                className={`absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-[26rem] bg-white rounded-xl shadow-xl border border-brand-light/20 overflow-hidden transition-all transform origin-top-right z-50 ${open ? 'opacity-100 visible scale-100' : 'opacity-0 invisible scale-95'}`}
            >
                <div className="px-4 py-3 border-b border-brand-light/20 flex items-center justify-between">
                    <span className="text-sm font-bold text-brand-darkest uppercase tracking-wide">
                        {t('notifications.title')}
                    </span>
                    {unreadCount > 0 && (
                        <span className="text-xs font-semibold text-brand-primary bg-brand-primary/10 px-2 py-0.5 rounded-full">
                            {t('notifications.newCount', { count: unreadCount })}
                        </span>
                    )}
                </div>

                <div className="max-h-[70vh] overflow-y-auto divide-y divide-brand-light/20">
                    {notifications.length === 0 ? (
                        <div className="px-4 py-10 text-center text-sm text-brand-dark/70">
                            <Check size={20} className="mx-auto mb-2 text-brand-light" />
                            {t('notifications.empty')}
                        </div>
                    ) : (
                        notifications.map(n => {
                            const isUnread = user.uid && !n.readBy.includes(user.uid);
                            return (
                                <div
                                    key={n.id}
                                    className={`px-4 py-3 flex gap-3 transition-colors ${isUnread ? 'bg-brand-primary/5' : ''}`}
                                >
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${typeAccentClass(n.type)}`}>
                                        <TypeIcon type={n.type} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-brand-darkest leading-snug">
                                            {mealTypeIcon(n.mealType) && (
                                                <span className="mr-1">{mealTypeIcon(n.mealType)}</span>
                                            )}
                                            {buildMessage(n)}
                                        </p>
                                        <div className="mt-1 flex items-center gap-2 text-[11px] text-brand-dark/60">
                                            <span>
                                                {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                                            </span>
                                            {n.date && <span>· {n.date}</span>}
                                        </div>
                                    </div>
                                    {isUnread && (
                                        <span className="w-2 h-2 mt-2 rounded-full bg-brand-primary shrink-0" />
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
