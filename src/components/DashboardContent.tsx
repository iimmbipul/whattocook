'use client';

import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarX2 } from 'lucide-react';
import AppShell from './AppShell';
import DatePicker from './DatePicker';
import { Card, EmptyState } from './ui/Card';
import { PageLoader, Skeleton } from './ui/Spinner';
import { canEditMeal } from '@/lib/permissions';
import { getMealByDate, getMealsByDates } from '@/lib/firestore';
import { getDashboardData } from '@/lib/pageData';
import { HouseholdMember, MealDocument } from '@/types/meal';
import { getFormattedDate } from '@/lib/permissions';
import MealCard from './MealCard';
import { addDays, format, isSameDay } from 'date-fns';
import { useLocale } from '@/context/LocaleContext';
import {
    fetchMealOnce,
    fetchMealsOnce,
    getCachedMeal,
    getCachedMembers,
    isFresh,
    markAllMealsStale,
    mealKey,
    setCachedMeal,
    setCachedMembers,
} from '@/lib/dashboardCache';

/** Number of days in the DatePicker strip; they are prefetched in the background. */
const DATE_STRIP_DAYS = 14;

export default function DashboardContent() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const { t } = useLocale();
    const householdId = user?.householdId;

    // State for selected date (defaults to Today)
    const [selectedDate, setSelectedDate] = useState(new Date());
    const dateString = format(selectedDate, 'yyyy-MM-dd');

    // When coming back to the dashboard, start from what was already loaded.
    const [selectedMeal, setSelectedMeal] = useState<MealDocument | null>(() =>
        householdId ? getCachedMeal(mealKey(householdId, dateString))?.meal ?? null : null);
    const [mealsLoading, setMealsLoading] = useState(() =>
        householdId ? !getCachedMeal(mealKey(householdId, dateString)) : true);
    const [memberCount, setMemberCount] = useState<number>(() =>
        householdId ? getCachedMembers(householdId)?.memberCount ?? 0 : 0);
    const [members, setMembers] = useState<HouseholdMember[]>(() =>
        householdId ? getCachedMembers(householdId)?.members ?? [] : []);

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        }
    }, [user, loading, router]);

    // Days cached during an earlier visit are shown right away but refetched
    // before being trusted (they may have been changed on another page).
    useEffect(() => {
        markAllMealsStale();
    }, []);

    // The day currently on screen; results for any other day only fill the cache.
    const shownKeyRef = useRef<string | null>(null);
    useEffect(() => {
        shownKeyRef.current = householdId ? mealKey(householdId, dateString) : null;
    }, [householdId, dateString]);

    const showMealIfCurrent = useCallback((key: string, meal: MealDocument | null) => {
        if (shownKeyRef.current !== key) return;
        setSelectedMeal(meal);
        setMealsLoading(false);
    }, []);

    // Household members are fetched once per visit, together with the first meal.
    const membersLoadedFor = useRef<string | null>(null);

    // Load the selected day. Cached days render instantly; missing or stale days
    // are fetched (sharing the request if a prefetch for that day is in flight).
    useEffect(() => {
        if (!householdId) return;
        const key = mealKey(householdId, dateString);
        const cached = getCachedMeal(key);

        if (cached) {
            setSelectedMeal(cached.meal);
            setMealsLoading(false);
        } else {
            setMealsLoading(true);
        }

        const needMembers = membersLoadedFor.current !== householdId;
        if (!needMembers && isFresh(cached)) return;

        const load = async () => {
            try {
                if (needMembers) {
                    membersLoadedFor.current = householdId;
                    // Meal + members + member count in a single round trip.
                    const data = await getDashboardData(dateString, householdId);
                    setCachedMeal(key, data.meal);
                    setCachedMembers(householdId, { members: data.members, memberCount: data.memberCount });
                    // An empty list means the session cookie wasn't usable yet; retry on the next load.
                    if (data.members.length === 0) membersLoadedFor.current = null;
                    if (shownKeyRef.current?.startsWith(`${householdId}|`)) {
                        setMembers(data.members);
                        setMemberCount(data.memberCount);
                    }
                    showMealIfCurrent(key, data.meal);
                } else {
                    const meal = await fetchMealOnce(key, () => getMealByDate(dateString, householdId));
                    showMealIfCurrent(key, meal);
                }
            } catch (error) {
                console.error("Error fetching meal:", error);
                if (needMembers) membersLoadedFor.current = null;
                if (shownKeyRef.current === key) setMealsLoading(false);
            }
        };
        load();
    }, [householdId, dateString, showMealIfCurrent]);

    // Once a day is on screen, warm the rest of the date strip with one
    // background request so switching days doesn't wait on the network.
    const prefetchedFor = useRef<string | null>(null);
    useEffect(() => {
        if (!householdId || mealsLoading || prefetchedFor.current === householdId) return;
        const timer = window.setTimeout(() => {
            prefetchedFor.current = householdId;
            const today = new Date();
            const dates = Array.from({ length: DATE_STRIP_DAYS }, (_, i) => format(addDays(today, i), 'yyyy-MM-dd'))
                .filter(d => !isFresh(getCachedMeal(mealKey(householdId, d))));
            if (dates.length === 0) return;
            fetchMealsOnce(householdId, dates, ds => getMealsByDates(ds, householdId))
                .catch(error => console.error("Error prefetching meals:", error));
        }, 300);
        return () => window.clearTimeout(timer);
    }, [householdId, mealsLoading]);

    // After an edit or attendance toggle: refetch that day, bypassing the cache.
    const refreshMeal = useCallback(async (date: string) => {
        if (!householdId) return;
        const key = mealKey(householdId, date);
        try {
            const meal = await getMealByDate(date, householdId);
            setCachedMeal(key, meal);
            showMealIfCurrent(key, meal);
        } catch (error) {
            console.error("Error fetching meal:", error);
        }
    }, [householdId, showMealIfCurrent]);

    if (loading) {
        return <PageLoader label={t('dashboard.loading')} />;
    }

    if (!user) {
        return null;
    }

    // Determine if the selected date matches Today
    const today = new Date();
    const isToday = isSameDay(selectedDate, today);

    // Permission check for the selected date (dateString is computed above)
    const canEdit = canEditMeal(user.role, dateString);
    const onRefresh = () => { refreshMeal(dateString); };

    // Day heading: "Today" / "Tomorrow" / weekday; the full date sits underneath.
    let label = format(selectedDate, 'EEEE');
    if (isToday) label = t('nav.today');
    else if (isSameDay(selectedDate, new Date(Date.now() + 86400000))) label = t('myPlates.tomorrow');

    // Exclude cooks from the "who's eating" universe — they cook but don't count as diners.
    const eaters = members.filter(m => m.role !== 'cook');
    const eaterCount = eaters.length || memberCount;
    const eaterOptions = eaters.map(m => ({ uid: m.uid, label: m.label }));
    const memberById = (uid?: string) => (uid ? members.find(m => m.uid === uid) : undefined);

    const renderDayMeals = (meal: MealDocument | null, date: string) => {
        if (mealsLoading) {
            return (
                <div className="space-y-4" aria-busy="true" aria-label={t('dashboard.loading')}>
                    {[0, 1, 2].map(i => (
                        <Card key={i} className="p-5">
                            <div className="flex gap-4">
                                <Skeleton className="h-14 w-14 rounded-2xl" />
                                <div className="flex-1 space-y-2.5 pt-1">
                                    <Skeleton className="h-3 w-20" />
                                    <Skeleton className="h-5 w-2/3" />
                                    <Skeleton className="h-3.5 w-1/3" />
                                </div>
                            </div>
                            <Skeleton className="mt-5 h-9 w-full" />
                        </Card>
                    ))}
                </div>
            );
        }

        if (!meal) {
            return (
                <Card>
                    <EmptyState
                        icon={<CalendarX2 size={22} />}
                        title={t('dashboard.emptyTitle')}
                        body={t('dashboard.emptyBody', { date: getFormattedDate(date) })}
                    />
                </Card>
            );
        }

        const slots = [
            { type: 'breakfast' as const, item: meal.breakfast, chefId: meal.responsibility?.breakfastLunchId },
            { type: 'lunch' as const, item: meal.lunch, chefId: meal.responsibility?.breakfastLunchId },
            { type: 'dinner' as const, item: meal.dinner, chefId: meal.responsibility?.dinnerId },
        ];

        return (
            <div className="space-y-4">
                {slots.map(({ type, item, chefId }) => {
                    const chef = memberById(chefId);
                    return (
                        <MealCard
                            key={type}
                            meal={item}
                            mealType={type}
                            mealId={date}
                            canEdit={canEdit}
                            phoneNumber={user.phoneNumber}
                            attendance={meal.attendance}
                            guests={meal.guests}
                            members={eaterOptions}
                            totalMembers={eaterCount}
                            currentUserId={user.uid}
                            userRole={user.role}
                            responsibleMemberName={chef?.label}
                            responsibleMemberPhone={chef?.phoneNumber}
                            responsibleMemberId={chefId}
                            onRefresh={onRefresh}
                            householdId={user.householdId}
                        />
                    );
                })}
            </div>
        );
    };

    return (
        <AppShell>
            <DatePicker selectedDate={selectedDate} onDateSelect={setSelectedDate} />

            <div className="mb-4 mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{label}</h1>
                    <p className="mt-0.5 text-[15px] text-ink-muted">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</p>
                </div>
                {!mealsLoading && selectedMeal && (
                    <p className="text-sm font-semibold text-ink-muted">
                        {t('dashboard.caloriesTotal', { calories: selectedMeal.total_calories })}
                    </p>
                )}
            </div>

            {renderDayMeals(selectedMeal, dateString)}
        </AppShell>
    );
}
