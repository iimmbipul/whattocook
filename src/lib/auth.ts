'use server';

import {
    db, collection, query, where, getDocs, addDoc, getCountFromServer, doc, getDoc, writeBatch, serverTimestamp, setDoc, deleteDoc, updateDoc, deleteField, increment, Timestamp, type DocumentData, type QueryDocumentSnapshot,
} from './server/db';
import { User, UserRole } from '@/types/meal';
import { generate30DayPlan, MonthlyPlanDay } from './ai';
import { resetHouseholdResponsibilities, clearMemberAssignments } from './server/household';
import { verifyGoogleIdentityToken } from './server/idToken';
import { dummyVerify, hashSecret, verifySecret } from './server/password';
import {
    clearPendingSignup,
    clearSessionCookies,
    readPendingSignup,
    readSessionCookieWithToken,
    verifySessionToken,
    writePendingSignup,
    writeSessionCookie,
    writeSessionTokenCookie,
    type AuthMethod,
    type VerifiedSession,
} from './server/session';
import {
    COOKS_COLLECTION,
    MEMBERS_COLLECTION,
    USERS_COLLECTION,
    buildUser,
    collectionForRole,
    ensureHouseCredentials,
    getSessionUser,
    householdIdFor,
    loadAccount,
    randomDigits,
    randomLetters,
} from './server/currentUser';
import { authorizeHousehold, isAppAdmin, isSafeDocId } from './server/guards';

/** Diet categories offered in onboarding and on the profile page. */
const DIET_CATEGORIES = ['Healthy', 'Vegan', 'Indian', 'Balanced', 'Protein-Heavy', 'Flexible'];

/** Wrong PIN/password attempts before an account is locked for LOCKOUT_MS. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Derive the household ID for a user.
 * Owners (role 'user') use their own uid; members/cooks use their linkedUserId.
 */
function getHouseholdId(role: UserRole, uid: string, linkedUserId?: string): string {
    return householdIdFor(role, uid, linkedUserId);
}

function normalizeDietCategory(category?: string | null): string | null {
    if (typeof category !== 'string') return null;
    const wanted = category.trim().toLowerCase();
    return DIET_CATEGORIES.find(c => c.toLowerCase() === wanted) ?? null;
}

type FoundAccount = { role: UserRole; snap: QueryDocumentSnapshot<DocumentData> };

/** Find an account by email; owners take precedence over members, then cooks. */
async function findAccountByEmail(email: string): Promise<FoundAccount | null> {
    if (typeof email !== 'string' || !email || email.length > 320) return null;
    const byEmail = (collectionName: string) =>
        getDocs(query(collection(db, collectionName), where('email', '==', email)));
    const [owners, members, cooks] = await Promise.all([
        byEmail(USERS_COLLECTION),
        byEmail(MEMBERS_COLLECTION),
        byEmail(COOKS_COLLECTION),
    ]);
    if (!owners.empty) return { role: 'user', snap: owners.docs[0] };
    if (!members.empty) return { role: 'member', snap: members.docs[0] };
    if (!cooks.empty) return { role: 'cook', snap: cooks.docs[0] };
    return null;
}

/** Issue a session for an existing account and return the user (with its session token). */
async function startSession(role: UserRole, uid: string, data: DocumentData, amr: AuthMethod): Promise<User> {
    await ensureHouseCredentials(role, uid, data);
    const user = buildUser(role, uid, data);
    const sessionToken = await writeSessionCookie(user, amr);
    await clearPendingSignup();
    return { ...user, sessionToken };
}

export type GoogleLoginResult =
    | { status: 'ok'; user: User }
    | { status: 'needs_onboarding'; email: string; displayName?: string; photoURL?: string }
    | { status: 'error'; error: string };

/**
 * Login via Google. `idToken` is the Firebase ID token from signInWithPopup
 * (or a Google ID token from the mobile app's native sign-in); it is verified
 * on the server and the email inside it is the only identity trusted.
 *
 * Unknown emails get a short-lived signed "pending sign-up" cookie and are
 * sent to onboarding, which reads the verified email from that cookie.
 */
