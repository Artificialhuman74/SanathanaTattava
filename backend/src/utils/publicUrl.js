/**
 * Resolve public site URLs used in user-facing email links, invoice notes, etc.
 *
 * The app ships as two Netlify sites:
 *   - consumer:  sanathanatattva.shop          (shop + landing)
 *   - partner:   partner.sanathanatattva.shop  (admin + trader + delivery)
 *
 * Each has its own env var so emails route to the correct front-end.
 * PUBLIC_SITE_URL / PARTNER_SITE_URL win; FRONTEND_URL is sometimes a CSV
 * (for CORS), so we only use its first entry as a fallback for the consumer URL.
 */
const clean = u => u.trim().replace(/\/+$/, '');

function getConsumerSiteUrl() {
  if (process.env.PUBLIC_SITE_URL) return clean(process.env.PUBLIC_SITE_URL);
  if (process.env.FRONTEND_URL) {
    const first = process.env.FRONTEND_URL.split(',')[0];
    if (first && first.trim()) return clean(first);
  }
  return 'https://sanathanatattva.shop';
}

function getPartnerSiteUrl() {
  if (process.env.PARTNER_SITE_URL) return clean(process.env.PARTNER_SITE_URL);
  return 'https://partner.sanathanatattva.shop';
}

// Legacy alias — kept so existing imports keep working. Points at the consumer
// site (which is what every current caller of getPublicSiteUrl expects).
const getPublicSiteUrl = getConsumerSiteUrl;

module.exports = { getPublicSiteUrl, getConsumerSiteUrl, getPartnerSiteUrl };
