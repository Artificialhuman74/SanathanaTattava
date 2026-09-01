import React, { useEffect, useRef, useState } from 'react';
import { useRive, useStateMachineInput, Layout, Fit, Alignment } from '@rive-app/react-canvas';
import { playNotificationSound } from '../../services/notificationSound';

/**
 * The win reveal, driven by a Rive state machine.
 *
 * This is the real build: a rigged vector animation with squash, stretch and
 * mesh deformation that CSS transforms cannot express. The component owns the
 * *sequence* (when each pour lands, when the oil breaks loose); the .riv owns
 * the *motion* (how the drop deforms, how the pool swells, how it floods).
 *
 * If the .riv is missing or fails to load, `onUnavailable` fires and the
 * caller falls back to the CSS reveal — so shipping this never depends on the
 * asset being present.
 *
 * ── CONTRACT THE .riv MUST MATCH ─────────────────────────────────────────
 *   Artboard:        "WinReveal"
 *   State machine:   "WinReveal"
 *   Inputs:
 *     • start   (Trigger) — fired once on mount; kicks off the first pour
 *     • land    (Trigger) — fired as each pour lands (5 times total)
 *     • pours   (Number)  — 1..5, set alongside each `land` so the rig knows
 *                           how full the pool should be
 *     • flood   (Trigger) — fired on the final landing; the oil takes the screen
 *     • settled (Boolean) — set true once the sequence should hold its end state
 *
 * Any of these may be absent without breaking the component — each input is
 * looked up defensively and skipped if the rig doesn't define it.
 */

/** Same rhythm as the CSS version: gaps close so the pours accelerate. */
export const POUR_TIMES = [700, 1250, 1700, 2050, 2300];
const FLOOD_AT = POUR_TIMES[POUR_TIMES.length - 1];
const SETTLE_AT = FLOOD_AT + 1850;

const ARTBOARD = 'WinReveal';
const STATE_MACHINE = 'WinReveal';

interface RiveWinRevealProps {
  /** Served from /public — drop the exported file at frontend/public/rive/win-reveal.riv */
  src?: string;
  onUnavailable: () => void;
  onSettled?: () => void;
  className?: string;
}

export default function RiveWinReveal({
  src = '/rive/win-reveal.riv',
  onUnavailable,
  onSettled,
  className = '',
}: RiveWinRevealProps) {
  const [failed, setFailed] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { rive, RiveComponent } = useRive({
    src,
    artboard: ARTBOARD,
    stateMachines: STATE_MACHINE,
    autoplay: true,
    layout: new Layout({ fit: Fit.Cover, alignment: Alignment.Center }),
    onLoadError: () => { setFailed(true); onUnavailable(); },
  });

  const start = useStateMachineInput(rive, STATE_MACHINE, 'start');
  const land = useStateMachineInput(rive, STATE_MACHINE, 'land');
  const pours = useStateMachineInput(rive, STATE_MACHINE, 'pours');
  const flood = useStateMachineInput(rive, STATE_MACHINE, 'flood');
  const settled = useStateMachineInput(rive, STATE_MACHINE, 'settled');

  useEffect(() => {
    if (!rive || failed) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const chime = () => { try { playNotificationSound(); } catch { /* silent is fine */ } };

    if (reduce) {
      // Skip straight to the end state: the rig holds its final pose, no
      // motion plays, and the copy around it is already on screen.
      if (settled) settled.value = true;
      chime();
      onSettled?.();
      return;
    }

    start?.fire();

    POUR_TIMES.forEach((t, i) => {
      timers.current.push(setTimeout(() => {
        if (pours) pours.value = i + 1;
        land?.fire();
        chime();
        if (i === POUR_TIMES.length - 1) flood?.fire();
      }, t));
    });

    timers.current.push(setTimeout(() => {
      if (settled) settled.value = true;
      onSettled?.();
    }, SETTLE_AT));

    const running = timers.current;
    return () => { running.forEach(clearTimeout); timers.current = []; };
    // Inputs resolve asynchronously with the rig; keying on `rive` is enough,
    // and re-running on each input identity would restart the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rive, failed]);

  if (failed) return null;
  return <RiveComponent className={className} />;
}
