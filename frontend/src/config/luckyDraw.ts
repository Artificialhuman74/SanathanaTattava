/**
 * Single source of truth for the lucky-draw feature's public-facing name.
 * "Bhagya Chakra" is a placeholder pending brand/trademark sign-off —
 * change this one line and every screen that names the feature updates
 * with it. Internal identifiers (the /shop/lucky-draw route, component
 * folder names, API paths) deliberately do NOT use this name — see
 * LUCKY_DRAW_FEATURE_SPEC.md §10 — so renaming never breaks a link,
 * a bookmark, or a notification someone already received.
 */
export const LUCKY_DRAW_NAME = 'Bhagya Chakra';

/** One-line description used in nav items, cards, and meta copy. */
export const LUCKY_DRAW_TAGLINE = "Sanathana Tattva's monthly lucky draw";

/**
 * localStorage key marking that this browser has watched the reveal for one
 * month's draw. Everyone enrolled watches it, winner or not, and it plays
 * once: every visit after that gets the calm state instead.
 *
 * Keyed on the scheme and the month rather than the enrollment, because a
 * round holds twelve draws and each one is its own moment.
 *
 * Shared rather than local to a page because three places depend on it: the
 * page that plays the reveal, the shop card that holds everything back until
 * it has been watched, and the Test Console, which clears it to replay.
 */
export const drawSeenKey = (schemeId: number, monthKey: string) =>
  `bhagya_chakra_draw_seen_${schemeId}_${monthKey}`;

/** Set once the post-reveal "here's who won, order by the 10th" card has been
 *  dismissed. Separate from the reveal itself: watching is not dismissing. */
export const drawInfoSeenKey = (schemeId: number, monthKey: string) =>
  `bhagya_chakra_draw_info_${schemeId}_${monthKey}`;

/** @deprecated Kept so an older enrollment-keyed flag still reads. */
export const winSeenKey = (enrollmentId: number) => `bhagya_chakra_win_seen_${enrollmentId}`;

/** Marks that this browser has already acknowledged the moment this consumer
 *  became eligible for a given month's draw. The sweep plays once. */
export const enteredSeenKey = (schemeId: number, monthKey: string) =>
  `bhagya_chakra_entered_${schemeId}_${monthKey}`;

/**
 * The three kinds of free order the lucky draw produces, recognised from the
 * order number's prefix.
 *
 * The prefix is the only marker these orders carry: they are ordinary
 * consumer_orders rows priced at zero, which is deliberate (spec §10 keeps
 * the feature liftable), but it means anything that wants to show them as
 * lucky-draw orders has to read the number.
 */
export type LuckyDrawOrderKind = 'welcome_gift' | 'reward' | 'guarantee';

const ORDER_PREFIXES: Array<[string, LuckyDrawOrderKind]> = [
  ['BCGIFT-', 'welcome_gift'],
  ['BCFREE-', 'reward'],
  ['BCGUAR-', 'guarantee'],
];

export function luckyDrawOrderKind(orderNumber?: string | null): LuckyDrawOrderKind | null {
  const n = String(orderNumber || '');
  for (const [prefix, kind] of ORDER_PREFIXES) if (n.startsWith(prefix)) return kind;
  return null;
}

/** What to call each on screen. Short: these sit inside an order row. */
export const LUCKY_DRAW_ORDER_LABEL: Record<LuckyDrawOrderKind, string> = {
  welcome_gift: `${LUCKY_DRAW_NAME} welcome gift`,
  reward: `${LUCKY_DRAW_NAME} reward`,
  guarantee: `${LUCKY_DRAW_NAME} guarantee`,
};

/** One line saying why nothing is being collected for it. */
export const LUCKY_DRAW_ORDER_NOTE: Record<LuckyDrawOrderKind, string> = {
  welcome_gift: 'Free with their enrollment. Collect nothing.',
  reward: 'They won this round. Free every month. Collect nothing.',
  guarantee: 'Their round ended without a win, so this one is free. Collect nothing.',
};

/** "12th", "3rd", "21st" — the draw day, said the way a person says it. */
export function ordinalDay(day: number): string {
  const n = Math.trunc(day);
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/** "17:00" reads as a timetable. "5pm" reads as a time of day. */
export function clockLabel(hhmm: string): string {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}.${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

/** How many qualified months buy one more entry, and the ceiling (spec §3.17). */
export const TICKETS_PER_MONTHS = 3;
export const MAX_TICKETS = 4;
