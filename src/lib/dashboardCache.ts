import type { HouseholdMember, MealDocument } from '@/types/meal';

/**
 * Client-side cache for the dashboard. It lives at module scope, so it
 * survives client-side navigation (dashboard → profile → back): revisited days
 * render immediately and are refreshed in the background when stale.
 */

/** How long a fetched day is trusted before it is refetched on view. */
const FRESH_MS = 60_000;

type MealEntry = { meal: MealDocument | null; at: number };
type MembersEntry = { members: HouseholdMember[]; memberCount: number };

const meals = new Map<string, MealEntry>();
const inflight = new Map<string, Promise<MealDocument | null>>();
const membersByHousehold = new Map<string, MembersEntry>();

export const mealKey = (householdId: string, date: string) => `${householdId}|${date}`;

export function getCachedMeal(key: string): MealEntry | undefined {
    return meals.get(key);
}

export function isFresh(entry: MealEntry | undefined): boolean {
    return !!entry && Date.now() - entry.at < FRESH_MS;
}

export function setCachedMeal(key: string, meal: MealDocument | null): void {
    meals.set(key, { meal, at: Date.now() });
}

/** Keep cached days for instant display, but refetch each one before trusting it. */
export function markAllMealsStale(): void {
    meals.forEach(entry => { entry.at = 0; });
}

export function getCachedMembers(householdId: string): MembersEntry | undefined {
    return membersByHousehold.get(householdId);
}

export function setCachedMembers(householdId: string, entry: MembersEntry): void {
    membersByHousehold.set(householdId, entry);
}

/** Fetch one day, sharing the request if that day is already being fetched. */
export function fetchMealOnce(key: string, fetcher: () => Promise<MealDocument | null>): Promise<MealDocument | null> {
    const pending = inflight.get(key);
    if (pending) return pending;

    const request = fetcher()
        .then(meal => {
            setCachedMeal(key, meal);
            return meal;
        })
        .finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
}

/**
 * Fetch several days with one batched request. Each day is registered as in
 * flight, so a click on one of them while the batch runs waits for it instead
 * of queueing a duplicate request.
 */
export function fetchMealsOnce(
    householdId: string,
    dates: string[],
    fetchBatch: (dates: string[]) => Promise<Record<string, MealDocument | null>>
): Promise<void> {
    const todo = dates.filter(d => !inflight.has(mealKey(householdId, d)));
    if (todo.length === 0) return Promise.resolve();

    const batch = fetchBatch(todo);
    for (const date of todo) {
        const key = mealKey(householdId, date);
        const request = batch
            .then(result => {
                const meal = result[date] ?? null;
                setCachedMeal(key, meal);
                return meal;
            })
            .finally(() => inflight.delete(key));
        request.catch(() => {}); // failures surface through the returned promise
        inflight.set(key, request);
    }
    return batch.then(() => undefined);
}

/** Forget everything (e.g. on logout). */
export function clearDashboardCache(): void {
    meals.clear();
    inflight.clear();
    membersByHousehold.clear();
}
