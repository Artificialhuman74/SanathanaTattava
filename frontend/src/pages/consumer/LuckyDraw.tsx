import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, Gift, Package, CalendarClock, RotateCcw, ShieldCheck, Store, Trophy } from 'lucide-react';
import ChakraIcon from '../../components/luckyDraw/ChakraIcon';
import WagonWheelLoader from '../../components/luckyDraw/WagonWheelLoader';
import { withViewTransition } from '../../utils/viewTransition';
import WinReveal from '../../components/luckyDraw/WinReveal';
import { LUCKY_DRAW_NAME, LUCKY_DRAW_TAGLINE, drawSeenKey } from '../../config/luckyDraw';

interface Scheme {
  id: number;
  name: string;
  joining_fee: number;
  enrollment_closes_at: string;
}

interface ActiveEnrollment {
  id: number;
  status: 'pending_payment' | 'active' | 'won';
  scheme_name: string;
  scheme_id: number;
  reward_product_name: string | null;
}

interface GiftProduct {
  id: number;
  name: string;
  description: string;
  price: number;
  image_url: string;
}

interface Winner {
  id: number;
  display_name: string;
  scheme_name: string;
  reward_product_name: string | null;
}

function RecentWinners({ winners }: { winners: Winner[] }) {
  if (winners.length === 0) return null;
  return (
    <div className="card p-5 sm:p-6 mt-6">
      <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-3">
        <Trophy size={15} className="text-gold-600" /> Recent winners
      </h2>
      <ul className="space-y-2.5">
        {winners.map(w => (
          <li key={w.id} className="flex items-center gap-2.5 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-gold-500 flex-shrink-0" />
            <span className="text-slate-700">
              <span className="font-semibold">{w.display_name}</span> won {w.scheme_name}
              {w.reward_product_name && <> — now getting <span className="font-medium">{w.reward_product_name}</span> free</>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LuckyDraw() {
  const { consumer } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  /* The wheel decelerates before the page takes over, so the spin is never cut
   * off mid-turn. `settling` is that hand-off window: still the loading view,
   * but the wheel is coasting to a stop rather than spinning. */
  const [settling, setSettling] = useState(false);
  const spinnerShownAt = useRef(Date.now());
  /* Cleared on unmount: navigating away mid-load otherwise leaves a timer
   * that wakes up to set state on a component that is gone. */
  const revealTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(revealTimer.current), []);
  const [openSchemes, setOpenSchemes] = useState<Scheme[]>([]);
  const [activeEnrollment, setActiveEnrollment] = useState<ActiveEnrollment | null>(null);
  const [gifts, setGifts] = useState<GiftProduct[]>([]);
  const [selectedGiftId, setSelectedGiftId] = useState<number | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [justEnrolled, setJustEnrolled] = useState<{ orderNumber: string; giftName: string } | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);

  // The big reveal plays once — the first time this browser sees this
  // enrollment as 'won'. Every visit after that gets the calm persistent
  // state instead; replaying the full flood on every page load would turn
  // delight into friction fast.
  const [showWinReveal, setShowWinReveal] = useState(false);
  const [cycle, setCycle] = useState<any>(null);

  const fetchStatus = async () => {
    const { data } = await consumerApi.get('/lucky-draw/consumer/status', { skipBaseRotation: true });
    const enrollment: ActiveEnrollment | null =
      data.active_enrollment && data.active_enrollment.status !== 'pending_payment' ? data.active_enrollment : null;
    setActiveEnrollment(enrollment);
    setOpenSchemes(data.open_schemes || []);

    // The reveal plays for everyone in the scheme once a draw lands, not only
    // for the winner: the draw is the shared moment, and the gold lifts to
    // whoever's name it is.
    //
    // Marked seen when they come out the far side of it, not when it starts.
    // The shop page holds everything back until this flag is set, so "seen"
    // has to mean actually watched: setting it up front would let a reload
    // mid-animation skip the moment for good.
    const c = data.cycle;
    setCycle(c || null);
    if (c?.latest_draw && !localStorage.getItem(drawSeenKey(c.scheme_id, c.latest_draw.month_key))) {
      setShowWinReveal(true);
    }
  };

  /* The loading wheel and the settled one are in different places on the
   * page. Both carry the same `viewTransitionName`, so swapping the views
   * inside a view transition makes the wheel travel between the two positions
   * rather than vanishing from one and appearing in the other. */
  const revealPage = useCallback(() => {
    window.clearTimeout(revealTimer.current);
    withViewTransition(() => setLoading(false));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await fetchStatus();
        const [giftsRes, winnersRes] = await Promise.all([
          consumerApi.get('/lucky-draw/consumer/welcome-gifts', { skipBaseRotation: true }),
          consumerApi.get('/lucky-draw/consumer/recent-winners', { skipBaseRotation: true }).catch(() => ({ data: { winners: [] } })),
        ]);
        setGifts(giftsRes.data.products || []);
        if (giftsRes.data.products?.length) setSelectedGiftId(giftsRes.data.products[0].id);
        setWinners(winnersRes.data.winners || []);
      } catch {
        toast.error(`Couldn't load ${LUCKY_DRAW_NAME}. Try again in a moment.`);
      } finally {
        // Only worth watching if the wheel was actually up long enough to read
        // as spinning. On a fast response, waiting out a deceleration nobody
        // saw start would just be latency dressed up as polish.
        const shown = Date.now() - spinnerShownAt.current;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (shown < 400 || reduced) { setLoading(false); return; }
        // Let the wheel be seen turning for a beat, fade the label out under
        // it, then hand over to the flight.
        // The wheel reports when it has actually stopped, so the page waits for
        // the brake rather than for a guessed duration that drifts out of step
        // the moment the braking maths is retuned.
        setSettling(true);
        // A backstop only: if the animation never fires (a backgrounded tab
        // suspends it), the page must still arrive.
        revealTimer.current = window.setTimeout(revealPage, 2000);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumer]);

  const scheme = openSchemes[0];

  const handleEnroll = async () => {
    if (!scheme || !selectedGiftId) return;
    setEnrolling(true);
    try {
      const { data } = await consumerApi.post('/lucky-draw/consumer/enroll', {
        scheme_id: scheme.id,
        welcome_gift_product_id: selectedGiftId,
      }, { skipBaseRotation: true });

      if (data.mocked) {
        // Dev-only shortcut (DEV_MOCK_PAYMENTS on the backend) — the fee is
        // already "paid" and the enrollment finalized, no checkout to open.
        const gift = gifts.find(g => g.id === selectedGiftId);
        setJustEnrolled({ orderNumber: data.order_number, giftName: gift?.name || 'your gift' });
        return;
      }

      const rzp = new window.Razorpay({
        key: data.key_id,
        amount: data.amount,
        currency: data.currency,
        name: 'Sanathana Tattva',
        description: `${LUCKY_DRAW_NAME} — ${scheme.name}`,
        order_id: data.razorpay_order_id,
        handler: async (response: any) => {
          try {
            const verifyRes = await consumerApi.post('/lucky-draw/consumer/enroll/verify', {
              enrollment_id: data.enrollment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }, { skipBaseRotation: true });
            const gift = gifts.find(g => g.id === selectedGiftId);
            setJustEnrolled({ orderNumber: verifyRes.data.order_number, giftName: gift?.name || 'your gift' });
          } catch {
            toast.error('Payment went through but we couldn\'t confirm enrollment. Contact support with your payment ID.');
          }
        },
        prefill: { name: consumer?.name || '', contact: consumer?.phone || '', email: consumer?.email || '' },
        theme: { color: '#c8963c' },
        modal: {
          ondismiss: () => toast('Payment cancelled. You can try again anytime.', { icon: 'ℹ️' }),
        },
      });
      rzp.open();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not start enrollment');
    } finally {
      setEnrolling(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 flex flex-col items-center">
        {/* The cart wheel turns while the round loads. It shares its
            view-transition name with the settled mark, so when the page
            arrives the wheel travels to where that mark sits rather than
            blinking out of one place and into another. */}
        <WagonWheelLoader
          size={120}
          className="mb-2"
          motion={settling ? 'settle' : 'spin'}
          onSettled={revealPage}
          style={{ viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties}
        />
        <p
          className="text-slate-400 transition-opacity duration-500 ease-out"
          style={{ opacity: settling ? 0 : 1 }}
        >
          Loading {LUCKY_DRAW_NAME}…
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <button
        onClick={() => navigate('/shop')}
        className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6 transition-colors"
      >
        <ArrowLeft size={14} /> Back to shop
      </button>

      {/* ── Just enrolled: the reveal moment ──────────────────────── */}
      {justEnrolled ? (
        <div className="text-center py-10">
          <div className="w-20 h-20 rounded-full bg-gold-50 flex items-center justify-center mx-auto mb-6">
            <ChakraIcon size={44} className="text-gold-600" motion="reveal" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">You're in {scheme?.name}.</h1>
          <p className="text-slate-600 max-w-sm mx-auto leading-relaxed">
            {justEnrolled.giftName} is on its way to you, no charge — order{' '}
            <span className="font-mono font-semibold text-slate-800">{justEnrolled.orderNumber}</span>. Every order you
            place from here counts toward this month's draw.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
            <Link to="/shop" className="btn-primary py-3 px-8">Continue Shopping</Link>
            <Link to="/shop/orders" className="btn-ghost border border-[#e8dcc8] py-3 px-8">View My Orders</Link>
          </div>
        </div>
      ) : showWinReveal && cycle?.latest_draw ? (
        /* ── The draw reveal: the ring pours, blooms, and lifts off the name ── */
        <WinReveal
          winnerName={cycle.latest_draw.is_me ? (consumer?.name || 'You') : cycle.latest_draw.winner_display_name}
          isMe={cycle.latest_draw.is_me}
          hasWinner={cycle.latest_draw.has_winner !== false}
          schemeName={cycle.scheme_name}
          rewardProductName={cycle.reward?.product_name ?? cycle.latest_draw.reward_product_name}
          nextEntryDeadline={cycle.next_entry_deadline}
          onContinue={() => {
            localStorage.setItem(drawSeenKey(cycle.scheme_id, cycle.latest_draw.month_key), '1');
            setShowWinReveal(false);
          }}
        />
      ) : activeEnrollment ? (
        /* ── Already enrolled (calm, persistent state) ─────────────── */
        <div className="text-center py-10">
          <div className="w-20 h-20 rounded-full bg-gold-50 flex items-center justify-center mx-auto mb-6">
            <ChakraIcon size={44} className="text-gold-600" style={{ viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {activeEnrollment.status === 'won' ? "You've won this round." : `You're in ${activeEnrollment.scheme_name}.`}
          </h1>
          <p className="text-slate-600 max-w-sm mx-auto leading-relaxed">
            {activeEnrollment.status === 'won'
              ? (activeEnrollment.reward_product_name
                  ? <>We're delivering your <span className="font-semibold text-slate-800">{activeEnrollment.reward_product_name}</span> free, every month, for the rest of this round.</>
                  : "We're delivering your last order free, every month, for the rest of this round.")
              : "Any purchase this month enters you into the draw on the 12th. Win, and we'll deliver whatever you bought most recently, free, for the rest of the round."}
          </p>
          <Link to="/shop" className="btn-primary py-3 px-8 inline-block mt-8">Continue Shopping</Link>
          <RecentWinners winners={winners} />
        </div>
      ) : scheme ? (
        /* ── Open to join ───────────────────────────────────────────── */
        <>
          <div className="text-center mb-8">
            <ChakraIcon
              size={48}
              className="text-gold-600 mx-auto mb-3"
              style={{ viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties}
            />
            <h1 className="text-2xl font-bold text-slate-900">{LUCKY_DRAW_NAME}</h1>
            <p className="text-slate-500 text-sm mt-1">{LUCKY_DRAW_TAGLINE}</p>
          </div>

          <div className="card p-5 sm:p-6 space-y-4 mb-6">
            <h2 className="font-bold text-slate-900 text-sm">How it works</h2>
            <ul className="space-y-3 text-sm text-slate-700">
              <li className="flex items-start gap-3">
                <Gift size={16} className="text-gold-600 mt-0.5 flex-shrink-0" />
                <span>Join for ₹{scheme.joining_fee} and pick a free 200ml oil to start.</span>
              </li>
              <li className="flex items-start gap-3">
                <Package size={16} className="text-gold-600 mt-0.5 flex-shrink-0" />
                <span>Any order you place in a month enters you into that month's draw. No minimum.</span>
              </li>
              <li className="flex items-start gap-3">
                <CalendarClock size={16} className="text-gold-600 mt-0.5 flex-shrink-0" />
                <span>One winner is picked on the 12th of every month.</span>
              </li>
              <li className="flex items-start gap-3">
                <ChakraIcon size={16} className="text-gold-600 mt-0.5 flex-shrink-0" />
                <span>Win, and we deliver whatever you bought most recently, free, every month for the rest of the round.</span>
              </li>
              <li className="flex items-start gap-3">
                <RotateCcw size={16} className="text-gold-600 mt-0.5 flex-shrink-0" />
                <span>Don't win by month 12? You still get your last order delivered free in month 13.</span>
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck size={16} className="text-gold-600 mt-0.5 flex-shrink-0" />
                <span>You can only be in one round of {LUCKY_DRAW_NAME} at a time.</span>
              </li>
            </ul>

            {/* Only for someone who cannot join yet. Every delivery in a round
                goes through their trader, so without one there is nobody to
                pack any of it. Says what is missing and where to fix it, in
                the card that is already explaining the rules. */}
            {!consumer?.linked_dealer_id && (
              <div
                className="flex items-start gap-3 rounded-xl border px-4 py-3 mt-1"
                style={{ borderColor: '#f0d898', backgroundColor: '#fdf8ee' }}
              >
                <Store size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#a87830' }} />
                <div className="text-sm">
                  <p className="font-semibold" style={{ color: '#3a2208' }}>
                    You need a trader linked before you can join.
                  </p>
                  <p className="leading-relaxed mt-1" style={{ color: '#6a4219' }}>
                    Your trader is the one who packs and delivers everything in the round, including the free
                    ones. Add your dealer&rsquo;s referral code to your profile and you can join straight after.
                  </p>
                  <Link
                    to="/shop/profile"
                    className="inline-block font-semibold mt-2 hover:underline focus-visible:underline"
                    style={{ color: '#885c24' }}
                  >
                    Link a trader in your profile
                  </Link>
                </div>
              </div>
            )}
          </div>

          <div className="card p-5 sm:p-6 mb-6">
            <h2 className="font-bold text-slate-900 text-sm mb-1">Pick your free 200ml oil</h2>
            <p className="text-slate-500 text-xs mb-4">No can deposit on the trial size — this one's a gift.</p>
            <div className="space-y-2">
              {gifts.map(g => (
                <label
                  key={g.id}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                    selectedGiftId === g.id ? 'border-gold-500 bg-gold-50' : 'border-[#e8dcc8] hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="welcome-gift"
                    checked={selectedGiftId === g.id}
                    onChange={() => setSelectedGiftId(g.id)}
                    className="accent-gold-600"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{g.name}</span>
                    <span className="block text-xs text-slate-500 truncate">{g.description}</span>
                  </span>
                  {selectedGiftId === g.id && <Check size={16} className="text-gold-600 flex-shrink-0" />}
                </label>
              ))}
              {gifts.length === 0 && (
                <p className="text-sm text-slate-400 py-4 text-center">No welcome gifts available right now — check back soon.</p>
              )}
            </div>
          </div>

          <button
            onClick={handleEnroll}
            disabled={enrolling || !selectedGiftId || !consumer?.linked_dealer_id}
            className="w-full py-3.5 text-base font-semibold rounded-2xl bg-gold-600 hover:bg-gold-700 active:bg-gold-800 text-white shadow-sm hover:shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {enrolling && <ChakraIcon size={16} motion="idle" className="text-white" />}
            {enrolling ? 'Starting…' : `Join for ₹${scheme.joining_fee}`}
          </button>

          <RecentWinners winners={winners} />
        </>
      ) : (
        /* ── Nothing open right now ─────────────────────────────────── */
        <div className="text-center py-16">
          <ChakraIcon
            size={40}
            className="text-slate-300 mx-auto mb-4"
            style={{ viewTransitionName: 'bhagya-chakra-hero' } as React.CSSProperties}
          />
          <p className="text-slate-500 font-medium">{LUCKY_DRAW_NAME} isn't running right now.</p>
          <p className="text-slate-400 text-sm mt-1 mb-6">We'll let you know here when the next round opens.</p>
          <Link to="/shop" className="btn-primary px-6 py-2 inline-block">Continue Shopping</Link>
          <RecentWinners winners={winners} />
        </div>
      )}
    </div>
  );
}
