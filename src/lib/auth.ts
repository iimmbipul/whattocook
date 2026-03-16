'use server';

import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, getCountFromServer, doc, getDoc } from 'firebase/firestore';
import { User, UserRole } from '@/types/meal';
import { cookies } from 'next/headers';

const USERS_COLLECTION = 'users'; // Owners/Admins
const MEMBERS_COLLECTION = 'members'; // Family members
const COOKS_COLLECTION = 'cooks'; // Cooks
const COOKIE_NAME = 'session_user';

/**
 * Login with email and password (Firestore-based)
 */
export async function loginWithEmail(email: string, password: string): Promise<User | null> {
    try {
        // Try to find user in all collections
        // 1. Check 'users' (Owners)
        let userDoc = await findUserInCollection(USERS_COLLECTION, email, password);
        let role: UserRole = 'user';

        // 2. Check 'members'
        if (!userDoc) {
            userDoc = await findUserInCollection(MEMBERS_COLLECTION, email, password);
            role = 'member';
        }

        // 3. Check 'cooks'
        if (!userDoc) {
            userDoc = await findUserInCollection(COOKS_COLLECTION, email, password);
            role = 'cook';
        }

        if (!userDoc) {
            return null; // Not found in any collection
        }

        const userData = userDoc.data();

        const user: User = {
            uid: userDoc.id,
            email: userData.email,
            role: role, // Explicitly set based on collection found
            phoneNumber: userData.phoneNumber || process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            linkedUserId: userData.linkedUserId, // Get linked ID if exists
            householdId: getHouseholdId(role, userDoc.id, userData.linkedUserId),
        };

        // Create cookie
        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, JSON.stringify(user), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7, // 1 week
            path: '/',
        });

        return user;
    } catch (error) {
        console.error('Login error:', error);
        return null;
    }
}

/**
 * Derive the household ID for a user.
 * Owners (role 'user') use their own uid; members/cooks use their linkedUserId.
 */
function getHouseholdId(role: UserRole, uid: string, linkedUserId?: string): string {
    if (role === 'user') return uid;
    return linkedUserId || uid; // fallback to own uid if no link
}

// Helper to find user in a specific collection
async function findUserInCollection(collectionName: string, email: string, password: string) {
    const usersRef = collection(db, collectionName);
    const q = query(usersRef, where('email', '==', email), where('password', '==', password));
    const querySnapshot = await getDocs(q);
    return querySnapshot.empty ? null : querySnapshot.docs[0];
}

/**
 * Logout
 */
export async function logout(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_NAME);
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser(): Promise<User | null> {
    try {
        const cookieStore = await cookies();
        const userCookie = cookieStore.get(COOKIE_NAME);

        if (userCookie && userCookie.value) {
            const user = JSON.parse(userCookie.value) as User;

            // Fix for old cookies missing linkedUserId
            if ((user.role === 'member' || user.role === 'cook') && !user.linkedUserId) {
                const collectionName = user.role === 'member' ? MEMBERS_COLLECTION : COOKS_COLLECTION;
                const docRef = doc(db, collectionName, user.uid);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    user.linkedUserId = docSnap.data().linkedUserId;
                }
            }

            if (!user.householdId) {
                user.householdId = getHouseholdId(user.role, user.uid, user.linkedUserId);
            }
            return user;
        }
    } catch (error) {
        // Ignore parsing errors
    }
    return null;
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
    const user = await getCurrentUser();
    return !!user;
}

/**
 * Refresh current session from db, patch old cookies, update token
 */
