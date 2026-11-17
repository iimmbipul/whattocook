'use client';

import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './Header';
import DatePicker from './DatePicker';
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
        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-gray-700 font-medium">{t('dashboard.loading')}</p>
                </div>
            </div>
        );
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

    // Determine label
    let label = format(selectedDate, 'EEEE, MMMM do');
    if (isToday) label = t('dashboard.today');
    else if (isSameDay(selectedDate, new Date(Date.now() + 86400000))) label = t('dashboard.tomorrow');

    const renderDayMeals = (
        meal: MealDocument | null,
        date: string,
        label: string,
        canEdit: boolean,
        isToday: boolean = false
    ) => {
        if (mealsLoading) {
            return (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-purple-600"></div>
                </div>
            );
        }

        if (!meal) {
            return (
                <div className="bg-white rounded-xl shadow-lg p-8">
                    <h2 className="text-2xl sm:text-3xl font-bold text-brand-darkest mb-2">{label}</h2>
                    <p className="text-brand-dark">{t('dashboard.noMealPlan')} {getFormattedDate(date)}</p>
                </div>
            );
        }

        // Standard card styling - Mobile: Transparent/Unstyled, Desktop: Card
        const sectionClasses = 'bg-transparent border-0 shadow-none p-0 md:bg-white md:border md:border-brand-light md:rounded-xl md:shadow-sm md:p-8';

        const editIndicator = canEdit ? '' : '';

        // Exclude cooks from the "who's eating" universe — they cook but don't count as diners.
        const eaters = members.filter(m => m.role !== 'cook');
        const eaterCount = eaters.length || memberCount;

        // Helper to get responsible name
        const getResponsibleName = (uid?: string) => {
            if (!uid) return undefined;
            return members.find(m => m.uid === uid)?.label;
        };

        const getResponsiblePhone = (uid?: string) => {
            if (!uid) return undefined;
            return members.find(m => m.uid === uid)?.phoneNumber;
        };

        const breakfastLunchResp = getResponsibleName(meal.responsibility?.breakfastLunchId);
        const breakfastLunchPhone = getResponsiblePhone(meal.responsibility?.breakfastLunchId);

        const dinnerResp = getResponsibleName(meal.responsibility?.dinnerId);
        const dinnerPhone = getResponsiblePhone(meal.responsibility?.dinnerId);

        return (
            <div className={`${sectionClasses} ${editIndicator}`}>
                <div className="mb-8">
                    <h2 className="text-2xl sm:text-3xl font-bold text-brand-darkest mb-1">{label}</h2>
                    <p className="text-brand-dark">{getFormattedDate(date)}</p>
                    <div className="mt-3 inline-block bg-brand-light/30 text-brand-darkest px-4 py-1.5 rounded-full text-sm font-semibold border border-brand-light">
                        {t('dashboard.totalCalories', { calories: meal.total_calories })}
                    </div>
                </div>


                {/* Responsive Grid: Mobile 1 col, Tablet 2 cols, Desktop 3 cols */}
                <div className="flex flex-col gap-6">
                    <MealCard
                        meal={meal.breakfast}
                        mealType="breakfast"
                        mealId={date}
                        canEdit={canEdit}
                        phoneNumber={user.phoneNumber}
                        attendance={meal.attendance}
                        guests={meal.guests}
                        members={eaters.map(m => ({ uid: m.uid, label: m.label }))}
                        totalMembers={eaterCount}
                        currentUserId={user.uid}
                        userRole={user.role}
                        responsibleMemberName={breakfastLunchResp}
                        responsibleMemberPhone={breakfastLunchPhone}
                        onRefresh={onRefresh}
                        householdId={user.householdId}
                    />
                    <MealCard
                        meal={meal.lunch}
                        mealType="lunch"
                        mealId={date}
                        canEdit={canEdit}
                        phoneNumber={user.phoneNumber}
                        attendance={meal.attendance}
                        guests={meal.guests}
                        members={eaters.map(m => ({ uid: m.uid, label: m.label }))}
                        totalMembers={eaterCount}
                        currentUserId={user.uid}
                        userRole={user.role}
                        responsibleMemberName={breakfastLunchResp}
                        responsibleMemberPhone={breakfastLunchPhone}
                        onRefresh={onRefresh}
                        householdId={user.householdId}
                    />
                    <MealCard
                        meal={meal.dinner}
                        mealType="dinner"
                        mealId={date}
                        canEdit={canEdit}
                        phoneNumber={user.phoneNumber}
                        attendance={meal.attendance}
                        guests={meal.guests}
                        members={eaters.map(m => ({ uid: m.uid, label: m.label }))}
                        totalMembers={eaterCount}
                        currentUserId={user.uid}
                        userRole={user.role}
                        responsibleMemberName={dinnerResp}
                        responsibleMemberPhone={dinnerPhone}
                        onRefresh={onRefresh}
                        householdId={user.householdId}
                    />
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-brand-light/30">
            <Header />
            <main className="container mx-auto p-2 md:p-6">
                <DatePicker selectedDate={selectedDate} onDateSelect={setSelectedDate} />
                <div className="space-y-6 mt-4 md:space-y-12 md:mt-8">
                    {renderDayMeals(selectedMeal, dateString, label, canEdit, isToday)}
                </div>
            </main>
        </div>
    );
}
