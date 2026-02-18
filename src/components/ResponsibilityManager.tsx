'use client';

import { useState } from 'react';
import { updateMealResponsibility } from '@/lib/firestore';
import { UserCheck, User, Coffee, Utensils } from 'lucide-react';

interface Member {
    uid: string;
    email: string;
    role: string;
    label: string;
}

interface ResponsibilityManagerProps {
    mealId: string;
    responsibility?: {
        breakfastLunchId?: string;
        dinnerId?: string;
    };
    members: Member[];
    canEdit: boolean;
    onRefresh: () => void;
}

export default function ResponsibilityManager({
    mealId,
    responsibility,
    members,
    canEdit,
    onRefresh
}: ResponsibilityManagerProps) {
    const [loading, setLoading] = useState<string | null>(null); // 'breakfastLunch' | 'dinner' | null

    const handleAssign = async (slot: 'breakfastLunchId' | 'dinnerId', userId: string) => {
        if (loading) return;
        setLoading(slot === 'breakfastLunchId' ? 'breakfastLunch' : 'dinner');

        try {
            const success = await updateMealResponsibility(mealId, slot, userId);
            if (success) {
                onRefresh();
            }
        } catch (error) {
            console.error('Failed to update responsibility', error);
        } finally {
            setLoading(null);
        }
    };

    const getMemberName = (uid?: string) => {
        if (!uid) return 'Unassigned';
        const member = members.find(m => m.uid === uid);
        return member ? member.label : 'Unknown User';
    };

    const SelectInput = ({
        value,
        onChange,
        label,
        icon: Icon
    }: {
        value?: string,
        onChange: (val: string) => void,
        label: string,
        icon: any
    }) => (
        <div className="flex flex-col gap-1.5 flex-1">
            <span className="text-xs font-semibold text-brand-dark flex items-center gap-1.5 opacity-80">
                <Icon size={12} /> {label}
            </span>
            <div className="relative">
                {canEdit ? (
                    <select
                        value={value || ''}
                        onChange={(e) => onChange(e.target.value)}
                        disabled={!!loading}
                        className="w-full appearance-none bg-white border border-brand-light/40 rounded-lg py-2 pl-3 pr-8 text-sm font-medium text-brand-darkest focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all cursor-pointer hover:border-brand-primary/40"
                    >
                        <option value="">Unassigned</option>
                        {members.map(member => (
                            <option key={member.uid} value={member.uid}>
                                {member.label}
                            </option>
                        ))}
                    </select>
                ) : (
                    <div className="w-full bg-brand-light/10 border border-brand-light/20 rounded-lg py-2 px-3 text-sm font-medium text-brand-darkest flex items-center gap-2">
                        {value ? (
                            <>
                                <UserCheck size={14} className="text-brand-primary" />
                                {getMemberName(value)}
                            </>
                        ) : (
                            <span className="text-brand-dark/50 italic">Unassigned</span>
                        )}
                    </div>
                )}

                {/* Custom arrow for select */}
                {canEdit && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-dark/50">
                        {loading === (label.includes('Breakfast') ? 'breakfastLunch' : 'dinner') ? (
                            <div className="animate-spin w-3 h-3 border-2 border-brand-primary border-t-transparent rounded-full" />
                        ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-sm border border-brand-light/40 p-5 mb-6">
            <h3 className="text-sm font-bold text-brand-darkest mb-4 flex items-center gap-2 uppercase tracking-wide">
                <span className="bg-brand-secondary/10 p-1.5 rounded-lg text-brand-secondary">
                    <User size={16} />
                </span>
                Responsibility Holders
            </h3>

            <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
                <SelectInput
                    label="Breakfast + Lunch"
                    value={responsibility?.breakfastLunchId}
                    onChange={(val) => handleAssign('breakfastLunchId', val)}
                    icon={Coffee}
                />
                <SelectInput
                    label="Dinner"
                    value={responsibility?.dinnerId}
                    onChange={(val) => handleAssign('dinnerId', val)}
                    icon={Utensils}
                />
            </div>
        </div>
    );
}
