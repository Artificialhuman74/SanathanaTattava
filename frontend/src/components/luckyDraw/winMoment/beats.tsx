import React, { useState } from 'react';
import OilSurfaceGL from './OilSurfaceGL';
import { C, CX, CY, FONT_B, FONT_D, MOTION, R, clamp } from './motion';

/**
 * The visual beats. Each is a pure function of the authored time `T` plus the
 * few scalars the scene has already derived from it — none of them own state,
 * none of them animate themselves, so scrubbing the clock backwards would
 * reproduce an earlier frame exactly.
 */

/** The wordmark that sits above the circle. The design canvas drew a mock iOS
 *  status bar here too; inside a real app that would be a second, wrong status
 *  bar, so only the brand line survives the port. */
export function Brandmark({ dim }: { dim: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', top: 128, left: 0, right: 0, opacity: dim,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
      }}
    >
      <div style={{
        font: `600 26px ${FONT_B}`, letterSpacing: '0.34em',
        color: 'rgba(246,241,228,0.5)', textTransform: 'uppercase',
      }}>Sanathana Tattva</div>
      <div style={{ width: 64, height: 2, background: 'rgba(216,169,63,0.55)' }} />
    </div>
  );
}

interface MonthDotsProps {
  r: number;
  innerR: number;
  /** 0..1 — the glow travelling clockwise from 1 o'clock to 12 o'clock,
   *  revealing each dot as it arrives. */
  head: number;
  /** 0..1 — the dots falling inward as oil. */
  drain: number;
  opacity: number;
  glow: number;
}

/** Twelve month markers around the circle; the one the chase is passing
 *  breathes, and the whole ring drains inward when the draw lands. */
export function MonthDots({ r, innerR, head, drain, opacity, glow }: MonthDotsProps) {
  const dots: React.ReactNode[] = [];
  const headDeg = 30 + head * 330;

  for (let i = 0; i < 12; i++) {
    const deg = i === 0 ? 360 : i * 30; // 0 is 12 o'clock, and arrives last
    const rev = clamp((headDeg - deg + 20) / 20, 0, 1);
    if (rev <= 0.001 && drain <= 0) continue;
    const arrive = Math.exp(-Math.max(headDeg - deg, 0) / 46);
    const lit = rev * (0.5 + 0.5 * arrive);

    const a = ((-90 + deg) * Math.PI) / 180;
    const d = clamp((drain - i * 0.024) / 0.74, 0, 1);
    const de = d * d * (3 - 2 * d);
    const rad = r - (r - innerR) * de;
    const x = CX + Math.cos(a) * rad;
    const y = CY + Math.sin(a) * rad;
    const s = (10 + lit * 12 + de * 14) * (1 - Math.pow(de, 3.2)) * (0.3 + 0.7 * rev);
    if (s <= 0.4) continue;

    dots.push(
      <div key={i} style={{
        position: 'absolute', left: x - s / 2, top: y - s / 2, width: s, height: s,
        borderRadius: de > 0.05 ? '50% 50% 50% 50% / 60% 60% 40% 40%' : '50%',
        background: `radial-gradient(circle at 36% 30%, ${C.goldHi}, ${C.gold} 58%, ${C.goldLo})`,
        opacity: Math.max(rev * (0.45 + 0.55 * lit), de),
        transform: `rotate(${deg}deg) scaleY(${1 + de * 1.3})`,
        boxShadow: `0 0 ${8 + lit * 40 + de * 40 + glow * 20}px rgba(216,169,63,${0.2 + lit * 0.7})`,
      }} />
    );
  }

  return <div aria-hidden="true" style={{ position: 'absolute', inset: 0, opacity }}>{dots}</div>;
}

interface SparksProps {
  T: number;
  start: number;
  count: number;
  cy: number;
  spread: number;
  rise: number;
  opacity: number;
}

/** Gold specks rising off the reveal. Deterministic from T — no RNG per frame,
 *  so the moment plays identically every time instead of shimmering randomly. */
