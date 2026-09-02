import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { enteredSeenKey } from '../../config/luckyDraw';
import { parseDbDate } from '../../utils/dateTime';
import { navigateWithViewTransition } from '../../utils/viewTransition';
import ChakraIcon from './ChakraIcon';
import type { Cycle } from './WinnerRoundCard';

/** "12 September", in IST: these are fixed IST wall-clock times. */
const dayAndMonth = (iso: string) =>
  parseDbDate(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long' });

/**
 * The shop page's standing line for someone enrolled in a running round.
 *
 * It used to say only "You're in SC1", which is true all year and therefore
 * tells nobody anything they can act on. What changes month to month is
 * whether they are in THIS month's draw, and that turns entirely on whether
 * they have bought oil yet. So the row carries the state, and when they
 * haven't, it says the one thing that would fix it.
 *
 * The delight is the crossing. Someone who orders and comes back to the shop
 * finds the row has flipped, and it is marked once with a single gold pass and
 * a tick that draws in. Keyed per scheme and month, so it happens the once and
 * never nags afterwards.
 */
export default function EnrolledStatusRow({ cycle }: { cycle: Cycle }) {
  const navigate = useNavigate();
  const [justCrossed, setJustCrossed] = useState(false);

  const entered = cycle.entered;
  const tickets = cycle.tickets ?? 1;
  const windowOpen = Date.now() <= parseDbDate(cycle.entry_deadline).getTime();
  /* Has THIS month's draw already been held? `entered` stays true for the rest
   * of the month once it has, so without this the row went on saying "In this
   * month's draw · 12 September" for the three weeks AFTER the 12th — to
   * someone who had already lost it. A tick and a future-tense promise against
   * a settled result is the one thing the row must never say. */
  const drawn = cycle.latest_draw?.month_key === cycle.month_key;
  const inThisDraw = entered && !drawn;

  useEffect(() => {
    if (!inThisDraw) return;
    const key = enteredSeenKey(cycle.scheme_id, cycle.month_key);
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
      setJustCrossed(true);
    } catch { /* private browsing: the row is still correct, just unmarked */ }
  }, [inThisDraw, cycle.scheme_id, cycle.month_key]);

  /* Three states, and only one of them is not a call to action. Once this
   * month's draw has run there is still something to ask for: a purchase now
   * rolls into the next draw, so the row points at that date rather than
   * saying entries are closed, which would send people away for three weeks
   * over a deadline that has already moved on. */
  const nextLine = `Buy any oil to enter the ${dayAndMonth(cycle.next_draw_at)} draw`;
  const line = drawn
    ? entered
      ? `This month\u2019s draw has been held \u00b7 ${nextLine.charAt(0).toLowerCase()}${nextLine.slice(1)}`
      : nextLine
    : entered
      ? tickets > 1
        ? `In this month\u2019s draw with ${tickets} entries \u00b7 ${dayAndMonth(cycle.draw_at)}`
        : `In this month\u2019s draw \u00b7 ${dayAndMonth(cycle.draw_at)}`
      : windowOpen
        ? `Buy any oil by ${dayAndMonth(cycle.entry_deadline)} to enter this month\u2019s draw`
        : nextLine;

  return (
    <button
      onClick={() => navigateWithViewTransition(navigate, '/shop/lucky-draw')}
      className="group relative w-full overflow-hidden flex items-center gap-3 px-5 py-3 rounded-[24px] border border-gold-200 bg-gold-50 hover:bg-gold-100 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gold-600"
      style={{ minHeight: 44 }}
    >
      {/* The crossing: one gold pass over the row, once. */}
      {justCrossed && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 motion-safe:animate-entered-sweep"
          style={{ background: 'linear-gradient(90deg, rgba(240,216,152,0) 0%, rgba(240,216,152,0.55) 50%, rgba(240,216,152,0) 100%)' }}
        />
      )}

      <ChakraIcon
        size={20}
        className="flex-shrink-0"
        style={{ viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties}
      />

      <span className="relative flex-1 min-w-0">
        <span className="block truncate text-sm font-semibold text-gold-800">
          You&rsquo;re in {cycle.scheme_name}
        </span>
        <span className="flex items-center gap-1.5 text-xs mt-0.5" style={{ color: '#885c24' }}>
          {inThisDraw && (
            <span
              className={`flex items-center justify-center w-3.5 h-3.5 rounded-full flex-shrink-0 ${justCrossed ? 'motion-safe:animate-tick-in' : ''}`}
              style={{ backgroundColor: '#c8963c' }}
              aria-hidden="true"
            >
              <Check size={9} strokeWidth={3.5} color="#fdf8ee" />
            </span>
          )}
          <span className="truncate">{line}</span>
        </span>
      </span>

      <ArrowRight
        size={16}
        className="relative text-gold-500 flex-shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </button>
  );
}
