'use client';

import { useAuth } from '@/components/AuthProvider';
import { useLocale } from '@/context/LocaleContext';
import { User as UserIcon, Mail, Phone, Hash, Shield, Users, Utensils, RefreshCw, CheckCircle2, ChefHat, Plus, X, Scale, Trash2, Calendar } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { getHouseholdDietCategory, changeDietCategory, getAllHouseholdMembers, createUser, removeHouseholdMember } from '@/lib/auth';
import { resetHouseholdResponsibilities, getHouseholdAssignmentCounts } from '@/lib/firestore';
import { isCalendarConnected } from '@/lib/calendarTokens';

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

    const [cooks, setCooks] = useState<{ uid: string; email: string; label: string; phoneNumber?: string }[]>([]);
    const [loadingCooks, setLoadingCooks] = useState(true);

    const [members, setMembers] = useState<{ uid: string; email: string; role: string; label: string; phoneNumber?: string }[]>([]);
    const [assignmentCounts, setAssignmentCounts] = useState<Record<string, number>>({});
    const [loadingMembers, setLoadingMembers] = useState(true);
    const [removingUid, setRemovingUid] = useState<string | null>(null);
    const [isAddingCook, setIsAddingCook] = useState(false);
    const [cookPhone, setCookPhone] = useState('');
    const [cookPin, setCookPin] = useState('');
    const [cookError, setCookError] = useState('');
    const [savingCook, setSavingCook] = useState(false);

    const [resettingResp, setResettingResp] = useState(false);
    const [resetRespResult, setResetRespResult] = useState<{ ok: boolean; msg: string } | null>(null);

    const [calendarStatus, setCalendarStatus] = useState<{ connected: boolean; email?: string } | null>(null);
    const [disconnectingCal, setDisconnectingCal] = useState(false);
    const [syncingCal, setSyncingCal] = useState(false);
    const [syncResult, setSyncResult] = useState<string | null>(null);

    const loadCalendarStatus = () => {
        if (!user?.uid) return;
        isCalendarConnected(user.uid).then(setCalendarStatus).catch(() => setCalendarStatus({ connected: false }));
    };

    useEffect(() => {
        loadCalendarStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid]);

    const handleConnectCalendar = () => {
        window.location.href = '/api/calendar/oauth/start';
    };

    const handleSyncCalendar = async () => {
        setSyncingCal(true);
        setSyncResult(null);
        try {
            const res = await fetch('/api/calendar/backfill', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setSyncResult(`Synced ${data.synced} day${data.synced === 1 ? '' : 's'}. Check your Google Calendar.`);
            } else {
                setSyncResult(`Sync failed: ${data.error ?? 'unknown error'}`);
            }
        } catch (err: any) {
            setSyncResult(`Sync failed: ${err?.message ?? 'network error'}`);
        } finally {
            setSyncingCal(false);
            setTimeout(() => setSyncResult(null), 6000);
        }
    };

    const handleDisconnectCalendar = async () => {
        if (!confirm('Disconnect Google Calendar? Existing events will remain on your calendar but new meal assignments won\'t sync.')) return;
        setDisconnectingCal(true);
        try {
            await fetch('/api/calendar/disconnect', { method: 'POST' });
            loadCalendarStatus();
        } finally {
            setDisconnectingCal(false);
        }
    };

    const handleResetResponsibilities = async () => {
        if (!user?.householdId) return;
        if (!confirm('Reset all cooking responsibilities and split them evenly across every household member? This will overwrite existing assignments for every day.')) return;

        setResettingResp(true);
        setResetRespResult(null);
        const result = await resetHouseholdResponsibilities(user.householdId);
        setResettingResp(false);

        if (result.success) {
            setResetRespResult({ ok: true, msg: `Redistributed across ${result.updated} day${result.updated === 1 ? '' : 's'}.` });
            loadMembers();
        } else {
            setResetRespResult({ ok: false, msg: result.error || 'Failed to redistribute responsibilities.' });
        }
        setTimeout(() => setResetRespResult(null), 4000);
    };

    useEffect(() => {
        if (user?.householdId) {
            getHouseholdDietCategory(user.householdId).then(cat => {
                setDietCategory(cat);
                setLoadingDiet(false);
            });
        }
    }, [user]);

    const loadCooks = () => {
        setLoadingCooks(true);
        getAllHouseholdMembers().then((list) => {
            setCooks(list.filter((m) => m.role === 'cook'));
            setLoadingCooks(false);
        });
    };

    useEffect(() => {
        if (user?.role === 'user') {
            loadCooks();
        } else {
            setLoadingCooks(false);
        }
    }, [user]);

    const loadMembers = () => {
        if (!user?.householdId) return;
        setLoadingMembers(true);
        Promise.all([
            getAllHouseholdMembers(),
            getHouseholdAssignmentCounts(user.householdId),
        ]).then(([list, counts]) => {
            setMembers(list.filter(m => m.role !== 'cook'));
            setAssignmentCounts(counts);
            setLoadingMembers(false);
        }).catch(() => setLoadingMembers(false));
    };

    useEffect(() => {
        loadMembers();
    }, [user]);

    const handleRemoveMember = async (uid: string, label: string) => {
        if (!confirm(`Remove ${label} from your household? Cooking duties will be redistributed evenly across the remaining members.`)) return;
        setRemovingUid(uid);
        const result = await removeHouseholdMember(uid, 'member');
        if (!result.success) {
            setRemovingUid(null);
            alert(result.error || 'Failed to remove member.');
            return;
        }
        if (user?.householdId) {
            await resetHouseholdResponsibilities(user.householdId);
        }
        setRemovingUid(null);
        loadMembers();
    };

    const handleRemoveCook = async (uid: string, label: string) => {
        if (!confirm(`Remove ${label} from your household? They will no longer be able to log in.`)) return;
        setRemovingUid(uid);
        const result = await removeHouseholdMember(uid, 'cook');
        setRemovingUid(null);
        if (result.success) {
            loadCooks();
        } else {
            alert(result.error || 'Failed to remove cook.');
        }
    };

    const handleAddCook = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?.uid) return;
        setCookError('');

        if (!/^\+?\d{7,15}$/.test(cookPhone.trim())) {
            setCookError('Enter a valid phone number.');
            return;
        }
        if (!/^\d{4,6}$/.test(cookPin.trim())) {
            setCookError('PIN must be 4–6 digits.');
            return;
        }

        setSavingCook(true);
        const result = await createUser('', cookPin.trim(), 'cook', cookPhone.trim(), user.uid);
        setSavingCook(false);

        if (result.success) {
            setCookPhone('');
            setCookPin('');
            setIsAddingCook(false);
            loadCooks();
        } else {
            setCookError(result.error || 'Failed to add cook.');
        }
    };

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
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                                <h3 className="text-xl font-bold text-brand-secondary flex items-center gap-3">
                                    <Calendar size={24} />
                                    Google Calendar Sync
                                </h3>
                                {calendarStatus?.connected ? (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleSyncCalendar}
                                            disabled={syncingCal}
                                            className="text-sm bg-brand-secondary/20 hover:bg-brand-secondary/30 text-brand-secondary px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                                        >
                                            <RefreshCw size={14} className={syncingCal ? 'animate-spin' : ''} />
                                            {syncingCal ? 'Syncing…' : 'Sync now'}
                                        </button>
                                        <button
                                            onClick={handleDisconnectCalendar}
                                            disabled={disconnectingCal}
                                            className="text-sm bg-red-500/20 hover:bg-red-500/30 text-red-300 px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50"
                                        >
                                            {disconnectingCal ? 'Disconnecting…' : 'Disconnect'}
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleConnectCalendar}
                                        className="text-sm bg-white text-black hover:bg-gray-100 px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2"
                                    >
                                        <Calendar size={14} /> Connect
                                    </button>
                                )}
                            </div>
                            {calendarStatus === null ? (
                                <div className="animate-pulse h-12 bg-white/5 rounded-xl" />
                            ) : calendarStatus.connected ? (
                                <div className="bg-green-500/10 border border-green-500/30 text-green-300 p-4 rounded-xl">
                                    <div className="font-bold">Connected{calendarStatus.email ? ` as ${calendarStatus.email}` : ''}</div>
                                    <div className="text-sm opacity-80 mt-1">Meals you're assigned to cook appear on your calendar with a 1 hour & 15 min reminder. Chef changes update automatically. Use <strong>Sync now</strong> to push the next 30 days.</div>
                                    {syncResult && (
                                        <div className="mt-2 text-sm text-white/90 bg-white/5 rounded-lg px-3 py-2">{syncResult}</div>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-white/5 border border-white/10 text-gray-300 p-4 rounded-xl text-sm">
                                    Connect your Google account so meals you're assigned to cook show up on your calendar. Each member connects their own account — chef reassignments (skips, redistributions) update the right calendar automatically.
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

                        <section className="bg-black/30 rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors">
                            <h3 className="text-xl font-bold text-brand-secondary mb-6 flex items-center gap-3">
                                <Users size={24} />
                                Household Members
                                {!loadingMembers && (
                                    <span className="text-sm font-semibold text-gray-400 ml-1">({members.length})</span>
                                )}
                            </h3>
                            {loadingMembers ? (
                                <div className="animate-pulse h-16 bg-white/5 rounded-xl"></div>
                            ) : members.length === 0 ? (
                                <div className="text-gray-400 text-sm">No members found.</div>
                            ) : (
                                <ul className="space-y-3">
                                    {members.map((m) => {
                                        const count = assignmentCounts[m.uid] ?? 0;
                                        const roleLabel = m.role === 'user' ? 'Owner' : 'Member';
                                        const canRemove = user.role === 'user' && m.role === 'member' && m.uid !== user.uid;
                                        const isRemoving = removingUid === m.uid;
                                        return (
                                            <li
                                                key={m.uid}
                                                className="bg-white/5 p-4 rounded-xl border border-white/5 flex items-center gap-4"
                                            >
                                                <div className="w-11 h-11 rounded-full bg-brand-secondary/20 text-brand-secondary flex items-center justify-center shrink-0 font-bold">
                                                    {m.label.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-bold text-white truncate">{m.label}</div>
                                                    <div className="text-xs text-gray-400 uppercase tracking-wider">{roleLabel}</div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <div className="text-2xl font-black text-brand-secondary leading-none">{count}</div>
                                                    <div className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
                                                        {count === 1 ? 'task' : 'tasks'}
                                                    </div>
                                                </div>
                                                {canRemove && (
                                                    <button
                                                        onClick={() => handleRemoveMember(m.uid, m.label)}
                                                        disabled={isRemoving}
                                                        aria-label={`Remove ${m.label}`}
                                                        className="shrink-0 w-9 h-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center transition-colors disabled:opacity-50"
                                                    >
                                                        {isRemoving ? (
                                                            <div className="animate-spin w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full" />
                                                        ) : (
                                                            <Trash2 size={16} />
                                                        )}
                                                    </button>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>

                        {user.role === 'user' && (
                            <section className="bg-black/30 rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                                    <h3 className="text-xl font-bold text-brand-secondary flex items-center gap-3">
                                        <ChefHat size={24} />
                                        Household Cooks
                                    </h3>
                                    {!isAddingCook && !loadingCooks && (
                                        <button
                                            onClick={() => { setIsAddingCook(true); setCookError(''); }}
                                            className="text-sm bg-brand-secondary text-brand-darkest hover:brightness-110 px-4 py-2 rounded-lg font-bold transition-all flex items-center gap-2"
                                        >
                                            <Plus size={16} /> Add Cook
                                        </button>
                                    )}
                                </div>

                                {loadingCooks ? (
                                    <div className="animate-pulse h-16 bg-white/5 rounded-xl"></div>
                                ) : isAddingCook ? (
                                    <form onSubmit={handleAddCook} className="space-y-4 bg-white/5 p-5 rounded-xl border border-white/10">
                                        <div>
                                            <label className="text-sm text-gray-300 mb-1.5 flex items-center gap-2">
                                                <Phone size={14} /> Cook Phone Number
                                            </label>
                                            <input
                                                type="tel"
                                                value={cookPhone}
                                                onChange={(e) => setCookPhone(e.target.value)}
                                                placeholder="+1234567890"
                                                className="w-full px-4 py-3 bg-white/10 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-secondary"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm text-gray-300 mb-1.5 flex items-center gap-2">
                                                <Hash size={14} /> Login PIN (4–6 digits)
                                            </label>
                                            <input
                                                type="password"
                                                value={cookPin}
                                                onChange={(e) => setCookPin(e.target.value)}
                                                placeholder="e.g. 1234"
                                                inputMode="numeric"
                                                className="w-full px-4 py-3 bg-white/10 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-secondary"
                                                required
                                            />
                                            <p className="mt-1 text-xs text-gray-400">The cook will log in using this phone number and PIN.</p>
                                        </div>
                                        {cookError && (
                                            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 p-3 rounded-lg">
                                                {cookError}
                                            </div>
                                        )}
                                        <div className="flex gap-3">
                                            <button
                                                type="submit"
                                                disabled={savingCook}
                                                className="flex-1 bg-brand-secondary text-brand-darkest hover:brightness-110 disabled:opacity-50 font-bold py-3 rounded-lg transition-all"
                                            >
                                                {savingCook ? 'Adding…' : 'Save Cook'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { setIsAddingCook(false); setCookError(''); setCookPhone(''); setCookPin(''); }}
                                                className="px-4 py-3 bg-white/10 hover:bg-white/20 rounded-lg font-semibold transition-colors flex items-center gap-2"
                                            >
                                                <X size={16} /> Cancel
                                            </button>
                                        </div>
                                    </form>
                                ) : cooks.length === 0 ? (
                                    <div className="bg-white/5 p-6 rounded-xl border border-white/5 text-center">
                                        <ChefHat size={40} className="mx-auto text-gray-500 mb-3" />
                                        <div className="text-gray-300 mb-1">No cook added yet</div>
                                        <div className="text-sm text-gray-500">Add a cook so they can log in with a phone number and PIN.</div>
                                    </div>
                                ) : (
                                    <ul className="space-y-3">
                                        {cooks.map((cook) => {
                                            const isRemoving = removingUid === cook.uid;
                                            return (
                                                <li
                                                    key={cook.uid}
                                                    className="bg-white/5 p-4 rounded-xl border border-white/5 flex items-center gap-4"
                                                >
                                                    <div className="w-11 h-11 rounded-full bg-brand-secondary/20 text-brand-secondary flex items-center justify-center shrink-0">
                                                        <ChefHat size={20} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="font-bold text-white truncate">{cook.label || 'Cook'}</div>
                                                        <div className="text-sm text-gray-400 flex items-center gap-1.5">
                                                            <Phone size={12} /> {cook.phoneNumber || '—'}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRemoveCook(cook.uid, cook.label || 'Cook')}
                                                        disabled={isRemoving}
                                                        aria-label={`Remove ${cook.label || 'cook'}`}
                                                        className="shrink-0 w-9 h-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center transition-colors disabled:opacity-50"
                                                    >
                                                        {isRemoving ? (
                                                            <div className="animate-spin w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full" />
                                                        ) : (
                                                            <Trash2 size={16} />
                                                        )}
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </section>
                        )}

                        {user.role === 'user' && (
                            <section className="bg-black/30 rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors">
                                <h3 className="text-xl font-bold text-brand-secondary mb-3 flex items-center gap-3">
                                    <Scale size={24} />
                                    Cooking Responsibilities
                                </h3>
                                <p className="text-sm text-gray-400 mb-5">
                                    Reset every day's Breakfast+Lunch and Dinner assignments and split them evenly across all household members.
                                </p>
                                <button
                                    onClick={handleResetResponsibilities}
                                    disabled={resettingResp}
                                    className="w-full sm:w-auto bg-brand-secondary text-brand-darkest hover:brightness-110 disabled:opacity-50 font-bold px-6 py-3 rounded-lg transition-all flex items-center justify-center gap-2"
                                >
                                    {resettingResp ? (
                                        <>
                                            <div className="animate-spin w-4 h-4 border-2 border-brand-darkest border-t-transparent rounded-full" />
                                            Redistributing…
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw size={16} />
                                            Reset & Divide Equally
                                        </>
                                    )}
                                </button>
                                {resetRespResult && (
                                    <div
                                        className={`mt-4 p-3 rounded-lg text-sm ${
                                            resetRespResult.ok
                                                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                                                : 'bg-red-500/10 border border-red-500/30 text-red-400'
                                        }`}
                                    >
                                        {resetRespResult.msg}
                                    </div>
                                )}
                            </section>
                        )}

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
