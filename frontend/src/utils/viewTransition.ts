import { flushSync } from 'react-dom';

/**
 * Navigate through the View Transitions API when the browser supports it
 * (and the user hasn't asked for reduced motion) — any element sharing a
 * `viewTransitionName` between the current and next page morphs instead of
 * hard-cutting. Falls back to a plain navigate() everywhere else; the
 * experience is complete either way, this is enhancement only.
 */
export function navigateWithViewTransition(navigate: (path: string, opts?: any) => void, path: string, opts?: any) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (typeof doc.startViewTransition === 'function' && !reduceMotion) {
    doc.startViewTransition(() => {
      flushSync(() => navigate(path, opts));
    });
  } else {
    navigate(path, opts);
  }
}

/**
 * Run a state update inside a view transition, so elements that share a
 * `viewTransitionName` across the update travel between their old and new
 * positions instead of cutting.
 *
 * The navigate version above is for route changes; this is for an in-place
 * swap, like a loading view giving way to the loaded one. `flushSync` is what
 * makes it work: the browser snapshots, runs the callback, then snapshots
 * again, so React has to commit synchronously inside it or there is nothing
 * new to compare against.
 *
 * Enhancement only. Where the API or motion preference says no, the update
 * just happens.
 */
export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (typeof doc.startViewTransition === 'function' && !reduceMotion) {
    doc.startViewTransition(() => {
      flushSync(update);
    });
  } else {
    update();
  }
}
