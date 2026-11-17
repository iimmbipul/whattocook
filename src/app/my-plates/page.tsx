'use client';

import { useAuth } from '@/components/AuthProvider';
import AppShell, { PageHeader } from '@/components/AppShell';
import { getUserMeals } from '@/lib/firestore';
import { MealItem } from '@/types/meal';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { ChefHat, Leaf, UtensilsCrossed } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Card, EmptyState } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';

type Entry = { date: string; mealType: string; meal: MealItem };
type MealFilter = 'All' | 'Breakfast' | 'Lunch' | 'Dinner';

const MEAL_ORDER: Record<string, number> = { Breakfast: 0, Lunch: 1, Dinner: 2 };
const MEAL_ICON: Record<string, string> = { Breakfast: '☕', Lunch: '🥗', Dinner: '🍲' };

const localDay = (d: Date) => format(d, 'yyyy-MM-dd');

export default function MyPlatesPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const { t } = useLocale();
    const [data, setData] = useState<{ assigned: Entry[]; attending: Entry[] } | null>(null);
    const [dataLoading, setDataLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'assigned' | 'attending'>('attending');
    const [filterType, setFilterType] = useState<MealFilter>('All');
    const [showEarlier, setShowEarlier] = useState(false);

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
            return;
        }

        if (user) {
            const fetchMeals = async () => {
                const result = await getUserMeals(user.uid, user.householdId);
                setData(result);
                setDataLoading(false);
            };
            fetchMeals();
        }
    }, [user, loading, router]);

    if (!loading && !user) return null;

    const canCook = user?.role === 'user' || user?.role === 'member';
    const items = (activeTab === 'attending' ? data?.attending : data?.assigned) ?? [];
    const filtered = filterType === 'All' ? items : items.filter(item => item.mealType === filterType);

    const todayStr = localDay(new Date());
    const tomorrowStr = localDay(addDays(new Date(), 1));
    const upcoming = filtered.filter(i => i.date >= todayStr);
    const earlier = filtered.filter(i => i.date < todayStr);
    const visible = showEarlier ? [...earlier, ...upcoming] : upcoming;

    // Group by day, keeping breakfast → lunch → dinner order within a day.
    const days: { date: string; entries: Entry[] }[] = [];
    for (const entry of visible) {
        const last = days[days.length - 1];
        if (last && last.date === entry.date) last.entries.push(entry);
        else days.push({ date: entry.date, entries: [entry] });
    }
    days.forEach(d => d.entries.sort((a, b) => (MEAL_ORDER[a.mealType] ?? 9) - (MEAL_ORDER[b.mealType] ?? 9)));

    const dayLabel = (date: string) => {
        if (date === todayStr) return t('myPlates.today');
        if (date === tomorrowStr) return t('myPlates.tomorrow');
        return format(new Date(`${date}T00:00:00`), 'EEEE, MMM d');
    };

    const isLoading = loading || dataLoading;

    return (
        <AppShell>
            <PageHeader title={t('myPlates.title')} subtitle={t('myPlates.subtitle')} />

            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {canCook ? (
                    <Segmented
                        label={t('myPlates.viewLabel')}
                        value={activeTab}
                        onChange={setActiveTab}
                        options={[
                            { value: 'attending', label: t('myPlates.eatingTab') },
                            { value: 'assigned', label: t('myPlates.cookingTab') },
                        ]}
                    />
                ) : <span />}
                <Segmented
                    label={t('myPlates.filterLabel')}
                    size="sm"
                    value={filterType}
                    onChange={setFilterType}
                    options={[
                        { value: 'All', label: t('myPlates.all') },
                        { value: 'Breakfast', label: t('mealCard.breakfast') },
                        { value: 'Lunch', label: t('mealCard.lunch') },
                        { value: 'Dinner', label: t('mealCard.dinner') },
                    ]}
                />
            </div>

            {isLoading ? (
                <div className="space-y-4" aria-busy="true" aria-label={t('common.loading')}>
                    {[0, 1, 2].map(i => (
                        <div key={i}>
                            <Skeleton className="mb-2 h-4 w-28" />
                            <Card className="divide-y divide-line">
                                {[0, 1].map(j => (
                                    <div key={j} className="flex items-center gap-3 p-4">
                                        <Skeleton className="h-10 w-10 rounded-xl" />
                                        <div className="flex-1 space-y-2"><Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-1/2" /></div>
                                    </div>
                                ))}
                            </Card>
                        </div>
                    ))}
                </div>
            ) : (
                <>
                    <p className="mb-3 text-sm font-medium text-ink-muted" aria-live="polite">
                        {activeTab === 'attending'
                            ? t('myPlates.countMeals', { count: visible.length })
                            : t('myPlates.countTasks', { count: visible.length })}
                    </p>

                    {earlier.length > 0 && (
                        <Button variant="ghost" size="sm" className="mb-3 -ml-3" onClick={() => setShowEarlier(v => !v)} aria-expanded={showEarlier}>
                            {showEarlier ? t('myPlates.hideEarlier') : `${t('myPlates.showEarlier')} (${earlier.length})`}
                        </Button>
                    )}

                    {days.length === 0 ? (
                        <Card>
                            <EmptyState
                                icon={activeTab === 'attending' ? <UtensilsCrossed size={22} /> : <ChefHat size={22} />}
                                title={activeTab === 'attending' ? t('myPlates.emptyEating') : t('myPlates.emptyCooking')}
                            />
                        </Card>
                    ) : (
                        <div className="space-y-5">
                            {days.map(day => (
                                <section key={day.date} aria-label={dayLabel(day.date)}>
                                    <h2 className="mb-2 text-sm font-semibold text-ink">
                                        {dayLabel(day.date)}
                                        {day.date < todayStr && <span className="font-normal text-ink-muted"> · {format(new Date(`${day.date}T00:00:00`), 'yyyy')}</span>}
                                    </h2>
                                    <Card className="divide-y divide-line">
                                        {day.entries.map(entry => (
                                            <div key={`${entry.date}-${entry.mealType}`} className="flex items-center gap-3 px-4 py-3.5">
                                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-lg" aria-hidden="true">
                                                    {MEAL_ICON[entry.mealType] ?? '🍽️'}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs font-semibold uppercase tracking-wider text-accent-strong">
                                                        {t(`mealCard.${entry.mealType.toLowerCase()}`)}
                                                    </p>
                                                    <p className="truncate text-[15px] font-medium text-ink">{entry.meal.item_name}</p>
                                                </div>
                                                <div className="flex shrink-0 flex-col items-end gap-1">
                                                    <span className="text-sm font-medium text-ink-muted">{entry.meal.calories} kcal</span>
                                                    {entry.meal.is_vegetarian && <Badge tone="success"><Leaf size={11} aria-hidden="true" /> {t('mealCard.veg')}</Badge>}
                                                </div>
                                            </div>
                                        ))}
                                    </Card>
                                </section>
                            ))}
                        </div>
                    )}
                </>
            )}
        </AppShell>
    );
}
