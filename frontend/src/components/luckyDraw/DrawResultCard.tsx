import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseDbDate } from '../../utils/dateTime';
import { navigateWithViewTransition } from '../../utils/viewTransition';
import ChakraIcon from './ChakraIcon';
import type { Cycle } from './WinnerRoundCard';

/** "12 September", in IST. Both dates the copy quotes are fixed IST
 *  wall-clock times computed by the API, so they only need formatting here. */
const dayAndMonth = (iso: string) =>
  parseDbDate(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long' });

/**
 * Shown on the front page in the window between a draw being run and this
 * consumer having seen the outcome. Then it goes away and the page returns to
 * the quiet one-line card.
 *
 * Two variants, deliberately the same card:
 *
 *   waiting  everyone in the scheme, before they've watched the reveal. It
 *            says a result exists and opens the animation. It names nobody
 *            and cannot be dismissed: the animation is the moment the result
 *            belongs to, and a front-page card that announced it first would
 *            be the thing that spoiled it.
 *   result   after watching, for those who didn't win: who won, and what puts
 *            them in the next draw. That is the moment to ask.
 *
 * The variant is passed in rather than derived from `is_me`, because "have
 * they watched it yet" is the question that decides which one shows, and only
 * the caller knows the answer.
 */
export default function DrawResultCard({
  cycle,
  variant = 'waiting',
  onSeen,
}: {
  cycle: Cycle;
  variant?: 'waiting' | 'result';
  onSeen: () => void;
}) {
  const draw = cycle.latest_draw!;
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);


  const dismiss = () => {
    setLeaving(true);
    // Matches the collapse duration below; the state only flips once the card
    // has finished getting out of the way.
    window.setTimeout(onSeen, 220);
  };

  const shopNow = () => {
    dismiss();
    navigateWithViewTransition(navigate, '/shop');
  };

  // The reveal lives on the lucky draw page and marks itself seen when the
  // viewer comes out of it. Nothing is dismissed here: this card stands until
  // the animation has actually played.
  const openReveal = () => navigateWithViewTransition(navigate, '/shop/lucky-draw');

  // ── The result, waiting to be opened ───────────────────────────────────
  // Centred and stripped to one action, deliberately unlike the informational
  // variant below. The wheel turns while it waits: the feature is a chakra,
  // the card is a held breath, and this is the one screen in the flow where
  // anticipation is the content rather than a decoration on it.
  if (variant === 'waiting') {
    return (
      <section
        className="rounded-[24px] border px-5 py-8 sm:py-9 text-center"
        style={{ backgroundColor: '#fdf8ee', borderColor: '#f0d898' }}
        aria-labelledby="bc-result-heading"
      >
        <ChakraIcon
          size={40}
          className="mx-auto motion-safe:animate-chakra-wait"
          style={{ color: '#c8963c', viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties}
        />

        <h2
          id="bc-result-heading"
          className="text-xl font-bold leading-snug mt-5 break-words"
          style={{ color: '#3a2208', textWrap: 'balance', overflowWrap: 'anywhere' } as React.CSSProperties}
        >
          {cycle.scheme_name} has been drawn.
        </h2>
        <p className="text-sm leading-relaxed mt-2" style={{ color: '#6a4219' }}>
          This month&rsquo;s result is waiting for you.
        </p>

        <button
          onClick={openReveal}
          className="inline-flex items-center justify-center px-7 py-3 mt-7 rounded-[16px] bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdf8ee] focus-visible:ring-brand-700"
          style={{ minHeight: 44 }}
        >
          See the result
        </button>
      </section>
    );
  }

  // ── Someone else won: informational, and an ask ────────────────────────
  return (
    <section
      className={`rounded-[24px] border px-5 py-6 sm:px-7 sm:py-7 transition-all duration-200 ease-out ${
        leaving ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'
      }`}
      style={{ backgroundColor: '#fdf8ee', borderColor: '#f0d898' }}
      aria-labelledby="bc-result-heading"
    >
      <div className="flex items-center gap-2">
        <ChakraIcon
          size={18}
          className="flex-shrink-0"
          style={{ color: '#c8963c', viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties}
        />
        <span className="text-[13px] font-semibold tracking-wide" style={{ color: '#885c24' }}>
          This month&rsquo;s draw
        </span>
      </div>

      <h2
        id="bc-result-heading"
        className="text-[22px] font-bold leading-[1.2] mt-3 break-words"
        style={{ color: '#3a2208', textWrap: 'balance', overflowWrap: 'anywhere' } as React.CSSProperties}
      >
        {draw.has_winner === false
          ? <>No one won {cycle.scheme_name} this month.</>
          : <>{draw.winner_display_name} won {cycle.scheme_name}.</>}
      </h2>

      <p className="text-sm leading-relaxed mt-2" style={{ color: '#6a4219' }}>
        {draw.has_winner === false ? (
          <>Nobody ordered in time, so the wheel stopped on an empty spoke. </>
        ) : draw.reward_product_name ? (
          <>They&rsquo;re getting {draw.reward_product_name} free for the rest of the round. </>
        ) : null}
        The next draw is on {dayAndMonth(cycle.next_draw_at)}. Any order by{' '}
        {dayAndMonth(cycle.next_entry_deadline)} puts you in it.
      </p>

      <div className="flex flex-wrap items-center gap-2.5 mt-6">
        <button
          onClick={shopNow}
          className="px-6 py-3 rounded-[16px] bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdf8ee] focus-visible:ring-brand-700"
          style={{ minHeight: 44 }}
        >
          Shop now to enter
        </button>
        <button
          onClick={dismiss}
          className="px-4 py-3 rounded-[16px] text-sm font-semibold transition-colors hover:bg-gold-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdf8ee] focus-visible:ring-gold-600"
          style={{ color: '#885c24', minHeight: 44 }}
        >
          Got it
        </button>
      </div>
    </section>
  );
}
