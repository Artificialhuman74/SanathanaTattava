import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { playNotificationSound } from '../../../services/notificationSound';
import { Brandmark, LiftReveal, Medallion, MonthDots, OilFill, Sparks } from './beats';
import { AUTHORED_TOTAL, C, CUES, CX, CY, FONT_B, FONT_D, R, STAGE_H, STAGE_W, MOTION, clamp } from './motion';

/**
 * The win moment.
 *
 * Twelve month markers chase around the circle and pick up speed. The chase
 * lands on the top dot, flashes, and every dot turns to oil and falls inward.
 * The circle fills. The oil floods into a molten disc that turns like the
 * ghani stone — and then gravity inverts: the gold lifts off the screen and
 * leaves the winner's name behind in the space it vacated.
 *
 * Ported from the "Lucky Draw Winning Animation" design canvas. Everything is
 * keyed to one authored clock (see ./motion.ts) rather than to CSS animation
 * delays, which is what lets the camera, the halo and the oil level all move
 * as one continuous gesture instead of as a stack of independent timers.
 */

interface WinMomentRevealProps {
  /** Whoever won this month. The name the gold uncovers, which is not
   *  necessarily the person watching. */
  winnerName: string;
  /** True when the viewer is the winner. The draw is one moment the whole
   *  scheme shares; only what comes after it differs. */
  isMe: boolean;
  /** False when the month drew nobody: everyone had already won, or no one
   *  ordered in time. The ceremony still runs; the result is just honest. */
  hasWinner?: boolean;
  schemeName: string;
  rewardProductName: string | null;
  /** Deadline for entering next month's draw, ISO. Shown to everyone who
   *  didn't win, because for them the next draw is the point. */
  nextEntryDeadline?: string | null;
  onContinue: () => void;
}

/** The band of the 1080x1920 field that must always be on screen: the wordmark
 *  down to the bottom of the claim button. Fitting to this rather than to the
 *  full field keeps the circle optically centred on short and wide viewports
 *  alike, with the background bleeding into whatever is left over. */
const SAFE_TOP = 96;
const SAFE_BOTTOM = 1500;
const SAFE_H = SAFE_BOTTOM - SAFE_TOP;
const ANCHOR_Y = (SAFE_TOP + SAFE_BOTTOM) / 2;

/** Above this the composition stops growing; past roughly 1:1 the type reads as
 *  a billboard rather than as a screen. */
const MAX_SCALE = 1.15;

const GROUND = `radial-gradient(70% 120% at 50% 50%, ${C.green} 0%, ${C.greenLo} 44%, ${C.deep} 100%)`;

function fitScale() {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.innerWidth / STAGE_W, window.innerHeight / SAFE_H, MAX_SCALE);
}

