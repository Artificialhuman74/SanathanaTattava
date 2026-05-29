/**
 * Firebase Admin SDK initialiser.
 *
 * Verifies ID tokens issued by Firebase Authentication (used for Google
 * sign-in on the consumer site). Initialised lazily on first use so the
 * server doesn't crash on boot if the credential file is missing — Google
 * sign-in just won't work until it's set up.
 *
 * Set GOOGLE_APPLICATION_CREDENTIALS to the absolute path of the service
 * account JSON. Do NOT commit that file.
 */

const admin = require('firebase-admin');

let initialised = false;

function ensureInit() {
  if (initialised) return;
  if (admin.apps.length) { initialised = true; return; }

  // applicationDefault() picks up GOOGLE_APPLICATION_CREDENTIALS from env.
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
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
