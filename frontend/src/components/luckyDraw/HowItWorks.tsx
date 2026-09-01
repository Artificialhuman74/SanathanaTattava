import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Package, CalendarX, Gift, RotateCcw, ShieldCheck, Store } from 'lucide-react';
import ChakraIcon from './ChakraIcon';
import {
  LUCKY_DRAW_NAME, ordinalDay, clockLabel, TICKETS_PER_MONTHS, MAX_TICKETS,
} from '../../config/luckyDraw';

/**
 * The rules, in the order someone actually meets them: pay, buy, wait, win.
 *
 * This is the card that decides whether ₹100 feels like a fair deal or a
 * trick, so every line names a real thing that will happen to them, with the
 * date the admin has actually set rather than a "12th" hard-coded into the
 * copy. The one rule people get wrong is the deadline, so it is stated once
 * plainly and then again as its consequence, and the entries rule is drawn
 * rather than described.
 */
export default function HowItWorks({
  joiningFee,
  drawDay,
  drawTime,
  hasTrader,
}: {
  joiningFee: number;
  drawDay: number;
  drawTime: string;
  hasTrader: boolean;
}) {
  const by = `the ${ordinalDay(drawDay)}, ${clockLabel(drawTime)}`;

  return (
    <div className="card p-5 sm:p-6 mb-6">
      <h2 className="font-bold text-slate-900 text-sm">How it works</h2>
      <p className="text-xs text-slate-500 mt-1 mb-4">Four rules, and the fourth one is the reason people stay.</p>

      <ul className="space-y-3.5 text-sm text-slate-700">
        <Rule icon={CalendarClock}>
          The round runs for <b className="font-semibold text-slate-900">twelve months</b>. You pay the
          &#8377;{joiningFee} once, at the start, and never again.
        </Rule>

        <Rule icon={Package}>
          Buy any oil before <b className="font-semibold text-slate-900">{by}</b> and you are in that month&rsquo;s
          draw. One bottle counts the same as five. Every month is a fresh chance.
        </Rule>

        <Rule icon={CalendarX}>
          Nothing bought by {by}, and you sit that month out. You stay in the round and the next month opens
          the same as any other, so a missed month costs you that month and nothing more.
        </Rule>

        <Rule icon={Ticket}>
          <span className="block">
            Every {TICKETS_PER_MONTHS} months you qualify, your name goes in one more time, up to {MAX_TICKETS}.
            Buying steadily is worth more than buying big.
          </span>
          <TicketLadder />
        </Rule>

        <Rule icon={ChakraIcon}>
          Win, and <b className="font-semibold text-slate-900">the oil you bought that month comes to you free</b>,
          every month, for the rest of the round. Win in month three and that is nine free deliveries.
        </Rule>

        <Rule icon={RotateCcw}>
          Reach month twelve without winning and your last order is delivered free in month thirteen. Nobody
          finishes {LUCKY_DRAW_NAME} with nothing.
        </Rule>

        <Rule icon={ShieldCheck}>
          One round at a time, and one winner each month. A winner steps out of the draw and keeps receiving.
        </Rule>
      </ul>

      {/* Only for someone who cannot join yet. Every delivery in a round goes
          through their trader, so without one there is nobody to pack any of
          it. Says what is missing and where to fix it, in the card that is
          already explaining the rules. */}
      {!hasTrader && (
        <div
          className="flex items-start gap-3 rounded-xl border px-4 py-3 mt-5"
          style={{ borderColor: '#f0d898', backgroundColor: '#fdf8ee' }}
        >
          <Store size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#a87830' }} />
          <div className="text-sm">
            <p className="font-semibold" style={{ color: '#3a2208' }}>
              You need a trader linked before you can join.
            </p>
            <p className="leading-relaxed mt-1" style={{ color: '#6a4219' }}>
              Your trader is the one who packs and delivers everything in the round, including the free ones.
              Add your dealer&rsquo;s referral code to your profile and you can join straight after.
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
  );
}

function Rule({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <Icon size={16} className="text-gold-600 mt-0.5 flex-shrink-0" />
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

/** A ticket, drawn rather than imported: lucide has no oil-can ticket. */
function Ticket({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5Z" />
      <path d="M12 7.5v9" strokeDasharray="2 2.5" />
    </svg>
  );
}

/**
 * The loyalty rule, shown. Four slots fill left to right on a stagger, so the
 * ladder reads as something that grows rather than four static pills. It is
 * the one rule people cannot picture from a sentence, and it is the argument
 * for buying every month, which is the whole point of the scheme.
 */
function TicketLadder() {
  return (
    <span className="flex items-center gap-1.5 mt-2" aria-hidden="true">
      {Array.from({ length: MAX_TICKETS }, (_, i) => (
        <span
          key={i}
          className="motion-safe:animate-ticket-fill"
          style={{
            width: 26 + i * 9,
            height: 6,
            borderRadius: 999,
            backgroundColor: '#e8c164',
            opacity: 1 - i * 0.16,
            animationDelay: `${i * 110}ms`,
            transformOrigin: 'left center',
          }}
        />
      ))}
      <span className="text-[11px] font-medium ml-1" style={{ color: '#885c24' }}>
        month {TICKETS_PER_MONTHS * MAX_TICKETS}
      </span>
    </span>
  );
}
