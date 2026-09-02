import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { consumerApi } from '../../contexts/AuthContext';
import { LUCKY_DRAW_NAME } from '../../config/luckyDraw';
import ChakraIcon from './ChakraIcon';
import RoundProgress from './RoundProgress';
import { Check, Loader2, PackageCheck } from 'lucide-react';

export interface Cycle {
  enrollment_id: number;
  scheme_id: number;
  scheme_name: string;
  month_number: number;
  total_months: number;
  month_key: string;
  entry_deadline: string;
  draw_at: string;
  next_entry_deadline: string;
  next_draw_at: string;
  entered: boolean;
  /** True once the twelve months are up, or the admin has ended the scheme. */
  round_over?: boolean;
  /** How many entries this month's order is worth (loyalty weighting). */
  tickets?: number;
  qualified_months?: number;
  won: boolean;
  latest_draw: {
    month_key: string;
    ran_at: string;
    /** False when the month drew nobody; the winner fields are then null. */
    has_winner?: boolean;
    winner_display_name: string | null;
    reward_product_name: string | null;
    is_me: boolean;
  } | null;
  reward: {
    product_name: string | null;
    quantity: number;
    won_at_month: number;
    months_remaining: number;
    this_month_ordered: boolean;
    this_month_order_number: string | null;
    this_month_delivery_status?: string | null;
    this_month_delivered?: boolean;
    this_month_delivered_at?: string | null;
  } | null;
}

/** "September" from a 'YYYY-MM' key, in the reader's own month names. */
function monthName(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long' });
}

/**
 * The winner's front page, for every month left in the round.
 *
 * Winning doesn't hand you anything on its own: the reward is an order you
 * place, priced at ₹0, once a month until the round ends (spec §3.12). So
 * this is an action card, not a trophy. The round tracker above the copy is
 * the part that changes month to month, and it carries the two facts the
 * sentence would otherwise have to spend words on: how far in you are, and
 * whether you've claimed this one yet.
 */
