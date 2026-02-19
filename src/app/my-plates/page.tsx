'use client';

import { useAuth } from '@/components/AuthProvider';
import Header from '@/components/Header';
import { getUserMeals } from '@/lib/firestore';
import { MealItem } from '@/types/meal';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

export default function MyPlatesPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [data, setData] = useState<{
        assigned: { date: string; mealType: string; meal: MealItem }[];
        attending: { date: string; mealType: string; meal: MealItem }[];
    } | null>(null);
    const [dataLoading, setDataLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'assigned' | 'attending'>('attending');
    const [filterType, setFilterType] = useState<'All' | 'Breakfast' | 'Lunch' | 'Dinner'>('All');

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
            return;
        }

        if (user) {
            const fetchMeals = async () => {
                const result = await getUserMeals(user.uid);
                setData(result);
                setDataLoading(false);
            };
            fetchMeals();
        }
    }, [user, loading, router]);

    if (loading || dataLoading) {
        return (
            <div className="min-h-screen bg-brand-light/30 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-brand-primary"></div>
            </div>
        );
    }

    if (!user || !data) return null;

    const filteredList = (items: { date: string; mealType: string; meal: MealItem }[]) => {
        if (filterType === 'All') return items;
        return items.filter(item => item.mealType === filterType);
    };

    const renderList = (items: { date: string; mealType: string; meal: MealItem }[]) => {
        const filteredItems = filteredList(items);

        if (filteredItems.length === 0) {
            return (
                <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-brand-light/20">
                    <p className="text-brand-dark/60 text-lg">No meals found for {filterType === 'All' ? 'this section' : filterType}.</p>
                </div>
            );
        }

        return (
            <div className="space-y-4">
                {filteredItems.map((item, idx) => (
                    <div key={idx} className="bg-white p-5 rounded-xl shadow-sm border border-brand-light/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-brand-light/20 rounded-full flex items-center justify-center text-2xl">
                                {item.mealType === 'Breakfast' ? '☕' : item.mealType === 'Lunch' ? '🥪' : '🍽️'}
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-brand-darkest">{item.meal.item_name}</h3>
                                <div className="flex items-center gap-2 text-sm text-brand-dark/70">
                                    <span className="font-semibold">{new Date(item.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                                    <span>•</span>
                                    <span className="uppercase tracking-wide text-xs font-bold">{item.mealType}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col items-end">
                                <span className="text-sm font-semibold text-brand-darkest">{item.meal.calories} kcal</span>
                                {item.meal.is_vegetarian && (
                                    <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full uppercase tracking-wide">
                                        Veg
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-brand-light/30">
            <Header />
            <main className="container mx-auto px-4 py-8">
                <div className="mb-6">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-brand-dark hover:text-brand-primary transition-colors font-medium"
                    >
                        <ArrowLeft size={20} />
                        <span>Back</span>
                    </button>
                </div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <h1 className="text-3xl font-black text-brand-darkest">My Plates</h1>

                    {/* Meal Type Filter */}
                    <div className="flex bg-white rounded-lg p-1 shadow-sm border border-brand-light/20 overflow-x-auto">
                        {(['All', 'Breakfast', 'Lunch', 'Dinner'] as const).map((type) => (
                            <button
                                key={type}
                                onClick={() => setFilterType(type)}
                                className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all whitespace-nowrap ${filterType === type
                                    ? 'bg-brand-secondary text-brand-darkest shadow-sm'
                                    : 'text-brand-dark/50 hover:bg-brand-light/10 hover:text-brand-dark'
                                    }`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex gap-2 mb-6 bg-brand-light/10 p-1 rounded-xl w-fit">
                    <button
                        onClick={() => setActiveTab('attending')}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'attending'
                            ? 'bg-white text-brand-darkest shadow-sm'
                            : 'text-brand-dark/60 hover:text-brand-dark'
                            }`}
                    >
                        On My Menu
                    </button>
                    {(user.role === 'user' || user.role === 'member') && (
                        <button
                            onClick={() => setActiveTab('assigned')}
                            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'assigned'
                                ? 'bg-white text-brand-darkest shadow-sm'
                                : 'text-brand-dark/60 hover:text-brand-dark'
                                }`}
                        >
                            Cooking Duties
                        </button>
                    )}
                </div>

                {activeTab === 'attending' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-brand-darkest">What I'm Eating</h2>
                            <span className="text-sm font-bold text-brand-primary bg-brand-primary/10 px-3 py-1 rounded-full">
                                {filteredList(data.attending).length} Meals
                            </span>
                        </div>
                        {renderList(data.attending)}
                    </div>
                )}

                {activeTab === 'assigned' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-brand-darkest">What I'm Cooking</h2>
                            <span className="text-sm font-bold text-brand-primary bg-brand-primary/10 px-3 py-1 rounded-full">
                                {filteredList(data.assigned).length} Tasks
                            </span>
                        </div>
                        {renderList(data.assigned)}
                    </div>
                )}
            </main>
        </div>
    );
}
