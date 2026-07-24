'use client';

import { useAuth } from '@/components/AuthProvider';
import { useLocale } from '@/context/LocaleContext';
import { User as UserIcon, Mail, Phone, Hash, Shield, Users, Utensils, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { getHouseholdDietCategory, changeDietCategory } from '@/lib/auth';

const DIET_CATEGORIES = [
    { id: 'Healthy', icon: '🥗', desc: 'Nutritious & low guilt' },
    { id: 'Vegan', icon: '🌱', desc: 'No animal products' },
    { id: 'Indian', icon: '🍛', desc: 'Rich & traditional' },
    { id: 'Balanced', icon: '⚖️', desc: 'Carbs, fats & proteins' },
    { id: 'Protein-Heavy', icon: '💪', desc: 'Max gains & recovery' },
    { id: 'Flexible', icon: '🍕', desc: 'A bit of everything' }
];

export default function ProfilePage() {
    const { user } = useAuth();
    const { t } = useLocale();
    const router = useRouter();

    const [dietCategory, setDietCategory] = useState<string | null>(null);
    const [loadingDiet, setLoadingDiet] = useState(true);
    const [isChangingDiet, setIsChangingDiet] = useState(false);
    const [savingDiet, setSavingDiet] = useState(false);
    const [dietSuccess, setDietSuccess] = useState(false);

    useEffect(() => {
        if (user?.householdId) {
            getHouseholdDietCategory(user.householdId).then(cat => {
                setDietCategory(cat);
                setLoadingDiet(false);
            });
        }
    }, [user]);

    const handleChangeDiet = async (newCategory: string) => {
        if (!user?.householdId) return;
        
        if (!confirm(`Are you sure you want to change your diet to ${newCategory}? This will generate a new 30-day meal plan and replace your current template.`)) return;
        
        setSavingDiet(true);
        const success = await changeDietCategory(user.householdId, newCategory);
        if (success) {
            setDietCategory(newCategory);
            setDietSuccess(true);
            setTimeout(() => {
                setDietSuccess(false);
                setIsChangingDiet(false);
            }, 3000);
        } else {
            alert('Failed to change diet category. Please try again.');
        }
        setSavingDiet(false);
    };

    if (!user) return null;

    return (
        <div className="min-h-screen bg-brand-darkest text-brand-light p-4 md:p-8">
            <div className="max-w-3xl mx-auto mt-8">
                <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-md shadow-2xl relative overflow-hidden">
                    {/* Decorative blobs */}
                    <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-brand-secondary/20 rounded-full blur-3xl pointer-events-none"></div>
                    <div className="absolute bottom-[-50px] left-[-50px] w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

                    <div className="relative z-10 flex flex-col md:flex-row items-center gap-8 mb-10 border-b border-white/10 pb-8">
                        <div className="w-28 h-28 bg-brand-secondary text-brand-darkest rounded-full flex items-center justify-center text-5xl font-black shadow-xl shrink-0 overflow-hidden border-4 border-brand-secondary">
                            {user.photoURL ? (
                                <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                user.displayName?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()
                            )}
                        </div>
                        <div className="text-center md:text-left">
                            <h1 className="text-4xl font-black tracking-tight mb-3">
                                {user.displayName || t('header.profile') || 'Profile'}
                            </h1>
                            <div className="inline-flex items-center gap-2 bg-brand-secondary/20 text-brand-secondary px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider">
                                <Shield size={16} />
                                {user.role === 'user' ? 'Owner' : user.role === 'member' ? 'Member' : 'Cook'}
                            </div>
                        </div>
                    </div>

                    <div className="relative z-10 space-y-6">
                        
                        {/* New Diet Category Section */}
                        <section className="bg-black/30 rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                                <h3 className="text-xl font-bold text-brand-secondary flex items-center gap-3">
                                    <Utensils size={24} />
                                    Household Diet Plan
                                </h3>
                                {!isChangingDiet && !savingDiet && user.role === 'user' && (
                                    <button 
                                        onClick={() => setIsChangingDiet(true)}
                                        className="text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2"
                                    >
                                        <RefreshCw size={14} /> Change Diet
                                    </button>
                                )}
                            </div>

                            {loadingDiet ? (
                                <div className="animate-pulse h-16 bg-white/5 rounded-xl"></div>
                            ) : dietSuccess ? (
                                <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-4 rounded-xl flex items-center gap-3">
                                    <CheckCircle2 size={24} />
                                    <div>
                                        <div className="font-bold">Successfully updated!</div>
                                        <div className="text-sm opacity-80">Your new 30-day template has been generated.</div>
                                    </div>
                                </div>
                            ) : savingDiet ? (
                                <div className="flex flex-col items-center justify-center space-y-3 py-6 text-brand-secondary bg-brand-secondary/5 rounded-xl border border-brand-secondary/10">
                                    <div className="animate-spin rounded-full h-8 w-8 border-4 border-brand-secondary border-t-transparent" />
                                    <span className="text-sm font-semibold animate-pulse">Generating your new 30-day plan via AI...</span>
                                </div>
                            ) : isChangingDiet ? (
                                <div className="space-y-4">
                                    <p className="text-sm text-gray-300">Select a new diet category below. Note: This action will replace your household's entire 30-day master template.</p>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {DIET_CATEGORIES.map(cat => (
                                            <button
                                                key={cat.id}
                                                onClick={() => handleChangeDiet(cat.id)}
                                                className={`p-4 border-2 rounded-xl transition-all text-left flex flex-col justify-center
                                                    ${dietCategory?.toLowerCase() === cat.id.toLowerCase() 
                                                        ? 'border-brand-secondary bg-brand-secondary/10' 
                                                        : 'border-white/5 bg-white/5 hover:border-brand-secondary/50 hover:bg-white/10'}`}
                                            >
                                                <div className="text-2xl mb-2">{cat.icon}</div>
                                                <div className="font-bold text-white text-sm">{cat.id}</div>
                                                <div className="text-xs text-gray-400 mt-1">{cat.desc}</div>
                                                {dietCategory?.toLowerCase() === cat.id.toLowerCase() && (
                                                    <div className="text-brand-secondary text-xs font-bold mt-2 uppercase">Current Phase</div>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                    <button 
                                        onClick={() => setIsChangingDiet(false)}
                                        className="mt-4 text-sm text-gray-400 hover:text-white transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="bg-white/5 p-5 rounded-xl border border-white/5 flex items-center gap-6">
                                    <div className="text-5xl">
                                        {DIET_CATEGORIES.find(c => c.id.toLowerCase() === dietCategory?.toLowerCase())?.icon || '🍽️'}
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-400 mb-1">Current Active Plan</div>
                                        <div className="font-bold text-2xl text-white">{dietCategory || 'Custom Template'}</div>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section className="bg-black/30 rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors">
                            <h3 className="text-xl font-bold text-brand-secondary mb-6 flex items-center gap-3">
                                <UserIcon size={24} />
                                Account Details
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <div className="text-sm text-gray-400 mb-1.5 flex items-center gap-2">
                                        <Mail size={16} /> Email Address
                                    </div>
                                    <div className="font-medium text-lg break-all">{user.email}</div>
                                </div>
                                <div>
                                    <div className="text-sm text-gray-400 mb-1.5 flex items-center gap-2">
                                        <Phone size={16} /> Phone Number
                                    </div>
                                    <div className="font-medium text-lg">{user.phoneNumber || 'Not provided'}</div>
                                </div>
                            </div>
                        </section>

                        <section className="bg-black/30 rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors">
                            <h3 className="text-xl font-bold text-brand-secondary mb-6 flex items-center gap-3">
                                <Users size={24} />
                                Household Info
                            </h3>
                            <div className="space-y-4">
                                {user.houseCode ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="bg-white/5 p-5 rounded-xl border border-white/5 flex flex-col items-center sm:items-start">
                                            <div className="text-sm text-gray-400 mb-2 flex items-center gap-2">
                                                <Hash size={16} /> House Code
                                            </div>
                                            <div className="font-mono font-bold text-3xl text-indigo-400 tracking-widest">{user.houseCode}</div>
                                        </div>
                                        <div className="bg-white/5 p-5 rounded-xl border border-white/5 flex flex-col items-center sm:items-start">
                                            <div className="text-sm text-gray-400 mb-2 flex items-center gap-2">
                                                <Hash size={16} /> House PIN
                                            </div>
                                            <div className="font-mono font-bold text-3xl text-indigo-400 tracking-widest">{user.housePin}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-gray-300 bg-white/5 p-5 rounded-xl border border-white/5">
                                        You are currently part of a household assigned by an owner. Your internal household ID is <span className="font-mono text-sm block mt-2 text-brand-secondary">{user.householdId}</span>
                                    </div>
                                )}
                            </div>
                        </section>

                    </div>
                    
                    <button
                        onClick={() => router.push('/')}
                        className="relative z-10 mt-10 w-full bg-brand-light text-brand-darkest hover:bg-brand-secondary hover:text-brand-darkest font-black text-lg py-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg"
                    >
                        Return to Dashboard
                    </button>
                </div>
            </div>
        </div>
    );
}
