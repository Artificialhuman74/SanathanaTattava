/**
 * Firebase Admin SDK initialiser.
 *
 * Verifies ID tokens issued by Firebase Authentication (used for Google
 * sign-in on the consumer site). Initialised lazily on first use so the
 * server doesn't crash on boot if the credential isn't configured — Google
 * sign-in just won't work until it is.
 *
 * Credential is read from one of (first match wins):
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON  — JSON content of the service account
 *      (recommended for Railway/Render/Heroku-style hosts where you can't
 *      easily ship a file).
 *   2. GOOGLE_APPLICATION_CREDENTIALS — absolute filesystem path to the JSON.
 */

const admin = require('firebase-admin');

let initialised = false;

function ensureInit() {
  if (initialised) return;
  if (admin.apps.length) { initialised = true; return; }

  const jsonInline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonInline && jsonInline.trim().startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(jsonInline);
    } catch (err) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err.message}`);
    }
    admin.initializeApp({ credential: admin.credential.cert(parsed) });
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS (file path)
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  initialised = true;
}

/**
 * Verify a Firebase ID token and return the decoded claims.
 * Throws if the token is invalid/expired or Firebase Admin isn't configured.
 *
 * @param {string} idToken
 * @returns {Promise<import('firebase-admin').auth.DecodedIdToken>}
 */
async function verifyIdToken(idToken) {
  ensureInit();
  return admin.auth().verifyIdToken(idToken);
}

module.exports = { verifyIdToken };
