import React, { useMemo, useRef, useState } from 'react';
import { Phone, MapPin, Mail, Users, Trophy, X } from 'lucide-react';
import ChakraIcon from './ChakraIcon';
import { LUCKY_DRAW_NAME } from '../../config/luckyDraw';

export interface TreeEnrollment {
  id: number;
  status: 'active' | 'won' | 'completed';
  standing: 'winning' | 'entered' | 'not_entered' | 'completed';
  entered_this_month: boolean;
  qualified_months: number;
  total_months: number;
  consumer_id: number;
  consumer_name: string;
  consumer_phone: string | null;
  consumer_email: string | null;
  consumer_address: string | null;
  consumer_pincode: string | null;
  scheme_name: string;
  welcome_gift_name: string | null;
  dealer_id: number | null;
  dealer_name: string | null;
  dealer_phone?: string | null;
}

/* Eligible or not, in one colour. Green reads as "in this month's draw", red
 * as "hasn't ordered yet"; a winner is neither, so it gets the brand gold. */
const DOT = {
  entered: '#1a6b2e',
  not_entered: '#b91c1c',
  winning: '#c8963c',
  completed: '#94a3b8',
} as const;

const STANDING_LABEL = {
  entered: 'In this month’s draw',
  not_entered: 'Not entered this month',
  winning: 'Winning: receiving free deliveries',
  completed: 'Round finished',
} as const;

/**
 * What a trader's node says under their name. Same rule as the header: the
 * fraction is over the people still able to enter, and when none of them are,
 * it says what is actually happening instead of showing 0/0.
 */
function traderLine(people: TreeEnrollment[]) {
  const pool = people.filter(p => p.standing === 'entered' || p.standing === 'not_entered');
  const entered = pool.filter(p => p.standing === 'entered').length;
  const winning = people.filter(p => p.standing === 'winning').length;
  if (pool.length > 0) {
    return winning > 0
      ? `${entered}/${pool.length} entered \u00b7 ${winning} winning`
      : `${entered}/${pool.length} entered`;
  }
  if (winning > 0) return winning === 1 ? 'Winning this round' : `${winning} winning this round`;
  return 'Round finished';
}

/** First name only on the node; the full name is in the detail. */
const firstName = (n: string) => (n || '').trim().split(/\s+/)[0] || n;

/**
 * The lucky draw as a tree: the business at the root, traders as siblings
 * beneath it, and each trader's consumers hanging off them coloured by
 * whether they are in this month's draw.
 *
 * A flat table answered "who is enrolled" but not the question an admin
 * actually has, which is "whose people are ordering". The shape does that
 * work: a trader whose column is mostly red is a trader whose consumers have
 * not bought this month, and that is visible before a single number is read.
 *
 * Connectors are drawn in SVG behind the nodes rather than with borders, so
 * the row can scroll horizontally when there are more traders than fit and
 * the lines keep meeting their nodes.
 */
