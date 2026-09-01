import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playNotificationSound } from '../../services/notificationSound';

interface OilFloodRevealProps {
  schemeName: string;
  rewardProductName: string | null;
  onContinue: () => void;
}

/**
 * The win reveal, told as a sequence rather than a single event.
 *
 * One drop falls and makes a small pool. Then another, then another, each
 * arriving sooner than the last, and the pool grows with every one — until
 * there is so much oil it floods the screen and the words rise out of it.
 * That escalation is the prize itself: one free delivery, then another, every
 * month for the rest of the round. The animation explains the mechanic
 * instead of just decorating it.
 */

/** Drop start delays, in ms from mount. The gaps close deliberately
 *  (550 → 450 → 350 → 250) so the arrivals accelerate. */
const DROP_STARTS = [0, 550, 1000, 1350, 1600];
const FALL = 700;                     // form + fall, per drop
const LANDINGS = DROP_STARTS.map(d => d + FALL);
const LAST_LANDING = LANDINGS[LANDINGS.length - 1];

const T = {
  poolSpan: LAST_LANDING,             // the pool animation covers every landing
  flood: LAST_LANDING,                // the final landing is what breaks the banks
  floodDur: 700,
  words: LAST_LANDING + 750,
  wordStep: 120,
  reward: LAST_LANDING + 1250,
  button: LAST_LANDING + 1400,
  end: LAST_LANDING + 1850,
};

/** Thrown off the last landing only — the one that floods. Precomputed so the
 *  reveal is identical on every play; a win moment that differs each time
 *  reads as a glitch rather than as life. */
const SATELLITES = Array.from({ length: 8 }, (_, i) => {
  const angle = (-162 + i * 21) * (Math.PI / 180);
  const dist = 56 + (i % 3) * 26;
  return {
    tx: Math.round(Math.cos(angle) * dist),
    ty: Math.round(Math.sin(angle) * dist),
    size: 5 + (i % 3) * 2,
    delay: i * 18,
    tone: ['#f0d898', '#e8b86d', '#c8963c'][i % 3],
  };
});

