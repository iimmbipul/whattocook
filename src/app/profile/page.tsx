'use client';

import { useAuth } from '@/components/AuthProvider';
import { useLocale } from '@/context/LocaleContext';
import { Phone, Shield, Users, Utensils, RefreshCw, ChefHat, Plus, Scale, Trash2, Calendar, CalendarCheck2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { changeDietCategory, getAllHouseholdMembers, createUser, removeHouseholdMember } from '@/lib/auth';
import { resetHouseholdResponsibilities, getHouseholdAssignmentCounts } from '@/lib/firestore';
import { isCalendarConnected } from '@/lib/calendarTokens';
import { getProfileData } from '@/lib/pageData';
import AppShell from '@/components/AppShell';
import { displayNameOf } from '@/components/Header';
import { Section } from '@/components/ui/Card';
import { Avatar, Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, Field, TextInput } from '@/components/ui/Field';
import { Skeleton, Spinner } from '@/components/ui/Spinner';
import { CopyValue } from '@/components/ui/CopyValue';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';

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
    const { confirm, dialog } = useConfirm();

    const [dietCategory, setDietCategory] = useState<string | null>(null);
    const [loadingDiet, setLoadingDiet] = useState(true);
    const [isChangingDiet, setIsChangingDiet] = useState(false);
    const [savingDiet, setSavingDiet] = useState(false);
    const [dietSuccess, setDietSuccess] = useState(false);
    const [dietError, setDietError] = useState('');

    const [cooks, setCooks] = useState<{ uid: string; email: string; label: string; phoneNumber?: string }[]>([]);
    const [loadingCooks, setLoadingCooks] = useState(true);

    const [members, setMembers] = useState<{ uid: string; email: string; role: string; label: string; phoneNumber?: string }[]>([]);
    const [assignmentCounts, setAssignmentCounts] = useState<Record<string, number>>({});
    const [loadingMembers, setLoadingMembers] = useState(true);
    const [removingUid, setRemovingUid] = useState<string | null>(null);
    const [removeError, setRemoveError] = useState('');
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

    const handleConnectCalendar = () => {
        window.location.href = '/api/calendar/oauth/start';
    };

    const handleSyncCalendar = async () => {
        setSyncingCal(true);
        setSyncResult(null);
        try {
            let totalSynced = 0;
            const totals = { created: 0, updated: 0, deleted: 0, noChef: 0, chefNotConnected: 0, errors: 0 };
            let offset = 0;
            for (let step = 0; step < 6; step++) {
                const res = await fetch(`/api/calendar/backfill?days=10&offset=${offset}`, { method: 'POST' });
                const data = await res.json();
                if (!res.ok) {
                    setSyncResult(`Sync failed: ${data.error ?? 'unknown error'}`);
                    return;
                }
                totalSynced += data.synced ?? 0;
                if (data.stats) {
                    totals.created += data.stats.created;
                    totals.updated += data.stats.updated;
                    totals.deleted += data.stats.deleted;
                    totals.noChef += data.stats.noChef;
                    totals.chefNotConnected += data.stats.chefNotConnected;
                    totals.errors += data.stats.errors;
                }
                setSyncResult(`Syncing… ${totalSynced} days pushed so far`);
                if (data.nextOffset == null) break;
                offset = data.nextOffset;
            }
            // Build a concise summary that also explains why events might be missing.
            const parts = [
                `${totalSynced} day${totalSynced === 1 ? '' : 's'} scanned`,
                `${totals.created} created`,
                `${totals.updated} updated`,
            ];
            if (totals.deleted) parts.push(`${totals.deleted} deleted`);
            if (totals.noChef) parts.push(`${totals.noChef} slot${totals.noChef === 1 ? '' : 's'} had no chef`);
            if (totals.chefNotConnected) parts.push(`${totals.chefNotConnected} chef slot${totals.chefNotConnected === 1 ? '' : 's'} not connected`);
            if (totals.errors) parts.push(`${totals.errors} errors`);
            setSyncResult(parts.join(' · '));
        } catch (err: any) {
            setSyncResult(`Sync failed: ${err?.message ?? 'network error'}`);
        } finally {
            setSyncingCal(false);
            setTimeout(() => setSyncResult(null), 12000);
        }
    };

    const handleDisconnectCalendar = async () => {
        const ok = await confirm({
            title: 'Disconnect Google Calendar?',
            message: 'Existing events stay on your calendar, but new meal assignments won’t sync.',
            confirmLabel: 'Disconnect',
            tone: 'danger',
        });
        if (!ok) return;
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
        const ok = await confirm({
            title: 'Reset all cooking duties?',
            message: 'Every day’s Breakfast + Lunch and Dinner assignments are overwritten and split evenly across household members.',
            confirmLabel: 'Reset duties',
            tone: 'danger',
        });
        if (!ok) return;

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

    const loadCooks = () => {
        setLoadingCooks(true);
        getAllHouseholdMembers().then((list) => {
            setCooks(list.filter((m) => m.role === 'cook'));
            setLoadingCooks(false);
        });
    };

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

    // Initial load: calendar status, diet, members (incl. cooks) and duty counts
    // in a single round trip. Server Actions run one at a time, so the separate
    // calls this page used to make queued up behind each other.
    // (loadCooks / loadMembers / loadCalendarStatus still refresh after edits.)
    const profileHouseholdId = user?.householdId;
    const profileUid = user?.uid;
    const profileRole = user?.role;
    useEffect(() => {
        if (!profileHouseholdId || !profileUid) return;
        let cancelled = false;
        getProfileData(profileHouseholdId, profileUid)
            .then((data) => {
                if (cancelled) return;
                setCalendarStatus(data.calendarStatus);
                setDietCategory(data.dietCategory);
                setLoadingDiet(false);
                if (profileRole === 'user') setCooks(data.members.filter((m) => m.role === 'cook'));
                setLoadingCooks(false);
                setMembers(data.members.filter(m => m.role !== 'cook'));
                setAssignmentCounts(data.assignmentCounts);
                setLoadingMembers(false);
            })
            .catch(() => {
                if (cancelled) return;
                setCalendarStatus({ connected: false });
                setLoadingDiet(false);
                setLoadingCooks(false);
                setLoadingMembers(false);
            });
        return () => { cancelled = true; };
    }, [profileHouseholdId, profileUid, profileRole]);

    const handleRemoveMember = async (uid: string, label: string) => {
        const ok = await confirm({
            title: `Remove ${label}?`,
            message: 'They lose access to this household, and cooking duties are redistributed evenly across the remaining members.',
            confirmLabel: 'Remove',
            tone: 'danger',
        });
        if (!ok) return;
        setRemoveError('');
        setRemovingUid(uid);
        const result = await removeHouseholdMember(uid, 'member');
        if (!result.success) {
            setRemovingUid(null);
            setRemoveError(result.error || 'Failed to remove member.');
            return;
        }
        if (user?.householdId) {
            await resetHouseholdResponsibilities(user.householdId);
        }
        setRemovingUid(null);
        loadMembers();
    };

    const handleRemoveCook = async (uid: string, label: string) => {
        const ok = await confirm({
            title: `Remove ${label}?`,
            message: 'They will no longer be able to log in.',
            confirmLabel: 'Remove',
            tone: 'danger',
        });
        if (!ok) return;
        setRemoveError('');
        setRemovingUid(uid);
        const result = await removeHouseholdMember(uid, 'cook');
        setRemovingUid(null);
        if (result.success) {
            loadCooks();
        } else {
            setRemoveError(result.error || 'Failed to remove cook.');
        }
    };

    const handleAddCook = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?.uid) return;
        setCookError('');

        if (!/^\+?\d{7,15}$/.test(cookPhone.trim())) {
            setCookError('Enter a valid phone number, e.g. +919876543210.');
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
        const ok = await confirm({
            title: `Switch to ${newCategory}?`,
            message: 'A new 30-day meal plan is generated and replaces your household’s current template.',
            confirmLabel: 'Switch plan',
        });
        if (!ok) return;

        setDietError('');
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
            setDietError('Couldn’t change the diet plan. Please try again.');
        }
        setSavingDiet(false);
    };

    if (!user) return null;

    const isOwner = user.role === 'user';
    const name = displayNameOf(user);
    const roleLabel = isOwner ? 'Owner' : user.role === 'member' ? 'Member' : 'Cook';
    const currentDiet = DIET_CATEGORIES.find(c => c.id.toLowerCase() === dietCategory?.toLowerCase());

    return (
        <AppShell>
            {dialog}

            {/* Identity */}
            <div className="mb-6 flex items-center gap-4">
                <Avatar name={name} photoURL={user.photoURL} size={64} />
                <div className="min-w-0">
                    <h1 className="truncate text-2xl font-bold tracking-tight text-ink">{name || t('header.profile')}</h1>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                        <Badge tone="accent"><Shield size={12} aria-hidden="true" /> {roleLabel}</Badge>
                        {user.email && <span className="truncate">{user.email}</span>}
                        {user.phoneNumber && (
                            <span className="inline-flex items-center gap-1"><Phone size={13} aria-hidden="true" /> {user.phoneNumber}</span>
                        )}
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                {/* Diet plan */}
                <Section
                    icon={<Utensils size={18} />}
                    title="Household diet plan"
                    description="Your 30-day menu is built from this plan."
                    action={isOwner && !isChangingDiet && !savingDiet && !loadingDiet ? (
                        <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} aria-hidden="true" />} onClick={() => setIsChangingDiet(true)}>
                            Change plan
                        </Button>
                    ) : undefined}
                >
                    {dietError && <Alert tone="error" className="mb-3">{dietError}</Alert>}
                    {loadingDiet ? (
                        <Skeleton className="h-[72px] w-full rounded-xl" />
                    ) : dietSuccess ? (
                        <Alert tone="success">Plan updated — your new 30-day template is ready.</Alert>
                    ) : savingDiet ? (
                        <div role="status" className="flex items-center gap-3 rounded-xl bg-surface-muted px-4 py-5 text-sm font-medium text-ink">
                            <Spinner size={18} className="text-accent" /> Generating your new 30-day plan…
                        </div>
                    ) : isChangingDiet ? (
                        <div>
                            <p className="mb-3 text-sm text-ink-muted">Pick a new plan. This replaces your household’s entire 30-day template.</p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {DIET_CATEGORIES.map(cat => {
                                    const isCurrent = dietCategory?.toLowerCase() === cat.id.toLowerCase();
                                    return (
                                        <button
                                            key={cat.id}
                                            type="button"
                                            onClick={() => handleChangeDiet(cat.id)}
                                            disabled={isCurrent}
                                            aria-pressed={isCurrent}
                                            className={cn(
                                                'flex flex-col items-start rounded-xl border p-3.5 text-left transition-colors',
                                                isCurrent ? 'cursor-default border-accent bg-accent-soft/60' : 'border-line hover:border-line-strong hover:bg-surface-muted',
                                            )}
                                        >
                                            <span className="mb-1.5 text-2xl" aria-hidden="true">{cat.icon}</span>
                                            <span className="text-sm font-semibold text-ink">{cat.id}</span>
                                            <span className="text-xs text-ink-muted">{isCurrent ? 'Current plan' : cat.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={() => setIsChangingDiet(false)}>
                                {t('common.cancel')}
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-4 rounded-xl bg-surface-muted px-4 py-3.5">
                            <span className="text-3xl" aria-hidden="true">{currentDiet?.icon || '🍽️'}</span>
                            <div>
                                <div className="text-xs font-medium text-ink-muted">Current plan</div>
                                <div className="text-lg font-semibold text-ink">{dietCategory || 'Custom template'}</div>
                            </div>
                        </div>
                    )}
                </Section>

                {/* Calendar */}
                <Section
                    icon={<Calendar size={18} />}
                    title="Google Calendar"
                    description="Meals you’re assigned to cook show up on your calendar."
                    action={calendarStatus === null ? undefined : calendarStatus.connected ? (
                        <div className="flex gap-2">
                            <Button variant="secondary" size="sm" loading={syncingCal} loadingText="Syncing…" leadingIcon={<RefreshCw size={14} aria-hidden="true" />} onClick={handleSyncCalendar}>
                                Sync now
                            </Button>
                            <Button variant="danger-soft" size="sm" loading={disconnectingCal} onClick={handleDisconnectCalendar}>
                                Disconnect
                            </Button>
                        </div>
                    ) : (
                        <Button size="sm" leadingIcon={<Calendar size={14} aria-hidden="true" />} onClick={handleConnectCalendar}>
                            Connect
                        </Button>
                    )}
                >
                    {calendarStatus === null ? (
                        <Skeleton className="h-12 w-full rounded-xl" />
                    ) : calendarStatus.connected ? (
                        <div className="space-y-2">
                            <p className="flex items-center gap-2 text-sm font-medium text-success">
                                <CalendarCheck2 size={16} aria-hidden="true" />
                                Connected{calendarStatus.email ? ` as ${calendarStatus.email}` : ''}
                            </p>
                            <p className="text-sm text-ink-muted">
                                Events include a reminder, and chef changes update automatically. Use <strong className="font-semibold text-ink">Sync now</strong> to push the next 30 days.
                            </p>
                            {syncResult && <Alert tone="info">{syncResult}</Alert>}
                        </div>
                    ) : (
                        <p className="text-sm text-ink-muted">
                            Each member connects their own Google account; skips and redistributions update the right calendar automatically.
                        </p>
                    )}
                </Section>

                {/* Household */}
                <Section
                    icon={<Users size={18} />}
                    title="Household"
                    description={user.houseCode ? 'Share the code and PIN so family members can join.' : 'You’re part of a household managed by its owner.'}
                >
                    {user.houseCode && user.housePin && (
                        <div className="mb-5 grid gap-2 sm:grid-cols-2">
                            <CopyValue label={t('nav.houseCode')} value={user.houseCode} size="lg" />
                            <CopyValue label={t('nav.housePin')} value={user.housePin} size="lg" />
                        </div>
                    )}

                    <h3 className="mb-1 text-sm font-semibold text-ink">
                        Members {!loadingMembers && <span className="font-normal text-ink-muted">({members.length})</span>}
                    </h3>
                    {removeError && <Alert tone="error" className="my-2">{removeError}</Alert>}
                    {loadingMembers ? (
                        <div className="space-y-2 pt-2">{[0, 1].map(i => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
                    ) : members.length === 0 ? (
                        <p className="py-3 text-sm text-ink-muted">No members found.</p>
                    ) : (
                        <ul className="divide-y divide-line">
                            {members.map((m) => {
                                const count = assignmentCounts[m.uid] ?? 0;
                                const canRemove = isOwner && m.role === 'member' && m.uid !== user.uid;
                                const isRemoving = removingUid === m.uid;
                                return (
                                    <li key={m.uid} className="flex items-center gap-3 py-3">
                                        <Avatar name={m.label} size={36} />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-[15px] font-medium text-ink">
                                                {m.label}
                                                {m.uid === user.uid && <span className="font-normal text-ink-muted"> · you</span>}
                                            </div>
                                            <div className="text-xs text-ink-muted">
                                                {m.role === 'user' ? 'Owner' : 'Member'} · {count} upcoming {count === 1 ? 'duty' : 'duties'}
                                            </div>
                                        </div>
                                        {canRemove && (
                                            <IconButton label={`Remove ${m.label}`} size="sm" variant="ghost" onClick={() => handleRemoveMember(m.uid, m.label)} disabled={isRemoving} className="text-ink-muted hover:bg-danger-soft hover:text-danger">
                                                {isRemoving ? <Spinner size={16} /> : <Trash2 size={16} />}
                                            </IconButton>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Section>

                {/* Cooks */}
                {isOwner && (
                    <Section
                        icon={<ChefHat size={18} />}
                        title="Cooks"
                        description="Cooks sign in with their phone number and a PIN."
                        action={!isAddingCook && !loadingCooks ? (
                            <Button variant="secondary" size="sm" leadingIcon={<Plus size={15} aria-hidden="true" />} onClick={() => { setIsAddingCook(true); setCookError(''); }}>
                                Add cook
                            </Button>
                        ) : undefined}
                    >
                        {loadingCooks ? (
                            <Skeleton className="h-12 w-full rounded-xl" />
                        ) : isAddingCook ? (
                            <form onSubmit={handleAddCook} className="space-y-4 rounded-xl border border-line p-4" noValidate>
                                <Field label="Cook’s phone number" required error={cookError && !/^\+?\d{7,15}$/.test(cookPhone.trim()) ? cookError : undefined}>
                                    <TextInput type="tel" inputMode="tel" autoComplete="off" value={cookPhone} onChange={(e) => setCookPhone(e.target.value)} placeholder="+919876543210" />
                                </Field>
                                <Field
                                    label="Login PIN"
                                    required
                                    hint="4–6 digits. The cook uses it with their phone number to log in."
                                    error={cookError && /^\+?\d{7,15}$/.test(cookPhone.trim()) ? cookError : undefined}
                                >
                                    <TextInput type="password" inputMode="numeric" autoComplete="new-password" value={cookPin} onChange={(e) => setCookPin(e.target.value)} placeholder="••••" maxLength={6} />
                                </Field>
                                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                    <Button variant="secondary" onClick={() => { setIsAddingCook(false); setCookError(''); setCookPhone(''); setCookPin(''); }}>
                                        {t('common.cancel')}
                                    </Button>
                                    <Button type="submit" loading={savingCook} loadingText="Adding…">Save cook</Button>
                                </div>
                            </form>
                        ) : cooks.length === 0 ? (
                            <p className="text-sm text-ink-muted">No cook added yet.</p>
                        ) : (
                            <ul className="divide-y divide-line">
                                {cooks.map((cook) => {
                                    const isRemoving = removingUid === cook.uid;
                                    const cookName = cook.label || 'Cook';
                                    return (
                                        <li key={cook.uid} className="flex items-center gap-3 py-3">
                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong" aria-hidden="true">
                                                <ChefHat size={17} />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-[15px] font-medium text-ink">{cookName}</div>
                                                <div className="text-xs text-ink-muted">{cook.phoneNumber || '—'}</div>
                                            </div>
                                            <IconButton label={`Remove ${cookName}`} size="sm" variant="ghost" onClick={() => handleRemoveCook(cook.uid, cookName)} disabled={isRemoving} className="text-ink-muted hover:bg-danger-soft hover:text-danger">
                                                {isRemoving ? <Spinner size={16} /> : <Trash2 size={16} />}
                                            </IconButton>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Section>
                )}

                {/* Duties */}
                {isOwner && (
                    <Section
                        icon={<Scale size={18} />}
                        title="Cooking duties"
                        description="Reset every day’s Breakfast + Lunch and Dinner assignments and split them evenly."
                    >
                        <Button variant="secondary" loading={resettingResp} loadingText="Redistributing…" leadingIcon={<RefreshCw size={15} aria-hidden="true" />} onClick={handleResetResponsibilities}>
                            Reset and divide equally
                        </Button>
                        {resetRespResult && (
                            <Alert tone={resetRespResult.ok ? 'success' : 'error'} className="mt-3">{resetRespResult.msg}</Alert>
                        )}
                    </Section>
                )}
            </div>
        </AppShell>
    );
}
