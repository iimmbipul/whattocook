'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
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

const STORAGE_KEY = 'meal_planner_user';

/**
 * The last session this browser saw, used only to render straight away while
 * the server verifies it below. Only copies written by the current version
 * (they carry the server-signed session token) are used. This is display
 * state: every server action still authorizes against the session cookie.
 */
function readStoredUser(): User | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return null;
        const parsed = JSON.parse(stored) as Partial<User>;
        if (!parsed?.uid || !parsed.role || !parsed.householdId || !parsed.sessionToken) return null;
        return parsed as User;
    } catch {
        return null;
    }
}

/** Same account data, ignoring the session token (which the server may roll forward). */
function sameUser(a: User, b: User): boolean {
    const { sessionToken: _a, ...restA } = a;
    const { sessionToken: _b, ...restB } = b;
    void _a; void _b;
    return JSON.stringify(restA) === JSON.stringify(restB);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [restored, setRestored] = useState(false);

    // Keep the same object when the server confirms an unchanged account, so
    // effects keyed on `user` don't refetch their data a second time. The fresh
    // token is still written to localStorage by checkAuth below.
    const commitUser = useCallback((next: User) =>
        setUser(prev => (prev && sameUser(prev, next) ? prev : next)), []);

    // 1) Render straight away with the last known session instead of blocking
    //    every page behind a server round trip; it is verified in step 2.
    useEffect(() => {
        const cached = readStoredUser();
        if (cached) {
            setUser(cached);
            setLoading(false);
        }
        setRestored(true);
    }, []);

    // 2) Verify the session with the server. This runs in the commit after
    //    step 1, after child effects, so pages that just received the cached user
    //    dispatch their own data request first. Server Actions run one at a time,
    //    so the page data is no longer queued behind this check.
    useEffect(() => {
        if (!restored) return;

        const checkAuth = async () => {
            try {
                // 1. The httpOnly session cookie — verified and rolled forward by the server.
                const refreshedUser = await refreshSession();
                if (refreshedUser) {
                    commitUser(refreshedUser);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshedUser));
                    return;
                }

                // 2. iOS PWAs can drop cookies while keeping localStorage. The stored
                //    copy carries the server-signed session token; only that token is
                //    sent back, and the server verifies it (and re-checks the account)
                //    before restoring the cookie. Unsigned data from older versions is
                //    ignored, so those users simply sign in again once.
                let token: string | undefined;
                try {
                    const stored = localStorage.getItem(STORAGE_KEY);
                    token = stored ? (JSON.parse(stored) as Partial<User>).sessionToken : undefined;
                } catch {
                    token = undefined;
                }

                const restoredUser = token ? await restoreSession(token) : null;
                if (restoredUser) {
                    commitUser(restoredUser);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(restoredUser));
                } else {
                    localStorage.removeItem(STORAGE_KEY);
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
    }, [restored, commitUser]);

    // Sync user state changes to localStorage
    useEffect(() => {
        if (user) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
        }
    }, [user]);

    return (
        <AuthContext.Provider value={{ user, loading, setUser }}>
            {children}
        </AuthContext.Provider>
    );
}
