import 'server-only';

import { FieldValue, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore';
import type { MealDocument, User } from '@/types/meal';
import { adminFirestore } from './firebaseAdmin';
import { COOKS_COLLECTION, MEMBERS_COLLECTION, USERS_COLLECTION } from './currentUser';
import { isSafeDocId } from './guards';
import {
    addComment,
    addRating,
    addToWeeks,
    attendedSession,
    averages,
    cleanComment,
    emptyTotals,
    isIsoDate,
    isRatingSession,
    isSessionOpen,
    isStars,
    localTime,
    mergeTotals,
    openSessions,
    ratingDocId,
    readTotals,
    sessionKey,
    trendSeries,
    type RatingSession,
    type RatingTotals,
    type StoredComment,
    type WeeklyTotals,
} from '../ratings/logic';
import type {
    CookFeedback,
    FeedbackComment,
    PendingRating,
    RatingResult,
    RatingsDashboard,
    RatingsStatus,
    SessionSummary,
} from '../ratings/types';

/*
 * Data model (all under the household, so nothing crosses households):
 *
 *   households/{hid}/meal_ratings/{date}_{session}_{uid}
 *       One per member per session, submitted or skipped. The document ID is
 *       what makes a second rating impossible.
 *   households/{hid}/cook_ratings/{cookUid}
 *       The cook's running totals, 1–5 breakdowns, weekly trend and seenAtMs
 *       (when they last dismissed the feedback summary).
 *   households/{hid}/cook_ratings/{cookUid}/sessions/{date}_{session}
 *       Per-session averages and the latest comments, for history and feedback.
 *
 * Totals are updated in the same transaction that creates the rating, so the
 * dashboard reads one document plus one page of sessions. Skipped ratings are
 * stored (so the prompt never returns) but never touch the totals.
 *
 * "Cook" is the person on duty for the slot (responsibility.breakfastLunchId /
 * dinnerId). With nobody on duty, a household's only hired cook gets the
 * rating; otherwise members rate the food alone.
 */

const TEMPLATES_COLLECTION = 'menu_templates';
type Fs = ReturnType<typeof adminFirestore>;

const ratingPath = (hid: string, date: string, session: RatingSession, uid: string) =>
    `households/${hid}/meal_ratings/${ratingDocId(date, session, uid)}`;
const cookStatsPath = (hid: string, cookUid: string) => `households/${hid}/cook_ratings/${cookUid}`;
const cookSessionsPath = (hid: string, cookUid: string) => `${cookStatsPath(hid, cookUid)}/sessions`;

const canRate = (user: User) => user.role === 'user' || user.role === 'member';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * The meal for each date, resolved the same way the dashboard does
 * (lookupMealByDate in firestore.ts): the dated household doc, then the
 * household's day-of-month doc, then the master menu. One round trip.
 */
async function findMeals(fs: Fs, hid: string, dates: string[]): Promise<Map<string, MealDocument | null>> {
    const plans = [...new Set(dates)].map(date => {
        const day = date.slice(8, 10);
        const unpadded = String(Number(day));
        const ids = unpadded === day ? [day] : [day, unpadded];
        return {
            date,
            paths: [
                `households/${hid}/meals/${date}`,
                ...ids.map(id => `households/${hid}/meals/${id}`),
                ...ids.map(id => `${TEMPLATES_COLLECTION}/${id}`),
            ],
        };
    });
    const refs = plans.flatMap(p => p.paths.map(path => fs.doc(path)));
    const snaps = refs.length > 0 ? await fs.getAll(...refs) : [];
    const byPath = new Map(snaps.map(s => [s.ref.path, s]));
    return new Map(
        plans.map(p => {
            const hit = p.paths.map(path => byPath.get(path)).find(s => s?.exists);
            return [p.date, hit ? (hit.data() as MealDocument) : null];
        }),
    );
}

function dishesFor(meal: MealDocument, session: RatingSession): string[] {
    const items = session === 'dinner' ? [meal.dinner] : [meal.breakfast, meal.lunch];
    return items
        .map(item => (typeof item?.item_name === 'string' ? item.item_name.trim().slice(0, 80) : ''))
        .filter(name => name && name !== 'Not Set');
}

function chefFor(meal: MealDocument, session: RatingSession): string | null {
    const id = session === 'dinner' ? meal.responsibility?.dinnerId : meal.responsibility?.breakfastLunchId;
    return isSafeDocId(id) ? id : null;
}

async function soleHiredCook(fs: Fs, hid: string): Promise<string | null> {
    const snap = await fs.collection(COOKS_COLLECTION).where('linkedUserId', '==', hid).limit(2).get();
    return snap.size === 1 ? snap.docs[0].id : null;
}

/** Display names for household accounts, as getAllHouseholdMembers labels them. */
async function labelsFor(fs: Fs, uids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(uids.filter(isSafeDocId))];
    if (unique.length === 0) return new Map();
    const collections = [USERS_COLLECTION, MEMBERS_COLLECTION, COOKS_COLLECTION];
    const snaps = await fs.getAll(...unique.flatMap(uid => collections.map(c => fs.doc(`${c}/${uid}`))));
    const labels = new Map<string, string>();
    for (const snap of snaps) {
        if (!snap.exists || labels.has(snap.id)) continue;
        const data = snap.data() ?? {};
        const name = typeof data.displayName === 'string' ? data.displayName.trim() : '';
        labels.set(snap.id, name || String(data.email ?? '').split('@')[0]);
    }
    return labels;
}

