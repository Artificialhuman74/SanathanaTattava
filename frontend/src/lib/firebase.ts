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
  onAuthStateChanged,
  type Auth,
  type User,
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Resolves once Firebase's local auth state reports a signed-in user, or
 *  after `timeoutMs` — whichever comes first. Used to detect a popup that
 *  actually finished signing in even though its promise never told us. */
function waitForLocalAuthUser(a: Auth, timeoutMs: number) {
  return new Promise<User | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = onAuthStateChanged(a, (user) => {
      if (settled || !user) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(user);
    });
  });
}

/**
 * Try popup first (better UX on desktop). If the browser blocks the popup,
 * fall back to a full-page redirect — the caller should then handle the
 * redirect result on page load via `consumeGoogleRedirectResult()`.
 *
 * Some browsers apply a default Cross-Origin-Opener-Policy that blocks the
 * popup from messaging back to this page once Google auth completes. When
 * that happens the popup finishes successfully (and Firebase persists the
 * resulting session locally) but `signInWithPopup()`'s own promise just
 * hangs forever — the first click silently does nothing, and only a second
 * click (which picks up the already-signed-in state) appears to work. We
 * guard against this by racing the popup against a timeout: if it hangs,
 * we check whether Firebase's local auth state actually completed anyway
 * before giving up and falling back to a redirect.
 *
 * Returns the Firebase ID token if sign-in succeeded, or null if a
 * redirect was kicked off (caller should not navigate; the browser will).
 */
export async function signInWithGoogleAndGetIdToken(): Promise<string | null> {
  const a = ensureFirebase();
  const provider = new GoogleAuthProvider();

  const POPUP_HANG_TIMEOUT_MS = 12000;

  const fallbackToRedirect = async (): Promise<null> => {
    sessionStorage.setItem('google_redirect_pending', '1');
    await signInWithRedirect(a, provider);
    return null;
  };

  // `.then(onFulfilled, onRejected)` maps BOTH outcomes onto a resolved
  // value, so this derived promise itself never rejects — safe to race
  // against a timeout without risking an unhandled rejection on whichever
  // side loses.
  const popupOutcome = signInWithPopup(a, provider).then(
    (res) => ({ status: 'resolved' as const, user: res.user }),
    (err) => ({ status: 'rejected' as const, err }),
  );
  const timeoutOutcome = sleep(POPUP_HANG_TIMEOUT_MS).then(() => ({ status: 'timeout' as const }));

  const outcome = await Promise.race([popupOutcome, timeoutOutcome]);

  if (outcome.status === 'resolved') return outcome.user.getIdToken();

  if (outcome.status === 'timeout') {
    // Popup call hasn't resolved or rejected yet. Some browsers' default
    // Cross-Origin-Opener-Policy blocks the popup from messaging back to
    // us even after it finishes Google auth successfully — Firebase still
    // persists the resulting session locally, it just can't tell this
    // promise about it. Give local persistence a moment to catch up
    // before concluding it's truly stuck.
    const recoveredUser = await waitForLocalAuthUser(a, 3000);
    if (recoveredUser) return recoveredUser.getIdToken();
    return fallbackToRedirect();
  }

  // status === 'rejected'
  const code = outcome.err?.code || '';
  const popupBlocked =
    code === 'auth/popup-blocked' ||
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/operation-not-supported-in-this-environment';
  if (!popupBlocked) throw outcome.err;
  return fallbackToRedirect();
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