export default function WinMomentReveal({
  winnerName,
  isMe,
  hasWinner = true,
  schemeName,
  rewardProductName,
  nextEntryDeadline,
  onContinue,
}: WinMomentRevealProps) {
  // Bumping this restarts the clock from zero. It is what the dev replay
  // button drives, and what a skip resets if the user replays afterwards.
  const [runId, setRunId] = useState(0);
  const [T, setT] = useState(0);
  const [scale, setScale] = useState(fitScale);
  const skipped = useRef(false);
  const chimes = useRef<number[]>([]);

  // Audio can fail for reasons outside this component's control (no
  // AudioContext, autoplay policy, a muted device). A win reveal that throws
  // because the chime didn't play is a worse bug than a silent one.
  const chimeSafely = useCallback(() => {
    try { playNotificationSound(); } catch { /* silent is fine */ }
  }, []);

  useLayoutEffect(() => {
    const onResize = () => setScale(fitScale());
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  /** Jump to the settled frame. Used by the skip affordance and by reduced
   *  motion — the destination is the same, only the route differs.
   *  Chimes still queued belong to beats that are no longer coming, so they
   *  are dropped and the one that matters is played now instead. */
  const settleNow = useCallback(() => {
    skipped.current = true;
    chimes.current.forEach(clearTimeout);
    chimes.current = [];
    setT(AUTHORED_TOTAL);
  }, []);

  useEffect(() => {
    skipped.current = false;
    setT(0);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settleNow();
      chimeSafely();
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      if (skipped.current) return;
      const elapsed = (now - t0) / 1000;
      if (elapsed >= AUTHORED_TOTAL) {
        // Hold on the settled frame rather than looping. Stopping the loop
        // here also stops the repaint on a screen the user may sit on for a
        // while before tapping through.
        setT(AUTHORED_TOTAL);
        return;
      }
      setT(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // A soft tap when the draw lands on the twelfth dot, and the full chime as
    // the name arrives out of the gold.
    chimes.current = [
      window.setTimeout(chimeSafely, (CUES.Drop + 0.3) * 1000),
      window.setTimeout(chimeSafely, (CUES.Reveal + 0.6) * 1000),
    ];

    return () => {
      cancelAnimationFrame(raf);
      chimes.current.forEach(clearTimeout);
      chimes.current = [];
    };
  }, [runId, chimeSafely, settleNow]);

  const deadlineLabel = nextEntryDeadline
    ? new Date(nextEntryDeadline).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long' })
    : 'the next draw';

  // ── One continuous camera: settles in, pushes on the reveal, eases back out
  const base = MOTION.enter(1.07, 1.0, 0, CUES.Pour)(T);
  const push = MOTION.draw(0, 0.06, CUES.Bloom + 0.6, CUES.Reveal + 1.4)(T)
    + MOTION.draw(0, -0.06, CUES.Settle - 0.6, AUTHORED_TOTAL - 0.4)(T);
  const drift = Math.sin(T * 0.42) * 6;
  const camY = MOTION.draw(0, -70, CUES.Bloom, CUES.Reveal + 1.2)(T)
    + MOTION.draw(0, 70, CUES.Settle - 0.4, AUTHORED_TOTAL - 0.5)(T);

  // The opening seam only. The canvas closed on the same frame it opened on
  // because it looped; here the piece ends on the reveal and stays there.
  const seam = MOTION.enter(0, 1, 0, 0.45)(T);

  const waitOut = MOTION.enter(1, 0, CUES.Drop - 0.2, CUES.Drop + 0.8)(T);
  const chrome = 0.35 + 0.65 * MOTION.enter(1, 0, CUES.Bloom, CUES.Reveal)(T);
  const ringFade = MOTION.enter(1, 0, CUES.Bloom + 0.55, CUES.Bloom + 1.3)(T);
  const head = MOTION.draw(0, 1, 0.35, CUES.Drop + 0.45)(T);
  const drain = MOTION.enter(0, 1, CUES.Drop + 0.5, CUES.Pour + 1.7)(T);
  const level = MOTION.enter(0, 1, CUES.Drop + 0.62, CUES.Bloom - 0.1)(T);
  const flash = Math.min(
    MOTION.enter(0, 1, CUES.Drop + 0.12, CUES.Drop + 0.45)(T),
    MOTION.enter(1, 0, CUES.Drop + 0.45, CUES.Drop + 1.4)(T),
  );
  const halo = 0.25 + 0.75 * MOTION.enter(0, 1, CUES.Bloom, CUES.Reveal)(T) + flash * 0.8;
  const rewardIn = MOTION.enter(0, 1, CUES.Settle - 0.6, CUES.Settle + 0.4)(T);
  const btn = clamp(MOTION.pop(0, 1, CUES.Settle + 0.25, CUES.Settle + 1.1)(T), 0, 1);

  // The reveal blocks the screen for thirteen seconds. Anywhere on the ground
  // jumps to the end, so nobody is held by an animation they have already
  // seen — the claim button sits above this and is not affected. The prompt
  // shows only while the piece is still building; past that it has been on
  // screen long enough to have been read, and the reveal should be clean.
  const skippable = T > 1.2 && btn < 0.5;
  const showSkipHint = skippable && T < CUES.Reveal;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      style={{ background: GROUND }}
      onClick={skippable ? settleNow : undefined}
    >
      <div
        style={{
          position: 'absolute', left: '50%', top: '50%',
          width: STAGE_W, height: STAGE_H,
          marginLeft: -CX, marginTop: -ANCHOR_Y,
          transformOrigin: `${CX}px ${ANCHOR_Y}px`,
          transform: `scale(${scale})`,
        }}
      >
        {/* The halo behind everything — it is what makes the flash read as
            light in the room rather than as a brighter dot. */}
        <div aria-hidden="true" style={{
          position: 'absolute', left: CX - 520, top: CY - 520, width: 1040, height: 1040,
          borderRadius: '50%', opacity: halo,
          background: 'radial-gradient(circle, rgba(216,169,63,0.30), rgba(216,169,63,0.06) 46%, rgba(216,169,63,0) 70%)',
        }} />

        <div style={{ position: 'absolute', inset: 0, transform: `translateY(${camY + drift}px) scale(${base + push})` }}>
          <Brandmark dim={chrome} />

          {/* Before the draw lands. */}
          <div aria-hidden="true" style={{
            position: 'absolute', left: 0, right: 0, top: CY - 96, textAlign: 'center', opacity: waitOut,
          }}>
            <div style={{
              font: `600 26px ${FONT_B}`, letterSpacing: '0.4em', textTransform: 'uppercase',
              color: 'rgba(246,241,228,0.45)',
            }}>Lucky Draw</div>
            <div style={{ font: `500 76px ${FONT_D}`, color: C.cream, marginTop: 30 }}>Drawing now</div>
            <div style={{ font: `400 30px ${FONT_B}`, color: 'rgba(246,241,228,0.5)', marginTop: 22 }}>
              {schemeName}
            </div>
          </div>

          <MonthDots r={R + 96} innerR={R * 0.3} head={head} drain={drain} glow={flash}
            opacity={0.9 + 0.1 * flash} />

          <OilFill T={T} level={level} fade={ringFade} />
          <Medallion T={T} start={CUES.Bloom} fillEnd={CUES.Bloom + 1.1} exitAt={CUES.Reveal}
            spokes={MOTION.enter(0, 1, CUES.Bloom + 0.5, CUES.Reveal)(T)} />

          <div role="status" aria-live="polite">
            <LiftReveal T={T} start={CUES.Reveal} name={winnerName} hasWinner={hasWinner} />

            <div style={{
              position: 'absolute', left: 150, right: 150, top: CY + 150,
              textAlign: 'center', opacity: rewardIn,
              transform: `translateY(${(1 - rewardIn) * 18}px)`,
            }}>
              <div style={{
                font: `600 26px ${FONT_B}`, letterSpacing: '0.34em', textTransform: 'uppercase',
                color: 'rgba(216,169,63,0.85)',
              }}>{schemeName}</div>
              <p style={{
                font: `400 34px ${FONT_B}`, lineHeight: 1.5, color: C.creamDim, margin: '26px 0 0',
              }}>
                {!hasWinner ? (
                  /* The wheel in the animation has eight spokes and it just
                     stopped on one with no name on it. Saying so is warmer
                     than "no winner", and truer to what was watched. */
                  <>No one ordered in time, so the wheel stopped on an empty spoke.
                    Order before <span style={{ color: C.cream, fontWeight: 600 }}>{deadlineLabel}</span>
                    {' '}and the next one could carry your name.</>
                ) : isMe ? (
                  rewardProductName ? (
                    <>We&rsquo;re delivering your <span style={{ color: C.cream, fontWeight: 600 }}>{rewardProductName}</span> free,
                      every month, for the rest of this round.</>
                  ) : (
                    'We’re delivering your last order free, every month, for the rest of this round.'
                  )
                ) : (
                  <>Not this month. Order before{' '}
                    <span style={{ color: C.cream, fontWeight: 600 }}>{deadlineLabel}</span>
                    {' '}to be in the next draw.</>
                )}
              </p>
            </div>
          </div>

          <Sparks T={T} start={CUES.Reveal - 0.1} count={26} cy={CY + 120} spread={620} rise={900} opacity={1} />

          <button
            onClick={onContinue}
            style={{
              position: 'absolute', left: 140, right: 140, top: CY + 470,
              height: 108, borderRadius: 54, border: 'none', background: C.gold,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              font: `600 36px ${FONT_B}`, color: '#2A1E05', letterSpacing: '0.02em',
              opacity: btn, transform: `scale(${0.94 + 0.06 * btn})`,
              pointerEvents: btn > 0.5 ? 'auto' : 'none',
              boxShadow: '0 18px 60px rgba(216,169,63,0.35)',
              cursor: 'pointer',
            }}
          >
            {isMe && hasWinner ? 'Claim your reward' : 'Shop now to enter'}
          </button>
        </div>

        {/* Vignette: keeps the eye on the circle and hides the stage edges
            where the composition meets the bled background. */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(130% 90% at 50% 46%, rgba(0,0,0,0) 52%, rgba(2,14,9,0.55) 100%)',
        }} />
      </div>

      {/* Open on the ground colour, so the first frame is a held breath rather
          than a hard cut into motion. */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, background: C.deep, opacity: 1 - seam, pointerEvents: 'none',
      }} />

      {showSkipHint && (
        <div
          className="absolute inset-x-0 bottom-8 text-center text-xs tracking-[0.28em] uppercase pointer-events-none"
          style={{ color: 'rgba(246,241,228,0.35)' }}
        >
          Tap to skip
        </div>
      )}

      {import.meta.env.DEV && (
        <button
          onClick={(e) => { e.stopPropagation(); setRunId(n => n + 1); }}
          className="absolute bottom-5 right-5 px-3.5 py-2 rounded-xl bg-black/40 text-white text-xs font-semibold shadow-md hover:bg-black/60 active:scale-95 transition-all"
        >
          ↻ Replay
        </button>
      )}
    </div>
  );
}
