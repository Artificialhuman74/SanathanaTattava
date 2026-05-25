/**
 * Derive Indian state from pincode prefix.
 *
 * Pincode-to-state mapping is stable on the first 2 digits per India Post's
 * postal-circle layout. Returns a canonical state name, or null if unknown.
 * Used to decide intra-state (CGST+SGST) vs inter-state (IGST) on invoices.
 */

const PIN2_TO_STATE = {
  // Delhi / Haryana / Punjab / HP / J&K / Chandigarh / Ladakh
  11: 'Delhi', 12: 'Haryana', 13: 'Haryana', 14: 'Punjab', 15: 'Punjab',
  16: 'Punjab', 17: 'Himachal Pradesh', 18: 'Jammu and Kashmir', 19: 'Jammu and Kashmir',
  // UP / Uttarakhand
  20: 'Uttar Pradesh', 21: 'Uttar Pradesh', 22: 'Uttar Pradesh',
  23: 'Uttar Pradesh', 24: 'Uttar Pradesh', 25: 'Uttar Pradesh',
  26: 'Uttar Pradesh', 27: 'Uttar Pradesh', 28: 'Uttar Pradesh',
  // Rajasthan
  30: 'Rajasthan', 31: 'Rajasthan', 32: 'Rajasthan', 33: 'Rajasthan',
  34: 'Rajasthan',
  // Gujarat / DD / DN
  36: 'Gujarat', 37: 'Gujarat', 38: 'Gujarat', 39: 'Gujarat',
  // Maharashtra
  40: 'Maharashtra', 41: 'Maharashtra', 42: 'Maharashtra', 43: 'Maharashtra',
  44: 'Maharashtra',
  // MP / Chhattisgarh
  45: 'Madhya Pradesh', 46: 'Madhya Pradesh', 47: 'Madhya Pradesh',
  48: 'Madhya Pradesh', 49: 'Chhattisgarh',
  // AP / Telangana
  50: 'Telangana', 51: 'Andhra Pradesh', 52: 'Andhra Pradesh', 53: 'Andhra Pradesh',
  // Karnataka
  56: 'Karnataka', 57: 'Karnataka', 58: 'Karnataka', 59: 'Karnataka',
  // Tamil Nadu / Puducherry
  60: 'Tamil Nadu', 61: 'Tamil Nadu', 62: 'Tamil Nadu', 63: 'Tamil Nadu',
  64: 'Tamil Nadu',
  // Kerala / Lakshadweep
  67: 'Kerala', 68: 'Kerala', 69: 'Kerala',
  // WB / Odisha / Sikkim / NE
  70: 'West Bengal', 71: 'West Bengal', 72: 'West Bengal', 73: 'West Bengal',
  74: 'West Bengal', 75: 'Odisha', 76: 'Odisha', 77: 'Odisha',
  78: 'Assam', 79: 'Arunachal Pradesh',
  // Bihar / Jharkhand
  80: 'Bihar', 81: 'Bihar', 82: 'Bihar', 83: 'Bihar', 84: 'Jharkhand',
  85: 'Jharkhand',
};

function stateFromPincode(pincode) {
  if (!pincode) return null;
  const digits = String(pincode).replace(/\D/g, '');
  if (digits.length !== 6) return null;
  const prefix = parseInt(digits.slice(0, 2), 10);
  return PIN2_TO_STATE[prefix] || null;
}

module.exports = { stateFromPincode };
