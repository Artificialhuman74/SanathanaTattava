/**
 * Delivery-area restriction: this platform currently ships within
 * Bengaluru only. Every Bengaluru (BBMP) postal code is a 6-digit
 * PIN starting with "560" (560001–560XXX) — that prefix is the
 * authoritative, deterministic check (unlike geocoding, which can
 * fail or be spoofed by client-supplied lat/lng).
 */
const BENGALURU_PINCODE_RE = /^560\d{3}$/;

function isBengaluruPincode(pincode) {
  return typeof pincode === 'string' && BENGALURU_PINCODE_RE.test(pincode.trim());
}

const OUTSIDE_DELIVERY_AREA_ERROR =
  'Sorry, we currently deliver only within Bengaluru (PIN codes starting with 560). ' +
  'Please use a Bengaluru delivery address.';

module.exports = { isBengaluruPincode, OUTSIDE_DELIVERY_AREA_ERROR };
