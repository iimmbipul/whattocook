'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { refreshSession, getCurrentUser, restoreCookieFromClient } from '@/lib/auth';
import { User } from '@/types/meal';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    setUser: () => { },
});

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check for existing user session on mount
        const checkAuth = async () => {
            // 1. Try server-side cookie and refresh it concurrently if possible
            const refreshedUser = await refreshSession();

            if (refreshedUser) {
                setUser(refreshedUser);
                // Sync to local storage
                localStorage.setItem('meal_planner_user', JSON.stringify(refreshedUser));
            } else {
                // 2. Fallback to localStorage (if cookie is lost/expired but client session intended)
                // This acts as the "refresh token" layer specifically for iOS/PWAs that aggressively clear cookies.
                const stored = localStorage.getItem('meal_planner_user');
                if (stored) {
                    try {
                        let parsedUser = JSON.parse(stored) as User;

                        // If no cookie and localStorage user is missing linkedUserId, force re-login
                        // (prevents zombie state from extremely old login structures)
                        if ((parsedUser.role === 'member' || parsedUser.role === 'cook') && !parsedUser.linkedUserId) {
                            localStorage.removeItem('meal_planner_user');
                            setUser(null);
                        } else {
                            if (!parsedUser.householdId) {
                                parsedUser.householdId = parsedUser.role === 'user' ? parsedUser.uid : (parsedUser.linkedUserId || parsedUser.uid);
                            }

                            // Restore the secure server-side cookie so that Server Actions work again!
                            const restored = await restoreCookieFromClient(parsedUser);

                            if (restored) {
                                // Double check against firestore to ensure user isn't disabled/deleted,
                                // and get the absolute freshest data.
                                const finalCheck = await refreshSession();
                                if (finalCheck) {
                                    parsedUser = finalCheck;
                                    localStorage.setItem('meal_planner_user', JSON.stringify(parsedUser));
                                } else {
                                    // Invalid in DB
                                    localStorage.removeItem('meal_planner_user');
                                    setUser(null);
                                    setLoading(false);
                                    return;
                                }
                            }

                            setUser(parsedUser);
                        }
                    } catch (e) {
                        localStorage.removeItem('meal_planner_user');
                        setUser(null);
                    }
                } else {
                    setUser(null);
                }
            }
            setLoading(false);
        };

        checkAuth();
    }, []);

    // Sync user state changes to localStorage
    useEffect(() => {
        if (user) {
            localStorage.setItem('meal_planner_user', JSON.stringify(user));
        }
    }, [user]);

    return (
        <AuthContext.Provider value={{ user, loading, setUser }}>
            {children}
        </AuthContext.Provider>
    );
}
