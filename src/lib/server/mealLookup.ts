import 'server-only';

import type { MealDocument } from '@/types/meal';
import { adminFirestore } from './firebaseAdmin';

const TEMPLATES_COLLECTION = 'menu_templates';

type Fs = ReturnType<typeof adminFirestore>;

/**
 * The meal for each date, resolved the same way the dashboard does
 * (lookupMealByDate in firestore.ts): the dated household doc, then the
 * household's day-of-month doc, then the master menu. One round trip.
 */
export async function findMeals(fs: Fs, hid: string, dates: string[]): Promise<Map<string, MealDocument | null>> {
    const plans = [...new Set(dates)].map(date => {
        const day = date.slice(8, 10);
        const unpadded = String(Number(day));
        const ids = unpadded === day ? [day] : [day, unpadded];
        return {
            date,
            paths: [
                `households/${hid}/meals/${date}`,
                ...ids.map(id => `households/${hid}/meals/${id}`),
                ...ids.map(id => `${TEMPLATES_COLLECTION}/${id}`),
            ],
        };
    });
    const refs = plans.flatMap(p => p.paths.map(path => fs.doc(path)));
    const snaps = refs.length > 0 ? await fs.getAll(...refs) : [];
    const byPath = new Map(snaps.map(s => [s.ref.path, s]));
    return new Map(
        plans.map(p => {
            const hit = p.paths.map(path => byPath.get(path)).find(s => s?.exists);
            return [p.date, hit ? (hit.data() as MealDocument) : null];
        }),
    );
}
