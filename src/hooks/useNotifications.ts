'use client';

import { useEffect, useState } from 'react';
import {
    collection,
    onSnapshot,
    orderBy,
    query,
    limit,
    Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { NotificationDoc } from '@/types/meal';

const PAGE_SIZE = 50;

/**
 * Live household notifications, newest first. Filters out anything the
 * caller emitted themselves — you don't need a chip for what you just did.
 */
export function useNotifications(householdId: string | undefined, currentUserId: string | undefined) {
    const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        if (!householdId || !currentUserId) {
            setNotifications([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const q = query(
            collection(db, `households/${householdId}/notifications`),
            orderBy('createdAt', 'desc'),
            limit(PAGE_SIZE),
        );

        const unsub = onSnapshot(
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
                    .filter(n => n.actorId !== currentUserId);

                setNotifications(docs);
                setLoading(false);
            },
            err => {
                console.error('notifications subscription error', err);
                setLoading(false);
            },
        );

        return () => unsub();
    }, [householdId, currentUserId]);

    const unreadCount = notifications.reduce(
        (n, doc) => n + (currentUserId && !doc.readBy.includes(currentUserId) ? 1 : 0),
        0,
    );

    return { notifications, unreadCount, loading };
}
