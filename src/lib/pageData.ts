'use server';

/**
 * Batched page loaders.
 *
 * The browser dispatches Server Actions one at a time: each call waits for the
 * previous one to finish. A page that calls three actions on mount therefore
 * pays three full network round trips back to back. These loaders run the same
 * existing reads in parallel inside a single action instead.
 *
 * Authorization: they only delegate to existing actions, each of which checks
 * the verified session itself (a householdId that doesn't match the session is
 * rejected), so these loaders expose nothing those actions don't already.
 * The date-strip prefetch is `getMealsByDates` in ./firestore, which checks
 * the session once for all days.
 */

import { getMealByDate, getHouseholdAssignmentCounts } from './firestore';
import { getAllHouseholdMembers, getMemberCount, getHouseholdDietCategory } from './auth';
import { isCalendarConnected } from './calendarTokens';
import type { HouseholdMember, MealDocument } from '@/types/meal';

/** Dashboard first paint: the selected day's meal plus the household members. */
export async function getDashboardData(
    date: string,
    householdId?: string
): Promise<{ meal: MealDocument | null; members: HouseholdMember[]; memberCount: number }> {
    const [meal, members, memberCount] = await Promise.all([
        getMealByDate(date, householdId),
        getAllHouseholdMembers(),
        getMemberCount(),
    ]);
    return { meal, members, memberCount };
}

/** Everything the profile page reads on mount. */
export async function getProfileData(
    householdId?: string,
    uid?: string
): Promise<{
    calendarStatus: { connected: boolean; email?: string };
    dietCategory: string | null;
    members: HouseholdMember[];
    assignmentCounts: Record<string, number>;
}> {
    const [calendarStatus, dietCategory, members, assignmentCounts] = await Promise.all([
        isCalendarConnected(uid).catch(() => ({ connected: false })),
        getHouseholdDietCategory(householdId),
        getAllHouseholdMembers(),
        getHouseholdAssignmentCounts(householdId).catch((): Record<string, number> => ({})),
    ]);
    return { calendarStatus, dietCategory, members, assignmentCounts };
}
