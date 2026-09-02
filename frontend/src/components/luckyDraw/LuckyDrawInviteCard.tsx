import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LUCKY_DRAW_NAME, drawSeenKey, drawInfoSeenKey } from '../../config/luckyDraw';
import ChakraIcon from './ChakraIcon';
import { navigateWithViewTransition } from '../../utils/viewTransition';
import { ArrowRight, Sparkles } from 'lucide-react';
import DrawResultCard from './DrawResultCard';
import WinnerRoundCard, { type Cycle } from './WinnerRoundCard';
import EnrolledStatusRow from './EnrolledStatusRow';
import { fetchDrawStatus } from './drawStatus';

interface StatusResponse {
  active_enrollment: { status: string; scheme_name: string } | null;
  open_schemes: { id: number; name: string; joining_fee: number }[];
  cycle: Cycle | null;
}

/**
 * Shop-page entry point for the lucky draw. Signed-out visitors never see
 * this — the mechanic requires an account (the joining-fee payment and
 * welcome-gift delivery are tied to a consumer record) — and when nothing
 * is open or joined, it renders nothing rather than a dead call-to-action.
 *
 * Five states, in the order they're checked:
 *
 *   draw unwatched   everyone in the scheme gets the same card: a result is
 *                    waiting, go and see it. Nothing else shows until they
 *                    have, the winner's claim card included. The reveal is
 *                    where finding out happens, so no card may pre-empt it.
 *   won, watched     the winner's round card, every month until the round
 *                    ends. Watched once, claimable every month after.
 *   lost, watched    who won, and what puts them in the next draw. Dismissible.
 *   enrolled         the quiet one-liner (the page's default all month)
 *   not enrolled     the join card, when a scheme is open
 *
 * Only the first three are big. The page stays as it was until a draw actually
 * decides something, which is the whole point: an announcement that is always
 * on screen isn't an announcement.
 */
