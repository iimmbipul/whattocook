'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { refreshSession, restoreSession } from '@/lib/auth';
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
            try {
                // 1. The httpOnly session cookie — verified and rolled forward by the server.
                const refreshedUser = await refreshSession();
                if (refreshedUser) {
                    setUser(refreshedUser);
                    localStorage.setItem('meal_planner_user', JSON.stringify(refreshedUser));
                    return;
                }

                // 2. iOS PWAs can drop cookies while keeping localStorage. The stored
                //    copy carries the server-signed session token; only that token is
                //    sent back, and the server verifies it (and re-checks the account)
                //    before restoring the cookie. Unsigned data from older versions is
                //    ignored, so those users simply sign in again once.
                let token: string | undefined;
                try {
                    const stored = localStorage.getItem('meal_planner_user');
                    token = stored ? (JSON.parse(stored) as Partial<User>).sessionToken : undefined;
                } catch {
                    token = undefined;
                }

                const restoredUser = token ? await restoreSession(token) : null;
                if (restoredUser) {
                    setUser(restoredUser);
                    localStorage.setItem('meal_planner_user', JSON.stringify(restoredUser));
                } else {
                    localStorage.removeItem('meal_planner_user');
                    setUser(null);
                }
            } catch (err) {
                // Network/server error: keep the stored token for the next attempt.
                console.error('Session check failed', err);
                setUser(null);
            } finally {
                setLoading(false);
            }
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
