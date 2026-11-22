'use server';

/**
 * Meal rating server actions. Each one is a public endpoint: the acting user
 * and household always come from the verified session, and every argument is
 * validated in src/lib/server/ratings.ts.
 *
 * Reads go through GET /api/ratings and /api/ratings/summary instead, so the
 * check on app open runs in parallel with the page's own data loads (the
 * browser runs Server Actions one at a time).
 */

import { getSessionUser } from '../server/currentUser';
import { markFeedbackSeen, recordRating, setNamesVisible } from '../server/ratings';
import type { RatingResult } from './types';

export async function submitMealRating(input: {
    date: string;
    session: string;
    food: number;
    cook?: number | null;
    comment?: string;
}): Promise<RatingResult> {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'auth' };
    return recordRating(user, input && typeof input === 'object' ? input : {}, 'submitted');
}

export async function skipMealRating(date: string, session: string): Promise<RatingResult> {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'auth' };
    return recordRating(user, { date, session }, 'skipped');
}

export async function markRatingFeedbackSeen(upToMs: number): Promise<boolean> {
    const user = await getSessionUser();
    if (!user) return false;
    return markFeedbackSeen(user, upToMs);
}

/** Owner only: whether names are shown next to ratings and comments. */
export async function setRatingNamesVisible(visible: boolean): Promise<boolean> {
    const user = await getSessionUser();
    if (!user) return false;
    return setNamesVisible(user, visible);
}
