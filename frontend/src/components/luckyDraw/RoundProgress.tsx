import React from 'react';

interface RoundProgressProps {
  /** Which month of the round we're in, 1-based. */
  current: number;
  /** Length of the round. 12 for every scheme today (spec §3.8). */
  total: number;
  /** True once this month's free order has been placed. */
  currentClaimed: boolean;
  /** Set for one render right after claiming, to play the fill. */
  justClaimed?: boolean;
}

/**
 * The round, drawn as a rail of its twelve months.
 *
 * This was a row of small dots wedged beside a text label. As a full-width
 * rail it stops being a widget and becomes the card's footer: months already
 * delivered read as filled, the month they can claim right now sits proud of
 * the line and breathes, and the rest of the round runs off to the right as
 * empty track. Twelve segments across a card give each one real width, which
 * is also what makes the fill on claiming legible rather than a 12px twitch.
 *
 * It redraws itself every month, so it is still worth a look on the twelfth
 * visit as well as the first.
 */
export default function RoundProgress({ current, total, currentClaimed, justClaimed }: RoundProgressProps) {
  /* Clamped rather than trusted. A round length of zero renders no rail at
   * all, and a month number outside the round leaves every segment looking
   * either all done or none done; neither is worth shipping on a bad payload. */
  const span = Math.min(Math.max(Math.round(total) || 12, 1), 24);
  const at = Math.min(Math.max(Math.round(current) || 1, 1), span);
  const months = Array.from({ length: span }, (_, i) => i + 1);

  return (
    <ol
      className="flex items-center gap-1"
      aria-label={`Month ${at} of ${span}. ${currentClaimed ? 'Claimed.' : 'Not claimed yet.'}`}
    >
      {months.map(m => {
        const past = m < at;
        const isCurrent = m === at;
        const filled = past || (isCurrent && currentClaimed);

        return (
          <li
            key={m}
            aria-hidden="true"
            className={`relative flex-1 rounded-full overflow-hidden transition-[height] duration-200 ${
              isCurrent ? 'h-2.5' : 'h-1.5'
            } ${
              // Breathes only while there is something to do. Once claimed it
              // goes quiet: a pulsing element with no pending action is an
              // alert that never resolves.
              isCurrent && !currentClaimed ? 'motion-safe:animate-month-live' : ''
            }`}
            style={{
              backgroundColor: filled ? 'transparent' : 'rgba(200, 150, 60, 0.15)',
              boxShadow: !filled && isCurrent ? 'inset 0 0 0 1.5px rgba(200, 150, 60, 0.5)' : undefined,
            }}
          >
            {filled && (
              <span
                className={`absolute inset-0 ${
                  // The fill runs only on the month just claimed, and only
                  // once. Every earlier month is simply already full.
                  justClaimed && isCurrent ? 'motion-safe:animate-month-pour' : ''
                }`}
                style={{
                  background: past
                    ? 'linear-gradient(90deg, #e8b86d, #a87830)'
                    : 'linear-gradient(90deg, #f0d898, #c8963c 55%, #a87830)',
                }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