export async function loginWithGoogle(idToken: string): Promise<GoogleLoginResult> {
    try {
        const identity = await verifyGoogleIdentityToken(idToken);
        if (!identity) {
            return { status: 'error', error: 'We could not verify your Google sign-in. Please try again.' };
        }

        const account = await findAccountByEmail(identity.email);
        if (!account) {
            await writePendingSignup({ email: identity.email, displayName: identity.name, photoURL: identity.picture });
            return { status: 'needs_onboarding', email: identity.email, displayName: identity.name, photoURL: identity.picture };
        }

        const { role, snap } = account;
        const data: DocumentData = { ...snap.data() };
        const updates: DocumentData = {};
        if (identity.name && data.displayName !== identity.name) updates.displayName = identity.name;
        if (identity.picture && data.photoURL !== identity.picture) updates.photoURL = identity.picture;
        if (Object.keys(updates).length > 0) {
            await setDoc(doc(db, collectionForRole(role), snap.id), updates, { merge: true });
            Object.assign(data, updates);
        }

        return { status: 'ok', user: await startSession(role, snap.id, data, 'google') };
    } catch (error) {
        console.error('Google login error:', error);
        return { status: 'error', error: 'Sign-in failed. Please try again.' };
    }
}

/**
 * Create a new household for a new user (via Google Auth)
 * Optionally generates a 30-day meal plan based on the chosen category.
 *
 * The email, name and photo come from the verified pending sign-up set by
 * loginWithGoogle; the arguments are kept for compatibility, and a
 * different `email` is rejected.
 */
export async function createNewHousehold(email: string, category?: string, displayName?: string, photoURL?: string): Promise<User | null> {
    void displayName; void photoURL; // taken from the verified Google identity instead
    try {
        const pending = await readPendingSignup();
        if (!pending) {
            console.warn('[auth] createNewHousehold: no verified Google sign-in pending');
            return null;
        }
        if (email && email.toLowerCase() !== pending.email.toLowerCase()) {
            console.warn('[auth] createNewHousehold: email does not match the verified sign-in');
            return null;
        }

        // Already registered (double submit, or invited meanwhile) — just sign in.
        const existing = await findAccountByEmail(pending.email);
        if (existing) {
            return await startSession(existing.role, existing.snap.id, { ...existing.snap.data() }, 'google');
        }

        const dietCategory = normalizeDietCategory(category);
        const houseCode = randomLetters(6);
        const housePin = randomDigits(6);

        const newUserData = {
            email: pending.email,
            displayName: pending.displayName || null,
            photoURL: pending.photoURL || null,
            role: 'user',
            phoneNumber: process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            createdAt: new Date(),
            houseCode,
            housePin,
            dietCategory,
        };
        const docRef = await addDoc(collection(db, USERS_COLLECTION), newUserData);
        const householdId = docRef.id;

        // If a category was provided, generate 30 days of meals
        if (dietCategory) {
            try {
                let plan: MonthlyPlanDay[] = [];
                const categoryDocId = dietCategory.toLowerCase().trim();
                const categoryTemplateRef = doc(db, 'category_templates', categoryDocId);
                const categoryTemplateSnap = await getDoc(categoryTemplateRef);

                if (categoryTemplateSnap.exists()) {
                    // Use static template data from Firestore
                    plan = categoryTemplateSnap.data().plan as MonthlyPlanDay[];
                } else {
                    // Generate using AI and save statically for future users
                    plan = await generate30DayPlan(dietCategory);
                    if (plan && plan.length > 0) {
                        await setDoc(categoryTemplateRef, {
                            category: dietCategory,
                            plan: plan,
                            created_at: serverTimestamp()
                        });
                    }
                }

                if (plan && plan.length > 0) {
                    const batch = writeBatch(db);
                    const mealsCollectionName = `households/${householdId}/meals`;

                    for (const day of plan) {
                        const dayDocId = day.day.toString().padStart(2, '0');
                        const mealRef = doc(db, mealsCollectionName, dayDocId);

                        const isVegetarian = dietCategory.toLowerCase() === 'vegan' || dietCategory.toLowerCase() === 'vegetarian';

                        batch.set(mealRef, {
                            id: dayDocId,
                            date: "unknown", // It's a template generic day
                            day_of_week: "Unknown",
                            created_at: serverTimestamp(),
                            updated_at: serverTimestamp(),
                            total_calories: (day.breakfast_cal || 0) + (day.lunch_cal || 0) + (day.dinner_cal || 0),
                            breakfast: {
                                item_name: day.breakfast_name || 'Not Set',
                                calories: day.breakfast_cal || 0,
                                image_url: '',
                                is_vegetarian: isVegetarian,
                                ingredients: [],
                                cooking_instructions: []
                            },
                            lunch: {
                                item_name: day.lunch_name || 'Not Set',
                                calories: day.lunch_cal || 0,
                                image_url: '',
                                is_vegetarian: isVegetarian,
                                ingredients: [],
                                cooking_instructions: []
                            },
                            dinner: {
                                item_name: day.dinner_name || 'Not Set',
                                calories: day.dinner_cal || 0,
                                image_url: '',
                                is_vegetarian: isVegetarian,
                                ingredients: [],
                                cooking_instructions: []
                            }
                        });
                    }
                    await batch.commit();
                }
            } catch (planError) {
                console.error("Failed to generate or save meal plan:", planError);
                // Continue despite failure to not block user creation
            }
        }

        const user = buildUser('user', householdId, newUserData);
        const sessionToken = await writeSessionCookie(user, 'google');
        await clearPendingSignup();
        return { ...user, sessionToken };
    } catch (error) {
        console.error('Create new household error:', error);
        return null;
    }
}

