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

/* On the production domain, the auth helper pages (/__/auth/*) are
 * proxied to Firebase by netlify.toml, so the sign-in window finishes
 * on OUR origin and can hand its result back to the app directly.
 * Using the default *.firebaseapp.com authDomain breaks that hand-off
 * on browsers that partition third-party storage (Safari, newer
 * Chrome): the popup completes Google auth but the app never hears
 * about it, which is why sign-in used to need two attempts.
 * Local dev (localhost / LAN IP) keeps the env-configured default —
 * the Vite server doesn't serve /__/auth. */
const SAME_ORIGIN_AUTH_HOSTS = [
  'sanathanatattva.shop',
  'www.sanathanatattva.shop',
  'partner.sanathanatattva.shop',
  'delivery.sanathanatattva.shop',
];
const authDomain =
  typeof window !== 'undefined' && SAME_ORIGIN_AUTH_HOSTS.includes(window.location.hostname)
    ? window.location.hostname
    : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain,
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

  /* A previous attempt may have completed Google auth without managing
   * to hand the result to the app (blocked popup channel). Firebase
   * keeps that session locally — reuse it instead of making the user
   * run the whole popup dance again. This is what used to require the
   * "second try": now the second try happens automatically, in-place. */
  if (a.currentUser) return a.currentUser.getIdToken();

  const POPUP_HANG_TIMEOUT_MS = 8000;

  const fallbackToRedirect = async (): Promise<null> => {
    sessionStorage.setItem('google_redirect_pending', '1');
    await signInWithRedirect(a, provider);
    return null;
  };

  // `.then(onFulfilled, onRejected)` maps BOTH outcomes onto a resolved
  // value, so this derived promise itself never rejects — safe to race
  // without risking an unhandled rejection on whichever side loses.
  const popupOutcome = signInWithPopup(a, provider).then(
    (res) => ({ status: 'resolved' as const, user: res.user }),
    (err) => ({ status: 'rejected' as const, err }),
  );
  /* Listen for the session appearing locally from the moment the popup
   * opens (not only after a timeout): if the popup finishes sign-in but
   * its message back to us is dropped, the auth-state write is often
   * still synced — whoever fires first wins. currentUser was null above,
   * so any user this reports is fresh from this popup. */
  const authStateOutcome = waitForLocalAuthUser(a, POPUP_HANG_TIMEOUT_MS + 3000).then(
    (user) => (user ? { status: 'authstate' as const, user } : { status: 'timeout' as const }),
  );
  const timeoutOutcome = sleep(POPUP_HANG_TIMEOUT_MS).then(() => ({ status: 'timeout' as const }));

  const outcome = await Promise.race([popupOutcome, authStateOutcome, timeoutOutcome]);

  if (outcome.status === 'resolved' || outcome.status === 'authstate') {
    return outcome.user.getIdToken();
  }

  if (outcome.status === 'timeout') {
    // Popup hasn't resolved, rejected, or synced a session. Give local
    // persistence one last short window before concluding it's stuck.
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
  if (result) return result.user.getIdToken();
  /* getRedirectResult can come back null even after a successful
   * sign-in when the browser partitions the helper's storage — but the
   * session itself often still lands in local persistence. Since we
   * only get here when WE initiated a redirect, give auth state a
   * moment before giving up. */
  const recoveredUser = a.currentUser || (await waitForLocalAuthUser(a, 2500));
  if (recoveredUser) return recoveredUser.getIdToken();
  return null;
}

/**
 * Fresh ID token for whoever is currently signed in with Firebase, or null.
 * Used by the partner signup flow: the person authenticates with Google on
 * the sign-in page, gets routed to signup, then at submit we mint a fresh
 * token from the still-live Firebase session (avoids passing a token that
 * could expire while they fill the form).
 */
export async function getCurrentGoogleIdToken(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const a = ensureFirebase();
  const user = a.currentUser || (await waitForLocalAuthUser(a, 2000));
  return user ? user.getIdToken() : null;
}

export const isFirebaseConfigured = () => !!firebaseConfig.apiKey;
