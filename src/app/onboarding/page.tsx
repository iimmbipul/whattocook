'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createNewHousehold, joinHousehold } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { UserPlus, Home, ArrowRight, ArrowLeft } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Alert, Field, TextInput } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';

const DIET_CATEGORIES = [
    { id: 'Healthy', icon: '🥗', desc: 'Nutritious & low guilt' },
    { id: 'Vegan', icon: '🌱', desc: 'No animal products' },
    { id: 'Indian', icon: '🍛', desc: 'Rich & traditional' },
    { id: 'Balanced', icon: '⚖️', desc: 'Carbs, fats & proteins' },
    { id: 'Protein-Heavy', icon: '💪', desc: 'Max gains & recovery' },
    { id: 'Flexible', icon: '🍕', desc: 'A bit of everything' },
];

export default function OnboardingPage() {
    const router = useRouter();
    const { setUser } = useAuth();
    const [email, setEmail] = useState<string | null>(null);
    const [displayName, setDisplayName] = useState<string | undefined>(undefined);
    const [photoURL, setPhotoURL] = useState<string | undefined>(undefined);
    const [view, setView] = useState<'options' | 'join' | 'category'>('options');
    const [houseCode, setHouseCode] = useState('');
    const [housePin, setHousePin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        // Read pending email from localStorage
        const storedEmail = localStorage.getItem('pendingRegistrationEmail');
        const storedName = localStorage.getItem('pendingRegistrationName') || undefined;
        const storedPhoto = localStorage.getItem('pendingRegistrationPhoto') || undefined;
        
        if (!storedEmail) {
            router.push('/login');
        } else {
            setEmail(storedEmail);
            setDisplayName(storedName);
            setPhotoURL(storedPhoto);
        }
    }, [router]);

    const handleCreateHousehold = async (category?: string) => {
        if (!email) return;
        setLoading(true);
        setError('');
        
        const user = await createNewHousehold(email, category, displayName, photoURL);
        if (user) {
            localStorage.removeItem('pendingRegistrationEmail');
            localStorage.removeItem('pendingRegistrationName');
            localStorage.removeItem('pendingRegistrationPhoto');
            setUser(user);
            router.push('/');
        } else {
            setError('Failed to create new household. Please try again.');
            setLoading(false);
        }
    };

    const handleJoinHousehold = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        if (!houseCode || !housePin) {
            setError('Please enter both House ID and PIN.');
            return;
        }

        setLoading(true);
        setError('');

        const result = await joinHousehold(email, houseCode, housePin, displayName, photoURL);
        if (result.success && result.user) {
            localStorage.removeItem('pendingRegistrationEmail');
            localStorage.removeItem('pendingRegistrationName');
            localStorage.removeItem('pendingRegistrationPhoto');
            setUser(result.user);
            router.push('/');
        } else {
            setError(result.error || 'Failed to join household.');
            setLoading(false);
        }
    };

    if (!email) return null;

    const backButton = (
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" leadingIcon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => { setView('options'); setError(''); }} disabled={loading}>
            Back
        </Button>
    );

    return (
        <AuthLayout
            title={view === 'category' ? 'Choose a diet plan' : view === 'join' ? 'Join a household' : 'Welcome!'}
            subtitle={
                view === 'category' ? 'We’ll generate a 30-day meal plan for your household.'
                    : view === 'join' ? 'Ask the household owner for the House code and PIN.'
                        : 'Let’s get your household set up.'
            }
            footer={<span>Signed in as <span className="font-medium text-ink">{email}</span></span>}
        >
            {error && <Alert tone="error" className="mb-4">{error}</Alert>}

            {view === 'options' && (
                <div className="space-y-3">
                    {[
                        { key: 'category' as const, icon: Home, title: 'Create a new household', body: 'Plan meals and invite your family.' },
                        { key: 'join' as const, icon: UserPlus, title: 'Join a household', body: 'I have a House code and PIN.' },
                    ].map(opt => (
                        <button
                            key={opt.key}
                            type="button"
                            onClick={() => { setView(opt.key); setError(''); }}
                            disabled={loading}
                            className="group flex w-full items-center gap-4 rounded-xl border border-line p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40 disabled:opacity-50"
                        >
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong" aria-hidden="true">
                                <opt.icon size={20} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[15px] font-semibold text-ink">{opt.title}</span>
                                <span className="block text-sm text-ink-muted">{opt.body}</span>
                            </span>
                            <ArrowRight size={18} className="shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </button>
                    ))}
                </div>
            )}

            {view === 'join' && (
                <div>
                    {backButton}
                    <form onSubmit={handleJoinHousehold} className="space-y-4">
                        <Field label="House code" required>
                            <TextInput
                                value={houseCode}
                                onChange={(e) => setHouseCode(e.target.value.toUpperCase())}
                                className="font-mono uppercase tracking-widest"
                                placeholder="ABCDEF"
                                maxLength={6}
                                autoComplete="off"
                                autoCapitalize="characters"
                            />
                        </Field>
                        <Field label="House PIN" required>
                            <TextInput
                                value={housePin}
                                onChange={(e) => setHousePin(e.target.value)}
                                className="font-mono tracking-widest"
                                placeholder="123456"
                                maxLength={6}
                                inputMode="numeric"
                                autoComplete="off"
                            />
                        </Field>
                        <Button type="submit" size="lg" fullWidth loading={loading} loadingText="Joining…">
                            Join household
                        </Button>
                    </form>
                </div>
            )}

            {view === 'category' && (
                <div>
                    {backButton}
                    {loading ? (
                        <div role="status" className="flex flex-col items-center gap-3 py-8 text-center">
                            <Spinner size={26} className="text-accent" />
                            <p className="text-sm font-medium text-ink">Generating your 30-day plan…</p>
                            <p className="text-xs text-ink-muted">This can take a few seconds.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            {DIET_CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => handleCreateHousehold(cat.id)}
                                    className="flex flex-col items-start rounded-xl border border-line p-3.5 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
                                >
                                    <span className="mb-1.5 text-2xl" aria-hidden="true">{cat.icon}</span>
                                    <span className="text-sm font-semibold text-ink">{cat.id}</span>
                                    <span className="line-clamp-1 text-xs text-ink-muted">{cat.desc}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </AuthLayout>
    );
}
