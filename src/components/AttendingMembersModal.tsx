'use client';

import { useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { addGuest, removeGuest } from '@/lib/firestore';
import { useLocale } from '@/context/LocaleContext';
import { useAuth } from './AuthProvider';
import { actorFromUser } from '@/lib/actor';
import { Dialog } from './ui/Dialog';
import { Avatar, Badge } from './ui/Badge';
import { Alert } from './ui/Field';
import { Spinner } from './ui/Spinner';

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
    const { user: authUser } = useAuth();
    const [busy, setBusy] = useState<'add' | 'remove' | null>(null);
    const [status, setStatus] = useState<'added' | 'removed' | null>(null);
    const eatingId = useId();
    const skippingId = useId();

    const isAttending = (uid: string) => attendance?.[uid]?.[mealType] !== false;
    const attendingMembers = members.filter(m => isAttending(m.uid));
    const skippingMembers = members.filter(m => !isAttending(m.uid));
    const guestCount = (uid: string) => guests?.[uid]?.[mealType] ?? 0;

    const changeGuests = async (kind: 'add' | 'remove') => {
        if (busy) return;
        setBusy(kind);
        setStatus(null);
        try {
            // Only your own guests can be changed (enforced on the server too).
            const ok = kind === 'add'
                ? await addGuest(mealId, mealType, currentUserId, householdId, actorFromUser(authUser))
                : await removeGuest(mealId, mealType, currentUserId, householdId, actorFromUser(authUser));
            if (ok) {
                setStatus(kind === 'add' ? 'added' : 'removed');
                onRefresh();
            }
        } finally {
            setBusy(null);
        }
    };

    const handleClose = () => {
        setStatus(null);
        onClose();
    };

    const row = (m: Member, eating: boolean) => {
        const isSelf = m.uid === currentUserId;
        const gc = guestCount(m.uid);
        return (
            <li key={m.uid} className="flex items-center gap-3 py-3">
                <Avatar name={m.label} size={36} className={eating ? undefined : 'opacity-60'} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-ink">
                        {m.label}
                        {isSelf && <span className="font-normal text-ink-muted"> · {t('attendingModal.you')}</span>}
                    </div>
                    {gc > 0 && (
                        <div className="text-xs text-ink-muted">
                            +{gc} {gc === 1 ? t('attendingModal.guest') : t('attendingModal.guests')}
                        </div>
                    )}
                </div>
                {isSelf && eating && (
                    <div className="flex shrink-0 items-center gap-1 rounded-xl border border-line p-1">
                        <button
                            type="button"
                            onClick={() => changeGuests('remove')}
                            disabled={!!busy || gc === 0}
                            aria-label={t('attendingModal.removeGuest')}
                            title={t('attendingModal.removeGuest')}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-40"
                        >
                            {busy === 'remove' ? <Spinner size={14} /> : <Minus size={16} aria-hidden="true" />}
                        </button>
                        <span className="min-w-[4.5rem] text-center text-xs font-semibold text-ink" aria-live="polite">
                            {gc} {gc === 1 ? t('attendingModal.guest') : t('attendingModal.guests')}
                        </span>
                        <button
                            type="button"
                            onClick={() => changeGuests('add')}
                            disabled={!!busy}
                            aria-label={t('attendingModal.addGuest')}
                            title={t('attendingModal.addGuest')}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-accent-strong transition-colors hover:bg-accent-soft disabled:opacity-40"
                        >
                            {busy === 'add' ? <Spinner size={14} /> : <Plus size={16} aria-hidden="true" />}
                        </button>
                    </div>
                )}
            </li>
        );
    };

    return (
        <Dialog open={isOpen} onClose={handleClose} title={t('attendingModal.title')} description={mealLabel} closeLabel={t('common.close')}>
            {status && (
                <Alert tone={status === 'added' ? 'success' : 'info'} className="mb-3">
                    {status === 'added' ? t('attendingModal.successCheckGroceries') : t('attendingModal.guestRemoved')}
                </Alert>
            )}

            <section aria-labelledby={eatingId}>
                <h3 id={eatingId} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    {t('attendingModal.eatingSection')} <Badge tone="success">{attendingMembers.length}</Badge>
                </h3>
                {attendingMembers.length === 0 ? (
                    <p className="py-4 text-sm text-ink-muted">{t('attendingModal.noMembers')}</p>
                ) : (
                    <ul className="divide-y divide-line">{attendingMembers.map(m => row(m, true))}</ul>
                )}
            </section>

            {skippingMembers.length > 0 && (
                <section aria-labelledby={skippingId} className="mt-4 border-t border-line pt-4">
                    <h3 id={skippingId} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                        {t('attendingModal.skippingSection')} <Badge tone="danger">{skippingMembers.length}</Badge>
                    </h3>
                    <ul className="divide-y divide-line">{skippingMembers.map(m => row(m, false))}</ul>
                </section>
            )}
        </Dialog>
    );
}
