/**
 * App build mode — set per Netlify site via the VITE_APP_MODE env var.
 *
 *   "partner"  → partner.sanathanatattva.shop   (admin + trader)
 *   "delivery" → delivery.sanathanatattva.shop  (delivery agents — traders/admins)
 *   "consumer" → sanathanatattva.shop           (public shop, default)
 *
 * Vite inlines import.meta.env.* at build time, so dead branches gated on
 * these constants are tree-shaken out of the bundle.
 */
const RAW = import.meta.env.VITE_APP_MODE;
export const APP_MODE: 'partner' | 'delivery' | 'consumer' =
  RAW === 'partner' ? 'partner' :
  RAW === 'delivery' ? 'delivery' :
  'consumer';

export const IS_PARTNER  = APP_MODE === 'partner';
export const IS_DELIVERY = APP_MODE === 'delivery';
export const IS_CONSUMER = APP_MODE === 'consumer';

// Cross-subdomain links (partner sidebar → delivery, etc.). Override via env
// for staging/preview deploys; defaults match production DNS.
export const DELIVERY_SITE_URL =
  import.meta.env.VITE_DELIVERY_URL || 'https://delivery.sanathanatattva.shop';
export const PARTNER_SITE_URL =
  import.meta.env.VITE_PARTNER_URL || 'https://partner.sanathanatattva.shop';
