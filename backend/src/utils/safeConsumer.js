/**
 * Map a raw `consumers` DB row to the shape that is safe to send in API
 * responses.
 *
 * A consumer's identity can be backed by an email/password, a linked Google
 * account, or both. We never expose the credentials themselves — instead we
 * derive two booleans the client uses to decide which account controls to show:
 *
 *   - has_password: an email/password login exists (password column is set).
 *                   Google-only consumers are created with password = NULL.
 *   - has_google:   a Google account is linked (google_uid is set).
 *
 * The raw `password` hash and `google_uid` are stripped from the output.
 */
function safeConsumer(c) {
  if (!c) return c;
  const obj = { ...c };
  obj.has_password = !!c.password;
  obj.has_google = !!c.google_uid;
  delete obj.password;
  delete obj.google_uid;
  return obj;
}

module.exports = { safeConsumer };
