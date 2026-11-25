import 'server-only';

import { FieldValue, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import type { MealDocument, User } from '@/types/meal';
import { adminFirestore } from './firebaseAdmin';
import { COOKS_COLLECTION, MEMBERS_COLLECTION, USERS_COLLECTION } from './currentUser';
import { isSafeDocId } from './guards';
import { findMeals } from './mealLookup';
import {
    addComment,
    addScore,
    addToWeeks,
    dishAverages,
    emptyScore,
    isIsoDate,
    isMealSlot,
    isRatingSession,
    isSessionOpen,
    localTime,
    mergeScores,
    openSessions,
    parseRatingInput,
    ratingDocId,
    ratingTargets,
    readScore,
    scoreAverage,
    SESSION_SLOTS,
    sessionKey,
    trendSeries,
    type MealSlot,
    type RatingSession,
    type RatingTargets,
    type StoredComment,
    type WeeklyScores,
} from '../ratings/logic';
import type {
    DishScore,
    FeedbackComment,
    NewFeedback,
    PendingRating,
    RatingResult,
    RatingRole,
    RatingsDashboard,
    RatingsStatus,
    RoleDashboard,
    RoleFeedback,
    SessionSummary,
} from '../ratings/types';

/*
 * Data model (all under the household, so nothing crosses households):
 *
 *   households/{hid}/meal_ratings/{date}_{session}_{uid}
 *       One per member per session, submitted or skipped. The document ID is
 *       what makes a second rating impossible.
 *   households/{hid}/cook_scores/{uid}
 *       Dish ratings received by whoever cooked: running totals, 1–5
 *       breakdown, weekly trend, and seenAtMs (when they last dismissed the
 *       feedback summary).
 *   households/{hid}/cook_scores/{uid}/sessions/{date}_{session}
 *       Each dish's totals for that session, and the latest notes for the cook.
 *   households/{hid}/chef_scores/{uid}   (+ /sessions/{date}_{session})
 *       The same for the flatmate on duty, rated for managing the meal.
 *
 * Who is who: the chef is responsibility.breakfastLunchId / dinnerId on the
 * day's meal plan. The cooks are the household's hired cooks; with none, the
 * chef cooked, so the dish ratings go to the chef too. ratingTargets() in
 * ../ratings/logic.ts holds these rules.
 *
 * Totals are updated in the same transaction that creates the rating, so the
 * dashboard reads one document plus one page of sessions. Skipped ratings are
 * stored (so the prompt never returns) but never touch the totals.
 */

type Fs = ReturnType<typeof adminFirestore>;

const COLLECTION: Record<RatingRole, string> = { cook: 'cook_scores', chef: 'chef_scores' };
/** Hired cooks credited for a session; a household rarely has more than one or two. */
const MAX_HIRED_COOKS = 4;
/** Sessions read for the dashboard's history and per-dish averages (about a month). */
const DASHBOARD_SESSIONS = 60;
const HISTORY_SESSIONS = 30;

const ratingPath = (hid: string, date: string, session: RatingSession, uid: string) =>
    `households/${hid}/meal_ratings/${ratingDocId(date, session, uid)}`;
const statsPath = (hid: string, role: RatingRole, uid: string) => `households/${hid}/${COLLECTION[role]}/${uid}`;
const sessionsPath = (hid: string, role: RatingRole, uid: string) => `${statsPath(hid, role, uid)}/sessions`;

/** Flatmates rate; hired cooks are only ever rated. */
const canRate = (user: User) => user.role === 'user' || user.role === 'member';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

function dishNamesFor(meal: MealDocument, session: RatingSession): Partial<Record<MealSlot, string>> {
    const names: Partial<Record<MealSlot, string>> = {};
    for (const slot of SESSION_SLOTS[session]) {
        const name = meal[slot]?.item_name;
        if (typeof name === 'string' && name.trim() && name.trim() !== 'Not Set') names[slot] = name.trim().slice(0, 80);
    }
    return names;
}

function chefFor(meal: MealDocument, session: RatingSession): string | null {
    const id = session === 'dinner' ? meal.responsibility?.dinnerId : meal.responsibility?.breakfastLunchId;
    return isSafeDocId(id) ? id : null;
}

async function hiredCooks(fs: Fs, hid: string): Promise<string[]> {
    const snap = await fs.collection(COOKS_COLLECTION).where('linkedUserId', '==', hid).limit(MAX_HIRED_COOKS).get();
    return snap.docs.map(d => d.id).filter(isSafeDocId).sort();
}

function targetsFor(meal: MealDocument, session: RatingSession, raterUid: string, hiredCookUids: string[]): RatingTargets {
    return ratingTargets({
        session,
        dishNames: dishNamesFor(meal, session),
        attendance: meal.attendance?.[raterUid],
        chefUid: chefFor(meal, session),
        hiredCookUids,
        raterUid,
    });
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

function readWeeks(value: unknown): WeeklyScores {
    if (!value || typeof value !== 'object') return {};
    const out: WeeklyScores = {};
    for (const [week, w] of Object.entries(value as Record<string, Record<string, unknown>>)) {
        if (!isIsoDate(week) || !w || typeof w !== 'object') continue;
        out[week] = { count: num(w.count), sum: num(w.sum) };
    }
    return out;
}

function readComments(value: unknown): StoredComment[] {
    if (!Array.isArray(value)) return [];
    return value.filter((c): c is StoredComment => !!c && typeof c.text === 'string' && typeof c.by === 'string');
}

function readMenu(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((d): d is string => typeof d === 'string') : [];
}

function readDishScores(value: unknown): DishScore[] {
    if (!value || typeof value !== 'object') return [];
    const dishes = value as Record<string, unknown>;
    return (['breakfast', 'lunch', 'dinner'] as const).flatMap(slot => {
        const d = dishes[slot] as Record<string, unknown> | undefined;
        if (!d || typeof d !== 'object' || typeof d.name !== 'string') return [];
        const score = readScore(d);
        return [{ slot, name: d.name, count: score.count, average: scoreAverage(score) }];
    });
}

function toFeedback(c: StoredComment, labels: Map<string, string> | null): FeedbackComment {
    const out: FeedbackComment = { text: c.text, stars: typeof c.stars === 'number' && c.stars >= 1 && c.stars <= 5 ? c.stars : null };
    const name = labels?.get(c.by);
    if (name) out.name = name;
    return out;
}

function toSummary(data: DocumentData, labels: Map<string, string> | null): SessionSummary {
    const totals = readScore(data);
    return {
        date: String(data.date),
        session: isRatingSession(data.session) ? data.session : 'dinner',
        menu: readMenu(data.menu),
        dishScores: readDishScores(data.dishes),
        count: totals.count,
        average: scoreAverage(totals),
        comments: readComments(data.comments).reverse().map(c => toFeedback(c, labels)),
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
    const [meals, cooks] = await Promise.all([findMeals(fs, hid, open.map(s => s.date)), hiredCooks(fs, hid)]);

    const candidates = open.flatMap(s => {
        const meal = meals.get(s.date);
        if (!meal) return [];
        const targets = targetsFor(meal, s.session, user.uid, cooks);
        return targets.dishes.length > 0 || targets.chefUid ? [{ ...s, targets }] : [];
    });
    if (candidates.length === 0) return [];

    const existing = await fs.getAll(...candidates.map(c => fs.doc(ratingPath(hid, c.date, c.session, user.uid))));
    const remaining = candidates.filter((_, i) => !existing[i].exists);
    if (remaining.length === 0) return [];

    const labels = await labelsFor(fs, remaining.flatMap(c => [...c.targets.cookUids, c.targets.chefUid ?? '']));
    return remaining.map(({ date, session, targets }) => {
        const chefCooked = cooks.length === 0 && !!targets.chefUid;
        return {
            date,
            session,
            dishes: targets.dishes,
            cookNames: chefCooked ? [] : targets.cookUids.map(uid => labels.get(uid) ?? ''),
            chef: targets.chefUid ? { name: labels.get(targets.chefUid) ?? '' } : null,
            chefCooked,
        };
    });
}

/**
 * Record a member's rating or skip for one session. Validates everything the
 * browser sends against what this member may rate; a second rating for the
 * same session is refused.
 */
export async function recordRating(
    user: User,
    input: { date?: unknown; session?: unknown; dishes?: unknown; chef?: unknown; cookNote?: unknown; chefNote?: unknown },
    status: 'submitted' | 'skipped',
    now: Date = new Date(),
): Promise<RatingResult> {
    if (!canRate(user) || !isSafeDocId(user.uid) || !isSafeDocId(user.householdId)) return { ok: false, error: 'not-eligible' };
    const { date, session } = input;
    if (!isIsoDate(date) || !isRatingSession(session)) return { ok: false, error: 'invalid' };
    if (!isSessionOpen(date, session, now)) return { ok: false, error: 'closed' };

    const fs = adminFirestore();
    const hid = user.householdId;
    const [meals, cooks] = await Promise.all([findMeals(fs, hid, [date]), hiredCooks(fs, hid)]);
    const meal = meals.get(date);
    if (!meal) return { ok: false, error: 'not-eligible' };
    const targets = targetsFor(meal, session, user.uid, cooks);
    if (targets.dishes.length === 0 && !targets.chefUid) return { ok: false, error: 'not-eligible' };

    const rating = status === 'submitted' ? parseRatingInput(input, targets) : null;
    if (status === 'submitted' && !rating) return { ok: false, error: 'invalid' };

    const nowMs = now.getTime();
    const allDishes = dishNamesFor(meal, session);
    const dishStars = rating?.dishes.map(d => d.stars) ?? [];
    const cookUids = dishStars.length > 0 ? targets.cookUids : [];
    const chefUid = rating?.chef != null ? targets.chefUid : null;

    // Every aggregate this rating touches: a stats and a session document per person.
    const people: { role: RatingRole; uid: string; stats: DocumentReference; session: DocumentReference }[] = [
        ...cookUids.map(uid => ({ role: 'cook' as const, uid })),
        ...(chefUid ? [{ role: 'chef' as const, uid: chefUid }] : []),
    ].map(p => ({
        ...p,
        stats: fs.doc(statsPath(hid, p.role, p.uid)),
        session: fs.doc(`${sessionsPath(hid, p.role, p.uid)}/${sessionKey(date, session)}`),
    }));
    const ratingRef = fs.doc(ratingPath(hid, date, session, user.uid));

    try {
        const outcome = await fs.runTransaction(async tx => {
            const snaps = await tx.getAll(ratingRef, ...people.flatMap(p => [p.stats, p.session]));
            if (snaps[0].exists) return 'duplicate' as const;

            tx.create(ratingRef, {
                version: 2,
                date,
                session,
                raterUid: user.uid,
                status,
                dishes: rating?.dishes.map(d => ({ slot: d.slot, name: allDishes[d.slot] ?? '', stars: d.stars })) ?? [],
                chef: chefUid && rating?.chef ? { uid: chefUid, stars: rating.chef } : null,
                cookUids,
                cookNote: rating?.cookNote || null,
                chefNote: rating?.chefNote || null,
                createdAt: FieldValue.serverTimestamp(),
                createdAtMs: nowMs,
            });
            if (!rating) return 'ok' as const;

            people.forEach((p, i) => {
                const stats = snaps[1 + i * 2].data() ?? {};
                const sessionSnap = snaps[2 + i * 2];
                const sessionData = sessionSnap.data() ?? {};
                const stars = p.role === 'cook' ? dishStars : [rating.chef as number];
                const note = p.role === 'cook' ? rating.cookNote : rating.chefNote;
                // A note's stars: the chef score, or the dish score when one dish was rated (an
                // average of two dishes would misstate what the note is about).
                const noteStars = p.role === 'cook' ? (dishStars.length === 1 ? dishStars[0] : null) : rating.chef;

                tx.set(p.stats, {
                    ...addScore(readScore(stats), ...stars),
                    uid: p.uid,
                    sessionCount: num(stats.sessionCount) + (sessionSnap.exists ? 0 : 1),
                    weeks: addToWeeks(readWeeks(stats.weeks), date, stars),
                    lastRatedAtMs: nowMs,
                    seenAtMs: num(stats.seenAtMs),
                });

                const comments = readComments(sessionData.comments);
                const sessionDoc: DocumentData = {
                    ...addScore(readScore(sessionData), ...stars),
                    date,
                    session,
                    menu: readMenu(sessionData.menu).length > 0 ? sessionData.menu : Object.values(allDishes),
                    comments: note ? addComment(comments, { text: note, by: user.uid, at: nowMs, stars: noteStars }) : comments,
                    updatedAtMs: nowMs,
                };
                if (p.role === 'cook') {
                    const dishes: Record<string, unknown> = { ...(sessionData.dishes ?? {}) };
                    for (const d of rating.dishes) {
                        const prev = dishes[d.slot] as Record<string, unknown> | undefined;
                        dishes[d.slot] = { name: allDishes[d.slot] ?? '', ...addScore(readScore(prev), d.stars) };
                    }
                    sessionDoc.dishes = dishes;
                }
                tx.set(p.session, sessionDoc);
            });
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

/** Roles a person can be rated in: hired cooks for their dishes, flatmates as chef (and as cook when there's no hired cook). */
const rolesFor = (user: User): RatingRole[] => (user.role === 'cook' ? ['cook'] : ['chef', 'cook']);

/** New ratings for one role since the person last dismissed the summary, consolidated. */
async function roleFeedback(fs: Fs, hid: string, role: RatingRole, uid: string, showNames: boolean): Promise<RoleFeedback | null> {
    const statsSnap = await fs.doc(statsPath(hid, role, uid)).get();
    if (!statsSnap.exists) return null;
    const seenAt = num(statsSnap.data()?.seenAtMs);
    const snap = await fs.collection(sessionsPath(hid, role, uid)).where('updatedAtMs', '>', seenAt).orderBy('updatedAtMs', 'desc').limit(20).get();
    if (snap.empty) return null;

    const labels = showNames ? await labelsFor(fs, snap.docs.flatMap(d => readComments(d.data().comments).map(c => c.by))) : null;
    const totals = snap.docs.reduce((acc, d) => mergeScores(acc, readScore(d.data())), emptyScore());
    return {
        upToMs: Math.max(...snap.docs.map(d => num(d.data().updatedAtMs))),
        count: totals.count,
        average: scoreAverage(totals),
        sessions: snap.docs.map(d => toSummary(d.data(), labels)).sort(newestFirst),
    };
}

/** Ratings the signed-in person hasn't seen yet, for each role they were rated in. */
export async function getNewFeedback(user: User): Promise<NewFeedback | null> {
    if (!isSafeDocId(user.uid) || !isSafeDocId(user.householdId)) return null;
    const fs = adminFirestore();
    const hid = user.householdId;
    const roles = rolesFor(user);
    const showNames = await namesVisible(fs, hid);
    const [cook, chef] = await Promise.all([
        roles.includes('cook') ? roleFeedback(fs, hid, 'cook', user.uid, showNames) : null,
        roles.includes('chef') ? roleFeedback(fs, hid, 'chef', user.uid, showNames) : null,
    ]);
    return cook || chef ? { cook, chef } : null;
}

/** Everything the app checks on open: ratings to give and feedback received. */
export async function getRatingsStatus(user: User, now: Date = new Date()): Promise<RatingsStatus> {
    const [pending, feedback] = await Promise.all([getPendingRatings(user, now), getNewFeedback(user)]);
    const showNames = pending.length > 0 && isSafeDocId(user.householdId) ? await namesVisible(adminFirestore(), user.householdId) : false;
    return { today: localTime(now).date, namesVisible: showNames, pending, feedback };
}

/** Called when the summary is dismissed: only newer ratings will show next time. */
export async function markFeedbackSeen(user: User, upTo: unknown): Promise<boolean> {
    if (!isSafeDocId(user.uid) || !isSafeDocId(user.householdId)) return false;
    const marks = (upTo && typeof upTo === 'object' ? upTo : {}) as Partial<Record<RatingRole, unknown>>;
    const fs = adminFirestore();
    const roles = rolesFor(user).filter(role => num(marks[role]) > 0);
    try {
        await Promise.all(roles.map(role => {
            const at = Math.min(num(marks[role]), Date.now());
            const ref = fs.doc(statsPath(user.householdId, role, user.uid));
            return fs.runTransaction(async tx => {
                const snap = await tx.get(ref);
                if (snap.exists && at > num(snap.data()?.seenAtMs)) tx.update(ref, { seenAtMs: at });
            });
        }));
        return true;
    } catch (err) {
        console.error('[ratings] markFeedbackSeen failed:', err);
        return false;
    }
}

function emptyDashboard(today: string): RoleDashboard {
    return {
        hasRatings: false,
        count: 0,
        sessionCount: 0,
        average: null,
        hist: [0, 0, 0, 0, 0],
        trend: trendSeries({}, today),
        history: [],
        comments: [],
        dishes: [],
    };
}

async function roleDashboard(fs: Fs, hid: string, role: RatingRole, uid: string, today: string, showNames: boolean): Promise<RoleDashboard> {
    const [statsSnap, sessionsSnap] = await Promise.all([
        fs.doc(statsPath(hid, role, uid)).get(),
        fs.collection(sessionsPath(hid, role, uid)).orderBy('date', 'desc').limit(role === 'cook' ? DASHBOARD_SESSIONS : HISTORY_SESSIONS).get(),
    ]);
    const stats = statsSnap.data() ?? {};
    const totals = readScore(stats);
    if (!statsSnap.exists || totals.count === 0) return emptyDashboard(today);

    const labels = showNames ? await labelsFor(fs, sessionsSnap.docs.flatMap(d => readComments(d.data().comments).map(c => c.by))) : null;
    const sessions = sessionsSnap.docs
        .map(d => ({ summary: toSummary(d.data(), labels), raw: d.data() }))
        .sort((a, b) => newestFirst(a.summary, b.summary));
    const comments = sessions
        .flatMap(({ summary, raw }) => readComments(raw.comments).map(c => ({ c, summary })))
        .sort((a, b) => b.c.at - a.c.at)
        .slice(0, 10)
        .map(({ c, summary }) => ({ ...toFeedback(c, labels), date: summary.date, session: summary.session }));
    const dishes = role === 'cook'
        ? dishAverages(sessions.flatMap(({ raw }) => {
            const map = (raw.dishes ?? {}) as Record<string, Record<string, unknown>>;
            return Object.entries(map)
                .filter(([slot, d]) => isMealSlot(slot) && d && typeof d.name === 'string')
                .map(([, d]) => ({ name: String(d.name), ...readScore(d) }));
        }))
        : [];

    return {
        hasRatings: true,
        count: totals.count,
        sessionCount: num(stats.sessionCount),
        average: scoreAverage(totals),
        hist: totals.hist,
        trend: trendSeries(readWeeks(stats.weeks), today),
        history: sessions.slice(0, HISTORY_SESSIONS).map(({ summary: s }) => ({
            date: s.date,
            session: s.session,
            menu: s.menu,
            dishScores: s.dishScores,
            count: s.count,
            average: s.average,
        })),
        comments,
        dishes,
    };
}

/** The signed-in person's own ratings for the profile page. */
export async function getRatingsDashboard(user: User, now: Date = new Date()): Promise<RatingsDashboard> {
    const today = localTime(now).date;
    if (!isSafeDocId(user.uid) || !isSafeDocId(user.householdId)) {
        return { today, namesVisible: false, cook: null, chef: null };
    }
    const fs = adminFirestore();
    const hid = user.householdId;
    const showNames = await namesVisible(fs, hid);
    if (user.role === 'cook') {
        return { today, namesVisible: showNames, cook: await roleDashboard(fs, hid, 'cook', user.uid, today, showNames), chef: null };
    }
    const [chef, cook] = await Promise.all([
        roleDashboard(fs, hid, 'chef', user.uid, today, showNames),
        roleDashboard(fs, hid, 'cook', user.uid, today, showNames),
    ]);
    return { today, namesVisible: showNames, chef, cook: cook.hasRatings ? cook : null };
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
