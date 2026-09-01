import React, { useEffect, useId, useRef } from 'react';

interface ChakraIconProps {
  size?: number;
  className?: string;
  /**
   * 'static'  — no motion.
   * 'reveal'  — one deliberate spin-and-settle (enrollment confirmation).
   * 'idle'    — a slow continuous spin (pending/loading).
   * 'settle'  — pick the spin up wherever it is and coast to a stop, landing
   *             with the spokes aligned. Switch to this from 'idle'.
   */
  motion?: 'static' | 'reveal' | 'idle' | 'settle';
  /** Fired when a 'settle' has come to rest (immediately under reduced motion). */
  onSettled?: () => void;
  /** Milliseconds per revolution while spinning. */
  spinMs?: number;
  style?: React.CSSProperties;
}

/** One revolution of the idle spin. Brisk: this reads as a wheel being
 *  driven, not as an ornament turning over. */
const DEFAULT_SPIN_MS = 1100;

/** Eight spokes, so the wheel is identical every 45°: any multiple is "aligned". */
const SPOKE_DEG = 45;

/**
 * The deceleration curve, and its slope at t=0.
 *
 * The slope is what makes the handoff invisible. A cubic-bezier's initial rate
 * is y1/x1 times its average rate, so knowing it lets the settle be launched at
 * exactly the speed the wheel is already turning. Mismatch it and the wheel
 * visibly lurches or stalls at the moment the spin gives way.
 */
const SETTLE_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)';
const SETTLE_SLOPE = 1 / 0.33;

/** How long a settle should feel; the distance is derived from it, not fixed.
 *  Kept short because the wheel still has to fly to its final position after
 *  this, and the two beats together are what the viewer waits through. */
const SETTLE_TARGET_MS = 450;
/* Guard rails only. They must sit OUTSIDE the range the maths actually
 * produces, or the clamp overrides the velocity match and the wheel stalls at
 * the moment the spin hands over: with this spin the natural range is roughly
 * 240-660ms, so a 380ms floor was quietly distorting half of it. */
const SETTLE_MIN_MS = 200;
const SETTLE_MAX_MS = 900;

/** Never so short that the wheel appears to snap onto its mark. */
const MIN_TRAVEL_DEG = 12;

/** The roll-back at the end of a settle. */
const RECOIL_DEG = 7;
const RECOIL_MS = 260;

/**
 * Where a wheel turning at the idle speed should come to rest, and how long
 * getting there should take.
 *
 * The distance is whatever a velocity-matched deceleration covers in roughly
 * SETTLE_TARGET_MS, rounded to the nearest spoke so the wheel lands aligned;
 * the duration is then recomputed from that rounded distance so the launch
 * speed still matches however far the rounding moved the mark.
 */
function planSettle(fromDeg: number, spinMs: number) {
  const speed = 360 / spinMs;                                   // deg per ms
  const ideal = (speed * SETTLE_TARGET_MS) / SETTLE_SLOPE;
  let target = Math.round((fromDeg + ideal) / SPOKE_DEG) * SPOKE_DEG;
  if (target - fromDeg < MIN_TRAVEL_DEG) target += SPOKE_DEG;
  const travel = target - fromDeg;
  const duration = Math.min(Math.max((travel * SETTLE_SLOPE) / speed, SETTLE_MIN_MS), SETTLE_MAX_MS);
  return { target, duration };
}

/**
 * The wheel/chakra mark for the lucky-draw feature — a deliberate custom
 * icon rather than a generic lucide gift/star icon (see
 * LUCKY_DRAW_FEATURE_SPEC.md §11 and PRODUCT.md Design Principle #1: the
 * ghani's own wheel is the brand's most distinctive visual, never
 * abstracted into a generic icon). Everything else on these screens still
 * uses the project's standard lucide-react set.
 *
 * The geometry and the wood are the cart wheel the loader turns, so the wheel
 * that spins while a page loads and the one sitting still afterwards are the
 * same object. Drawn in SVG rather than the loader's stack of divs because
 * this mark also has to hold up at 18px in a card header, where the loader's
 * grain lines and blur would turn to mud.
 *
 * One spoke points straight up. Eight spokes means the wheel repeats every
 * 45 degrees, which is also what lets the spin settle onto an aligned stop.
 */
