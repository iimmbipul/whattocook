/**
 * Meal rating rules shared by the server and the browser.
 *
 * Pure functions with no imports, so they can be unit-tested directly with
 * `node --test` (see tests/ratings.test.mjs). Firestore access lives in
 * src/lib/server/ratings.ts.
 */

/** Ratings follow cooking duties: Breakfast + Lunch share one chef, Dinner has its own. */
export type RatingSession = 'breakfastLunch' | 'dinner';
export const RATING_SESSIONS: readonly RatingSession[] = ['breakfastLunch', 'dinner'];

export function isRatingSession(value: unknown): value is RatingSession {
    return value === 'breakfastLunch' || value === 'dinner';
}

/**
 * The household's wall-clock time zone. Meal dates and session boundaries are
 * always worked out here, never in the viewer's device time zone, so a member
 * travelling abroad rates the same sessions as everyone at home.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** Local time (minutes after midnight) when each session opens for rating: after lunch, after dinner. */
export const SESSION_OPENS_AT: Record<RatingSession, number> = {
    breakfastLunch: 14 * 60,
    dinner: 21 * 60,
};

/** A session can be rated for this long after it opens; then the prompt quietly expires. */
export const RATING_WINDOW_MINUTES = 24 * 60;

export const MAX_COMMENT_LENGTH = 300;
/** Newest comments kept on a session summary. */
export const MAX_COMMENTS_PER_SESSION = 20;
/** Weeks of trend data kept per cook. */
export const TREND_WEEKS = 12;

export interface LocalTime {
    /** YYYY-MM-DD in the household's time zone. */
    date: string;
    /** Minutes after local midnight. */
    minutes: number;
}

export function localTime(now: Date, timeZone: string = DEFAULT_TIME_ZONE): LocalTime {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        minutes: Number(get('hour')) * 60 + Number(get('minute')),
    };
}

