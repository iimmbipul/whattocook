/**
 * Meal rating rules shared by the server and the browser.
 *
 * Two different people are rated after each session:
 *   - the cook, for every dish they cooked (a hired cook; in a household with
 *     no hired cook, the flatmate on duty cooks, so their dishes are theirs);
 *   - the chef, the flatmate on duty for the session, for how they managed it
 *     and how creative the menu was.
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

/** One dish per slot: the meal plan has one item for each. */
export type MealSlot = 'breakfast' | 'lunch' | 'dinner';
export const SESSION_SLOTS: Record<RatingSession, readonly MealSlot[]> = {
    breakfastLunch: ['breakfast', 'lunch'],
    dinner: ['dinner'],
};

export function isMealSlot(value: unknown): value is MealSlot {
    return value === 'breakfast' || value === 'lunch' || value === 'dinner';
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
/** Newest notes kept on a session summary. */
export const MAX_COMMENTS_PER_SESSION = 20;
/** Weeks of trend data kept per person. */
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

/** Members are eating unless they marked Skip for that meal. */
export function attendedSlot(attendance: Attendance, slot: MealSlot): boolean {
    return attendance?.[slot] !== false;
}

/** Breakfast + Lunch counts if they ate either meal. */
export function attendedSession(attendance: Attendance, session: RatingSession): boolean {
    return SESSION_SLOTS[session].some(slot => attendedSlot(attendance, slot));
}

export function isStars(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Trimmed single-line comment, control characters removed, at most MAX_COMMENT_LENGTH characters. */
export function cleanComment(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT_LENGTH);
}

/** Who can be rated for one session, from one member's point of view. */
export interface RatingTargets {
    /** Dishes this member ate, one per slot, in meal order. */
    dishes: { slot: MealSlot; name: string }[];
    /** Who gets the dish ratings: the hired cooks, or the chef when there is none. Empty: dishes aren't rated. */
    cookUids: string[];
    /** The flatmate on duty, rated for managing the meal. Null when there is nobody else to rate. */
    chefUid: string | null;
}

/**
 * Works out what `raterUid` can rate for a session. Nobody rates their own
 * work: the chef can rate the hired cook's dishes but not their own duty, and
 * in a household without a hired cook the chef cooked, so they rate nothing.
 * Skipped meals aren't rated, and nothing is rated when no dish was planned.
 */
export function ratingTargets({
    session,
    dishNames,
    attendance,
    chefUid,
    hiredCookUids,
    raterUid,
}: {
    session: RatingSession;
    dishNames: Partial<Record<MealSlot, string>>;
    attendance: Attendance;
    chefUid: string | null;
    hiredCookUids: string[];
    raterUid: string;
}): RatingTargets {
    const dishes = SESSION_SLOTS[session]
        .map(slot => ({ slot, name: (dishNames[slot] ?? '').trim() }))
        .filter(d => d.name && attendedSlot(attendance, d.slot));
    if (dishes.length === 0) return { dishes: [], cookUids: [], chefUid: null };

    // A hired cook put on the rotation by mistake is still the cook, not a chef.
    const chef = chefUid && !hiredCookUids.includes(chefUid) ? chefUid : null;
    const cookUids = (hiredCookUids.length > 0 ? hiredCookUids : chef ? [chef] : []).filter(uid => uid !== raterUid);
    return {
        dishes: cookUids.length > 0 ? dishes : [],
        cookUids,
        chefUid: chef && chef !== raterUid ? chef : null,
    };
}

export interface RatingInput {
    dishes: { slot: MealSlot; stars: number }[];
    chef: number | null;
    cookNote: string;
    chefNote: string;
}

/**
 * Checks what the browser sent against what this member may rate. Every
 * score is optional, but at least one must be given; notes go only to people
 * who were rated.
 */
export function parseRatingInput(
    input: { dishes?: unknown; chef?: unknown; cookNote?: unknown; chefNote?: unknown },
    targets: RatingTargets,
): RatingInput | null {
    const allowed = new Set(targets.dishes.map(d => d.slot));
    const dishes: RatingInput['dishes'] = [];
    if (input.dishes !== undefined && input.dishes !== null) {
        if (!Array.isArray(input.dishes) || input.dishes.length > 3) return null;
        for (const d of input.dishes as { slot?: unknown; stars?: unknown }[]) {
            if (!d || !isMealSlot(d.slot) || !allowed.has(d.slot) || !isStars(d.stars)) return null;
            if (dishes.some(x => x.slot === d.slot)) return null;
            dishes.push({ slot: d.slot, stars: d.stars });
        }
    }
    let chef: number | null = null;
    if (input.chef !== undefined && input.chef !== null) {
        if (!targets.chefUid || !isStars(input.chef)) return null;
        chef = input.chef;
    }
    if (dishes.length === 0 && chef === null) return null;
    return {
        dishes,
        chef,
        cookNote: dishes.length > 0 ? cleanComment(input.cookNote) : '',
        chefNote: chef !== null ? cleanComment(input.chefNote) : '',
    };
}

/** Running totals for an average and its 1–5 breakdown. Skipped ratings never reach these. */
export interface ScoreTotals {
    count: number;
    sum: number;
    /** hist[0] = number of 1-star ratings … hist[4] = 5-star. */
    hist: number[];
}

export function emptyScore(): ScoreTotals {
    return { count: 0, sum: 0, hist: [0, 0, 0, 0, 0] };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Read totals from a stored document defensively. */
export function readScore(data: unknown): ScoreTotals {
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
        count: num(d.count),
        sum: num(d.sum),
        hist: Array.from({ length: 5 }, (_, i) => num(Array.isArray(d.hist) ? d.hist[i] : 0)),
    };
}

export function addScore(totals: ScoreTotals, ...stars: number[]): ScoreTotals {
    const hist = [...totals.hist];
    for (const s of stars) hist[s - 1] += 1;
    return { count: totals.count + stars.length, sum: totals.sum + stars.reduce((a, b) => a + b, 0), hist };
}

export function mergeScores(a: ScoreTotals, b: ScoreTotals): ScoreTotals {
    return { count: a.count + b.count, sum: a.sum + b.sum, hist: a.hist.map((n, i) => n + b.hist[i]) };
}

/** Average to one decimal place, or null when nothing was submitted (never counted as zero). */
export function average(sum: number, count: number): number | null {
    return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

export const scoreAverage = (t: ScoreTotals) => average(t.sum, t.count);

/** Weekly totals for the trend chart, keyed by the week's Monday. */
export type WeeklyScores = Record<string, { count: number; sum: number }>;

export function addToWeeks(weeks: WeeklyScores, date: string, stars: number[], keep: number = TREND_WEEKS): WeeklyScores {
    const key = weekStart(date);
    const prev = weeks[key] ?? { count: 0, sum: 0 };
    const next: WeeklyScores = {
        ...weeks,
        [key]: { count: prev.count + stars.length, sum: prev.sum + stars.reduce((a, b) => a + b, 0) },
    };
    const recent = Object.keys(next).sort().slice(-keep);
    return Object.fromEntries(recent.map(k => [k, next[k]]));
}

export interface TrendPoint {
    /** Monday of the week. */
    week: string;
    count: number;
    average: number | null;
}

/** The last `weeks` weeks up to the one containing `today`, oldest first; empty weeks have null averages. */
export function trendSeries(weekly: WeeklyScores, today: string, weeks: number = TREND_WEEKS): TrendPoint[] {
    const current = weekStart(today);
    return Array.from({ length: weeks }, (_, i) => {
        const week = addDays(current, -7 * (weeks - 1 - i));
        const w = weekly[week];
        return { week, count: w?.count ?? 0, average: w ? average(w.sum, w.count) : null };
    });
}

/** A written note as stored on a session summary. `by` is shown only when the household allows names. */
export interface StoredComment {
    text: string;
    by: string;
    at: number;
    /** The writer's score: their chef rating, or their dish rating when they rated one dish. */
    stars: number | null;
}

export function addComment(list: StoredComment[], comment: StoredComment): StoredComment[] {
    return [...list, comment].slice(-MAX_COMMENTS_PER_SESSION);
}

/** Groups the same dish across sessions, whatever its capitalisation. */
export const dishKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface DishAverage {
    name: string;
    average: number | null;
    count: number;
    /** Sessions the dish was served and rated in. */
    times: number;
}

/** Each dish's average over the given sessions, best first; ties go to the dish rated more often. */
export function dishAverages(entries: { name: string; count: number; sum: number }[]): DishAverage[] {
    const byDish = new Map<string, { name: string; count: number; sum: number; times: number }>();
    for (const e of entries) {
        if (!e.name || e.count <= 0) continue;
        const key = dishKey(e.name);
        const prev = byDish.get(key) ?? { name: e.name.trim(), count: 0, sum: 0, times: 0 };
        byDish.set(key, { name: prev.name, count: prev.count + e.count, sum: prev.sum + e.sum, times: prev.times + 1 });
    }
    return [...byDish.values()]
        .map(d => ({ name: d.name, average: average(d.sum, d.count), count: d.count, times: d.times }))
        .sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || b.count - a.count || a.name.localeCompare(b.name));
}