async function namesVisible(fs: Fs, hid: string): Promise<boolean> {
    const snap = await fs.doc(`${USERS_COLLECTION}/${hid}`).get();
    return snap.data()?.ratingNamesVisible === true;
}

function readWeeks(value: unknown): WeeklyTotals {
    if (!value || typeof value !== 'object') return {};
    const out: WeeklyTotals = {};
    for (const [week, w] of Object.entries(value as Record<string, Record<string, unknown>>)) {
        if (!isIsoDate(week) || !w || typeof w !== 'object') continue;
        out[week] = { count: num(w.count), foodSum: num(w.foodSum), cookCount: num(w.cookCount), cookSum: num(w.cookSum) };
    }
    return out;
}

function readComments(value: unknown): StoredComment[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (c): c is StoredComment => !!c && typeof c.text === 'string' && typeof c.by === 'string' && isStars(c.food),
    );
}

function toFeedback(c: StoredComment, labels: Map<string, string> | null): FeedbackComment {
    const out: FeedbackComment = { text: c.text, food: c.food, cook: isStars(c.cook) ? c.cook : null };
    const name = labels?.get(c.by);
    if (name) out.name = name;
    return out;
}

function toSummary(data: DocumentData, labels: Map<string, string> | null): SessionSummary & { totals: RatingTotals } {
    const totals = readTotals(data);
    const avg = averages(totals);
    return {
        date: String(data.date),
        session: isRatingSession(data.session) ? data.session : 'dinner',
        dishes: Array.isArray(data.dishes) ? data.dishes.filter((d: unknown) => typeof d === 'string') : [],
        count: totals.count,
        food: avg.food,
        cook: avg.cook,
        comments: readComments(data.comments).reverse().map(c => toFeedback(c, labels)),
        totals,
    };
}

/** Newest first; on the same day Dinner comes before Breakfast + Lunch. */
const newestFirst = (a: { date: string; session: RatingSession }, b: { date: string; session: RatingSession }) =>
    b.date.localeCompare(a.date) || (a.session === b.session ? 0 : a.session === 'dinner' ? -1 : 1);

/** Sessions the member can still rate right now, oldest first. */
export async function getPendingRatings(user: User, now: Date = new Date()): Promise<PendingRating[]> {
    if (!canRate(user) || !isSafeDocId(user.uid) || !isSafeDocId(user.householdId)) return [];
    const fs = adminFirestore();
    const hid = user.householdId;
    const open = openSessions(now);
    const meals = await findMeals(fs, hid, open.map(s => s.date));

    const candidates = open.flatMap(s => {
        const meal = meals.get(s.date);
        if (!meal) return [];
        const dishes = dishesFor(meal, s.session);
        const chef = chefFor(meal, s.session);
        // You don't rate your own cooking, or a meal you skipped.
        if (dishes.length === 0 || chef === user.uid || !attendedSession(meal.attendance?.[user.uid], s.session)) return [];
        return [{ ...s, dishes, chef }];
    });
    if (candidates.length === 0) return [];

    const existing = await fs.getAll(...candidates.map(c => fs.doc(ratingPath(hid, c.date, c.session, user.uid))));
    const remaining = candidates.filter((_, i) => !existing[i].exists);
    if (remaining.length === 0) return [];

    const fallback = remaining.some(c => !c.chef) ? await soleHiredCook(fs, hid) : null;
    const cookUids = remaining.map(c => c.chef ?? fallback);
    const labels = await labelsFor(fs, cookUids.filter((u): u is string => !!u));
    return remaining.map((c, i) => {
        const cookUid = cookUids[i];
        return { date: c.date, session: c.session, dishes: c.dishes, cookName: cookUid ? labels.get(cookUid) ?? '' : null };
    });
}

/**
 * Record a member's rating or skip for one session. Validates everything the
 * browser sends; a second rating for the same session is refused.
 */