/**
 * Join an existing household as a member (via Google Auth). Like
 * createNewHousehold, the identity comes from the verified pending sign-up.
 */
export async function joinHousehold(email: string, houseCode: string, housePin: string, displayName?: string, photoURL?: string): Promise<{ success: boolean; user?: User; error?: string }> {
    void displayName; void photoURL; // taken from the verified Google identity instead
    try {
        const pending = await readPendingSignup();
        if (!pending || (email && email.toLowerCase() !== pending.email.toLowerCase())) {
            return { success: false, error: 'Your sign-in has expired. Please sign in with Google again.' };
        }

        const existing = await findAccountByEmail(pending.email);
        if (existing) {
            const user = await startSession(existing.role, existing.snap.id, { ...existing.snap.data() }, 'google');
            return { success: true, user };
        }

        const code = typeof houseCode === 'string' ? houseCode.trim().toUpperCase() : '';
        const pin = typeof housePin === 'string' ? housePin.trim() : '';
        if (!code || !pin || code.length > 32 || pin.length > 32) {
            return { success: false, error: 'Invalid House ID or PIN.' };
        }

        // Find the owner with matching houseCode and housePin
        const usersRef = collection(db, USERS_COLLECTION);
        const q = query(usersRef, where('houseCode', '==', code), where('housePin', '==', pin));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            return { success: false, error: 'Invalid House ID or PIN.' };
        }

        const ownerDoc = querySnapshot.docs[0];
        const ownerId = ownerDoc.id;

        // Create the new member
        const newMemberData = {
            email: pending.email,
            displayName: pending.displayName || null,
            photoURL: pending.photoURL || null,
            role: 'member',
            phoneNumber: process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            createdAt: new Date(),
            linkedUserId: ownerId,
        };

        const docRef = await addDoc(collection(db, MEMBERS_COLLECTION), newMemberData);

        try {
            await resetHouseholdResponsibilities(ownerId);
        } catch (redistErr) {
            console.error('Failed to redistribute responsibilities after joinHousehold:', redistErr);
        }

        const user = buildUser('member', docRef.id, newMemberData);
        const sessionToken = await writeSessionCookie(user, 'google');
        await clearPendingSignup();

        return { success: true, user: { ...user, sessionToken } };
    } catch (error) {
        console.error('Join household error:', error);
        return { success: false, error: 'An error occurred while joining.' };
    }
}

function toMillis(value: unknown): number | null {
    if (value instanceof Timestamp) return value.toMillis();
    if (value && typeof value === 'object' && typeof (value as { seconds?: unknown }).seconds === 'number') {
        return (value as { seconds: number }).seconds * 1000;
    }
    return null;
}

/**
 * Check a password or PIN for one account document, with a lockout after
 * repeated failures. On success, legacy plaintext values are replaced by a
 * hash (one-time migration on login) and the failure counter is cleared.
 */
