'use client';

import { useEffect, useState } from 'react';
import type { NotificationDoc } from '@/types/meal';

const PAGE_SIZE = 50;

/**
 * Live household notifications, newest first. Filters out anything the
 * caller emitted themselves — you don't need a chip for what you just did.
 *
 * The Firestore SDK is loaded on demand inside the effect, so it is fetched
 * after the page has rendered instead of being part of the initial bundle of
 * every page that shows the bell.
 */
export function useNotifications(householdId: string | undefined, currentUserId: string | undefined, role?: string) {
    const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        if (!householdId || !currentUserId) {
            setNotifications([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        let cancelled = false;
        let unsub: (() => void) | undefined;

        Promise.all([import('firebase/firestore'), import('@/lib/firebase')])
            .then(([{ collection, onSnapshot, orderBy, query, limit, Timestamp }, { db }]) => {
                if (cancelled) return;

                const q = query(
                    collection(db, `households/${householdId}/notifications`),
                    orderBy('createdAt', 'desc'),
                    limit(PAGE_SIZE),
                );

                unsub = onSnapshot(
                    q,
                    snap => {
                        const docs: NotificationDoc[] = snap.docs
                            .map(d => {
                                const raw = d.data() as any;
                                const created = raw.createdAt;
                                const createdMs =
                                    created instanceof Timestamp
                                        ? created.toMillis()
                                        : typeof created?.seconds === 'number'
                                            ? created.seconds * 1000
                                            : Date.now();
                                return {
                                    id: d.id,
                                    type: raw.type,
                                    actorId: raw.actorId,
                                    actorName: raw.actorName,
                                    date: raw.date ?? undefined,
                                    mealType: raw.mealType ?? undefined,
                                    payload: raw.payload ?? {},
                                    createdAt: createdMs,
                                    readBy: Array.isArray(raw.readBy) ? raw.readBy : [],
                                } satisfies NotificationDoc;
                            })
                            .filter(n => n.actorId !== currentUserId)
                            // Some notifications are for part of the household: 'owner' only,
                            // or 'members' (the owner and members, e.g. Milkbasket; not the cook).
                            .filter(n => {
                                const audience = n.payload?.audience;
                                if (audience === 'owner') return role === 'user';
                                if (audience === 'members') return role === 'user' || role === 'member';
                                return true;
                            });

                        setNotifications(docs);
                        setLoading(false);
                    },
                    err => {
                        console.error('notifications subscription error', err);
                        setLoading(false);
                    },
                );
            })
            .catch(err => {
                console.error('notifications subscription error', err);
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
            unsub?.();
        };
    }, [householdId, currentUserId, role]);

    const unreadCount = notifications.reduce(
        (n, doc) => n + (currentUserId && !doc.readBy.includes(currentUserId) ? 1 : 0),
        0,
    );

    return { notifications, unreadCount, loading };
}
