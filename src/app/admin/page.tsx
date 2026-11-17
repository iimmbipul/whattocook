'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, KeyRound, RefreshCw, Copy as CopyIcon, UserPlus, Wrench } from 'lucide-react';
import { createUser, getAllHouseholdMembers } from '@/lib/auth';
import { updateMealDatesToCurrentMonth } from '@/lib/firestore';
import AdminJsonEditor from '@/components/AdminJsonEditor';
import { getAdminCapabilities, migrateStoredCredentials } from '@/lib/adminData';
import { UserRole } from '@/types/meal';
import BulkResponsibilityManager from '@/components/BulkResponsibilityManager';
import MultiDatePicker from '@/components/MultiDatePicker';
import { isSameDay } from 'date-fns';
import { useLocale } from '@/context/LocaleContext';
import { useAuth } from '@/components/AuthProvider';
import AppShell, { PageHeader } from '@/components/AppShell';
import { Section } from '@/components/ui/Card';
import { Alert, Field, Select, TextInput } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { useConfirm } from '@/components/ui/ConfirmDialog';

export default function AdminPage() {
    const router = useRouter();
    const { t } = useLocale();
    const { user, loading: authLoading } = useAuth();
    const { confirm, dialog } = useConfirm();

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

    // Shared-template tools and the raw DB editor are for app admins only
    // (ADMIN_EMAILS); the server enforces this, the flag just hides the UI.
    const [appAdmin, setAppAdmin] = useState(false);
    const [credentialMigration, setCredentialMigration] = useState<{ busy: boolean; message: string; ok?: boolean }>({ busy: false, message: '' });

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
        });
        getAdminCapabilities().then(c => setAppAdmin(c.appAdmin)).catch(() => setAppAdmin(false));
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
        const ok = await confirm({
            title: t('admin.updateDatesButton'),
            message: t('admin.confirmUpdateDates'),
            confirmLabel: t('admin.updateDatesButton'),
            tone: 'danger',
        });
        if (!ok) return;

        setMealUpdateLoading(true);
        setMealUpdateError('');
        setMealUpdateSuccess('');

        try {
            const result = await updateMealDatesToCurrentMonth();

            if (result.success) {
                setMealUpdateSuccess(`Updated ${result.updated} meals to the current month.`);
            } else {
                setMealUpdateError(result.error || 'Failed to update meal dates');
            }
        } catch (err: any) {
            setMealUpdateError(err.message || 'Failed to update meal dates');
        } finally {
            setMealUpdateLoading(false);
        }
    };

    const handleCopyDailyMenu = async () => {
        const ok = await confirm({
            title: 'Copy daily menu to templates?',
            message: 'Existing templates with the same day IDs are overwritten.',
            confirmLabel: 'Copy to templates',
            tone: 'danger',
        });
        if (!ok) return;
        setMealUpdateLoading(true);
        setMealUpdateError('');
        setMealUpdateSuccess('');
        try {
            const { copyDailyMenuToTemplates } = await import('@/lib/firestore');
            const result = await copyDailyMenuToTemplates();
            if (result.success) {
                setMealUpdateSuccess(`Copied ${result.copied} meals to templates.`);
            } else {
                setMealUpdateError(result.error || 'Failed to copy templates');
            }
        } catch (e: any) {
            setMealUpdateError(e.message || 'Failed to copy templates');
        } finally {
            setMealUpdateLoading(false);
        }
    };

    const handleMigrateCredentials = async () => {
        setCredentialMigration({ busy: true, message: '' });
        try {
            const preview = await migrateStoredCredentials(true);
            if (!preview.ok) {
                setCredentialMigration({ busy: false, ok: false, message: preview.error ?? 'Migration failed' });
                return;
            }
            if (preview.migrated === 0) {
                setCredentialMigration({ busy: false, ok: true, message: `Nothing to migrate (${preview.alreadyHashed} already hashed, ${preview.skipped} skipped).` });
                return;
            }
            const ok = await confirm({
                title: `Hash ${preview.migrated} stored credential${preview.migrated === 1 ? '' : 's'}?`,
                message: 'Plaintext passwords and PINs are replaced with salted hashes and deleted. This cannot be undone.',
                confirmLabel: 'Hash credentials',
                tone: 'danger',
            });
            if (!ok) {
                setCredentialMigration({ busy: false, message: '' });
                return;
            }
            const result = await migrateStoredCredentials(false);
            setCredentialMigration({
                busy: false,
                ok: result.ok,
                message: result.ok
                    ? `Hashed ${result.migrated} record(s); ${result.alreadyHashed} were already hashed; ${result.skipped} skipped (no usable value).`
                    : result.error ?? 'Migration failed',
            });
        } catch (err) {
            setCredentialMigration({ busy: false, ok: false, message: err instanceof Error ? err.message : 'Migration failed' });
        }
    };

    if (authLoading || !user || user.role !== 'user') {
        return <PageLoader label={t('common.loading')} />;
    }

    const isCook = formData.role === 'cook';

    return (
        <AppShell>
            {dialog}
            <PageHeader title={t('nav.admin')} subtitle={t('admin.userManagementDesc')} />

            <div className="space-y-4">
                {/* Add people */}
                <Section icon={<UserPlus size={18} />} title={t('admin.userManagementTitle')}>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && <Alert tone="error">{error}</Alert>}
                        {success && <Alert tone="success">{success}</Alert>}

                        <Field label={t('admin.roleLabel')} required>
                            <Select value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}>
                                <option value="member">{t('admin.roleMember')}</option>
                                {appAdmin && <option value="user">{t('admin.roleOwner')}</option>}
                                <option value="cook">{t('admin.roleCook')}</option>
                            </Select>
                        </Field>

                        {!isCook ? (
                            <>
                                <Field label={t('admin.emailLabel')} required>
                                    <TextInput type="email" autoComplete="off" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="name@example.com" />
                                </Field>
                                <Field label={t('admin.passwordLabel')} required hint={t('admin.passwordHint')}>
                                    <TextInput type="password" autoComplete="new-password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder={t('admin.passwordPlaceholder')} minLength={6} />
                                </Field>
                                <Field label={t('admin.phoneLabel')} hint={t('admin.phoneHint')}>
                                    <TextInput type="tel" inputMode="tel" value={formData.phoneNumber} onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })} placeholder={t('admin.phonePlaceholder')} />
                                </Field>
                            </>
                        ) : (
                            <>
                                <Field label="Cook’s phone number" required>
                                    <TextInput type="tel" inputMode="tel" value={formData.phoneNumber} onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })} placeholder="+919876543210" />
                                </Field>
                                <Field label="Login PIN" required hint="4–6 digits, used with the phone number to log in.">
                                    <TextInput type="password" inputMode="numeric" autoComplete="new-password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="••••" />
                                </Field>
                            </>
                        )}

                        <div className="flex justify-end pt-1">
                            <Button type="submit" loading={loading} loadingText={t('admin.creatingButton')} className="w-full sm:w-auto">
                                {t('admin.createButton')}
                            </Button>
                        </div>
                    </form>
                </Section>

                {/* Assign duties */}
                <Section icon={<CalendarDays size={18} />} title={t('admin.assignTitle')} description={t('admin.assignDesc')}>
                    <div className="space-y-5">
                        <MultiDatePicker selectedDates={selectedDates} onDateToggle={handleDateToggle} />
                        <div className="border-t border-line pt-5">
                            <BulkResponsibilityManager
                                selectedDates={selectedDates}
                                members={members}
                                onSuccess={() => { }}
                                householdId={user.uid}
                            />
                        </div>
                    </div>
                </Section>

                {/* App-admin maintenance (shared templates) */}
                {appAdmin ? (
                    <>
                        <Section icon={<Wrench size={18} />} tone="danger" title="Maintenance" description="App-admin tools that change shared data. Each asks for confirmation.">
                            <div className="space-y-3">
                                {mealUpdateError && <Alert tone="error">{mealUpdateError}</Alert>}
                                {mealUpdateSuccess && <Alert tone="success">{mealUpdateSuccess}</Alert>}

                                <div className="flex flex-col gap-3 rounded-xl border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="text-sm font-semibold text-ink">{t('admin.mealDateTitle')}</p>
                                        <p className="text-sm text-ink-muted">{t('admin.mealDateDesc')}</p>
                                    </div>
                                    <Button variant="danger-soft" size="sm" className="shrink-0" loading={mealUpdateLoading} leadingIcon={<RefreshCw size={14} aria-hidden="true" />} onClick={handleUpdateMealDates}>
                                        Update dates
                                    </Button>
                                </div>

                                <div className="flex flex-col gap-3 rounded-xl border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="text-sm font-semibold text-ink">Copy daily menu to templates</p>
                                        <p className="text-sm text-ink-muted">One-time copy of <code className="rounded bg-surface-muted px-1 text-[13px]">dailymenu</code> into <code className="rounded bg-surface-muted px-1 text-[13px]">menu_templates</code>.</p>
                                    </div>
                                    <Button variant="danger-soft" size="sm" className="shrink-0" loading={mealUpdateLoading} leadingIcon={<CopyIcon size={14} aria-hidden="true" />} onClick={handleCopyDailyMenu}>
                                        Copy menu
                                    </Button>
                                </div>

                                <div className="flex flex-col gap-3 rounded-xl border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="text-sm font-semibold text-ink">Hash stored passwords &amp; PINs</p>
                                        <p className="text-sm text-ink-muted">Replaces any plaintext credentials with salted hashes. Accounts also migrate when they next sign in.</p>
                                    </div>
                                    <Button variant="danger-soft" size="sm" className="shrink-0" loading={credentialMigration.busy} leadingIcon={<KeyRound size={14} aria-hidden="true" />} onClick={handleMigrateCredentials}>
                                        Hash credentials
                                    </Button>
                                </div>
                                {credentialMigration.message && (
                                    <Alert tone={credentialMigration.ok === false ? 'error' : 'info'}>{credentialMigration.message}</Alert>
                                )}
                            </div>
                        </Section>

                        <AdminJsonEditor />
                    </>
                ) : (
                    <p className="px-1 text-xs text-ink-muted">Shared menu templates and the database editor are limited to app admins.</p>
                )}
            </div>
        </AppShell>
    );
}