async function checkCredential(snap: QueryDocumentSnapshot<DocumentData>, secret: string, kind: 'password' | 'pin'): Promise<boolean> {
    const data = snap.data();
    const lockedUntil = toMillis(data.authLockedUntil);
    if (lockedUntil && lockedUntil > Date.now()) {
        await dummyVerify(secret);
        return false;
    }

    const hashField = kind === 'pin' ? 'pinHash' : 'passwordHash';
    const legacyRaw = kind === 'pin' ? (data.pin ?? data.password) : data.password;
    const legacyValue = typeof legacyRaw === 'number' ? String(legacyRaw) : legacyRaw;
    const result = await verifySecret(secret, data[hashField], legacyValue);

    if (!result.ok) {
        const failures = (typeof data.authFailures === 'number' ? data.authFailures : 0) + 1;
        const update: DocumentData = failures >= MAX_FAILED_ATTEMPTS
            ? { authFailures: 0, authLockedUntil: Timestamp.fromMillis(Date.now() + LOCKOUT_MS) }
            : { authFailures: increment(1) };
        await updateDoc(snap.ref, update).catch(err => console.error('[auth] could not record failed attempt', err));
        return false;
    }

    const update: DocumentData = {};
    if (data.authFailures) update.authFailures = deleteField();
    if (data.authLockedUntil) update.authLockedUntil = deleteField();
    const plaintextFields = kind === 'pin' ? ['pin', 'password'] : ['password'];
    const hasPlaintext = plaintextFields.some(f => data[f] !== undefined);
    if (result.needsRehash || hasPlaintext) {
        update[hashField] = await hashSecret(secret);
        for (const f of plaintextFields) {
            if (data[f] !== undefined) update[f] = deleteField();
        }
    }
    if (Object.keys(update).length > 0) {
        await updateDoc(snap.ref, update).catch(err => console.error('[auth] could not update credential record', err));
    }
    return true;
}

/**
 * Login with email and password (Firestore-based). Not used by the current
 * UI (owners/members sign in with Google); kept for compatibility.
 */
export async function loginWithEmail(email: string, password: string): Promise<User | null> {
    try {
        if (typeof password !== 'string' || !password) return null;
        const account = await findAccountByEmail(email);
        if (!account) {
            await dummyVerify(password);
            return null;
        }
        if (!(await checkCredential(account.snap, password, 'password'))) return null;
        return await startSession(account.role, account.snap.id, { ...account.snap.data() }, 'password');
    } catch (error) {
        console.error('Login error:', error);
        return null;
    }
}

/**
 * Login with Phone Number and PIN (Firestore-based) for Cooks
 */
export async function loginWithPhoneAndPin(phoneNumber: string, pin: string): Promise<User | null> {
    try {
        if (typeof phoneNumber !== 'string' || typeof pin !== 'string' || !pin) return null;
        const candidates = Array.from(new Set([phoneNumber, phoneNumber.trim()])).filter(p => p && p.length <= 32);
        if (candidates.length === 0) return null;

        const querySnapshot = await getDocs(
            query(collection(db, COOKS_COLLECTION), where('phoneNumber', 'in', candidates))
        );
        if (querySnapshot.empty) {
            await dummyVerify(pin);
            return null; // Cook not found or invalid PIN
        }

        for (const cookDoc of querySnapshot.docs) {
            if (await checkCredential(cookDoc, pin, 'pin')) {
                return await startSession('cook', cookDoc.id, { ...cookDoc.data() }, 'pin');
            }
        }
        return null;
    } catch (error) {
        console.error('Cook Login error:', error);
        return null;
    }
}

/**
 * Logout
 */
export async function logout(): Promise<void> {
    await clearSessionCookies();
    await clearPendingSignup();
}

/**
 * Get current authenticated user (from the verified session cookie).
 */
export async function getCurrentUser(): Promise<User | null> {
    try {
        return await getSessionUser();
    } catch (error) {
        console.error('getCurrentUser error:', error);
        return null;
    }
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
    const user = await getCurrentUser();
    return !!user;
}

/**
 * Re-check a verified session against Firestore and issue a fresh token.
 * If Firestore can't be reached, the still-valid token is kept as-is rather
 * than logging the user out over a transient error.
 */
async function renewSession(session: VerifiedSession, originalToken?: string): Promise<User | null> {
    let account: User | null;
    try {
        account = await loadAccount(session.user.role, session.user.uid);
    } catch (error) {
        console.error('Session refresh: account lookup failed; keeping current session', error);
        if (originalToken) await writeSessionTokenCookie(originalToken);
        return { ...session.user, sessionToken: originalToken };
    }
    if (!account) {
        await clearSessionCookies();
        return null;
    }
    const sessionToken = await writeSessionCookie(account, session.amr, session.authAt);
    return { ...account, sessionToken };
}

/**
 * Refresh current session from db and roll the signed cookie forward.
 * Returns the user including `sessionToken` for the iOS PWA fallback.
 */
