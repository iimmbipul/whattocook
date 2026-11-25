import type { DishAverage, MealSlot, RatingSession, TrendPoint } from './logic';

/**
 * Who a rating is for:
 *   cook: the person who cooked, rated per dish (a hired cook, or the chef in
 *         a household without one);
 *   chef: the flatmate on duty, rated for managing the meal and the menu.
 */
export type RatingRole = 'cook' | 'chef';

/** A session the signed-in member can still rate. */
export interface PendingRating {
    date: string;
    session: RatingSession;
    /** Dishes to rate for the cook, in meal order. Empty when the dishes aren't rated by this member. */
    dishes: { slot: MealSlot; name: string }[];
    /** Who cooked: the hired cooks' names ('' when unknown). */
    cookNames: string[];
    /** The chef on duty, rated for managing the meal. Null when this member doesn't rate them. */
    chef: { name: string } | null;
    /** No hired cook: the chef also cooked, so the dish ratings go to them too. */
    chefCooked: boolean;
}

export interface FeedbackComment {
    text: string;
    /** The writer's chef rating, or their dish rating when they rated one dish. */
    stars: number | null;
    /** Only present when the household chose to show names with ratings. */
    name?: string;
}

export interface DishScore {
    slot: MealSlot;
    name: string;
    count: number;
    average: number | null;
}

/** Ratings for one Breakfast + Lunch or Dinner session, for one cook or chef. */
export interface SessionSummary {
    date: string;
    session: RatingSession;
    /** The session's dishes. */
    menu: string[];
    /** Cook only: each dish's own score. */
    dishScores: DishScore[];
    /** Scores given: one per dish rated for a cook, one per member for a chef. */
    count: number;
    average: number | null;
    comments: FeedbackComment[];
}

/** New ratings for one role since the person last looked. */
export interface RoleFeedback {
    /** Pass back to markRatingFeedbackSeen when the summary is dismissed. */
    upToMs: number;
    count: number;
    average: number | null;
    sessions: SessionSummary[];
}

export interface NewFeedback {
    cook: RoleFeedback | null;
    chef: RoleFeedback | null;
}

/** GET /api/ratings */
export interface RatingsStatus {
    /** Today in the household's time zone (YYYY-MM-DD). */
    today: string;
    /** Whether the household shows names next to ratings (so the prompt can say so). */
    namesVisible: boolean;
    pending: PendingRating[];
    feedback: NewFeedback | null;
}

export interface RoleDashboard {
    hasRatings: boolean;
    count: number;
    sessionCount: number;
    average: number | null;
    /** hist[0] = 1-star ratings … hist[4] = 5-star. */
    hist: number[];
    trend: TrendPoint[];
    history: Omit<SessionSummary, 'comments'>[];
    comments: (FeedbackComment & { date: string; session: RatingSession })[];
    /** Cook only: each dish's average over recent sessions, best first. */
    dishes: DishAverage[];
}

/** GET /api/ratings/summary: the signed-in person's own ratings, by role. */
export interface RatingsDashboard {
    today: string;
    namesVisible: boolean;
    /** Ratings for their cooking. Always present for a hired cook; for a flatmate only once they have some. */
    cook: RoleDashboard | null;
    /** Ratings for their chef duties. Present for every flatmate, never for a hired cook. */
    chef: RoleDashboard | null;
}

export type RatingError = 'auth' | 'invalid' | 'closed' | 'not-eligible' | 'duplicate' | 'failed';
export type RatingResult = { ok: true } | { ok: false; error: RatingError };
