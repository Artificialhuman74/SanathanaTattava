/**
 * Firebase client init for consumer Google sign-in.
 *
 * Config values come from VITE_FIREBASE_* env vars (set in Netlify and
 * .env.local for dev). The apiKey is public — safe to ship in the bundle.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  type Auth,
} from 'firebase/auth';

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
 * Try popup first (better UX on desktop). If the browser blocks the popup,
 * fall back to a full-page redirect — the caller should then handle the
 * redirect result on page load via `consumeGoogleRedirectResult()`.
 *
 * Returns the Firebase ID token if popup succeeded, or null if a redirect
 * was kicked off (caller should not navigate; the browser will).
 */
export async function signInWithGoogleAndGetIdToken(): Promise<string | null> {
  const a = ensureFirebase();
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(a, provider);
    return result.user.getIdToken();
  } catch (err: any) {
    const code = err?.code || '';
    const popupBlocked =
      code === 'auth/popup-blocked' ||
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/operation-not-supported-in-this-environment';
    if (!popupBlocked) throw err;
    // Mark that we kicked off a redirect so Login can consume the result.
    sessionStorage.setItem('google_redirect_pending', '1');
    await signInWithRedirect(a, provider);
    return null;
  }
}

/**
 * Call on Login page mount. If we previously kicked off a redirect, this
 * resolves with the Firebase ID token; otherwise returns null.
 */
export async function consumeGoogleRedirectResult(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  if (!sessionStorage.getItem('google_redirect_pending')) return null;
  sessionStorage.removeItem('google_redirect_pending');
  const a = ensureFirebase();
  const result = await getRedirectResult(a);
  if (!result) return null;
  return result.user.getIdToken();
}

export const isFirebaseConfigured = () => !!firebaseConfig.apiKey;
