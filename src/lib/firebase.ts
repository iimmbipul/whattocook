import { getFirestore } from 'firebase/firestore';
import { app } from './firebaseApp';

// Firestore only. Firebase Auth is in ./firebaseAuth — importing it here would
// pull the Auth SDK into every bundle (and server action) that needs `db`.
const db = getFirestore(app);

export { app, db };
