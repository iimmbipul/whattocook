import { getMealByDate } from '@/lib/firestore';
import { getFormattedDate } from '@/lib/permissions';
import MealCard from './MealCard';

interface DayMealsProps {
    date: string;
    label: string;
    canEdit: boolean;
    phoneNumber: string;
}

export default async function DayMeals({ date, label, canEdit, phoneNumber }: DayMealsProps) {
    const meal = await getMealByDate(date);

    if (!meal) {
        return (
            <div className="bg-white rounded-xl shadow-lg p-8">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">{label}</h2>
                <p className="text-gray-500">No meal plan available for {getFormattedDate(date)}</p>
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl shadow-lg p-6">
            <div className="mb-6">
                <h2 className="text-3xl font-bold text-gray-800 mb-1">{label}</h2>
                <p className="text-gray-600">{getFormattedDate(date)}</p>
                <div className="mt-2 inline-block bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-semibold">
                    Total: {meal.total_calories} calories
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <MealCard
                    meal={meal.breakfast}
                    mealType="breakfast"
                    mealId={meal.id}
                    canEdit={canEdit}
                    phoneNumber={phoneNumber}
                />
                <MealCard
                    meal={meal.lunch}
                    mealType="lunch"
                    mealId={meal.id}
                    canEdit={canEdit}
                    phoneNumber={phoneNumber}
                />
                <MealCard
                    meal={meal.dinner}
                    mealType="dinner"
                    mealId={meal.id}
                    canEdit={canEdit}
                    phoneNumber={phoneNumber}
                />
            </div>
        </div>
    );
}
