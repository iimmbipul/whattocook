'use client';

import { addDays, type RatingSession } from './logic';
import type { RatingsDashboard, RatingsStatus } from './types';

/*
 * Browser-side loading for ratings. The status check runs once per app open
 * (kept for two minutes across page navigations), and both loaders share one
 * request between components that ask at the same time.
 */

const STATUS_TTL_MS = 2 * 60 * 1000;
let status: { uid: string; at: number; data: RatingsStatus } | null = null;
let statusRequest: { uid: string; promise: Promise<RatingsStatus | null> } | null = null;

export function loadRatingsStatus(uid: string): Promise<RatingsStatus | null> {
    if (status && status.uid === uid && Date.now() - status.at < STATUS_TTL_MS) return Promise.resolve(status.data);
    if (statusRequest?.uid === uid) return statusRequest.promise;
    const promise: Promise<RatingsStatus | null> = fetch('/api/ratings', { credentials: 'same-origin', cache: 'no-store' })
        .then(res => (res.ok ? (res.json() as Promise<RatingsStatus>) : null))
        .then(data => {
            if (data) status = { uid, at: Date.now(), data };
            return data;
        })
        .catch(() => null)
        .finally(() => {
            if (statusRequest?.promise === promise) statusRequest = null;
        });
    statusRequest = { uid, promise };
    return promise;
}

/** Keep the cached status in step after a rating, skip or dismissal. */
export function updateCachedRatingsStatus(uid: string, update: (s: RatingsStatus) => RatingsStatus): void {
    if (status?.uid === uid) status = { ...status, data: update(status.data) };
}

let dashboardRequest: { uid: string; promise: Promise<RatingsDashboard | null> } | null = null;

export function loadRatingsDashboard(uid: string, { fresh = false }: { fresh?: boolean } = {}): Promise<RatingsDashboard | null> {
    if (!fresh && dashboardRequest?.uid === uid) return dashboardRequest.promise;
    const promise = fetch('/api/ratings/summary', { credentials: 'same-origin', cache: 'no-store' })
        .then(res => (res.ok ? (res.json() as Promise<RatingsDashboard>) : null))
        .catch(() => null);
    dashboardRequest = { uid, promise };
    // Don't keep a failed load around: the next visit should try again.
    promise.then(data => {
        if (!data && dashboardRequest?.promise === promise) dashboardRequest = null;
    });
    return promise;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

const INTL_LOCALE: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', or: 'or-IN' };

/** "Today", "Yesterday" or "Sat, 21 Nov", for a household-local YYYY-MM-DD date. */
export function mealDayLabel(date: string, today: string, t: T, locale: string): string {
    if (date === today) return t('ratings.today');
    if (date === addDays(today, -1)) return t('ratings.yesterday');
    return new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
        .format(new Date(`${date}T00:00:00Z`));
}

/** "21 Nov" for chart axes and tables. */
export function shortDate(date: string, locale: string): string {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
        .format(new Date(`${date}T00:00:00Z`));
}

export const sessionLabel = (session: RatingSession, t: T) =>
    t(session === 'dinner' ? 'ratings.dinner' : 'ratings.breakfastLunch');

/** "4.3", or an en dash when there is nothing to average. */
export const formatAverage = (value: number | null) => (value === null ? '–' : value.toFixed(1));

/** Picks `<key>One` for a count of 1, `<key>` otherwise. */
export const plural = (t: T, key: string, count: number) => t(count === 1 ? `${key}One` : key, { count });
