'use client';

import React, { useState } from 'react';
import { bulkUpdateMealResponsibility } from '@/lib/firestore';
import { UserCheck, User, Coffee, Utensils, CalendarDays, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

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
}

export default function BulkResponsibilityManager({
    selectedDates,
    members,
    onSuccess
}: BulkResponsibilityManagerProps) {
    const [brunchUser, setBrunchUser] = useState<string>('');
    const [dinnerUser, setDinnerUser] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const handleApply = async () => {
        if (selectedDates.length === 0) {
            setMessage({ type: 'error', text: 'Please select at least one date.' });
            return;
        }

        if (!brunchUser && !dinnerUser) {
            setMessage({ type: 'error', text: 'Please select a user to assign for at least one meal.' });
            return;
        }

        setLoading(true);
        setMessage(null);

        try {
            // Updated to match the backend function signature
            // const result = await bulkUpdateMealResponsibility(dates: string[], updates: { breakfastLunchId?: string; dinnerId?: string })

            const dateStrings = selectedDates.map(d => format(d, 'yyyy-MM-dd'));

            const updates: { breakfastLunchId?: string; dinnerId?: string } = {};
            if (brunchUser) updates.breakfastLunchId = brunchUser;
            if (dinnerUser) updates.dinnerId = dinnerUser;

            const result = await bulkUpdateMealResponsibility(dateStrings, updates);

            if (result.success) {
                setMessage({ type: 'success', text: `Successfully updated ${result.updated} meals!` });
                // Optional: Clear selection after success? 
                // setBrunchUser(''); 
                // setDinnerUser('');
                if (onSuccess) onSuccess();
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to update.' });
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || 'An error occurred' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-brand-light/40 p-6">
            <div className="mb-6 flex items-center justify-between border-b border-brand-light/10 pb-4">
                <div>
                    <h3 className="text-lg font-bold text-brand-darkest flex items-center gap-2">
                        <span className="bg-brand-primary/10 p-2 rounded-lg text-brand-primary">
                            <CalendarDays size={20} />
                        </span>
                        Bulk Assign Responsibility
                    </h3>
                    <p className="text-sm text-brand-dark mt-1">
                        Selected: <span className="font-bold text-brand-primary">{selectedDates.length} days</span>
                    </p>
                </div>
            </div>

            {message && (
                <div className={`mb-6 px-4 py-3 rounded-xl border flex items-center gap-2 text-sm font-medium ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
                    {message.type === 'success' ? <CheckCircle2 size={16} /> : null}
                    {message.text}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {/* Breakfast + Lunch Select */}
                <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-brand-dark flex items-center gap-1.5">
                        <Coffee size={14} className="text-orange-500" /> Breakfast + Lunch
                    </label>
                    <div className="relative">
                        <select
                            value={brunchUser}
                            onChange={(e) => setBrunchUser(e.target.value)}
                            disabled={loading}
                            className="w-full appearance-none bg-brand-light/5 border border-brand-light/30 rounded-xl py-3 pl-4 pr-10 text-sm font-medium text-brand-darkest focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all cursor-pointer hover:border-brand-primary/40 focus:bg-white"
                        >
                            <option value="">-- No Change --</option>
                            {members.map(member => (
                                <option key={member.uid} value={member.uid}>
                                    {member.label}
                                </option>
                            ))}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-dark/50">
                            <User size={16} />
                        </div>
                    </div>
                </div>

                {/* Dinner Select */}
                <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-brand-dark flex items-center gap-1.5">
                        <Utensils size={14} className="text-purple-500" /> Dinner
                    </label>
                    <div className="relative">
                        <select
                            value={dinnerUser}
                            onChange={(e) => setDinnerUser(e.target.value)}
                            disabled={loading}
                            className="w-full appearance-none bg-brand-light/5 border border-brand-light/30 rounded-xl py-3 pl-4 pr-10 text-sm font-medium text-brand-darkest focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all cursor-pointer hover:border-brand-primary/40 focus:bg-white"
                        >
                            <option value="">-- No Change --</option>
                            {members.map(member => (
                                <option key={member.uid} value={member.uid}>
                                    {member.label}
                                </option>
                            ))}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-dark/50">
                            <User size={16} />
                        </div>
                    </div>
                </div>
            </div>

            <button
                onClick={handleApply}
                disabled={loading || selectedDates.length === 0}
                className={`w-full py-3.5 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2
                    ${loading || selectedDates.length === 0
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                        : 'bg-brand-darkest hover:bg-black text-white shadow-brand-darkest/20 active:scale-[0.98]'
                    }`}
            >
                {loading ? (
                    <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Applying Updates...
                    </>
                ) : (
                    <>
                        <CheckCircle2 size={18} />
                        Apply to {selectedDates.length} Selected Days
                    </>
                )}
            </button>
        </div>
    );
}
