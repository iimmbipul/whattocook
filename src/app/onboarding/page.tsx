'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createNewHousehold, joinHousehold } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { UserPlus, Home, ArrowRight, ArrowLeft } from 'lucide-react';

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

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 overflow-hidden relative">
                
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="text-5xl mb-4">🏠</div>
                    <h1 className="text-3xl font-bold text-gray-800 mb-2">Welcome!</h1>
                    <p className="text-gray-500 text-sm">Let's get your household set up.</p>
                    <p className="text-indigo-600 font-medium text-xs mt-2 bg-indigo-50 inline-block px-3 py-1 rounded-full">{email}</p>
                </div>

                {error && (
                    <div className="mb-6 bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-xl text-sm">
                        {error}
                    </div>
                )}

                {/* View: Options */}
                {view === 'options' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                        <button
                            onClick={() => { setView('category'); setError(''); }}
                            disabled={loading}
                            className="w-full flex items-center p-4 bg-gray-50 hover:bg-indigo-50 border-2 border-transparent hover:border-indigo-100 rounded-xl transition-all group text-left"
                        >
                            <div className="bg-indigo-100 text-indigo-600 p-3 rounded-lg mr-4 group-hover:scale-110 transition-transform">
                                <Home size={24} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-gray-800 text-lg">Create a New Team</h3>
                                <p className="text-sm text-gray-500">I want to manage my own meals</p>
                            </div>
                            {loading ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-600 border-t-transparent" />
                            ) : (
                                <ArrowRight className="text-gray-400 group-hover:text-indigo-600 transition-colors" size={20} />
                            )}
                        </button>

                        <button
                            onClick={() => { setView('join'); setError(''); }}
                            disabled={loading}
                            className="w-full flex items-center p-4 bg-gray-50 hover:bg-purple-50 border-2 border-transparent hover:border-purple-100 rounded-xl transition-all group text-left"
                        >
                            <div className="bg-purple-100 text-purple-600 p-3 rounded-lg mr-4 group-hover:scale-110 transition-transform">
                                <UserPlus size={24} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-gray-800 text-lg">Join a Team</h3>
                                <p className="text-sm text-gray-500">I have a House ID and PIN</p>
                            </div>
                            <ArrowRight className="text-gray-400 group-hover:text-purple-600 transition-colors" size={20} />
                        </button>
                    </div>
                )}

                {/* View: Join Form */}
                {view === 'join' && (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                        <button
                            onClick={() => { setView('options'); setError(''); }}
                            className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-800 mb-6 transition-colors"
                        >
                            <ArrowLeft size={16} className="mr-1" /> Back
                        </button>

                        <form onSubmit={handleJoinHousehold} className="space-y-5">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">House ID (Code)</label>
                                <input
                                    type="text"
                                    value={houseCode}
                                    onChange={(e) => setHouseCode(e.target.value)}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-800 uppercase"
                                    placeholder="e.g. ABCD12"
                                    maxLength={6}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">House PIN</label>
                                <input
                                    type="text"
                                    value={housePin}
                                    onChange={(e) => setHousePin(e.target.value)}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-800"
                                    placeholder="e.g. 123456"
                                    maxLength={6}
                                    required
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-200 mt-2 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loading && <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />}
                                {loading ? 'Joining...' : 'Join Household'}
                            </button>
                        </form>
                    </div>
                )}

                {/* View: Category Selection */}
                {view === 'category' && (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                        <button
                            onClick={() => { setView('options'); setError(''); }}
                            className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-800 mb-6 transition-colors"
                        >
                            <ArrowLeft size={16} className="mr-1" /> Back
                        </button>
                        
                        <div className="mb-6">
                            <h3 className="text-lg font-bold text-gray-800">Select a Diet Category</h3>
                            <p className="text-sm text-gray-500">We will instantly generate a 30-day meal plan for you.</p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3 mb-6">
                            {[
                                { id: 'Healthy', icon: '🥗', desc: 'Nutritious & low guilt' },
                                { id: 'Vegan', icon: '🌱', desc: 'No animal products' },
                                { id: 'Indian', icon: '🍛', desc: 'Rich & traditional' },
                                { id: 'Balanced', icon: '⚖️', desc: 'Carbs, fats & proteins' },
                                { id: 'Protein-Heavy', icon: '💪', desc: 'Max gains & recovery' },
                                { id: 'Flexible', icon: '🍕', desc: 'A bit of everything' }
                            ].map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => handleCreateHousehold(cat.id)}
                                    disabled={loading}
                                    className="p-3 border-2 border-gray-100 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left flex flex-col justify-center disabled:opacity-50 bg-white"
                                >
                                    <div className="text-2xl mb-1">{cat.icon}</div>
                                    <div className="font-bold text-gray-800 text-sm">{cat.id}</div>
                                    <div className="text-xs text-gray-500 line-clamp-1">{cat.desc}</div>
                                </button>
                            ))}
                        </div>
                        
                        {loading && (
                            <div className="flex flex-col items-center justify-center space-y-3 py-4 text-indigo-600 bg-indigo-50 rounded-xl border border-indigo-100">
                                <div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent" />
                                <span className="text-sm font-semibold animate-pulse">Generating your 30-day plan...</span>
                            </div>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
}
