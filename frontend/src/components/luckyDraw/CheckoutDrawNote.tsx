import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchDrawStatus } from './drawStatus';
import { LUCKY_DRAW_NAME } from '../../config/luckyDraw';
import { parseDbDate } from '../../utils/dateTime';
import ChakraIcon from './ChakraIcon';

interface Cycle {
  scheme_name: string;
  entry_deadline: string;
  draw_at: string;
  next_draw_at: string;
  entered: boolean;
  won: boolean;
  round_over?: boolean;
  tickets?: number;
  qualified_months?: number;
}

/** "12 September", in IST — the dates are fixed IST wall-clock times. */
const dayAndMonth = (iso: string) =>
  parseDbDate(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long' });

/**
 * At checkout, for someone enrolled in a running round.
 *
 * They came here to buy oil, and buying oil is exactly what puts them in this
 * month's draw. Saying so at the moment of payment is the one place the
 * mechanic is genuinely useful rather than decorative: it is the difference
 * between an order and an entry, and they are one tap from it.
 *
 * Renders nothing for anyone not enrolled, for a winner (they are out of the
 * pool), or once the round is finished. It does keep going after this
 * month's draw, because an order placed then rolls into the next one: the
 * note simply names that draw instead. Telling someone their purchase counts
 * for nothing, when it does count, would lose the order for no reason.
 */
export default function CheckoutDrawNote() {
  const { consumer } = useAuth();
  const [cycle, setCycle] = useState<Cycle | null>(null);

  useEffect(() => {
    if (!consumer) return;
    let alive = true;
    fetchDrawStatus()
      .then(data => { if (alive) setCycle(data?.cycle ?? null); })
      .catch(() => { /* the checkout must not care whether this loads */ });
    return () => { alive = false; };
  }, [consumer]);

  if (!cycle || cycle.won || cycle.round_over) return null;

  const deadline = parseDbDate(cycle.entry_deadline);
  if (Number.isNaN(deadline.getTime())) return null;

  /* After this month's draw the order still counts, for the next one. The
   * note names whichever draw this purchase is actually going into, because
   * naming the wrong one at the moment of payment is the worst place to be
   * wrong. */
  const rollsForward = Date.now() > deadline.getTime();
  const drawAt = rollsForward ? cycle.next_draw_at : cycle.draw_at;
  const tickets = cycle.tickets ?? 1;

  return (
    <div
      className="rounded-2xl border px-5 py-4"
      style={{ borderColor: '#f0d898', backgroundColor: '#fdf8ee' }}
      role="note"
    >
      <div className="flex items-start gap-3">
        <ChakraIcon size={22} className="flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: '#3a2208' }}>
            {rollsForward
              ? `This order puts you in the next ${cycle.scheme_name} draw.`
              : cycle.entered
                ? `You're already in this month's ${cycle.scheme_name} draw.`
                : `This order puts you in this month's ${cycle.scheme_name} draw.`}
          </p>
          <p className="text-sm leading-relaxed mt-1" style={{ color: '#6a4219' }}>
            The draw is on {dayAndMonth(drawAt)}. Win it and we deliver this
            order free, every month, for the rest of the round.
            {tickets > 1 && (
              <>
                {' '}You&rsquo;ve ordered in {cycle.qualified_months} months so far, so you go in
                with <span className="font-semibold" style={{ color: '#3a2208' }}>{tickets} entries</span> instead of one.
              </>
            )}
          </p>
          <p className="text-sm font-semibold mt-2" style={{ color: '#885c24' }}>Good luck.</p>
        </div>
      </div>
    </div>
  );
}