export function Sparks({ T, start, count, cy, spread, rise, opacity }: SparksProps) {
  if (opacity <= 0.001) return null;
  const items: React.ReactNode[] = [];

  for (let i = 0; i < count; i++) {
    const seed = ((i * 9301 + 49297) % 233280) / 233280;
    const seed2 = ((i * 4177 + 8191) % 65521) / 65521;
    const t = clamp((T - start - seed * 0.5) / 2.6, 0, 1);
    if (t <= 0) continue;
    const x = CX + (seed - 0.5) * spread * (0.4 + seed2) + Math.sin(T * 1.6 + i * 2.3) * 22;
    const y = cy - t * rise * (0.5 + seed2) - seed2 * 40;
    const s = 4 + seed2 * 9;
    items.push(
      <div key={i} style={{
        position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: '50%',
        background: seed2 > 0.6 ? C.goldHi : C.gold,
        opacity: (1 - t) * opacity,
        boxShadow: `0 0 ${10 + s}px rgba(216,169,63,0.8)`,
      }} />
    );
  }

  return <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{items}</div>;
}

/** The twelve drops become oil and the circle fills. The surface itself is
 *  WebGL; the splash specks thrown off the crest stay in the DOM, where they
 *  cost nothing and read crisply at any scale. */
export function OilFill({ T, level, fade }: { T: number; level: number; fade: number }) {
  // If the surface can't be drawn, the circle still has to fill — a missing
  // WebGL context should cost the reveal its texture, not its story beat.
  const [flat, setFlat] = useState(false);
  const onUnavailable = React.useCallback(() => setFlat(true), []);

  if (fade <= 0.002 || level <= 0.002) return null;

  const D = R * 2;
  const calm = 1 - Math.pow(level, 1.4);
  const rim = 0.1 + level * 0.9;

  const splash: React.ReactNode[] = [];
  for (let i = 0; i < 12; i++) {
    const sd = ((i * 7919) % 997) / 997;
    const sd2 = ((i * 6151) % 863) / 863;
    const cyc = 1.1 + sd2 * 0.9;
    const ph = ((T - sd * cyc) % cyc) / cyc;
    if (ph < 0 || ph > 1 || calm < 0.12) continue;
    const x0 = 70 + sd * (D - 140);
    const y0 = D - level * D;
    const sz = 5 + sd2 * 7;
    splash.push(
      <div key={i} style={{
        position: 'absolute', left: x0 - sz / 2,
        top: y0 - (ph * (60 + sd2 * 90) - ph * ph * (90 + sd * 70)),
        width: sz, height: sz * (1 + ph * 0.8), borderRadius: '50%',
        background: sd2 > 0.5 ? C.goldHi : C.gold,
        opacity: (1 - ph) * calm * 0.9,
        boxShadow: `0 0 ${8 + sz}px rgba(247,227,161,0.75)`,
      }} />
    );
  }

  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: CX - R, top: CY - R, width: D, height: D, opacity: fade }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        border: `2px solid rgba(216,169,63,${rim})`,
        boxShadow: `0 0 ${60 * level}px rgba(216,169,63,${0.4 * level})`,
      }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden' }}>
        {flat ? (
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: `${level * 100}%`,
            background: `linear-gradient(to bottom, ${C.goldHi} 0%, ${C.gold} 34%, ${C.goldLo} 100%)`,
            borderTop: `3px solid ${C.goldHi}`,
          }} />
        ) : (
          <OilSurfaceGL size={D} T={T} level={level} calm={calm} onUnavailable={onUnavailable} />
        )}
        {splash}
      </div>
    </div>
  );
}

interface MedallionProps {
  T: number;
  start: number;
  fillEnd: number;
  spokes: number;
  exitAt: number;
}

/** The ring floods into a molten disc that turns like the ghani stone, then
 *  evaporates upward — rising, expanding, blurring and thinning out, so the
 *  gold leaves the frame rather than being cut from it. */
