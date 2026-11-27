import 'server-only';

import { after } from 'next/server';
import type { LevelChange } from '../milkbasket/logic';

/*
 * The small piece of Milkbasket auto-order the grocery code calls. It only
 * checks the household is allowed and schedules the work for after the
 * response is sent, so reporting stock never waits on Milkbasket. The
 * work itself (src/lib/server/milkbasket.ts) is loaded on demand.
 */

/** Households allowed to use the Milkbasket account: MB_HOUSEHOLD_IDS, comma-separated owner uids. */
export function milkbasketHouseholds(): string[] {
    return (process.env.MB_HOUSEHOLD_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

export function isMilkbasketHousehold(householdId: string): boolean {
    return !!householdId && milkbasketHouseholds().includes(householdId);
}

/** Run `task` after the response (or straight away outside a request, e.g. in scripts). */
export function runAfterResponse(label: string, task: () => Promise<void>): void {
    const run = async () => {
        try {
            await task();
        } catch (err) {
            console.error(`[milkbasket] ${label} failed:`, err instanceof Error ? err.message : err);
        }
    };
    try {
        after(run);
    } catch {
        void run();
    }
}

/** Pantry levels changed: let Milkbasket auto-order look at the items, in the background. */
export function queueLevelChanges(householdId: string, changes: LevelChange[]): void {
    const real = changes.filter(c => c.from !== c.to);
    if (real.length === 0 || !isMilkbasketHousehold(householdId)) return;
    runAfterResponse('level change', async () => {
        const { handleLevelChanges } = await import('./milkbasket');
        await handleLevelChanges(householdId, real);
    });
}
