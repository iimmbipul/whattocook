'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { mealNameKey, type MealPhoto } from './mealPhoto';

/**
 * Browser-side cache for meal photo lookups (/api/meal-image).
 * - One request per dish, shared by every component that shows it.
 * - Results persist in localStorage for a week, so reloads don't refetch.
 * - Components subscribe and re-render when a lookup resolves.
 */

export type PhotoEntry = { photo: MealPhoto | null; at: number };

const STORAGE_KEY = 'wtc_meal_photos_v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

const entries = new Map<string, PhotoEntry>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let hydrated = false;

function hydrate() {
    if (hydrated || typeof window === 'undefined') return;
    hydrated = true;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const stored = JSON.parse(raw) as Record<string, PhotoEntry>;
        const now = Date.now();
        for (const [key, entry] of Object.entries(stored)) {
            if (entry && now - entry.at < TTL_MS) entries.set(key, entry);
        }
    } catch {
        /* storage unavailable or corrupt: start empty */
    }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        try {
            const recent = Array.from(entries.entries()).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(recent)));
        } catch {
            /* quota or private mode: memory cache still works */
        }
    }, 500);
}

let version = 0;
function emit() {
    version++;
    listeners.forEach(l => l());
}

/** Re-renders the caller whenever any lookup resolves (for lists of dishes). */
export function useMealPhotoCacheVersion(): number {
    return useSyncExternalStore(subscribe, () => version, () => 0);
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function peekMealPhoto(name: string | undefined): PhotoEntry | undefined {
    if (!name) return undefined;
    hydrate();
    return entries.get(mealNameKey(name));
}

/** Look a dish up unless it's cached or already being fetched. */
export function requestMealPhoto(name: string): void {
    hydrate();
    const key = mealNameKey(name);
    if (!key || entries.has(key) || inflight.has(key)) return;
    inflight.add(key);
    fetch(`/api/meal-image?q=${encodeURIComponent(name)}`, { credentials: 'same-origin' })
        .then(async res => {
            if (res.ok) {
                const body = (await res.json()) as { photo: MealPhoto | null };
                entries.set(key, { photo: body.photo ?? null, at: Date.now() });
                persist();
                emit();
            } else if (res.status === 400) {
                entries.set(key, { photo: null, at: Date.now() });
                emit();
            }
            // 401/503: don't remember a miss; a later render can try again.
        })
        .catch(() => { /* offline: keep the placeholder */ })
        .finally(() => inflight.delete(key));
}

/**
 * The cached photo entry for a meal name (undefined = not looked up yet,
 * photo: null = nothing suitable). Triggers the lookup when `enabled`.
 */
export function useMealPhoto(name: string | undefined, { enabled = true }: { enabled?: boolean } = {}): PhotoEntry | undefined {
    const entry = useSyncExternalStore(
        subscribe,
        () => peekMealPhoto(name),
        () => undefined,
    );
    useEffect(() => {
        if (name && enabled) requestMealPhoto(name);
    }, [name, enabled]);
    return entry;
}
