import { User } from '@/types/meal';

/**
 * Build the { uid, name } record used to attribute notifications.
 * Falls back through displayName → email local-part → "Someone".
 */
export function actorFromUser(user: User | null | undefined): { uid: string; name: string } | undefined {
    if (!user) return undefined;
    const name =
        user.displayName?.trim() ||
        user.email?.split('@')[0] ||
        'Someone';
    return { uid: user.uid, name };
}
