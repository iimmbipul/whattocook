'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { getCurrentUser } from '@/lib/auth';
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
            // 1. Try server-side cookie (preferred)
            const currentUser = await getCurrentUser();

            if (currentUser) {
                setUser(currentUser);
                // Sync to local storage
                localStorage.setItem('meal_planner_user', JSON.stringify(currentUser));
            } else {
                // 2. Fallback to localStorage (if cookie is lost/expired but client session intended)
                const stored = localStorage.getItem('meal_planner_user');
                if (stored) {
                    try {
                        const parsedUser = JSON.parse(stored) as User;

                        // If no cookie and localStorage user is missing linkedUserId, force re-login
                        if ((parsedUser.role === 'member' || parsedUser.role === 'cook') && !parsedUser.linkedUserId) {
                            localStorage.removeItem('meal_planner_user');
                            setUser(null);
                        } else {
                            if (!parsedUser.householdId) {
                                parsedUser.householdId = parsedUser.role === 'user' ? parsedUser.uid : (parsedUser.linkedUserId || parsedUser.uid);
                            }
                            setUser(parsedUser);
                        }
                    } catch (e) {
                        localStorage.removeItem('meal_planner_user');
                    }
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