export function isIsoDate(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Calendar arithmetic on YYYY-MM-DD strings (no time zone involved). */
export function addDays(date: string, days: number): string {
    const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
    return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    return addDays(date, -((day + 6) % 7));
}

export interface SessionRef {
    date: string;
    session: RatingSession;
}

/**
 * Sessions that can be rated at `now`, oldest first. A session opens at its
 * SESSION_OPENS_AT local time and stays open for RATING_WINDOW_MINUTES, so at
 * 10:00 the open ones are yesterday's Breakfast + Lunch and Dinner, and at
 * 15:00 they are yesterday's Dinner and today's Breakfast + Lunch.
 */
export function openSessions(now: Date, timeZone: string = DEFAULT_TIME_ZONE): SessionRef[] {
    const { date: today, minutes } = localTime(now, timeZone);
    const open: SessionRef[] = [];
    for (const daysBack of [1, 0]) {
        const date = addDays(today, -daysBack);
        for (const session of RATING_SESSIONS) {
            const minutesSinceOpen = daysBack * 1440 + minutes - SESSION_OPENS_AT[session];
            if (minutesSinceOpen >= 0 && minutesSinceOpen < RATING_WINDOW_MINUTES) open.push({ date, session });
        }
    }
    return open;
}

export function isSessionOpen(date: string, session: RatingSession, now: Date, timeZone: string = DEFAULT_TIME_ZONE): boolean {
    return openSessions(now, timeZone).some(s => s.date === date && s.session === session);
}

export const sessionKey = (date: string, session: RatingSession) => `${date}_${session}`;
/** One document per member per session: the ID itself prevents duplicate ratings. */
export const ratingDocId = (date: string, session: RatingSession, uid: string) => `${date}_${session}_${uid}`;

export type Attendance = { breakfast?: boolean; lunch?: boolean; dinner?: boolean } | undefined;

/** Members are eating unless they marked Skip. Breakfast + Lunch counts if they ate either meal. */
export function attendedSession(attendance: Attendance, session: RatingSession): boolean {
    if (session === 'dinner') return attendance?.dinner !== false;
    return attendance?.breakfast !== false || attendance?.lunch !== false;
}

export function isStars(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Trimmed single-line comment, control characters removed, at most MAX_COMMENT_LENGTH characters. */
export function cleanComment(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT_LENGTH);
}

/** Running totals for averages and the 1–5 breakdown. Skipped ratings never reach these. */
export interface RatingTotals {
    /** Submitted ratings (every one has a food score). */
    count: number;
    foodSum: number;
    /** foodHist[0] = number of 1-star ratings … foodHist[4] = 5-star. */
    foodHist: number[];
    /** Ratings that included a cook score. */
    cookCount: number;
    cookSum: number;
    cookHist: number[];
}

export function emptyTotals(): RatingTotals {
    return { count: 0, foodSum: 0, foodHist: [0, 0, 0, 0, 0], cookCount: 0, cookSum: 0, cookHist: [0, 0, 0, 0, 0] };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const hist = (v: unknown) => Array.from({ length: 5 }, (_, i) => num(Array.isArray(v) ? v[i] : 0));

/** Read totals from a stored document defensively. */
export function readTotals(data: unknown): RatingTotals {
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
        count: num(d.count),
        foodSum: num(d.foodSum),
        foodHist: hist(d.foodHist),
        cookCount: num(d.cookCount),
        cookSum: num(d.cookSum),
        cookHist: hist(d.cookHist),
    };
}

export function addRating(totals: RatingTotals, food: number, cook: number | null): RatingTotals {
    const foodHist = [...totals.foodHist];
    foodHist[food - 1] += 1;
    const cookHist = [...totals.cookHist];
    if (cook !== null) cookHist[cook - 1] += 1;
    return {
        count: totals.count + 1,
        foodSum: totals.foodSum + food,
        foodHist,
        cookCount: totals.cookCount + (cook !== null ? 1 : 0),
        cookSum: totals.cookSum + (cook ?? 0),
        cookHist,
    };
}

export function mergeTotals(a: RatingTotals, b: RatingTotals): RatingTotals {
    return {
        count: a.count + b.count,
        foodSum: a.foodSum + b.foodSum,
        foodHist: a.foodHist.map((n, i) => n + b.foodHist[i]),
        cookCount: a.cookCount + b.cookCount,
        cookSum: a.cookSum + b.cookSum,
        cookHist: a.cookHist.map((n, i) => n + b.cookHist[i]),
    };
}

/** Average to one decimal place, or null when nothing was submitted (never counted as zero). */
export function average(sum: number, count: number): number | null {
    return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

export function averages(t: RatingTotals): { food: number | null; cook: number | null } {
    return { food: average(t.foodSum, t.count), cook: average(t.cookSum, t.cookCount) };
}

/** Weekly totals for the trend chart, keyed by the week's Monday. */
export type WeeklyTotals = Record<string, { count: number; foodSum: number; cookCount: number; cookSum: number }>;

export function addToWeeks(weeks: WeeklyTotals, date: string, food: number, cook: number | null, keep: number = TREND_WEEKS): WeeklyTotals {
    const key = weekStart(date);
    const prev = weeks[key] ?? { count: 0, foodSum: 0, cookCount: 0, cookSum: 0 };
    const next: WeeklyTotals = {
        ...weeks,
        [key]: {
            count: prev.count + 1,
            foodSum: prev.foodSum + food,
            cookCount: prev.cookCount + (cook !== null ? 1 : 0),
            cookSum: prev.cookSum + (cook ?? 0),
        },
    };
    const recent = Object.keys(next).sort().slice(-keep);
    return Object.fromEntries(recent.map(k => [k, next[k]]));
}

export interface TrendPoint {
    /** Monday of the week. */
    week: string;
    count: number;
    food: number | null;
    cook: number | null;
}

/** The last `weeks` weeks up to the one containing `today`, oldest first; empty weeks have null averages. */
export function trendSeries(weekly: WeeklyTotals, today: string, weeks: number = TREND_WEEKS): TrendPoint[] {
    const current = weekStart(today);
    return Array.from({ length: weeks }, (_, i) => {
        const week = addDays(current, -7 * (weeks - 1 - i));
        const w = weekly[week];
        return {
            week,
            count: w?.count ?? 0,
            food: w ? average(w.foodSum, w.count) : null,
            cook: w ? average(w.cookSum, w.cookCount) : null,
        };
    });
}

/** A written comment as stored on a session summary. `by` is shown only when the household allows names. */
export interface StoredComment {
    text: string;
    by: string;
    at: number;
    food: number;
    cook: number | null;
}

export function addComment(list: StoredComment[], comment: StoredComment): StoredComment[] {
    return [...list, comment].slice(-MAX_COMMENTS_PER_SESSION);
}
