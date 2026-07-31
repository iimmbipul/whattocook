'use client';

import { useState } from 'react';
import { X, UserPlus, UserMinus, Users, CheckCircle2 } from 'lucide-react';
import { addGuest, removeGuest } from '@/lib/firestore';
import { useLocale } from '@/context/LocaleContext';

interface Member {
    uid: string;
    label: string;
}

interface AttendingMembersModalProps {
    isOpen: boolean;
    onClose: () => void;
    mealId: string;
    mealType: 'breakfast' | 'lunch' | 'dinner';
    mealLabel: string;
    householdId: string;
    currentUserId: string;
    members: Member[];
    attendance?: Record<string, { breakfast: boolean; lunch: boolean; dinner: boolean }>;
    guests?: Record<string, { breakfast?: number; lunch?: number; dinner?: number }>;
    onRefresh: () => void;
}

export default function AttendingMembersModal({
    isOpen,
    onClose,
    mealId,
    mealType,
    mealLabel,
    householdId,
    currentUserId,
    members,
    attendance,
    guests,
    onRefresh,
}: AttendingMembersModalProps) {
    const { t } = useLocale();
    const [busyFor, setBusyFor] = useState<string | null>(null);
    const [successFor, setSuccessFor] = useState<{ uid: string; kind: 'added' | 'removed' } | null>(null);

    if (!isOpen) return null;

    const isAttending = (uid: string) => {
        const rec = attendance?.[uid];
        return rec?.[mealType] !== false;
    };

    const attendingMembers = members.filter(m => isAttending(m.uid));

    const guestCount = (uid: string) => guests?.[uid]?.[mealType] ?? 0;

    const handleAddGuest = async (uid: string) => {
        if (busyFor) return;
        if (uid !== currentUserId) return; // safety: only self can add
        setBusyFor(uid);
        setSuccessFor(null);
        try {
            const ok = await addGuest(mealId, mealType, uid, householdId);
            if (ok) {
                setSuccessFor({ uid, kind: 'added' });
                onRefresh();
            }
        } finally {
            setBusyFor(null);
        }
    };

    const handleRemoveGuest = async (uid: string) => {
        if (busyFor) return;
        if (uid !== currentUserId) return; // safety: only self can remove
        setBusyFor(uid);
        setSuccessFor(null);
        try {
            const ok = await removeGuest(mealId, mealType, uid, householdId);
            if (ok) {
                setSuccessFor({ uid, kind: 'removed' });
                onRefresh();
            }
        } finally {
            setBusyFor(null);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
            onClick={onClose}
        >
            <div
                className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-brand-light/40">
                    <div className="flex items-center gap-2">
                        <Users size={20} className="text-purple-700" />
                        <div>
                            <h2 className="text-base font-bold text-brand-darkest">
                                {t('attendingModal.title')}
                            </h2>
                            <p className="text-xs text-brand-dark/70">{mealLabel}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-full hover:bg-brand-light/30 text-brand-dark"
                        aria-label="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Members list */}
                <div className="overflow-y-auto flex-1 divide-y divide-brand-light/30">
                    {attendingMembers.length === 0 ? (
                        <div className="p-6 text-center text-sm text-brand-dark/70">
                            {t('attendingModal.noMembers')}
                        </div>
                    ) : (
                        attendingMembers.map(m => {
                            const gc = guestCount(m.uid);
                            const busy = busyFor === m.uid;
                            const successHere = successFor?.uid === m.uid ? successFor.kind : null;
                            const isSelf = m.uid === currentUserId;
                            return (
                                <div key={m.uid} className="px-5 py-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-full bg-brand-light/40 flex items-center justify-center text-sm font-semibold text-brand-darkest shrink-0">
                                                {m.label.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-brand-darkest truncate">
                                                    {m.label}
                                                </div>
                                                {gc > 0 && (
                                                    <div className="text-xs text-brand-dark/70">
                                                        +{gc} {gc === 1 ? t('attendingModal.guest') : t('attendingModal.guests')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {isSelf && (
                                            <div className="flex items-center gap-2 shrink-0">
                                                {gc > 0 && (
                                                    <button
                                                        onClick={() => handleRemoveGuest(m.uid)}
                                                        disabled={busy}
                                                        aria-label={t('attendingModal.removeGuest')}
                                                        title={t('attendingModal.removeGuest')}
                                                        className="p-2 rounded-lg text-xs font-semibold bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 disabled:opacity-60"
                                                    >
                                                        <UserMinus size={14} />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleAddGuest(m.uid)}
                                                    disabled={busy}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-100 disabled:opacity-60"
                                                >
                                                    {busy ? (
                                                        <span className="animate-spin">⌛</span>
                                                    ) : (
                                                        <UserPlus size={14} />
                                                    )}
                                                    {t('attendingModal.addGuest')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {successHere && isSelf && (
                                        <div className={`mt-2 flex items-start gap-2 text-xs rounded-lg px-3 py-2 border ${successHere === 'added'
                                            ? 'bg-green-50 border-green-200 text-green-800'
                                            : 'bg-brand-light/30 border-brand-light text-brand-darkest'
                                            }`}>
                                            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                                            <span>
                                                {successHere === 'added'
                                                    ? t('attendingModal.successCheckGroceries')
                                                    : t('attendingModal.guestRemoved')}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
