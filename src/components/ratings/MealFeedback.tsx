'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { loadRatingsStatus, updateCachedRatingsStatus } from '@/lib/ratings/client';
import { markRatingFeedbackSeen } from '@/lib/ratings/actions';
import type { RatingsStatus } from '@/lib/ratings/types';
import MealRatingPrompt from './MealRatingPrompt';
import RatingFeedbackDialog from './RatingFeedbackDialog';

/** Wait for the page to settle before asking anything. */
const START_DELAY_MS = 1200;

/**
 * Mounted once in AppShell. Shows cooks and chefs a summary of new ratings,
 * then (separately, never at the same time) asks members to rate open
 * sessions, one at a time.
 */
export default function MealFeedback() {
    const { user } = useAuth();
    const uid = user?.uid;
    const [status, setStatus] = useState<RatingsStatus | null>(null);

    useEffect(() => {
        if (!uid) return;
        let alive = true;
        const timer = window.setTimeout(() => {
            loadRatingsStatus(uid).then(next => {
                if (alive) setStatus(next);
            });
        }, START_DELAY_MS);
        return () => {
            alive = false;
            window.clearTimeout(timer);
        };
    }, [uid]);

    if (!uid || !status) return null;

    const update = (change: (s: RatingsStatus) => RatingsStatus) => {
        updateCachedRatingsStatus(uid, change);
        setStatus(s => (s ? change(s) : s));
    };

    if (status.feedback) {
        const { cook, chef } = status.feedback;
        const upTo = { ...(cook ? { cook: cook.upToMs } : {}), ...(chef ? { chef: chef.upToMs } : {}) };
        return (
            <RatingFeedbackDialog
                feedback={status.feedback}
                today={status.today}
                onClose={() => {
                    void markRatingFeedbackSeen(upTo).catch(() => undefined);
                    update(s => ({ ...s, feedback: null }));
                }}
            />
        );
    }

    const next = status.pending[0];
    if (!next) return null;
    return (
        <MealRatingPrompt
            key={`${next.date}_${next.session}`}
            pending={next}
            today={status.today}
            namesVisible={status.namesVisible}
            onDone={() => update(s => ({ ...s, pending: s.pending.filter(p => p.date !== next.date || p.session !== next.session) }))}
        />
    );
}
