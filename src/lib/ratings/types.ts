import type { RatingSession, TrendPoint } from './logic';

/** A session the signed-in member can still rate. */
export interface PendingRating {
    date: string;
    session: RatingSession;
    /** Dish names for the session (breakfast and lunch, or dinner). */
    dishes: string[];
    /** Who cooked: a name, '' when the name is unknown, null when nobody is assigned (food rating only). */
    cookName: string | null;
}

export interface FeedbackComment {
    text: string;
    food: number;
    cook: number | null;
    /** Only present when the household chose to show names with ratings. */
    name?: string;
}

/** Averages for one Breakfast + Lunch or Dinner session. */
export interface SessionSummary {
    date: string;
    session: RatingSession;
    dishes: string[];
    /** Members who submitted a rating (skips are not counted). */
    count: number;
    food: number | null;
    cook: number | null;
    comments: FeedbackComment[];
}

/** New feedback for the signed-in cook since they last looked. */
export interface CookFeedback {
    /** Pass back to markRatingFeedbackSeen when the summary is dismissed. */
    upToMs: number;
    totals: { count: number; food: number | null; cook: number | null };
    sessions: SessionSummary[];
}

/** GET /api/ratings */
export interface RatingsStatus {
    /** Today in the household's time zone (YYYY-MM-DD). */
    today: string;
    /** Whether the household shows names next to ratings (so the prompt can say so). */
    namesVisible: boolean;
    pending: PendingRating[];
    feedback: CookFeedback | null;
}

/** GET /api/ratings/summary: the cook's own "My Ratings" dashboard. */
export interface RatingsDashboard {
    today: string;
    namesVisible: boolean;
    hasRatings: boolean;
    totals: {
        count: number;
        sessionCount: number;
        food: number | null;
        cook: number | null;
        foodHist: number[];
        cookHist: number[];
    };
    trend: TrendPoint[];
    history: Omit<SessionSummary, 'comments'>[];
    feedback: (FeedbackComment & { date: string; session: RatingSession })[];
}

export type RatingError = 'auth' | 'invalid' | 'closed' | 'not-eligible' | 'duplicate' | 'failed';
export type RatingResult = { ok: true } | { ok: false; error: RatingError };