export async function refreshSession(): Promise<User | null> {
    try {
        const current = await readSessionCookieWithToken();
        if (!current) {
            await clearSessionCookies(); // also drops any legacy unsigned cookie
            return null;
        }
        return await renewSession(current.session, current.token);
    } catch (error) {
        console.error('Session refresh error:', error);
        return null;
    }
}

/**
 * Restore the session cookie from the signed token the client kept in
 * localStorage (iOS PWAs drop cookies). Only tokens this server signed are
 * accepted; the account is re-checked in Firestore before a new cookie is set.
 */
export async function restoreSession(sessionToken: string): Promise<User | null> {
    try {
        const session = verifySessionToken(sessionToken);
        if (!session) return null;
        return await renewSession(session, sessionToken);
    } catch (error) {
        console.error('Failed to restore session:', error);
        return null;
    }
}

/**
 * @deprecated Use restoreSession(user.sessionToken). Kept so older callers
 * compile; it no longer trusts the user data, only the signed token in it.
 */
export async function restoreCookieFromClient(user: User): Promise<boolean> {
    return !!(await restoreSession(user?.sessionToken ?? ''));
}

/**
 * Create a new user in Firestore. Owner-only; members and cooks are always
 * added to the caller's own household (a different `linkedUserId` is
 * rejected). Creating another owner account requires an app admin.
 */
export async function createUser(
    email: string,
    password: string,
    role: UserRole,
    phoneNumber: string,
    linkedUserId?: string // Optional: must be the caller's household if given
): Promise<{ success: boolean; userId?: string; error?: string }> {
    try {
        const access = await authorizeHousehold('createUser', undefined, ['user']);
        if (!access) return { success: false, error: 'Only the household owner can add people.' };

        if (role !== 'user' && role !== 'member' && role !== 'cook') {
            return { success: false, error: 'Invalid role' };
        }
        if (role === 'user' && !(await isAppAdmin())) {
            return { success: false, error: 'Only app admins can create owner accounts.' };
        }
        if (role !== 'user' && linkedUserId && linkedUserId !== access.householdId) {
            return { success: false, error: 'You can only add people to your own household.' };
        }

        const cleanEmail = typeof email === 'string' ? email.trim() : '';
        const cleanPhone = typeof phoneNumber === 'string' ? phoneNumber.trim() : '';
        const secret = typeof password === 'string' ? password : '';
        if (cleanEmail.length > 320 || cleanPhone.length > 32) {
            return { success: false, error: 'Invalid email or phone number' };
        }
        if (role === 'cook') {
            if (!cleanPhone) return { success: false, error: 'Phone number is required for cooks' };
            if (secret.length < 4 || secret.length > 64) return { success: false, error: 'PIN must be at least 4 characters' };
        } else {
            if (!cleanEmail) return { success: false, error: 'Email is required' };
            if (secret && secret.length < 6) return { success: false, error: 'Password must be at least 6 characters' };
        }

        // Determine target collection based on role
        const targetCollection = collectionForRole(role);

        // Check if user already exists in ANY collection (email must be unique globally, except for cooks using phone only constraint)
        const existsInUsers = cleanEmail ? await checkEmailExists(USERS_COLLECTION, cleanEmail) : false;
        const existsInMembers = cleanEmail ? await checkEmailExists(MEMBERS_COLLECTION, cleanEmail) : false;
        const existsInCooks = cleanEmail ? await checkEmailExists(COOKS_COLLECTION, cleanEmail) : false;

        if (existsInUsers || existsInMembers || existsInCooks) {
            return { success: false, error: 'User with this email already exists' };
        }

        // For cooks, phone number must be unique
        if (role === 'cook') {
            const q = query(collection(db, COOKS_COLLECTION), where('phoneNumber', '==', cleanPhone));
            const snap = await getDocs(q);
            if (!snap.empty) {
                return { success: false, error: 'Cook with this phone number already exists' };
            }
        }

        // Prepare User Data — only hashes of the password/PIN are stored.
        const userData: DocumentData = {
            email: cleanEmail || `${cleanPhone}@cook.local`, // Fallback for cooks without email
            role,
            phoneNumber: cleanPhone || process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            createdAt: new Date(),
        };

        if (role === 'cook') {
            userData.pinHash = await hashSecret(secret);
        } else if (secret) {
            userData.passwordHash = await hashSecret(secret);
        }

        // Members/cooks always belong to the caller's household.
        if (role === 'member' || role === 'cook') {
            userData.linkedUserId = access.householdId;
        }

        // Create new user document in correct collection
        const docRef = await addDoc(collection(db, targetCollection), userData);

        // When a member or cook joins, rebalance cooking duties across the household.
        if (role === 'member' || role === 'cook') {
            try {
                await resetHouseholdResponsibilities(access.householdId);
            } catch (redistErr) {
                console.error('Failed to redistribute responsibilities after createUser:', redistErr);
            }
        }

        return { success: true, userId: docRef.id };
    } catch (error) {
        console.error('Error creating user:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to create user' };
    }
}