export async function recordRating(
    user: User,
    input: { date?: unknown; session?: unknown; food?: unknown; cook?: unknown; comment?: unknown },
    status: 'submitted' | 'skipped',
    now: Date = new Date(),
): Promise<RatingResult> {
    if (!canRate(user) || !isSafeDocId(user.uid) || !isSafeDocId(user.householdId)) return { ok: false, error: 'not-eligible' };
    const { date, session } = input;
    if (!isIsoDate(date) || !isRatingSession(session)) return { ok: false, error: 'invalid' };
    if (!isSessionOpen(date, session, now)) return { ok: false, error: 'closed' };

    let food: number | null = null;
    let cook: number | null = null;
    let comment = '';
    if (status === 'submitted') {
        if (!isStars(input.food)) return { ok: false, error: 'invalid' };
        food = input.food;
        if (input.cook !== undefined && input.cook !== null) {
            if (!isStars(input.cook)) return { ok: false, error: 'invalid' };
            cook = input.cook;
        }
        comment = cleanComment(input.comment);
    }

    const fs = adminFirestore();
    const hid = user.householdId;
    const meal = (await findMeals(fs, hid, [date])).get(date);
    if (!meal) return { ok: false, error: 'not-eligible' };
    const dishes = dishesFor(meal, session);
    const chef = chefFor(meal, session);
    if (dishes.length === 0 || chef === user.uid || !attendedSession(meal.attendance?.[user.uid], session)) {
        return { ok: false, error: 'not-eligible' };
    }
    const cookUid = chef ?? (await soleHiredCook(fs, hid));
    if (!cookUid) cook = null;
    const nowMs = now.getTime();

    const ratingRef = fs.doc(ratingPath(hid, date, session, user.uid));
    const aggregate = status === 'submitted' && food !== null;
    const statsRef = aggregate && cookUid ? fs.doc(cookStatsPath(hid, cookUid)) : null;
    const sessionRef = aggregate && cookUid ? fs.doc(`${cookSessionsPath(hid, cookUid)}/${sessionKey(date, session)}`) : null;

    try {
        const outcome = await fs.runTransaction(async tx => {
            const snaps: DocumentSnapshot[] = statsRef && sessionRef
                ? await tx.getAll(ratingRef, statsRef, sessionRef)
                : await tx.getAll(ratingRef);
            if (snaps[0].exists) return 'duplicate' as const;

            tx.create(ratingRef, {
                date,
                session,
                raterUid: user.uid,
                status,
                food,
                cook,
                comment: comment || null,
                cookUid,
                createdAt: FieldValue.serverTimestamp(),
                createdAtMs: nowMs,
            });

            if (statsRef && sessionRef && food !== null && cookUid) {
                const stats = snaps[1].data() ?? {};
                const sessionData = snaps[2].data() ?? {};
                tx.set(statsRef, {
                    ...addRating(readTotals(stats), food, cook),
                    cookUid,
                    sessionCount: num(stats.sessionCount) + (snaps[2].exists ? 0 : 1),
                    weeks: addToWeeks(readWeeks(stats.weeks), date, food, cook),
                    lastRatedAtMs: nowMs,
                    seenAtMs: num(stats.seenAtMs),
                });
                const comments = readComments(sessionData.comments);
                tx.set(sessionRef, {
                    ...addRating(readTotals(sessionData), food, cook),
                    date,
                    session,
                    dishes,
                    comments: comment ? addComment(comments, { text: comment, by: user.uid, at: nowMs, food, cook }) : comments,
                    updatedAtMs: nowMs,
                });
            }
            return 'ok' as const;
        });
        return outcome === 'ok' ? { ok: true } : { ok: false, error: 'duplicate' };
    } catch (err) {
        // 6 = ALREADY_EXISTS: another device saved this rating first.
        if ((err as { code?: number }).code === 6) return { ok: false, error: 'duplicate' };
        console.error('[ratings] recordRating failed:', err);
        return { ok: false, error: 'failed' };
    }
}

/** Ratings the signed-in cook hasn't seen yet, consolidated into one summary. */
export async function getCookFeedback(user: User): Promise<CookFeedback | null> {
    if (!isSafeDocId(user.uid) || !isSafeDocId(user.householdId)) return null;
    const fs = adminFirestore();
    const hid = user.householdId;
    const statsSnap = await fs.doc(cookStatsPath(hid, user.uid)).get();
    if (!statsSnap.exists) return null;
    const seenAt = num(statsSnap.data()?.seenAtMs);

    const [snap, showNames] = await Promise.all([
        fs.collection(cookSessionsPath(hid, user.uid)).where('updatedAtMs', '>', seenAt).orderBy('updatedAtMs', 'desc').limit(20).get(),
        namesVisible(fs, hid),
    ]);
    if (snap.empty) return null;

    const labels = showNames
        ? await labelsFor(fs, snap.docs.flatMap(d => readComments(d.data().comments).map(c => c.by)))
        : null;
    const summaries = snap.docs.map(d => toSummary(d.data(), labels)).sort(newestFirst);
    const totals = summaries.reduce((acc, s) => mergeTotals(acc, s.totals), emptyTotals());
    const avg = averages(totals);
    return {
        upToMs: Math.max(...snap.docs.map(d => num(d.data().updatedAtMs))),
        totals: { count: totals.count, food: avg.food, cook: avg.cook },
        sessions: summaries.map(s => ({ date: s.date, session: s.session, dishes: s.dishes, count: s.count, food: s.food, cook: s.cook, comments: s.comments })),
    };
}

