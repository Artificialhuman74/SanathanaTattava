/**
 * Delivery-area restriction: this platform currently ships within Bengaluru
 * only. Every Bengaluru (BBMP) postal code is a 6-digit PIN starting with
 * "560" — mirrors the authoritative check enforced server-side in
 * backend/src/utils/deliveryArea.js. This copy is for instant UI feedback;
 * the backend is the source of truth and re-validates on every write.
 */
const BENGALURU_PINCODE_RE = /^560\d{3}$/;

export function isBengaluruPincode(pincode: string | null | undefined): boolean {
  return typeof pincode === 'string' && BENGALURU_PINCODE_RE.test(pincode.trim());
}

export const OUTSIDE_DELIVERY_AREA_ERROR =
  'Sorry, we currently deliver only within Bengaluru (PIN codes starting with 560). ' +
  'Please use a Bengaluru delivery address.';
