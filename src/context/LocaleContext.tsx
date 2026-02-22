'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { SupportedLocale } from '@/lib/i18n';
import { DEFAULT_LOCALE } from '@/lib/i18n';
import en from '@/locale/en.json';
import hi from '@/locale/hi.json';
import or_ from '@/locale/or.json';

type LocaleData = typeof en;

const localeMap: Record<SupportedLocale, LocaleData> = { en, hi, or: or_ };

const STORAGE_KEY = 'meal_planner_locale';

interface LocaleContextValue {
    locale: SupportedLocale;
    setLocale: (locale: SupportedLocale) => void;
    t: (key: string, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
    locale: DEFAULT_LOCALE,
    setLocale: () => { },
    t: (key) => key,
});

/**
 * Resolve a dot-notation key like "header.welcome" from a nested object.
 */
function resolvePath(obj: Record<string, unknown>, path: string): string {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current === null || typeof current !== 'object') return path;
        current = (current as Record<string, unknown>)[part];
    }
    if (typeof current === 'string') return current;
    return path;
}

/**
 * Replace {{var}} placeholders in a string.
 */
function interpolate(str: string, vars?: Record<string, string | number>): string {
    if (!vars) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) =>
        key in vars ? String(vars[key]) : `{{${key}}}`
    );
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<SupportedLocale>(DEFAULT_LOCALE);

    // Hydrate from localStorage on mount (client only)
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY) as SupportedLocale | null;
        if (stored && stored in localeMap) {
            setLocaleState(stored);
        }
    }, []);

    const setLocale = useCallback((newLocale: SupportedLocale) => {
        setLocaleState(newLocale);
        localStorage.setItem(STORAGE_KEY, newLocale);
    }, []);

    const t = useCallback(
        (key: string, vars?: Record<string, string | number>): string => {
            const data = localeMap[locale] as Record<string, unknown>;
            const fallback = localeMap[DEFAULT_LOCALE] as Record<string, unknown>;
            const resolved = resolvePath(data, key) || resolvePath(fallback, key) || key;
            return interpolate(resolved, vars);
        },
        [locale]
    );

    return (
        <LocaleContext.Provider value={{ locale, setLocale, t }}>
            {children}
        </LocaleContext.Provider>
    );
}

export function useLocale() {
    return useContext(LocaleContext);
}
