'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createUser, getAllHouseholdMembers } from '@/lib/auth';
import { updateMealDatesToCurrentMonth } from '@/lib/firestore';
import AdminJsonEditor from '@/components/AdminJsonEditor';
import { UserRole } from '@/types/meal';
import BulkResponsibilityManager from '@/components/BulkResponsibilityManager';
import MultiDatePicker from '@/components/MultiDatePicker';
import { format, isSameDay } from 'date-fns';
import { useLocale } from '@/context/LocaleContext';
import { useAuth } from '@/components/AuthProvider';

export default function AdminPage() {
    const router = useRouter();
    const { t } = useLocale();
    const { user, loading: authLoading } = useAuth();

    const [formData, setFormData] = useState({
        email: '',
        password: '',
        role: 'member' as UserRole,
        phoneNumber: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [mealUpdateLoading, setMealUpdateLoading] = useState(false);
    const [mealUpdateError, setMealUpdateError] = useState('');
    const [mealUpdateSuccess, setMealUpdateSuccess] = useState('');

    const [selectedDates, setSelectedDates] = useState<Date[]>([new Date()]);
    const [members, setMembers] = useState<{ uid: string; email: string; role: string; label: string }[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(true);

    // Guard: only 'user' (owner) role can access admin
    useEffect(() => {
        if (authLoading) return; // wait for auth to resolve
        if (!user || user.role !== 'user') {
            router.push('/');
            return;
        }
        // Load members list once access is confirmed
        getAllHouseholdMembers().then((list) => {
            setMembers(list);
            setLoadingMembers(false);
        });
    }, [user, authLoading, router]);

    const handleDateToggle = (date: Date) => {
        setSelectedDates(prev => {
            const exists = prev.some(d => isSameDay(d, date));
            if (exists) {
                return prev.filter(d => !isSameDay(d, date));
            } else {
                return [...prev, date];
            }
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const result = await createUser(
                formData.email,
                formData.password,
                formData.role,
                formData.phoneNumber,
                (formData.role === 'member' || formData.role === 'cook') ? user?.uid : undefined
            );

            if (result.success) {
                setSuccess(t('admin.userCreatedSuccess', { userId: result.userId ?? '' }));
                setFormData({
                    email: '',
                    password: '',
                    role: 'member',
                    phoneNumber: '',
                });
            } else {
                setError(result.error || 'Failed to create user');
            }
        } catch (err: any) {
            console.error('Error creating user:', err);
            setError(err.message || 'Failed to create user');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateMealDates = async () => {
        if (!confirm(t('admin.confirmUpdateDates'))) {
            return;
        }

        setMealUpdateLoading(true);
        setMealUpdateError('');
        setMealUpdateSuccess('');

        try {
            const result = await updateMealDatesToCurrentMonth();

            if (result.success) {
                setMealUpdateSuccess(`✅ Successfully updated ${result.updated} meals to current month!`);
            } else {
                setMealUpdateError(result.error || 'Failed to update meal dates');
            }
        } catch (err: any) {
            setMealUpdateError(err.message || 'Failed to update meal dates');
        } finally {
            setMealUpdateLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-50 py-12 px-4">
            <div className="container mx-auto max-w-2xl space-y-8">

                {/* User Management Section */}
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    <div className="mb-8">
                        <h1 className="text-3xl font-bold text-gray-800 mb-2">{t('admin.userManagementTitle')}</h1>
                        <p className="text-gray-600">{t('admin.userManagementDesc')}</p>
                    </div>

                    {error && (
                        <div className="mb-6 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg">
                            ❌ {error}
                        </div>
                    )}

                    {success && (
                        <div className="mb-6 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg">
                            ✅ {success}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                                {t('admin.emailLabel')} <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-800"
                                required
                                placeholder="user@example.com"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
                                {t('admin.passwordLabel')} <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-800"
                                required
                                placeholder={t('admin.passwordPlaceholder')}
                                minLength={6}
                            />
                            <p className="mt-1 text-sm text-gray-500">{t('admin.passwordHint')}</p>
                        </div>

                        <div>
                            <label htmlFor="role" className="block text-sm font-semibold text-gray-700 mb-2">
                                {t('admin.roleLabel')} <span className="text-red-500">*</span>
                            </label>
                            <select
                                id="role"
                                value={formData.role}
                                onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-800"
                                required
                            >
                                <option value="member">{t('admin.roleMember')}</option>
                                <option value="user">{t('admin.roleOwner')}</option>
                                <option value="cook">{t('admin.roleCook')}</option>
                            </select>
                        </div>

                        <div>
                            <label htmlFor="phoneNumber" className="block text-sm font-semibold text-gray-700 mb-2">
                                {t('admin.phoneLabel')}
                            </label>
                            <input
                                id="phoneNumber"
                                type="tel"
                                value={formData.phoneNumber}
                                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-800"
                                placeholder={t('admin.phonePlaceholder')}
                            />
                            <p className="mt-1 text-sm text-gray-500">{t('admin.phoneHint')}</p>
                        </div>

                        <div className="pt-4">
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50"
                            >
                                {loading ? t('admin.creatingButton') : t('admin.createButton')}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Meal Date Management Section */}
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    <div className="mb-6">
                        <h2 className="text-2xl font-bold text-gray-800 mb-2">{t('admin.mealDateTitle')}</h2>
                        <p className="text-gray-600">{t('admin.mealDateDesc')}</p>
                    </div>

                    {mealUpdateError && (
                        <div className="mb-6 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg">
                            ❌ {mealUpdateError}
                        </div>
                    )}

                    {mealUpdateSuccess && (
                        <div className="mb-6 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg">
                            {mealUpdateSuccess}
                        </div>
                    )}

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                        <h3 className="font-semibold text-blue-900 mb-2">{t('admin.howItWorksTitle')}</h3>
                        <ul className="text-sm text-blue-800 space-y-1">
                            <li>• {t('admin.howItWorks1')}</li>
                            <li>• {t('admin.howItWorks2')}</li>
                            <li>• {t('admin.howItWorks3')}</li>
                            <li>• {t('admin.howItWorks4')}</li>
                        </ul>
                    </div>

                    <button
                        onClick={handleUpdateMealDates}
                        disabled={mealUpdateLoading}
                        className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50"
                    >
                        {mealUpdateLoading ? t('admin.updatingDatesButton') : t('admin.updateDatesButton')}
                    </button>

                    <p className="mt-4 text-xs text-gray-500 text-center">
                        {t('admin.updateDatesWarning')}
                    </p>
                </div>

                {/* Responsibility Assignment Section */}
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    <div className="mb-6">
                        <h2 className="text-2xl font-bold text-gray-800 mb-2">{t('admin.assignTitle')}</h2>
                        <p className="text-gray-600">{t('admin.assignDesc')}</p>
                    </div>

                    <div className="mb-6">
                        <MultiDatePicker selectedDates={selectedDates} onDateToggle={handleDateToggle} />
                    </div>

                    <BulkResponsibilityManager
                        selectedDates={selectedDates}
                        members={members}
                        onSuccess={() => { }}
                    />
                </div>

                <AdminJsonEditor />

                {/* Navigation */}
                <div>
                    <button
                        type="button"
                        onClick={() => router.push('/')}
                        className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 px-4 rounded-lg transition-all duration-200"
                    >
                        {t('admin.backButton')}
                    </button>
                </div>
            </div>
        </div>
    );
}