export default function EligibilityTree({
  rows,
  /** Overrides the root node's second line. The admin's default count of
   *  traders is meaningless on a trader's own page, where there is only ever
   *  one branch and it is theirs. */
  rootSubtitle,
  /** The heading over the tree, and the line under it. */
  title = 'Who is in this month\u2019s draw',
  hint = 'Green is in this month\u2019s draw, red has not ordered yet. Click a name for their details.',
}: {
  rows: TreeEnrollment[];
  rootSubtitle?: string;
  title?: string;
  hint?: string;
}) {
  const [selected, setSelected] = useState<TreeEnrollment | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* Group by trader. Consumers with no linked dealer are a real group, not an
   * error, so they get their own node rather than being dropped. */
  const traders = useMemo(() => {
    const by = new Map<string, { id: number | null; name: string; phone?: string | null; people: TreeEnrollment[] }>();
    for (const r of rows) {
      const key = r.dealer_id == null ? 'unassigned' : String(r.dealer_id);
      if (!by.has(key)) {
        by.set(key, { id: r.dealer_id, name: r.dealer_name || 'Unassigned', phone: r.dealer_phone, people: [] });
      }
      by.get(key)!.people.push(r);
    }
    return [...by.values()].sort((a, b) => {
      if ((a.id == null) !== (b.id == null)) return a.id == null ? 1 : -1;  // unassigned last
      return a.name.localeCompare(b.name);
    });
  }, [rows]);

  /* "x of y entered" counts only the people who CAN enter. A winner is out of
   * the pool for the rest of the round and a finished member is out for good,
   * so counting them in the denominator reads as a shortfall that nobody can
   * do anything about: one winner and nobody else showed "0 of 1 entered",
   * which is not a miss, it is an empty pool. */
  const totals = useMemo(() => ({
    people: rows.length,
    pool: rows.filter(r => r.standing === 'entered' || r.standing === 'not_entered').length,
    entered: rows.filter(r => r.standing === 'entered').length,
    winning: rows.filter(r => r.standing === 'winning').length,
  }), [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-1">
        <h3 className="font-bold text-slate-900 text-sm">{title}</h3>
        <p className="text-xs text-slate-500">
          {totals.pool > 0 && <>{totals.entered} of {totals.pool} entered</>}
          {totals.pool > 0 && totals.winning > 0 && <> · </>}
          {totals.winning > 0 && <>{totals.winning} winning</>}
          {totals.pool === 0 && totals.winning === 0 && <>Round finished</>}
        </p>
      </div>
      <p className="text-xs text-slate-400 mb-6">{hint}</p>

      {/* The tree scrolls sideways when there are more traders than fit; the
          connectors scroll with it because they share the same canvas. */}
      <div ref={scrollRef} className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="inline-flex flex-col items-center min-w-full">

          {/* Root */}
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border"
            style={{ borderColor: '#e8c164', backgroundColor: '#fdf8ee' }}
          >
            <ChakraIcon size={18} />
            <span className="text-sm font-bold" style={{ color: '#3a2208' }}>{LUCKY_DRAW_NAME}</span>
            <span className="text-xs" style={{ color: '#885c24' }}>
              {rootSubtitle ?? `${traders.length} ${traders.length === 1 ? 'trader' : 'traders'}`}
            </span>
          </div>

          {/* Trunk down to the branch bar */}
          <div className="w-px h-5" style={{ backgroundColor: '#e0d0b8' }} aria-hidden="true" />

          <div className="flex items-stretch">
            {traders.map((t, i) => (
              <div key={t.id ?? 'unassigned'} className="flex flex-col items-center px-3" style={{ minWidth: 190 }}>
                {/* Branch: half-width bars so the joins land under the root and
                    over each trader, and the ends stay open on the outside. */}
                <div className="flex w-full h-5" aria-hidden="true">
                  <div className="flex-1" style={{ borderTop: i === 0 ? 'none' : '1px solid #e0d0b8' }} />
                  <div className="flex-1" style={{ borderTop: i === traders.length - 1 ? 'none' : '1px solid #e0d0b8' }} />
                </div>
                <div className="w-px h-4 -mt-px" style={{ backgroundColor: '#e0d0b8' }} aria-hidden="true" />

                {/* Trader node */}
                <div
                  className="w-full rounded-xl border px-3 py-2 text-center"
                  style={{ borderColor: '#e8dcc8', backgroundColor: '#fffbf2' }}
                >
                  <p className="text-sm font-semibold text-slate-900 truncate" title={t.name}>{t.name}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{traderLine(t.people)}</p>
                </div>

                {/* Consumers, one per line, hanging off the trader. */}
                <ul className="w-full mt-2 space-y-1">
                  {t.people.map(p => {
                    const colour = DOT[p.standing as keyof typeof DOT] ?? DOT.completed;
                    const isOn = hovered === p.id || selected?.id === p.id;
                    return (
                      <li key={p.id} className="flex">
                        {/* The stub connecting this consumer to their trader. */}
                        <span
                          aria-hidden="true"
                          className="flex-shrink-0 w-3 self-stretch"
                          style={{ borderLeft: '1px solid #e8dcc8' }}
                        />
                        <button
                          onClick={() => setSelected(p)}
                          onMouseEnter={() => setHovered(p.id)}
                          onMouseLeave={() => setHovered(h => (h === p.id ? null : h))}
                          onFocus={() => setHovered(p.id)}
                          onBlur={() => setHovered(h => (h === p.id ? null : h))}
                          className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                          style={{ backgroundColor: isOn ? '#f5ede0' : 'transparent' }}
                          title={`${p.consumer_name} — ${STANDING_LABEL[p.standing as keyof typeof STANDING_LABEL] ?? p.standing}`}
                        >
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: colour }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-xs font-medium text-slate-700">
                            {firstName(p.consumer_name)}
                          </span>
                          {p.standing === 'winning' && <Trophy size={11} className="flex-shrink-0" style={{ color: DOT.winning }} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The detail. Inline under the tree rather than a modal: the admin is
          comparing people, and a dialog would hide the thing being compared. */}
      {selected && (
        <div
          className="mt-5 pt-4 border-t border-[#e8dcc8] motion-safe:animate-fade-in"
          role="region"
          aria-label={`Details for ${selected.consumer_name}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-slate-900">{selected.consumer_name}</p>
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${DOT[selected.standing as keyof typeof DOT]}1a`, color: DOT[selected.standing as keyof typeof DOT] }}
                >
                  {STANDING_LABEL[selected.standing as keyof typeof STANDING_LABEL] ?? selected.standing}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {selected.scheme_name} · qualified {selected.qualified_months} of {selected.total_months} months
                {selected.dealer_name ? <> · via {selected.dealer_name}</> : <> · no linked trader</>}
              </p>
            </div>
            <button
              onClick={() => setSelected(null)}
              aria-label="Close details"
              className="p-2 -m-2 text-slate-400 hover:text-slate-600 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-sm">
            {selected.consumer_phone && (
              <a href={`tel:${selected.consumer_phone}`} className="flex items-center gap-2 text-slate-700 hover:underline">
                <Phone size={13} className="text-slate-400 flex-shrink-0" /> {selected.consumer_phone}
              </a>
            )}
            {selected.consumer_email && (
              <a href={`mailto:${selected.consumer_email}`} className="flex items-center gap-2 text-slate-700 hover:underline truncate">
                <Mail size={13} className="text-slate-400 flex-shrink-0" /> <span className="truncate">{selected.consumer_email}</span>
              </a>
            )}
            {selected.consumer_address && (
              <p className="flex items-start gap-2 text-slate-700 sm:col-span-2">
                <MapPin size={13} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <span>{selected.consumer_address}{selected.consumer_pincode ? `, ${selected.consumer_pincode}` : ''}</span>
              </p>
            )}
            {selected.welcome_gift_name && (
              <p className="flex items-center gap-2 text-slate-500 sm:col-span-2">
                <Users size={13} className="text-slate-400 flex-shrink-0" /> Welcome gift: {selected.welcome_gift_name}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