export function Medallion({ T, start, fillEnd, spokes, exitAt }: MedallionProps) {
  const fill = MOTION.enter(0, 1, start, fillEnd)(T);
  if (fill <= 0.001) return null;

  const ev = MOTION.draw(0, 1, exitAt, exitAt + 1.9)(T);
  if (ev >= 0.999) return null;

  const spin = (T - start) * 26;
  const shimmer = (T * 60) % 360;
  const s = MOTION.pop(0.86, 1, start, start + 0.9)(T) * (1 + ev * 0.16);
  const cut = 100 - ev * 128;
  const wipe = ev > 0
    ? `linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) ${Math.max(cut - 26, 0)}%, rgba(0,0,0,0) ${Math.max(cut, 2)}%)`
    : 'none';

  return (
    <div aria-hidden="true" style={{
      position: 'absolute', left: CX - R, top: CY - R, width: R * 2, height: R * 2,
      borderRadius: '50%', overflow: 'hidden',
      transform: `translateY(${-ev * 300}px) scale(${s})`,
      opacity: fill * (1 - Math.pow(ev, 1.5)),
      filter: ev > 0 ? `blur(${ev * 26}px)` : 'none',
      WebkitMaskImage: wipe,
      maskImage: wipe,
      background: `conic-gradient(from ${shimmer}deg, ${C.goldLo}, ${C.goldHi} 18%, ${C.gold} 34%, ${C.goldLo} 52%, ${C.goldHi} 72%, ${C.gold} 88%, ${C.goldLo})`,
      boxShadow: `0 0 140px rgba(216,169,63,0.45), inset 0 0 80px rgba(255,255,255,0.28)`,
    }}>
      <div style={{
        position: 'absolute', inset: 0, opacity: spokes * 0.5,
        transform: `rotate(${spin}deg)`,
        background: 'repeating-conic-gradient(from 0deg, rgba(120,80,10,0.18) 0deg 2deg, rgba(120,80,10,0) 2deg 45deg)',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 36% 28%, rgba(255,255,255,0.55), rgba(255,255,255,0) 46%)',
      }} />
    </div>
  );
}

/** The payoff: the pooled gold lifts off against gravity and the winner's name
 *  is left behind in the space it vacated. The letterspacing tightens as the
 *  name arrives, so it reads as settling rather than as fading in. */
export function LiftReveal({
  T, start, name, hasWinner = true,
}: { T: number; start: number; name: string; hasWinner?: boolean }) {
  const nameIn = MOTION.enter(0, 1, start + 0.55, start + 2.0)(T);
  const kern = MOTION.enter(0.18, 0.03, start + 0.55, start + 2.4)(T);

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, top: CY - 210, textAlign: 'center', opacity: nameIn,
    }}>
      <div style={{
        font: `600 26px ${FONT_B}`, letterSpacing: '0.42em', textTransform: 'uppercase',
        color: 'rgba(216,169,63,0.9)', marginBottom: 34,
      }}>
        {/* A month that drew nobody is still a draw, so the label stops
            promising a winner rather than the reveal pretending there is one. */}
        {hasWinner ? <>This month&rsquo;s winner</> : <>This month&rsquo;s draw</>}
      </div>
      <div style={{
        font: `500 108px ${FONT_D}`, color: C.cream, lineHeight: 1.06,
        // Wraps rather than running off the frame: a long name at 108px is
        // wider than the field, and so is the no-winner line.
        padding: '0 90px', textWrap: 'balance',
        letterSpacing: `${kern}em`, transform: `translateY(${(1 - nameIn) * 26}px)`,
      } as React.CSSProperties}>{hasWinner ? name : 'No one.'}</div>
      <div style={{
        width: 120 + nameIn * 140, height: 3, margin: '44px auto 0',
        background: `linear-gradient(to right, rgba(216,169,63,0), ${C.gold}, rgba(216,169,63,0))`,
      }} />
    </div>
  );
}