async function checkEmailExists(collectionName: string, email: string): Promise<boolean> {
    const q = query(collection(db, collectionName), where('email', '==', email));
    const snap = await getDocs(q);
    return !snap.empty;
}




/**
 * Get total count of members (users with role 'user' or 'member')
 * This represents the number of people to cook for.
 */
/**
 * Get total count of members (users + members)
 * If Caller is 'user' (Owner): Count Self (1) + Count of documents in 'members' linked to this user.
 * If Caller is 'member': Return count from their linked owner? Or just 1?
 * For now, assuming we want the TOTAL household count.
 */
export async function getMemberCount(): Promise<number> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) return 0;

        const ownerId = currentUser.householdId;

        // Count the owner (1)
        let count = 1;

        // Count all members linked to this owner
        const membersRef = collection(db, MEMBERS_COLLECTION);
        const q = query(membersRef, where('linkedUserId', '==', ownerId));
        const snapshot = await getCountFromServer(q);

        count += snapshot.data().count;

        return count;
    } catch (error) {
        console.error('Error fetching member count:', error);
        return 0;
    }
}

/**
 * Get all household members (Users + Members + Cooks)
 * Returns a list of potential assignees for responsibility
 */
export async function getAllHouseholdMembers(): Promise<{ uid: string; email: string; role: string; label: string; phoneNumber?: string }[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) return [];

        const householdId = currentUser.householdId || getHouseholdId(currentUser.role, currentUser.uid, currentUser.linkedUserId);
        const members: { uid: string; email: string; role: string; label: string; phoneNumber?: string }[] = [];

        // Owner doc and linked members/cooks are independent reads — fetch them
        // in one parallel round trip.
        const linkedQuery = (collectionName: string) =>
            getDocs(query(collection(db, collectionName), where('linkedUserId', '==', householdId)));
        const [ownerDocSnap, memberSnap, cookSnap] = await Promise.all([
            getDoc(doc(db, USERS_COLLECTION, householdId)),
            linkedQuery(MEMBERS_COLLECTION),
            linkedQuery(COOKS_COLLECTION),
        ]);

        // 1. The owner (User collection)
        if (ownerDocSnap.exists()) {
            const data = ownerDocSnap.data();
            members.push({
                uid: ownerDocSnap.id,
                email: data.email,
                role: 'user',
                label: data.email.split('@')[0],
                phoneNumber: data.phoneNumber
            });
        }

        // 2. Linked members, then cooks
        const addLinked = (snapshot: typeof memberSnap, role: string) => {
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                if (data.email) {
                    members.push({
                        uid: docSnap.id,
                        email: data.email,
                        role: role,
                        label: data.email.split('@')[0],
                        phoneNumber: data.phoneNumber
                    });
                }
            });
        };
        addLinked(memberSnap, 'member');
        addLinked(cookSnap, 'cook');

        console.log(`[Prod Debug] Fetched all household members for UID: ${currentUser.uid}, Computed Household ID: ${householdId}, Total Members Found: ${members.length}`);

        return members;
    } catch (error) {
        console.error('Error fetching household members:', error);
        return [];
    }
}

/**
 * Remove a household member (or cook) from the current owner's household.
 * Only the owner (role 'user') may call this. Also clears any dangling
 * responsibility assignments so counts remain accurate.
 */
