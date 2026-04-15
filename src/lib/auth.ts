'use server';

import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, getCountFromServer, doc, getDoc, writeBatch, serverTimestamp, setDoc } from 'firebase/firestore';
import { User, UserRole } from '@/types/meal';
import { cookies } from 'next/headers';
import { generate30DayPlan, MonthlyPlanDay } from './ai';

const USERS_COLLECTION = 'users'; // Owners/Admins
const MEMBERS_COLLECTION = 'members'; // Family members
const COOKS_COLLECTION = 'cooks'; // Cooks
const COOKIE_NAME = 'session_user';

/**
 * Login via Google OAuth (email already verified by Firebase Auth client-side).
 * Looks up the user by email in Firestore without a password check.
 */
export async function loginWithGoogleEmail(email: string, displayName?: string, photoURL?: string): Promise<User | null> {
    try {
        let userDoc = await findUserInCollectionByEmail(USERS_COLLECTION, email);
        let role: UserRole = 'user';

        if (!userDoc) {
            userDoc = await findUserInCollectionByEmail(MEMBERS_COLLECTION, email);
            role = 'member';
        }

        if (!userDoc) {
            userDoc = await findUserInCollectionByEmail(COOKS_COLLECTION, email);
            role = 'cook';
        }

        if (!userDoc) {
            return null; // Email not registered in the system
        }

        const userData = userDoc.data();

        let updated = false;
        const dataToUpdate: any = {};
        if (displayName && userData.displayName !== displayName) { dataToUpdate.displayName = displayName; updated = true; }
        if (photoURL && userData.photoURL !== photoURL) { dataToUpdate.photoURL = photoURL; updated = true; }

        if (updated) {
            const collectionName = role === 'user' ? USERS_COLLECTION : role === 'member' ? MEMBERS_COLLECTION : COOKS_COLLECTION;
            await setDoc(doc(db, collectionName, userDoc.id), dataToUpdate, { merge: true });
        }

        const user: User = {
            uid: userDoc.id,
            email: userData.email,
            displayName: displayName || userData.displayName || undefined,
            photoURL: photoURL || userData.photoURL || undefined,
            role: role,
            phoneNumber: userData.phoneNumber || process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            linkedUserId: userData.linkedUserId,
            householdId: getHouseholdId(role, userDoc.id, userData.linkedUserId),
            houseCode: userData.houseCode,
            housePin: userData.housePin,
        };

        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, JSON.stringify(user), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7, // 1 week
            path: '/',
        });

        return user;
    } catch (error) {
        console.error('Google login error:', error);
        return null;
    }
}

/**
 * Generate a random alphabetic string
 */
function generateRandomCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for ( let i = 0; i < length; i++ ) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Generate a random numeric string
 */
function generateRandomPin(length: number): string {
    const chars = '0123456789';
    let result = '';
    for ( let i = 0; i < length; i++ ) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Create a new household for a new user (via Google Auth)
 * Optionally generates a 30-day meal plan based on the chosen category.
 */
export async function createNewHousehold(email: string, category?: string, displayName?: string, photoURL?: string): Promise<User | null> {
    try {
        const houseCode = generateRandomCode(6);
        const housePin = generateRandomPin(6);

        const newUserData = {
            email,
            displayName: displayName || null,
            photoURL: photoURL || null,
            role: 'user',
            phoneNumber: process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            createdAt: new Date(),
            houseCode,
            housePin,
            dietCategory: category || null,
        };
        const docRef = await addDoc(collection(db, USERS_COLLECTION), newUserData);
        const householdId = docRef.id;

        // If a category was provided, generate 30 days of meals
        if (category) {
            try {
                let plan: MonthlyPlanDay[] = [];
                const categoryDocId = category.toLowerCase().trim();
                const categoryTemplateRef = doc(db, 'category_templates', categoryDocId);
                const categoryTemplateSnap = await getDoc(categoryTemplateRef);
                
                if (categoryTemplateSnap.exists()) {
                    // Use static template data from Firestore
                    plan = categoryTemplateSnap.data().plan as MonthlyPlanDay[];
                } else {
                    // Generate using AI and save statically for future users
                    plan = await generate30DayPlan(category);
                    if (plan && plan.length > 0) {
                        await setDoc(categoryTemplateRef, {
                            category: category,
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
                        
                        const isVegetarian = category.toLowerCase() === 'vegan' || category.toLowerCase() === 'vegetarian';
                        
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

        const user: User = {
            uid: householdId,
            email: newUserData.email,
            displayName: newUserData.displayName || undefined,
            photoURL: newUserData.photoURL || undefined,
            role: 'user',
            phoneNumber: newUserData.phoneNumber,
            householdId: householdId,
            houseCode: newUserData.houseCode,
            housePin: newUserData.housePin,
        };

        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, JSON.stringify(user), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7, // 1 week
            path: '/',
        });

        return user;
    } catch (error) {
        console.error('Create new household error:', error);
        return null;
    }
}

/**
 * Join an existing household as a member (via Google Auth)
 */
export async function joinHousehold(email: string, houseCode: string, housePin: string, displayName?: string, photoURL?: string): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
        // Find the owner with matching houseCode and housePin
        const usersRef = collection(db, USERS_COLLECTION);
        const q = query(usersRef, where('houseCode', '==', houseCode.toUpperCase()), where('housePin', '==', housePin));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            return { success: false, error: 'Invalid House ID or PIN.' };
        }

        const ownerDoc = querySnapshot.docs[0];
        const ownerId = ownerDoc.id;

        // Create the new member
        const newMemberData = {
            email,
            displayName: displayName || null,
            photoURL: photoURL || null,
            role: 'member',
            phoneNumber: process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            createdAt: new Date(),
            linkedUserId: ownerId,
        };

        const docRef = await addDoc(collection(db, MEMBERS_COLLECTION), newMemberData);

        const user: User = {
            uid: docRef.id,
            email: newMemberData.email,
            displayName: newMemberData.displayName || undefined,
            photoURL: newMemberData.photoURL || undefined,
            role: 'member',
            phoneNumber: newMemberData.phoneNumber,
            linkedUserId: ownerId,
            householdId: ownerId,
        };

        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, JSON.stringify(user), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7, // 1 week
            path: '/',
        });

        return { success: true, user };
    } catch (error) {
        console.error('Join household error:', error);
        return { success: false, error: 'An error occurred while joining.' };
    }
}


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
            displayName: userData.displayName || undefined,
            photoURL: userData.photoURL || undefined,
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
 * Login with Phone Number and PIN (Firestore-based) for Cooks
 */
