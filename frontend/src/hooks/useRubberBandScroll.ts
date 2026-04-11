import { useEffect } from 'react';

/**
 * Applies rubber-band (iOS-style spring) overscroll to the document.
 * When the user drags past the top or bottom boundary, the page resists
 * and springs back on release.
 *
 * Fixed elements (modals, overlays) are unaffected because they are fixed
 * to the viewport, not to the transformed documentElement.
 */
export function useRubberBandScroll() {
  useEffect(() => {
    let startY = 0;
    let pulling = false;

    /** Return true if the touch target is inside a scrollable container
     *  other than the document itself — e.g. a modal drawer. */
    const insideScrollable = (target: EventTarget | null): boolean => {
      let el = target as HTMLElement | null;
      while (el && el !== document.documentElement) {
        const ov = window.getComputedStyle(el).overflowY;
        if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
          return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (insideScrollable(e.target)) return;
      startY = e.touches[0].clientY;
      pulling = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (insideScrollable(e.target)) return;
      const dy = e.touches[0].clientY - startY;
      const scrollY = window.scrollY;
      const maxScroll = Math.max(0, document.body.scrollHeight - window.innerHeight);
      const atTop    = scrollY <= 0 && dy > 0;
      const atBottom = scrollY >= maxScroll - 1 && dy < 0;
      if (!atTop && !atBottom) return;

      pulling = true;
      const resistance = 0.28;
      const offset = dy * resistance;
      document.documentElement.style.transition = 'none';
      document.documentElement.style.transform  = `translateY(${offset}px)`;
      e.preventDefault();
    };

    const onTouchEnd = () => {
      if (!pulling) return;
      pulling = false;
      document.documentElement.style.transition = 'transform 0.48s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      document.documentElement.style.transform  = 'translateY(0)';
      setTimeout(() => {
        document.documentElement.style.transition = '';
        document.documentElement.style.transform  = '';
      }, 500);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove',  onTouchMove,  { passive: false });
    document.addEventListener('touchend',   onTouchEnd,   { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove',  onTouchMove);
      document.removeEventListener('touchend',   onTouchEnd);
    };
  }, []);
}
