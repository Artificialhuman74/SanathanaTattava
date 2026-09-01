import React from 'react';
import WinMomentReveal from './winMoment/WinMomentReveal';

interface WinRevealProps {
  /** Whoever won this month, not necessarily the viewer. */
  winnerName: string;
  /** True when the viewer is the winner. */
  isMe: boolean;
  /** False when the month drew nobody. */
  hasWinner?: boolean;
  schemeName: string;
  rewardProductName: string | null;
  nextEntryDeadline?: string | null;
  onContinue: () => void;
}

/**
 * The draw reveal. This is the seam the page imports, so the implementation
 * behind it can change without touching the route.
 *
 * Everyone in the scheme watches the same animation when a draw lands; the
 * gold lifts to the winner's name whether or not that name is theirs. Only
 * what the reveal asks for at the end differs.
 *
 * It now resolves to the piece ported from the "Lucky Draw Winning Animation"
 * design canvas — see ./winMoment. The two earlier attempts it replaces are
 * still on disk and no longer referenced: `OilFloodReveal.tsx` (the CSS
 * keyframe version) and `RiveWinReveal.tsx` (which waited on a `.riv` export
 * that was never produced, and paid a HEAD request and a blank frame on every
 * win to find that out).
 */
export default function WinReveal({
  winnerName, isMe, hasWinner = true, schemeName, rewardProductName, nextEntryDeadline, onContinue,
}: WinRevealProps) {
  return (
    <WinMomentReveal
      winnerName={winnerName}
      isMe={isMe}
      hasWinner={hasWinner}
      schemeName={schemeName}
      rewardProductName={rewardProductName}
      nextEntryDeadline={nextEntryDeadline}
      onContinue={onContinue}
    />
  );
}