export async function removeHouseholdMember(
    memberUid: string,
    memberRole: 'member' | 'cook'
): Promise<{ success: boolean; error?: string }> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) return { success: false, error: 'Not authenticated.' };
        if (currentUser.role !== 'user') return { success: false, error: 'Only the household owner can remove members.' };
        if (memberUid === currentUser.uid) return { success: false, error: 'You cannot remove yourself.' };
        if (!isSafeDocId(memberUid) || (memberRole !== 'member' && memberRole !== 'cook')) {
            return { success: false, error: 'Member not found.' };
        }

        const collectionName = memberRole === 'member' ? MEMBERS_COLLECTION : COOKS_COLLECTION;
        const memberRef = doc(db, collectionName, memberUid);
        const memberSnap = await getDoc(memberRef);

        if (!memberSnap.exists()) return { success: false, error: 'Member not found.' };
        if (memberSnap.data().linkedUserId !== currentUser.uid) {
            return { success: false, error: 'This member does not belong to your household.' };
        }

        await deleteDoc(memberRef);
        await clearMemberAssignments(currentUser.uid, memberUid);

        return { success: true };
    } catch (error) {
        console.error('Error removing household member:', error);
        return { success: false, error: 'Failed to remove member.' };
    }
}

/**
 * Get the household team's chosen diet category. The household is the
 * caller's own; a different `householdId` is rejected.
 */
export async function getHouseholdDietCategory(householdId?: string): Promise<string | null> {
    try {
        const access = await authorizeHousehold('getHouseholdDietCategory', householdId);
        if (!access) return null;
        const ownerDoc = await getDoc(doc(db, USERS_COLLECTION, access.householdId));
        if (ownerDoc.exists()) {
            return ownerDoc.data().dietCategory || null;
        }
        return null;
    } catch (error) {
        console.error('Error fetching diet category:', error);
        return null;
    }
}

/**
 * Change the household team's diet category (owner only, own household).
 * Completely replaces all generic menu template days with the new AI plan
 */
export async function changeDietCategory(householdId: string | undefined, newCategory: string): Promise<boolean> {
    try {
        const access = await authorizeHousehold('changeDietCategory', householdId, ['user']);
        if (!access) return false;
        const category = normalizeDietCategory(newCategory);
        if (!category) return false;
        householdId = access.householdId;
        newCategory = category;

        let plan: MonthlyPlanDay[] = [];
        const categoryDocId = newCategory.toLowerCase().trim();
        const categoryTemplateRef = doc(db, 'category_templates', categoryDocId);
        const categoryTemplateSnap = await getDoc(categoryTemplateRef);

        if (categoryTemplateSnap.exists()) {
            plan = categoryTemplateSnap.data().plan as MonthlyPlanDay[];
        } else {
            plan = await generate30DayPlan(newCategory);
            if (plan && plan.length > 0) {
                await setDoc(categoryTemplateRef, {
                    category: newCategory,
                    plan: plan,
                    created_at: serverTimestamp()
                });
            }
        }

        if (plan && plan.length > 0) {
            const batch = writeBatch(db);
            const mealsCollectionName = `households/${householdId}/meals`;

            for (const day of plan) {
                const dayDocId = day.day.toString().padStart(2, '0');
                const mealRef = doc(db, mealsCollectionName, dayDocId);
                const isVegetarian = newCategory.toLowerCase() === 'vegan' || newCategory.toLowerCase() === 'vegetarian';

                batch.set(mealRef, {
                    id: dayDocId,
                    date: "unknown",
                    day_of_week: "Unknown",
                    created_at: serverTimestamp(),
                    updated_at: serverTimestamp(),
                    total_calories: (day.breakfast_cal || 0) + (day.lunch_cal || 0) + (day.dinner_cal || 0),
                    breakfast: {
                        item_name: day.breakfast_name || 'Not Set',
                        calories: day.breakfast_cal || 0,
                        image_url: '',
                        is_vegetarian: isVegetarian,
                        ingredients: [],
                        cooking_instructions: []
                    },
                    lunch: {
                        item_name: day.lunch_name || 'Not Set',
                        calories: day.lunch_cal || 0,
                        image_url: '',
                        is_vegetarian: isVegetarian,
                        ingredients: [],
                        cooking_instructions: []
                    },
                    dinner: {
                        item_name: day.dinner_name || 'Not Set',
                        calories: day.dinner_cal || 0,
                        image_url: '',
                        is_vegetarian: isVegetarian,
                        ingredients: [],
                        cooking_instructions: []
                    }
                });
            }

            // Update user document
            const userRef = doc(db, USERS_COLLECTION, householdId);
            batch.update(userRef, { dietCategory: newCategory });

            await batch.commit();
            return true;
        }
        return false;
    } catch(err) {
        console.error("Change diet error:", err);
        return false;
    }
}