export async function loginWithPhoneAndPin(phoneNumber: string, pin: string): Promise<User | null> {
    try {
        const usersRef = collection(db, COOKS_COLLECTION);
        const q = query(usersRef, where('phoneNumber', '==', phoneNumber), where('pin', '==', pin));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            return null; // Cook not found or invalid PIN
        }

        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data();

        const user: User = {
            uid: userDoc.id,
            email: userData.email || '',
            displayName: userData.displayName || undefined,
            photoURL: userData.photoURL || undefined,
            role: 'cook',
            phoneNumber: userData.phoneNumber,
            linkedUserId: userData.linkedUserId,
            householdId: getHouseholdId('cook', userDoc.id, userData.linkedUserId),
        };

        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, JSON.stringify(user), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7, // 1 week
            path: '/',
        });

        return user;
    } catch (error) {
        console.error('Cook Login error:', error);
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

// Helper to find user by email only (used for OAuth flows)
async function findUserInCollectionByEmail(collectionName: string, email: string) {
    const usersRef = collection(db, collectionName);
    const q = query(usersRef, where('email', '==', email));
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
            displayName: userData.displayName || undefined,
            photoURL: userData.photoURL || undefined,
            role: parsedUser.role,
            phoneNumber: userData.phoneNumber || process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            linkedUserId: userData.linkedUserId,
            householdId: getHouseholdId(parsedUser.role, docSnap.id, userData.linkedUserId),
            houseCode: userData.houseCode,
            housePin: userData.housePin,
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

        // Check if user already exists in ANY collection (email must be unique globally, except for cooks using phone only constraint)
        const existsInUsers = email ? await checkEmailExists(USERS_COLLECTION, email) : false;
        const existsInMembers = email ? await checkEmailExists(MEMBERS_COLLECTION, email) : false;
        const existsInCooks = email ? await checkEmailExists(COOKS_COLLECTION, email) : false;

        if (existsInUsers || existsInMembers || existsInCooks) {
            return { success: false, error: 'User with this email already exists' };
        }

        // For cooks, phone number must be unique
        if (role === 'cook') {
            const q = query(collection(db, COOKS_COLLECTION), where('phoneNumber', '==', phoneNumber));
            const snap = await getDocs(q);
            if (!snap.empty) {
                return { success: false, error: 'Cook with this phone number already exists' };
            }
        }

        // Prepare User Data
        const userData: any = {
            email: email || `${phoneNumber}@cook.local`, // Fallback for cooks without email
            password, // In production, you should hash this!
            role,
            phoneNumber: phoneNumber || process.env.NEXT_PUBLIC_HOUSE_OWNER_PHONE || '',
            createdAt: new Date(),
        };

        if (role === 'cook') {
            userData.pin = password; // Save the password as PIN for cooks
        }

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

/**
 * Get the household team's chosen diet category
 */
export async function getHouseholdDietCategory(householdId: string): Promise<string | null> {
    try {
        const ownerDoc = await getDoc(doc(db, USERS_COLLECTION, householdId));
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
 * Change the household team's diet category
 * Completely replaces all generic menu template days with the new AI plan
 */
export async function changeDietCategory(householdId: string, newCategory: string): Promise<boolean> {
    try {
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