export default function WinnerRoundCard({ cycle, onClaimed }: { cycle: Cycle; onClaimed: () => void }) {
  const reward = cycle.reward!;
  const [claiming, setClaiming] = useState(false);
  const [justClaimed, setJustClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic so the tracker fills the moment they tap. The refresh behind it
  // is what makes it true; the animation shouldn't wait on a round trip.
  const [claimed, setClaimed] = useState(reward.this_month_ordered);
  /* Placed is not the same as arrived. Once the delivery agent marks it
   * delivered the card has to stop saying "on its way", or a status quietly
   * becomes a slogan the reader learns to ignore. */
  const delivered = !!reward.this_month_delivered;

  const month = monthName(cycle.month_key);
  const item = reward.product_name;
  const lastOne = reward.months_remaining <= 0;
  /* The twelve months are up. There is nothing left to claim, and offering a
   * button that can only return an error is worse than saying so. */
  const roundOver = !!cycle.round_over;

  const claim = async () => {
    setClaiming(true);
    setError(null);
    try {
      await consumerApi.post('/lucky-draw/consumer/reward-order', {}, { skipBaseRotation: true, skipAuthRedirect: true });
      setClaimed(true);
      setJustClaimed(true);
      onClaimed();
    } catch (err: any) {
      setError(err?.response?.data?.error || "That didn't go through. Try again in a moment.");
    } finally {
      setClaiming(false);
    }
  };

  /* The rail and the "Month N of 12" label carry the position, and the line
   * above the product names the month, so the confirmation only says what
   * none of them does. It marks the two moments in a twelve-month run that
   * are actually different from the other ten, and otherwise gets out of the
   * way rather than restating what is already on screen. */
  /** Where the delivery has actually got to, in the words someone waiting
   *  for a can of oil would use. */
  const journey: Record<string, string> = {
    pending: 'Your dealer is packing it.',
    accepted: 'Your dealer is packing it.',
    packed: 'Packed and waiting to go out.',
    out_for_delivery: 'Out for delivery today.',
  };

  const confirmation = delivered
    ? lastOne
      ? "Delivered. That was the last one of your round."
      : 'Delivered.'
    : journey[reward.this_month_delivery_status || 'pending']
      ?? (lastOne
        ? "That's the last delivery of your round."
        : reward.won_at_month === cycle.month_number
          ? 'Your first free delivery is on its way.'
          : 'On its way to you.');

  return (
    <section
      className="rounded-[24px] border px-5 py-6 sm:px-7 sm:py-7"
      style={{ backgroundColor: '#fdf8ee', borderColor: '#f0d898' }}
      aria-labelledby="bc-winner-heading"
    >
      {/* Zone 1 — what they get. The product is the reason the card exists, so
          it leads at display size instead of sitting mid-sentence. */}
      <div className="flex items-center gap-2">
        <ChakraIcon
          size={18}
          className="flex-shrink-0"
          style={{ color: '#c8963c', viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties}
        />
        <span className="text-[13px] font-semibold tracking-wide" style={{ color: '#885c24' }}>
          {delivered
            ? `${month}, delivered`
            : lastOne
              ? `${month}, the last of your round`
              : claimed ? `${month}, booked` : `${month}, ready`}
        </span>
      </div>

      <h2
        id="bc-winner-heading"
        className="text-[26px] sm:text-[28px] font-bold leading-[1.15] mt-3 break-words"
        style={{ color: '#3a2208', textWrap: 'balance', overflowWrap: 'anywhere' } as React.CSSProperties}
      >
        {item || 'Your reward delivery'}
        {item && reward.quantity > 1 && (
          <span className="font-semibold" style={{ color: '#885c24' }}>{` × ${reward.quantity}`}</span>
        )}
      </h2>

      <p className="text-sm leading-relaxed mt-2" style={{ color: '#6a4219' }}>
        {`Free, because you won ${cycle.scheme_name}.`}
      </p>

      {/* Zone 2 — the action. Generous space above it: this is the one thing
          the card wants them to do. */}
      <div className="mt-6">
        {roundOver && !claimed ? (
          <p className="text-sm font-semibold" style={{ color: '#6a4219' }} role="status">
            {/* Counted from the month they actually won. The old copy said
                "Twelve months, all of them free after you won" to everybody,
                which is only true of a month-one winner and reads as a boast
                about deliveries nobody received. */}
            Your round is complete
            {reward.won_at_month
              ? ` — ${cycle.total_months - reward.won_at_month + 1} free ${
                  cycle.total_months - reward.won_at_month + 1 === 1 ? 'delivery' : 'deliveries'
                } after you won in month ${reward.won_at_month}.`
              : '.'}
          </p>
        ) : claimed ? (
          <p
            className="flex items-center gap-2 text-sm font-semibold motion-safe:animate-fade-in"
            style={{ color: delivered ? '#14532d' : '#885c24' }}
            role="status"
          >
            <span
              className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0"
              style={{ backgroundColor: delivered ? '#1a6b2e' : '#c8963c' }}
              aria-hidden="true"
            >
              {delivered
                ? <PackageCheck size={12} strokeWidth={2.5} color="#ffffff" />
                : <Check size={12} strokeWidth={3} color="#fdf8ee" />}
            </span>
            {confirmation}
          </p>
        ) : (
          <button
            onClick={claim}
            disabled={claiming}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-[16px] bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdf8ee] focus-visible:ring-brand-700"
            style={{ minHeight: 44 }}
          >
            {claiming && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {claiming ? 'Placing your order' : 'Place my free order'}
          </button>
        )}

        {error && (
          <p className="text-sm mt-3 text-red-700" role="alert">
            {error}{' '}
            <button onClick={claim} className="underline font-semibold hover:no-underline">Try again</button>
          </p>
        )}
      </div>

      {/* Zone 3 — the round, as a rail across the foot of the card. Separated
          by a hairline because it is a different kind of information: not what
          to do now, but where this month sits in the twelve. */}
      <div className="mt-7 pt-5 border-t" style={{ borderColor: 'rgba(200, 150, 60, 0.22)' }}>
        <RoundProgress
          current={cycle.month_number}
          total={cycle.total_months}
          currentClaimed={claimed}
          justClaimed={justClaimed}
        />
        <div className="flex items-baseline justify-between gap-4 mt-3">
          <span className="text-xs font-semibold" style={{ color: '#885c24' }}>
            Month {cycle.month_number} of {cycle.total_months}
          </span>
          <Link
            to="/shop/lucky-draw"
            className="text-xs hover:underline focus-visible:underline py-1"
            style={{ color: '#885c24' }}
          >
            How {LUCKY_DRAW_NAME} works
          </Link>
        </div>
      </div>
    </section>
  );
}