export default function OilFloodReveal({ schemeName, rewardProductName, onContinue }: OilFloodRevealProps) {
  // Bumping this remounts every animated node, restarting the CSS sequence
  // from zero. It is what the dev replay button drives.
  const [runId, setRunId] = useState(0);
  // `settled` is set by a timer, never by an animation event. If the browser
  // never runs the animations — backgrounded tab on mount, a headless render,
  // reduced motion — the copy still arrives on schedule instead of sitting at
  // opacity 0 forever behind a reveal that never fired.
  const [settled, setSettled] = useState(false);
  // The displacement filter is the expensive part of the frame. It only earns
  // its cost while the flood edge is moving, so it comes off once the oil is
  // at rest and the screen stops repainting.
  const [warping, setWarping] = useState(true);
  const reduced = useRef(false);

  // Audio can fail for reasons outside this component's control (no
  // AudioContext, autoplay policy, a muted device). A win reveal that throws
  // because the chime didn't play is a worse bug than a silent one.
  const chimeSafely = useCallback(() => {
    try { playNotificationSound(); } catch { /* silent is fine */ }
  }, []);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced.current) {
      setSettled(true);
      setWarping(false);
      chimeSafely();
      return;
    }
    setSettled(false);
    setWarping(true);
    // A quiet tick per landing, and the full chime when the oil breaks loose.
    const taps = LANDINGS.slice(0, -1).map(t => setTimeout(chimeSafely, t));
    const burst = setTimeout(chimeSafely, T.flood);
    const calm = setTimeout(() => setWarping(false), T.flood + T.floodDur + 120);
    const done = setTimeout(() => setSettled(true), T.end);
    return () => { taps.forEach(clearTimeout); clearTimeout(burst); clearTimeout(calm); clearTimeout(done); };
  }, [runId, chimeSafely]);

  const words = useMemo(() => `You won ${schemeName}.`.split(' '), [schemeName]);

  const anim = (delay: number): React.CSSProperties => (settled ? {} : { animationDelay: `${delay}ms` });
  const cls = (name: string) => (settled ? '' : name);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" style={{ backgroundColor: '#fdf8f0' }}>
      {/* The warp. feTurbulence drives a displacement map over the flood so the
          oil spreads with an uneven, organic rim instead of as a geometric
          circle. Kept low: at high displacement it purées the gradient into
          mud rather than reading as liquid. SMIL animates it back to zero as
          the oil settles; where SMIL is unavailable the static scale of 0
          leaves a clean circle — still correct, just calmer. */}
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <filter id="oil-warp" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="2" seed="7" result="noise">
            <animate attributeName="baseFrequency" values="0.013;0.006;0.004"
                     dur={`${T.floodDur}ms`} begin={`${T.flood}ms`} fill="freeze" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="0"
                             xChannelSelector="R" yChannelSelector="G">
            <animate attributeName="scale" values="0;20;12;0"
                     dur={`${T.floodDur + 200}ms`} begin={`${T.flood}ms`} fill="freeze" />
          </feDisplacementMap>
        </filter>
      </svg>

      <div key={runId} className="absolute inset-0">
        {/* The oil. 130vmax clears every screen corner from the impact point
            while keeping the gradient ramp tight enough that the warm rim is
            actually on screen. */}
        <div
          className={`absolute rounded-full ${cls('animate-oil-flood')}`}
          style={{
            width: '130vmax', height: '130vmax', left: '50%', top: '46%',
            marginLeft: '-65vmax', marginTop: '-65vmax',
            background: 'radial-gradient(circle at 50% 50%, #f0d898 0%, #ddb060 45%, #c08a33 100%)',
            filter: warping && !settled ? 'url(#oil-warp)' : undefined,
            ...anim(T.flood),
          }}
          aria-hidden="true"
        />

        {!settled && (
          <>
            {/* The pool, growing one landing at a time. */}
            <div
              className="absolute rounded-[50%] animate-oil-pool"
              style={{
                width: 260, height: 34, left: '50%', top: '46%',
                marginLeft: -130, marginTop: -17,
                background: 'radial-gradient(ellipse at 50% 50%, #e6bd72 0%, #c8963c 40%, #a87830 100%)',
                boxShadow: '0 2px 14px rgba(168, 120, 48, 0.35)',
              }}
              aria-hidden="true"
            />

            {/* One drop per beat. */}
            {DROP_STARTS.map((start, i) => (
              <div
                key={`drop-${i}`}
                className="absolute animate-oil-drop"
                style={{
                  width: 18, height: 22, left: '50%', top: 96, marginLeft: -9,
                  borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                  background: 'linear-gradient(160deg, #e8b86d 0%, #c8963c 55%, #8a5f24 100%)',
                  ['--oil-fall' as string]: 'calc(46vh - 107px)',
                  ...anim(start),
                }}
                aria-hidden="true"
              />
            ))}

            {/* A rim thrown up at every landing. */}
            {LANDINGS.map((t, i) => (
              <div
                key={`crown-${i}`}
                className="absolute animate-oil-crown"
                style={{
                  // borderRadius 50%, not `rounded-full`: on a 56x16 box the
                  // Tailwind class produces a stadium, and a pill outline
                  // floating on the oil reads as a stray UI chip.
                  width: 56, height: 16, left: '50%', top: '46%', marginLeft: -28, marginTop: -8,
                  borderRadius: '50%',
                  border: '2px solid #f0d898',
                  ...anim(t),
                }}
                aria-hidden="true"
              />
            ))}

            {/* Only the last landing throws droplets — it's the one that floods. */}
            {SATELLITES.map((s, i) => (
              <div
                key={`sat-${i}`}
                className="absolute rounded-full animate-oil-satellite"
                style={{
                  width: s.size, height: s.size, left: '50%', top: '46%',
                  marginLeft: -s.size / 2, marginTop: -s.size / 2,
                  background: s.tone,
                  ['--oil-tx' as string]: `${s.tx}px`,
                  ['--oil-ty' as string]: `${s.ty}px`,
                  ...anim(T.flood + s.delay),
                }}
                aria-hidden="true"
              />
            ))}
          </>
        )}

        {/* Dark ink on the gold field — the inverse of the earlier version,
            which put pale text on a dark core and read as mud. */}
        <div className="absolute inset-x-0 px-6 text-center" style={{ top: '57%' }} role="status">
          <h1 className="flex flex-wrap justify-center gap-x-[9px] text-[26px] leading-9 font-bold" style={{ color: '#3a2208' }}>
            {words.map((w, i) => (
              <span
                key={`${w}-${i}`}
                className={`inline-block ${cls('animate-oil-word')}`}
                style={anim(T.words + i * T.wordStep)}
              >
                {w}
              </span>
            ))}
          </h1>

          <p
            className={`mt-4 mx-auto max-w-[330px] text-base leading-relaxed ${cls('animate-oil-rise')}`}
            style={{ color: '#5a3a12', ...anim(T.reward) }}
          >
            {rewardProductName ? (
              <>We're delivering your <span className="font-semibold" style={{ color: '#2a1806' }}>{rewardProductName}</span> free, every month, for the rest of this round.</>
            ) : (
              "We're delivering your last order free, every month, for the rest of this round."
            )}
          </p>

          <button
            onClick={onContinue}
            className={`mt-9 px-8 py-3 rounded-[18px] bg-brand-800 text-white text-sm font-semibold shadow-sm active:scale-[0.98] transition-transform ${cls('animate-oil-rise')}`}
            style={anim(T.button)}
          >
            Continue
          </button>
        </div>
      </div>

      {/* Dev-only: replay the sequence without needing to win again. */}
      {import.meta.env.DEV && (
        <button
          onClick={() => setRunId(n => n + 1)}
          className="absolute bottom-5 right-5 px-3.5 py-2 rounded-xl bg-brand-900/85 text-white text-xs font-semibold shadow-md hover:bg-brand-900 active:scale-95 transition-all"
        >
          ↻ Replay
        </button>
      )}
    </div>
  );
}