export default function ChakraIcon({
  size = 24,
  className = '',
  motion = 'static',
  onSettled,
  spinMs = DEFAULT_SPIN_MS,
  style,
}: ChakraIconProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const spin = useRef<Animation | null>(null);
  /** The angle the spin had reached when it was handed over. */
  const handoffDeg = useRef(0);
  /** Held in a ref so an inline callback prop can't restart the animation. */
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    const el = svgRef.current;
    if (!el || (motion !== 'idle' && motion !== 'settle')) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (motion === 'settle') settled.current?.();
      return;
    }

    if (motion === 'idle') {
      const a = el.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
        { duration: spinMs, iterations: Infinity, easing: 'linear' },
      );
      spin.current = a;
      return () => {
        // Read the live angle BEFORE letting go of the animation. Cancelling
        // first drops the wheel back to 0°, which is the jerk this exists to
        // remove; the settle needs to know where the wheel actually is.
        handoffDeg.current = (((Number(a.currentTime) || 0) / spinMs) * 360) % 360;
        a.cancel();
        spin.current = null;
      };
    }

    const { target, duration } = planSettle(handoffDeg.current, spinMs);
    /* Past the mark, then back onto it. A loaded cart wheel does not simply
     * halt: the rim carries past, the weight in the hub takes up, and it rocks
     * back. Small and slow, so it reads as mass settling rather than a spring
     * bouncing, which PRODUCT.md rules out. */
    const total = duration + RECOIL_MS;
    const a = el.animate(
      [
        { transform: `rotate(${handoffDeg.current}deg)`, offset: 0, easing: SETTLE_EASE },
        { transform: `rotate(${target + RECOIL_DEG}deg)`, offset: duration / total, easing: 'cubic-bezier(0.4, 0, 0.3, 1)' },
        { transform: `rotate(${target}deg)`, offset: 1 },
      ],
      { duration: total, fill: 'forwards' },
    );
    // Landing on a multiple of 45° means the resting wheel is indistinguishable
    // from an un-rotated one, so nothing shifts if the animation is later
    // dropped and the element falls back to its untransformed state.
    const finish = () => { handoffDeg.current = 0; settled.current?.(); };
    a.addEventListener('finish', finish);
    return () => { a.removeEventListener('finish', finish); a.cancel(); };
  }, [motion, spinMs]);

  const motionClass = motion === 'reveal'
    ? 'motion-safe:animate-chakra-spin-settle motion-reduce:animate-fade-in'
    : '';

  /* Eight tapered spokes: broad where they meet the nave, narrow at the rim,
   * which is what makes it read as a cart wheel rather than a bicycle one.
   * The first sits at 0deg, straight up. */
  const spokes = Array.from({ length: 8 }, (_, i) => i * SPOKE_DEG);

  const RIM_OUTER = 47;
  const RIM_INNER = 38;    // where the face begins and the spokes end
  const HUB_R = 11.5;
  const W_HUB = 5.2;       // spoke half-width at the nave
  const W_RIM = 1.5;       // spoke half-width at the felloe

  const spoke = [
    `${50 - W_HUB},${50 - HUB_R + 2}`,
    `${50 + W_HUB},${50 - HUB_R + 2}`,
    `${50 + W_RIM},${50 - RIM_INNER}`,
    `${50 - W_RIM},${50 - RIM_INNER}`,
  ].join(' ');

  /* Gradient ids have to be unique per instance: several wheels share a page,
   * and duplicated ids make every one of them paint from the first. */
  const uid = useId().replace(/:/g, '');
  const rimId = `cw-rim-${uid}`;
  const spokeId = `cw-spoke-${uid}`;
  const hubId = `cw-hub-${uid}`;

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={`${motionClass} ${className}`}
      style={{ transformOrigin: '50% 50%', ...style }}
      aria-hidden="true"
    >
      <defs>
        {/* Light from the upper left, so the felloe turns from lit to shadow
            across its width the way a rounded wooden rim does. */}
        <linearGradient id={rimId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6B4A2C" />
          <stop offset="38%" stopColor="#4A3020" />
          <stop offset="100%" stopColor="#2B1B0E" />
        </linearGradient>
        {/* Across the spoke, not along it: the pale core is the round face of
            the timber catching the light. */}
        <linearGradient id={spokeId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4A2E14" />
          <stop offset="22%" stopColor="#7A4B23" />
          <stop offset="50%" stopColor="#A9793F" />
          <stop offset="78%" stopColor="#7A4B23" />
          <stop offset="100%" stopColor="#4A2E14" />
        </linearGradient>
        <radialGradient id={hubId} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#B98F55" />
          <stop offset="55%" stopColor="#8A5A2E" />
          <stop offset="100%" stopColor="#4A2E14" />
        </radialGradient>
      </defs>

      {/* The cream face the spokes sit on. */}
      <circle cx="50" cy="50" r={RIM_INNER + 1} fill="#F7F1E8" />

      {/* The felloe. Stroked so its inner edge lands exactly where the spokes
          end, with a hairline inside it for the bevel the photo shows. */}
      <circle
        cx="50" cy="50" r={(RIM_OUTER + RIM_INNER) / 2}
        stroke={`url(#${rimId})`} strokeWidth={RIM_OUTER - RIM_INNER}
      />
      <circle cx="50" cy="50" r={RIM_INNER + 0.5} stroke="#2B1B0E" strokeWidth="0.8" opacity="0.55" />
      <circle cx="50" cy="50" r={RIM_OUTER - 0.4} stroke="#8A6039" strokeWidth="0.7" opacity="0.35" />

      {spokes.map(angle => (
        <polygon
          key={angle}
          points={spoke}
          fill={`url(#${spokeId})`}
          transform={`rotate(${angle} 50 50)`}
        />
      ))}

      {/* The nave, domed. */}
      <circle cx="50" cy="50" r={HUB_R} fill={`url(#${hubId})`} />
      <circle cx="50" cy="50" r={HUB_R} fill="none" stroke="#3A2410" strokeWidth="0.9" opacity="0.5" />
    </svg>
  );
}
