import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { app } from './firebaseApp';

// Firebase Auth is only needed for Google sign-in (login page) and sign-out.
// Keep it out of ./firebase so pages that only read Firestore don't bundle it.
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Local testing only: sign in against the Firebase Auth emulator
// (the server accepts its tokens only when FIREBASE_AUTH_EMULATOR_HOST is set
// and NODE_ENV isn't production).
const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost && process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
}

export { auth, googleProvider };