/** Everything the app checks on open: ratings to give and feedback received. */
export async function getRatingsStatus(user: User, now: Date = new Date()): Promise<RatingsStatus> {
    const [pending, feedback] = await Promise.all([getPendingRatings(user, now), getCookFeedback(user)]);
    const showNames = pending.length > 0 && isSafeDocId(user.householdId) ? await namesVisible(adminFirestore(), user.householdId) : false;
    return { today: localTime(now).date, namesVisible: showNames, pending, feedback };
}

/** Called when the cook dismisses the summary: only newer ratings will show next time. */
export async function markFeedbackSeen(user: User, upToMs: unknown): Promise<boolean> {
    if (!isSafeDocId(user.uid) || !isSafeDocId(user.householdId)) return false;
    const at = Math.min(num(upToMs), Date.now());
    const fs = adminFirestore();
    const ref = fs.doc(cookStatsPath(user.householdId, user.uid));
    try {
        await fs.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (snap.exists && at > num(snap.data()?.seenAtMs)) tx.update(ref, { seenAtMs: at });
        });
        return true;
    } catch (err) {
        console.error('[ratings] markFeedbackSeen failed:', err);
        return false;
    }
}

/** The signed-in cook's own rating history for the profile page. */
export async function getRatingsDashboard(user: User, now: Date = new Date()): Promise<RatingsDashboard> {
    const today = localTime(now).date;
    const empty: RatingsDashboard = {
        today,
        namesVisible: false,
        hasRatings: false,
        totals: { count: 0, sessionCount: 0, food: null, cook: null, foodHist: [0, 0, 0, 0, 0], cookHist: [0, 0, 0, 0, 0] },
        trend: trendSeries({}, today),
        history: [],
        feedback: [],
    };
    if (!isSafeDocId(user.uid) || !isSafeDocId(user.householdId)) return empty;

    const fs = adminFirestore();
    const hid = user.householdId;
    const [statsSnap, sessionsSnap, showNames] = await Promise.all([
        fs.doc(cookStatsPath(hid, user.uid)).get(),
        fs.collection(cookSessionsPath(hid, user.uid)).orderBy('date', 'desc').limit(30).get(),
        namesVisible(fs, hid),
    ]);
    const stats = statsSnap.data() ?? {};
    const totals = readTotals(stats);
    if (!statsSnap.exists || totals.count === 0) return { ...empty, namesVisible: showNames };

    const labels = showNames
        ? await labelsFor(fs, sessionsSnap.docs.flatMap(d => readComments(d.data().comments).map(c => c.by)))
        : null;
    const sessions = sessionsSnap.docs.map(d => ({ summary: toSummary(d.data(), labels), raw: d.data() })).sort((a, b) => newestFirst(a.summary, b.summary));
    const avg = averages(totals);
    const feedback = sessions
        .flatMap(({ summary, raw }) => readComments(raw.comments).map(c => ({ c, summary })))
        .sort((a, b) => b.c.at - a.c.at)
        .slice(0, 10)
        .map(({ c, summary }) => ({ ...toFeedback(c, labels), date: summary.date, session: summary.session }));

    return {
        today,
        namesVisible: showNames,
        hasRatings: true,
        totals: { count: totals.count, sessionCount: num(stats.sessionCount), food: avg.food, cook: avg.cook, foodHist: totals.foodHist, cookHist: totals.cookHist },
        trend: trendSeries(readWeeks(stats.weeks), today),
        history: sessions.map(({ summary: s }) => ({ date: s.date, session: s.session, dishes: s.dishes, count: s.count, food: s.food, cook: s.cook })),
        feedback,
    };
}

/** Owner setting: show who wrote each rating (off by default: ratings are anonymous). */
export async function setNamesVisible(user: User, visible: unknown): Promise<boolean> {
    if (user.role !== 'user' || !isSafeDocId(user.uid)) return false;
    try {
        await adminFirestore().doc(`${USERS_COLLECTION}/${user.uid}`).update({ ratingNamesVisible: visible === true });
        return true;
    } catch (err) {
        console.error('[ratings] setNamesVisible failed:', err);
        return false;
    }
}
