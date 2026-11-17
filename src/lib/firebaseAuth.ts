import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { app } from './firebaseApp';

// Firebase Auth is only needed for Google sign-in (login page) and sign-out.
// Keep it out of ./firebase so pages that only read Firestore don't bundle it.
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { auth, googleProvider };
