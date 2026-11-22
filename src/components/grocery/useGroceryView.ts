'use client';

import { useEffect, useState } from 'react';
import { loadGroceryView, subscribeGroceryView } from '@/lib/grocery/client';
import type { GroceryView } from '@/lib/grocery/types';

/** The grocery view for the signed-in user; undefined while loading, null if it failed. */
export function useGroceryView(uid: string | undefined): GroceryView | null | undefined {
    const [view, setView] = useState<GroceryView | null | undefined>(undefined);
    useEffect(() => {
        if (!uid) return;
        let alive = true;
        const unsubscribe = subscribeGroceryView(next => {
            if (alive) setView(next);
        });
        loadGroceryView(uid).then(next => {
            if (alive) setView(next);
        });
        return () => {
            alive = false;
            unsubscribe();
        };
    }, [uid]);
    return view;
}
