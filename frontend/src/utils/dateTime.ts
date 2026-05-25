/**
 * SQLite stores CURRENT_TIMESTAMP as a UTC string without a tz marker
 * (e.g. "2026-05-24 09:00:00"). JS `new Date(...)` parses that as LOCAL
 * time, so a value emitted by the backend at 14:30 IST (=09:00 UTC) looks
 * 5h 30m old in the browser. Always route DB timestamps through here.
 */
export function parseDbDate(raw: string | number | Date): Date {
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number') return new Date(raw);
  const s = String(raw).trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s); // already has tz
  return new Date(s.replace(' ', 'T') + 'Z');
}

const IST_FMT_OPTS: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata' };

/** "24 May 2026, 3:42 pm" — always in IST regardless of viewer's locale. */
export function formatIst(raw: string | number | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return parseDbDate(raw).toLocaleString('en-IN', {
    ...IST_FMT_OPTS,
    day:    'numeric',
    month:  'short',
    year:   'numeric',
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
    ...opts,
  });
}

/** "24 May 2026" — date only, IST. */
export function formatIstDate(raw: string | number | Date): string {
  return parseDbDate(raw).toLocaleDateString('en-IN', {
    ...IST_FMT_OPTS,
    day:   'numeric',
    month: 'short',
    year:  'numeric',
  });
}

/** Relative "Just now / 5m ago / 2h ago / 3d ago". */
export function timeAgo(raw: string | number | Date): string {
  const diff = Date.now() - parseDbDate(raw).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
