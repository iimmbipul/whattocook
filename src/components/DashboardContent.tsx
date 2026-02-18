'use client';

import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Header from './Header';
import DatePicker from './DatePicker';
import { canEditMeal } from '@/lib/permissions';
import { getMealByDate } from '@/lib/firestore';
import { getMemberCount } from '@/lib/auth';
import { MealDocument } from '@/types/meal';
import { getFormattedDate } from '@/lib/permissions';
import MealCard from './MealCard';
import { format, isSameDay } from 'date-fns';
import { getAllHouseholdMembers } from '@/lib/auth';

export default function DashboardContent() {
    const { user, loading } = useAuth();
    const router = useRouter();

    // State for selected date (defaults to Today)
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [selectedMeal, setSelectedMeal] = useState<MealDocument | null>(null);
    const [mealsLoading, setMealsLoading] = useState(true);
    const [memberCount, setMemberCount] = useState<number>(0);
    const [members, setMembers] = useState<{ uid: string; email: string; role: string; label: string }[]>([]);

    // Fetch member count
    useEffect(() => {
        const fetchCount = async () => {
            const count = await getMemberCount();
            setMemberCount(count);

            // Fetch detailed members list for assignment
            const membersList = await getAllHouseholdMembers();
            setMembers(membersList);
        };
        fetchCount();
    }, []);

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        }
    }, [user, loading, router]);

    const fetchMealData = async () => {
        if (!user) return;

        try {
            // Format date as Day (dd) for backend as ID is just the day number (padded)
            const dayString = format(selectedDate, 'dd');
            const meal = await getMealByDate(dayString);
            setSelectedMeal(meal);
        } catch (error) {
            console.error("Error fetching meal:", error);
        }
    };

    // Fetch meal whenever selectedDate changes
    useEffect(() => {
        const load = async () => {
            setMealsLoading(true);
            await fetchMealData();
            setMealsLoading(false);
        };
        load();
    }, [user, selectedDate]);

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-gray-700 font-medium">Loading...</p>
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

    // Format date string for permission check and display
    const dateString = format(selectedDate, 'yyyy-MM-dd');
    const canEdit = canEditMeal(user.role, dateString);

    // Determine label
    let label = format(selectedDate, 'EEEE, MMMM do');
    if (isToday) label = '📅 Today';
    else if (isSameDay(selectedDate, new Date(Date.now() + 86400000))) label = '📅 Tomorrow';

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
                    <p className="text-brand-dark">No meal plan available for {getFormattedDate(date)}</p>
                </div>
            );
        }

        // Standard card styling - Mobile: Transparent/Unstyled, Desktop: Card
        const sectionClasses = 'bg-transparent border-0 shadow-none p-0 md:bg-white md:border md:border-brand-light md:rounded-xl md:shadow-sm md:p-8';

        const editIndicator = canEdit ? '' : '';

        // Helper to get responsible name
        const getResponsibleName = (uid?: string) => {
            if (!uid) return undefined;
            return members.find(m => m.uid === uid)?.label;
        };

        const breakfastLunchResp = getResponsibleName(meal.responsibility?.breakfastLunchId);
        const dinnerResp = getResponsibleName(meal.responsibility?.dinnerId);

        return (
            <div className={`${sectionClasses} ${editIndicator}`}>
                <div className="mb-8">
                    <h2 className="text-2xl sm:text-3xl font-bold text-brand-darkest mb-1">{label}</h2>
                    <p className="text-brand-dark">{getFormattedDate(date)}</p>
                    <div className="mt-3 inline-block bg-brand-light/30 text-brand-darkest px-4 py-1.5 rounded-full text-sm font-semibold border border-brand-light">
                        Total: {meal.total_calories} calories
                    </div>
                </div>


                {/* Responsive Grid: Mobile 1 col, Tablet 2 cols, Desktop 3 cols */}
                <div className="flex flex-col gap-6">
                    <MealCard
                        meal={meal.breakfast}
                        mealType="breakfast"
                        mealId={meal.id}
                        canEdit={canEdit}
                        phoneNumber={user.phoneNumber}
                        attendance={meal.attendance}
                        totalMembers={memberCount}
                        currentUserId={user.uid}
                        userRole={user.role}
                        responsibleMemberName={breakfastLunchResp}
                        onRefresh={fetchMealData}
                    />
                    <MealCard
                        meal={meal.lunch}
                        mealType="lunch"
                        mealId={meal.id}
                        canEdit={canEdit}
                        phoneNumber={user.phoneNumber}
                        attendance={meal.attendance}
                        totalMembers={memberCount}
                        currentUserId={user.uid}
                        userRole={user.role}
                        responsibleMemberName={breakfastLunchResp}
                        onRefresh={fetchMealData}
                    />
                    <MealCard
                        meal={meal.dinner}
                        mealType="dinner"
                        mealId={meal.id}
                        canEdit={canEdit}
                        phoneNumber={user.phoneNumber}
                        attendance={meal.attendance}
                        totalMembers={memberCount}
                        currentUserId={user.uid}
                        userRole={user.role}
                        responsibleMemberName={dinnerResp}
                        onRefresh={fetchMealData}
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
