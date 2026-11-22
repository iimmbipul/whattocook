'use client';

import { addDays } from './logic';
import { localName } from './catalog';
import type { GroceryAdminView, GroceryView } from './types';

/*
 * Browser-side loading for the grocery screens. One request is shared by the
 * components that ask at the same time, and the view is kept briefly so moving
 * between Today, Groceries and Pantry doesn't refetch. Call `refreshGroceryView`
 * after a change so everything on screen updates.
 */

const TTL_MS = 30 * 1000;
let cached: { uid: string; at: number; data: GroceryView } | null = null;
let inflight: { uid: string; promise: Promise<GroceryView | null> } | null = null;
const listeners = new Set<(view: GroceryView) => void>();

export function loadGroceryView(uid: string, { fresh = false }: { fresh?: boolean } = {}): Promise<GroceryView | null> {
    if (!fresh && cached && cached.uid === uid && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.data);
    if (!fresh && inflight?.uid === uid) return inflight.promise;
    const promise: Promise<GroceryView | null> = fetch('/api/grocery', { credentials: 'same-origin', cache: 'no-store' })
        .then(res => (res.ok ? (res.json() as Promise<GroceryView>) : null))
        .then(data => {
            if (data) {
                cached = { uid, at: Date.now(), data };
                listeners.forEach(l => l(data));
            }
            return data;
        })
        .catch(() => null)
        .finally(() => {
            if (inflight?.promise === promise) inflight = null;
        });
    inflight = { uid, promise };
    return promise;
}

/** Re-fetch after a change; every subscribed component receives the new view. */
export function refreshGroceryView(uid: string): Promise<GroceryView | null> {
    return loadGroceryView(uid, { fresh: true });
}

export function subscribeGroceryView(listener: (view: GroceryView) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export async function loadGroceryAdminView(): Promise<GroceryAdminView | null> {
    try {
        const res = await fetch('/api/grocery/admin', { credentials: 'same-origin', cache: 'no-store' });
        return res.ok ? ((await res.json()) as GroceryAdminView) : null;
    } catch {
        return null;
    }
}

type T = (key: string, vars?: Record<string, string | number>) => string;

const INTL_LOCALE: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', or: 'or-IN' };

/** "Today", "Tomorrow" or "Wed 26 Nov", for a household-local YYYY-MM-DD date. */
export function groceryDayLabel(date: string, today: string, t: T, locale: string): string {
    if (date === today) return t('grocery.today');
    if (date === addDays(today, 1)) return t('grocery.tomorrow');
    return new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
        .format(new Date(`${date}T00:00:00Z`));
}

/** The item's name in the viewer's language. */
export function itemName(item: { en: string; hi?: string; or?: string }, locale: string): string {
    return localName(item, locale);
}

/** "2 h ago", "yesterday" or a date, for when a level was reported. */
export function reportedAgo(ms: number | null, t: T, locale: string): string {
    if (!ms) return '';
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 60) return t('grocery.minutesAgo', { count: Math.max(1, minutes) });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t('grocery.hoursAgo', { count: hours });
    return new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'en-IN', { day: 'numeric', month: 'short' }).format(new Date(ms));
}
