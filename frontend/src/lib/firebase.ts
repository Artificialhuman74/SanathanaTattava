/**
 * Firebase client init for consumer Google sign-in.
 *
 * Config values come from VITE_FIREBASE_* env vars (set in Netlify and
 * .env.local for dev). The apiKey is public — safe to ship in the bundle.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

function ensureFirebase(): Auth {
  if (!firebaseConfig.apiKey) {
    throw new Error('Firebase not configured (missing VITE_FIREBASE_API_KEY)');
  }
  if (!app) app = getApps()[0] || initializeApp(firebaseConfig);
  if (!auth) auth = getAuth(app);
  return auth;
}

/**
 * Pop up Google sign-in, return the Firebase ID token on success.
 * Caller posts this token to POST /api/auth/consumer/google.
 */
export async function signInWithGoogleAndGetIdToken(): Promise<string> {
  const a = ensureFirebase();
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(a, provider);
  return result.user.getIdToken();
}

export const isFirebaseConfigured = () => !!firebaseConfig.apiKey;