export default function LuckyDrawInviteCard() {
  const { consumer } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [infoSeen, setInfoSeen] = useState(false);
  const [revealSeen, setRevealSeen] = useState(false);

  /* Keyed on the id, not the consumer object: a refresh elsewhere in the app
   * hands back a new object with the same id, and depending on the object made
   * this refetch on every one of them. */
  const consumerId = consumer?.id;

  const load = useCallback(async () => {
    if (!consumerId) return;
    try {
      setStatus(await fetchDrawStatus());
    } catch {
      /* Deliberately NOT setStatus(null).
       *
       * A failed refresh is not evidence that the round has gone away, and
       * blanking on it is what made the card disappear on reload: one dropped
       * request and the whole thing vanished until the next client-side
       * navigation remounted it. Keep showing the last good answer; the
       * listeners below try again. */
    }
  }, [consumerId]);

  useEffect(() => { load(); }, [load]);

  /* Come back from a failure on our own. The first load can lose its race with
   * a cold backend, and without this the card stays empty until the page is
   * navigated away from and back. */
  useEffect(() => {
    if (!consumerId || status) return;
    const again = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    const t = window.setTimeout(load, 5000);
    return () => {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
      window.clearTimeout(t);
    };
  }, [consumerId, status, load]);

  const cycle = status?.cycle ?? null;

  // A draw counts as "fresh" only for the calendar month it ran in. One that
  // ran last month has already been seen or already been missed; either way it
  // is not news, and re-announcing it on the 1st would be a lie about timing.
  const freshDraw =
    cycle?.latest_draw && cycle.latest_draw.month_key === cycle.month_key ? cycle.latest_draw : null;

  const draw = cycle?.latest_draw ?? null;

  useEffect(() => {
    if (!cycle || !draw) return;
    // Both written elsewhere: the reveal flag by the lucky draw page when the
    // viewer comes out of the animation, the info flag by the card below.
    // Read on every load rather than once, so coming back from watching the
    // reveal swaps this card over without needing a refresh.
    setRevealSeen(!!localStorage.getItem(drawSeenKey(cycle.scheme_id, draw.month_key)));
    setInfoSeen(!!localStorage.getItem(drawInfoSeenKey(cycle.scheme_id, draw.month_key)));
  }, [cycle, draw, status]);

  const markInfoSeen = () => {
    if (cycle && draw) localStorage.setItem(drawInfoSeenKey(cycle.scheme_id, draw.month_key), '1');
    setInfoSeen(true);
  };

  if (!consumer || !status) return null;

  // ── A draw has landed and they haven't watched it ──────────────────────
  // First, and for everyone: winner or not, the animation is the moment the
  // result belongs to. Keyed on `latest_draw` rather than on the draw being
  // this month's, so it still stands if they don't open the app until the
  // following month. The reveal is owed to them whenever they turn up.
  if (cycle && draw && !revealSeen) {
    return <DrawResultCard cycle={cycle} variant="waiting" onSeen={() => {}} />;
  }

  // ── The winner, for the rest of the round ──────────────────────────────
  if (cycle?.won && cycle.reward) {
    return <WinnerRoundCard cycle={cycle} onClaimed={load} />;
  }

  // ── Watched it, didn't win: who won, and how to be in the next one ─────
  if (cycle && freshDraw && !freshDraw.is_me && !infoSeen) {
    return <DrawResultCard cycle={cycle} variant="result" onSeen={markInfoSeen} />;
  }

  // ── Enrolled, nothing decided yet: the page stays as it was ────────────
  if (status.active_enrollment) {
    const { status: enrollStatus, scheme_name } = status.active_enrollment;
    if (enrollStatus === 'pending_payment') return null; // mid-checkout, nothing to show here

    /* With a cycle in hand the row can say whether they are in THIS month's
     * draw, which is the part that changes and the part they can act on.
     * Without one (a scheme not yet running) it falls back to the standing
     * line, which is all there is to say. */
    if (cycle) return <EnrolledStatusRow cycle={cycle} />;

    return (
      <button
        onClick={() => navigateWithViewTransition(navigate, '/shop/lucky-draw')}
        className="group w-full flex items-center gap-3 px-5 py-3.5 rounded-[24px] border border-gold-200 bg-gold-50 hover:bg-gold-100 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gold-600"
        style={{ minHeight: 44 }}
      >
        <ChakraIcon size={20} className="flex-shrink-0" style={{ viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties} />
        <span className="flex-1 min-w-0 truncate text-sm font-semibold text-gold-800">
          {enrollStatus === 'won' ? "You've won this round of " : "You're in "}{scheme_name}
        </span>
        <ArrowRight
          size={16}
          className="text-gold-500 flex-shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </button>
    );
  }

  // ── Not enrolled, a scheme is open ─────────────────────────────────────
  const open = status.open_schemes ?? [];
  if (open.length === 0) return null;

  const fee = open[0].joining_fee;

  return (
    <div className="rounded-[24px] border border-gold-200 bg-gold-50 px-5 py-5 sm:px-6">
      <div className="flex items-center gap-2">
        <ChakraIcon size={18} className="text-gold-600 flex-shrink-0" style={{ viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties} />
        <span className="text-[13px] font-semibold tracking-wide text-gold-700 flex items-center gap-1.5">
          {LUCKY_DRAW_NAME}
          <Sparkles size={11} className="text-gold-500" aria-hidden="true" />
        </span>
      </div>

      <p className="text-[15px] font-semibold text-slate-900 leading-snug mt-2.5">
        Join for ₹{fee} and pick a free 200ml oil to start.
      </p>
      <p className="text-sm text-slate-600 leading-relaxed mt-1.5">
        Every month you order, you&rsquo;re in that month&rsquo;s draw.
      </p>

      <button
        onClick={() => navigateWithViewTransition(navigate, '/shop/lucky-draw')}
        className="px-5 py-2.5 mt-5 rounded-[16px] bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-700"
        style={{ minHeight: 44 }}
      >
        How it works
      </button>
    </div>
  );
}