export async function refreshSession(): Promise<User | null> {
    try {
        const cookieStore = await cookies();
        const userCookie = cookieStore.get(COOKIE_NAME);
        if (!userCookie || !userCookie.value) return null;

        const parsedUser = JSON.parse(userCookie.value) as User;

        let targetCollection = USERS_COLLECTION;
        if (parsedUser.role === 'member') targetCollection = MEMBERS_COLLECTION;
        if (parsedUser.role === 'cook') targetCollection = COOKS_COLLECTION;

        const docRef = doc(db, targetCollection, parsedUser.uid);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            cookieStore.delete(COOKIE_NAME);
            return null;
        }

        const userData = docSnap.data();

        const freshUser: User = {
            uid: docSnap.id,
            email: userData.email,
            role: parsedUser.role,
            phoneNumber: userData.phoneNumber || process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            linkedUserId: userData.linkedUserId,
            householdId: getHouseholdId(parsedUser.role, docSnap.id, userData.linkedUserId),
        };

        cookieStore.set(COOKIE_NAME, JSON.stringify(freshUser), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7, // 1 week
            path: '/',
        });

        return freshUser;
    } catch (error) {
        console.error('Session refresh error:', error);
        return null;
    }
}

/**
 * Restore cookie session from client-provided user data (e.g. from localStorage).
 * This acts as our "refresh token" mechanism when browser clears cookies (like iOS PWA) 
 * but client state is retained.
 */
export async function restoreCookieFromClient(user: User): Promise<boolean> {
    try {
        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, JSON.stringify(user), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7, // 1 week
            path: '/',
        });
        return true;
    } catch (error) {
        console.error('Failed to restore cookie from client:', error);
        return false;
    }
}

/**
 * Create a new user in Firestore
 */
export async function createUser(
    email: string,
    password: string,
    role: UserRole,
    phoneNumber: string,
    linkedUserId?: string // Optional: ID of the owner creating this user
): Promise<{ success: boolean; userId?: string; error?: string }> {
    try {
        // Determine target collection based on role
        let targetCollection = USERS_COLLECTION;
        if (role === 'member') targetCollection = MEMBERS_COLLECTION;
        if (role === 'cook') targetCollection = COOKS_COLLECTION;

        // Check if user already exists in ANY collection (email must be unique globally)
        const existsInUsers = await checkEmailExists(USERS_COLLECTION, email);
        const existsInMembers = await checkEmailExists(MEMBERS_COLLECTION, email);
        const existsInCooks = await checkEmailExists(COOKS_COLLECTION, email);

        if (existsInUsers || existsInMembers || existsInCooks) {
            return { success: false, error: 'User with this email already exists' };
        }

        // Prepare User Data
        const userData: any = {
            email,
            password, // In production, you should hash this!
            role,
            phoneNumber: phoneNumber || process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            createdAt: new Date(),
        };

        // Link to owner if applicable (members/cooks)
        if ((role === 'member' || role === 'cook') && linkedUserId) {
            userData.linkedUserId = linkedUserId;
        } else if (role !== 'user') {
            // If trying to create member/cook without link (shouldn't happen in app flow)
            // We can allow it but it's orphans.
        }

        // Create new user document in correct collection
        const docRef = await addDoc(collection(db, targetCollection), userData);

        return { success: true, userId: docRef.id };
    } catch (error: any) {
        console.error('Error creating user:', error);
        return { success: false, error: error.message };
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

        let ownerId = currentUser.uid;
        // If current user is a member or cook, use their linked owner ID to find siblings
        if ((currentUser.role === 'member' || currentUser.role === 'cook') && currentUser.linkedUserId) {
            ownerId = currentUser.linkedUserId;
        }

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

        // 1. Fetch the owner (User collection)
        const ownerDocRef = doc(db, USERS_COLLECTION, householdId);
        const ownerDocSnap = await getDoc(ownerDocRef);

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

        // 2. Fetch linked members/cooks
        const fetchLinkedAndMap = async (collectionName: string, role: string) => {
            const q = query(collection(db, collectionName), where('linkedUserId', '==', householdId));
            const querySnapshot = await getDocs(q);
            querySnapshot.forEach((docSnap) => {
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

        await Promise.all([
            fetchLinkedAndMap(MEMBERS_COLLECTION, 'member'),
            fetchLinkedAndMap(COOKS_COLLECTION, 'cook')
        ]);

        console.log(`[Prod Debug] Fetched all household members for UID: ${currentUser.uid}, Computed Household ID: ${householdId}, Total Members Found: ${members.length}`);

        return members;
    } catch (error) {
        console.error('Error fetching household members:', error);
        return [];
    }
}
