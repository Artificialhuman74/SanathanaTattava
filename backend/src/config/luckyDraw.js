/**
 * Single source of truth for the lucky-draw feature's public-facing name.
 * "Bhagya Chakra" is a placeholder pending brand/trademark sign-off —
 * change this one line and every notification/email that mentions the
 * feature by name updates with it. Internal identifiers (routes, table
 * names, DB values) deliberately do NOT use this name — see
 * LUCKY_DRAW_FEATURE_SPEC.md §10 — so renaming never touches a URL,
 * a stored value, or a foreign key.
 */
const LUCKY_DRAW_NAME = 'Bhagya Chakra';

module.exports = { LUCKY_DRAW_NAME };
