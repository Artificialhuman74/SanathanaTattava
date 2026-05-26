/**
 * App build mode — set per Netlify site via the VITE_APP_MODE env var.
 *
 *   "partner"  → partner.sanathanatattva.shop  (admin + trader + delivery)
 *   "consumer" → sanathanatattva.shop          (public shop, default)
 *
 * Vite inlines import.meta.env.* at build time, so dead branches gated on
 * these constants are tree-shaken out of the bundle.
 */
export const APP_MODE: 'partner' | 'consumer' =
  import.meta.env.VITE_APP_MODE === 'partner' ? 'partner' : 'consumer';

export const IS_PARTNER  = APP_MODE === 'partner';
export const IS_CONSUMER = APP_MODE === 'consumer';
