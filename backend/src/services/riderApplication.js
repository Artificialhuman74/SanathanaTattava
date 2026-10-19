/**
 * Rider application rules shared by signup, resubmission and admin review.
 * The ST Partner app collects these in 8 steps (handoff §4.3); messages are
 * short and plain because riders read them on a phone, often in a second language.
 */

const VEHICLES   = ['walk', 'cycle', 'scooter', 'bike'];
const MOTORISED  = new Set(['scooter', 'bike']);
const BASE_LABELS = ['home', 'shop', 'other'];
const RELATIONS  = ['mother', 'father', 'wife', 'husband', 'brother', 'sister', 'friend', 'other'];

/* What an admin can flag; the app maps each to the step that fixes it. */
const REVIEW_ITEMS = ['selfie', 'licence_front', 'licence_back', 'pan', 'bank', 'vehicle', 'emergency', 'base'];

const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_RE   = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC_RE  = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const digits = (v) => str(v).replace(/\D/g, '');
/* "+91 98765 43210" and "098765 43210" both mean 9876543210. */
const indianMobile = (v) => {
  const d = digits(v);
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
};

/**
 * Validates submitted fields + photos.
 *   mode 'new'    → everything required (password only when withPassword)
 *   mode 'update' → only what was sent is checked; caller merges with the stored row
 * Returns { values, errors } where errors is null or { field: message }.
 */
function validateApplication(body = {}, files = {}, { mode = 'new', withPassword = false } = {}) {
  const errors = {};
  const values = {};
  const sent = (key) => mode === 'new' || (body[key] !== undefined && body[key] !== '');
  const has = (field) => Array.isArray(files[field]) && files[field].length > 0;

  if (sent('name')) {
    values.name = str(body.name).replace(/\s+/g, ' ');
    if (values.name.length < 2) errors.name = 'Enter your full name';
  }
  if (sent('phone')) {
    values.phone = indianMobile(body.phone);
    if (!PHONE_RE.test(values.phone)) errors.phone = 'Enter a 10-digit mobile number';
  }
  if (mode === 'new' && withPassword) {
    values.email = str(body.email).toLowerCase();
    if (!EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address';
    values.password = body.password === undefined ? '' : String(body.password);
    if (values.password.length < 8) errors.password = 'Use at least 8 letters or numbers';
  }

  if (sent('base_address') || sent('base_lat') || sent('base_lng')) {
    values.base_label = BASE_LABELS.includes(str(body.base_label).toLowerCase()) ? str(body.base_label).toLowerCase() : 'home';
    values.base_address = str(body.base_address);
    values.base_lat = Number(body.base_lat);
    values.base_lng = Number(body.base_lng);
    if (!values.base_address) errors.base_address = 'Add the address of your start place';
    if (!Number.isFinite(values.base_lat) || Math.abs(values.base_lat) > 90 ||
        !Number.isFinite(values.base_lng) || Math.abs(values.base_lng) > 180) {
      errors.base_lat = 'Set the pin on the map';
    }
  }

  if (sent('vehicle_type')) {
    values.vehicle_type = str(body.vehicle_type).toLowerCase();
    if (!VEHICLES.includes(values.vehicle_type)) errors.vehicle_type = 'Pick how you will deliver';
  }
  if (sent('vehicle_plate') && body.vehicle_plate !== undefined) {
    values.vehicle_plate = str(body.vehicle_plate).toUpperCase().replace(/\s+/g, ' ');
  }
  if (sent('licence_number') && body.licence_number !== undefined) {
    values.licence_number = str(body.licence_number).toUpperCase().replace(/\s+/g, ' ');
  }

  if (sent('pan')) {
    values.pan = str(body.pan).toUpperCase().replace(/\s+/g, '');
    if (!PAN_RE.test(values.pan)) errors.pan = 'PAN looks like ABCDE1234F';
  }
  if (sent('bank_account_name')) {
    values.bank_account_name = str(body.bank_account_name).replace(/\s+/g, ' ');
    if (values.bank_account_name.length < 2) errors.bank_account_name = 'Enter the name on your bank account';
  }
  if (sent('bank_account_number')) {
    values.bank_account_number = digits(body.bank_account_number);
    if (!ACCOUNT_RE.test(values.bank_account_number)) errors.bank_account_number = 'Account number is 9 to 18 digits';
  }
  if (sent('bank_ifsc')) {
    values.bank_ifsc = str(body.bank_ifsc).toUpperCase().replace(/\s+/g, '');
    if (!IFSC_RE.test(values.bank_ifsc)) errors.bank_ifsc = 'IFSC looks like HDFC0001234';
  }

  if (sent('emergency_name')) {
    values.emergency_name = str(body.emergency_name).replace(/\s+/g, ' ');
    if (values.emergency_name.length < 2) errors.emergency_name = 'Enter their name';
  }
  if (sent('emergency_relation')) {
    values.emergency_relation = str(body.emergency_relation).toLowerCase();
    if (!RELATIONS.includes(values.emergency_relation)) errors.emergency_relation = 'Pick how they are related to you';
  }
  if (sent('emergency_phone')) {
    values.emergency_phone = indianMobile(body.emergency_phone);
    if (!PHONE_RE.test(values.emergency_phone)) errors.emergency_phone = 'Enter their 10-digit mobile number';
  }

  if (mode === 'new') {
    if (!has('selfie')) errors.selfie = 'Take a selfie';
    if (!has('pan_photo')) errors.pan_photo = 'Take a photo of your PAN card';
  }

  return { values, errors: Object.keys(errors).length ? errors : null };
}

/**
 * Cross-field rules on the final record (after an update is merged in):
 * motorised vehicles need a plate, licence number and both licence photos,
 * and the emergency contact can't be the rider's own number.
 */
function completenessErrors(record) {
  const errors = {};
  if (MOTORISED.has(record.vehicle_type)) {
    if (!record.vehicle_plate || record.vehicle_plate.replace(/\s/g, '').length < 6) errors.vehicle_plate = 'Enter your number plate';
    if (!record.licence_number || record.licence_number.replace(/\s/g, '').length < 8) errors.licence_number = 'Enter your licence number';
    if (!record.kyc_licence_front) errors.licence_front = 'Take a photo of the front of your licence';
    if (!record.kyc_licence_back) errors.licence_back = 'Take a photo of the back of your licence';
  }
  if (record.phone && record.emergency_phone && record.phone === record.emergency_phone) {
    errors.emergency_phone = 'Use someone else’s number, not your own';
  }
  return Object.keys(errors).length ? errors : null;
}

/** Validates an admin's "send back" list. Returns { issues } or { error }. */
function parseReviewIssues(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Flag at least one item with a reason' };
  const seen = new Set();
  const issues = [];
  for (const entry of raw) {
    const item = str(entry && entry.item);
    const reason = str(entry && entry.reason);
    if (!REVIEW_ITEMS.includes(item)) return { error: `Unknown item: ${item || '(blank)'}` };
    if (!reason) return { error: `Add a reason for ${item}` };
    if (reason.length > 200) return { error: `Keep the reason for ${item} under 200 characters` };
    if (seen.has(item)) continue;
    seen.add(item);
    issues.push({ item, reason });
  }
  return { issues };
}

module.exports = {
  VEHICLES, MOTORISED, BASE_LABELS, RELATIONS, REVIEW_ITEMS,
  validateApplication, completenessErrors, parseReviewIssues, indianMobile,
};
