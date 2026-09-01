import React from 'react';
import ChakraIcon from './ChakraIcon';

interface WagonWheelLoaderProps {
  /** Overall width and height in px; the wheel and its halo scale together. */
  size?: number;
  /** Seconds per revolution. */
  speed?: number;
  /**
   * 'spin'   — turning, the loading state.
   * 'settle' — brake from wherever it is now and come to rest with the spokes
   *            aligned. Switch to this when the wait is over.
   */
  motion?: 'spin' | 'settle';
  /** Fired once the wheel has stopped (immediately under reduced motion). */
  onSettled?: () => void;
  label?: string;
  className?: string;
  /** Applied to the wheel itself, not to the halo around it. See below. */
  style?: React.CSSProperties;
}

/** The wheel's share of the box; the rest is the halo's room to breathe. */
const WHEEL_RATIO = 0.63;

/**
 * The lucky draw's loader: the wheel, turning, inside a warm halo.
 *
 * It draws nothing itself. The wheel is `ChakraIcon` — the same component that
 * renders the stationary mark on the loaded page — at a larger size with its
 * spin running.
 *
 * That matters more than it sounds. This used to be its own artwork, a stack
 * of divs with conic-gradient rims and a blurred motion smear, while the mark
 * it handed over to was an SVG. Two drawings of "the same" wheel, with
 * different rim weights, spoke tapers and face colours. Both carried the same
 * `viewTransitionName`, so the browser dutifully cross-faded one into the
 * other, and the wheel appeared to glitch and redraw at the exact moment it
 * was meant to be settling into place. Nothing was wrong with the animation;
 * the two ends of it were different pictures.
 *
 * One component, so there is nothing to cross-fade: the wheel that spins and
 * the wheel that rests are the same object at two sizes, leaving the
 * transition only distance and scale to animate.
 *
 * The merge costs the blurred motion smear the old artwork had, which cannot
 * follow a component that owns its own rotation. At this size and speed the
 * spokes read cleanly without it.
 */
export default function WagonWheelLoader({
  size = 140,
  speed = 1.1,
  motion = 'spin',
  onSettled,
  label,
  className = '',
  style,
}: WagonWheelLoaderProps) {
  return (
    <div className={`flex flex-col items-center ${className}`} role="status" aria-label={label || 'Loading'}>
      <div
        data-loader="wheel"
        style={{
          position: 'relative', width: size, height: size,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* Warm halo, breathing under the wheel. Deliberately NOT part of the
            shared-element morph: it belongs to the waiting state, so it fades
            with the rest of the page rather than shrinking into the mark. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(106,68,35,0.25) 0%, rgba(106,68,35,0.07) 55%, rgba(106,68,35,0) 75%)',
            animation: 'wheelHalo 1.8s ease-in-out infinite',
          }}
        />

        {/* `style` lands here, on the wheel, so a viewTransitionName from the
            page morphs wheel to wheel rather than halo-box to mark. */}
        <ChakraIcon
          size={Math.round(size * WHEEL_RATIO)}
          motion={motion === 'settle' ? 'settle' : 'idle'}
          onSettled={onSettled}
          spinMs={speed * 1000}
          style={{ filter: 'drop-shadow(0 3px 6px rgba(120,80,20,0.25))', ...style }}
        />
      </div>

      {label && <p className="text-sm text-slate-600 mt-2">{label}</p>}
    </div>
  );
}
