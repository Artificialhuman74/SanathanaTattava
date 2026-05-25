/**
 * Resolve the public site URL used in user-facing email links, invoice
 * notes, etc. FRONTEND_URL is sometimes set to a comma-separated CORS
 * list, which is not a valid base URL — so prefer a dedicated PUBLIC_SITE_URL
 * env var, then fall back to the first entry of FRONTEND_URL, then to prod.
 */
function getPublicSiteUrl() {
  const clean = u => u.trim().replace(/\/+$/, '');
  if (process.env.PUBLIC_SITE_URL) return clean(process.env.PUBLIC_SITE_URL);
  if (process.env.FRONTEND_URL) {
    const first = process.env.FRONTEND_URL.split(',')[0];
    if (first && first.trim()) return clean(first);
  }
  return 'https://sanathanatattva.shop';
}

module.exports = { getPublicSiteUrl };
