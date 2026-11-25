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
import type { MealSlot } from './logic';
import type { RatingResult, RatingRole } from './types';

/** Dish ratings go to whoever cooked; the chef rating goes to the flatmate on duty. Every score is optional, but one is needed. */
export async function submitMealRating(input: {
    date: string;
    session: string;
    dishes: { slot: MealSlot; stars: number }[];
    chef?: number | null;
    cookNote?: string;
    chefNote?: string;
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

export async function markRatingFeedbackSeen(upTo: Partial<Record<RatingRole, number>>): Promise<boolean> {
    const user = await getSessionUser();
    if (!user) return false;
    return markFeedbackSeen(user, upTo);
}

/** Owner only: whether names are shown next to ratings and comments. */
export async function setRatingNamesVisible(visible: boolean): Promise<boolean> {
    const user = await getSessionUser();
    if (!user) return false;
    return setNamesVisible(user, visible);
}
