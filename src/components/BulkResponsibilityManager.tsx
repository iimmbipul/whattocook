'use client';

import React, { useState } from 'react';
import { bulkUpdateMealResponsibility } from '@/lib/firestore';
import { CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { useLocale } from '@/context/LocaleContext';
import { useAuth } from './AuthProvider';
import { actorFromUser } from '@/lib/actor';
import { Alert, Field, Select } from './ui/Field';
import { Button } from './ui/Button';

interface Member {
    uid: string;
    email: string;
    role: string;
    label: string;
}

interface BulkResponsibilityManagerProps {
    selectedDates: Date[];
    members: Member[];
    onSuccess: () => void;
    householdId: string;
}

export default function BulkResponsibilityManager({
    selectedDates,
    members,
    onSuccess,
    householdId
}: BulkResponsibilityManagerProps) {
    const [brunchUser, setBrunchUser] = useState<string>('');
    const [dinnerUser, setDinnerUser] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const { t } = useLocale();
    const { user: authUser } = useAuth();

    const handleApply = async () => {
        if (selectedDates.length === 0) {
            setMessage({ type: 'error', text: t('bulk.errorNoDate') });
            return;
        }

        if (!brunchUser && !dinnerUser) {
            setMessage({ type: 'error', text: t('bulk.errorNoUser') });
            return;
        }

        setLoading(true);
        setMessage(null);

        try {
            const dateStrings = selectedDates.map(d => format(d, 'yyyy-MM-dd'));

            const updates: { breakfastLunchId?: string | null; dinnerId?: string | null } = {};
            if (brunchUser === 'unassigned') {
                updates.breakfastLunchId = null;
            } else if (brunchUser) {
                updates.breakfastLunchId = brunchUser;
            }

            if (dinnerUser === 'unassigned') {
                updates.dinnerId = null;
            } else if (dinnerUser) {
                updates.dinnerId = dinnerUser;
            }

            const labelFor = (val: string) =>
                val === 'unassigned' || !val ? 'Unassigned' : members.find(m => m.uid === val)?.label ?? '';

            const result = await bulkUpdateMealResponsibility(
                dateStrings,
                updates,
                householdId,
                actorFromUser(authUser),
                {
                    breakfastLunchName: brunchUser ? labelFor(brunchUser) : undefined,
                    dinnerName: dinnerUser ? labelFor(dinnerUser) : undefined,
                },
            );

            if (result.success) {
                setMessage({ type: 'success', text: t('bulk.successMessage', { count: result.updated }) });
                if (onSuccess) onSuccess();
            } else {
                setMessage({ type: 'error', text: result.error || t('bulk.errorNoUser') });
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || t('bulk.errorNoUser') });
        } finally {
            setLoading(false);
        }
    };

    const memberOptions = (
        <>
            <option value="">{t('bulk.noChange')}</option>
            <option value="unassigned">Unassigned</option>
            {members.map(member => (
                <option key={member.uid} value={member.uid}>{member.label}</option>
            ))}
        </>
    );

    return (
        <div className="space-y-4">
            {message && (
                <Alert tone={message.type === 'success' ? 'success' : 'error'}>{message.text}</Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('bulk.breakfastLunch')}>
                    <Select value={brunchUser} onChange={(e) => setBrunchUser(e.target.value)} disabled={loading}>
                        {memberOptions}
                    </Select>
                </Field>
                <Field label={t('bulk.dinner')}>
                    <Select value={dinnerUser} onChange={(e) => setDinnerUser(e.target.value)} disabled={loading}>
                        {memberOptions}
                    </Select>
                </Field>
            </div>

            <Button
                fullWidth
                onClick={handleApply}
                disabled={selectedDates.length === 0}
                loading={loading}
                loadingText={t('bulk.applyingButton')}
                leadingIcon={<CheckCircle2 size={17} aria-hidden="true" />}
            >
                {t('bulk.applyButton', { count: selectedDates.length })}
            </Button>
        </div>
    );
}
