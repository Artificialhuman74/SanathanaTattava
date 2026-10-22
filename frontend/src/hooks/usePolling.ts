import { useEffect, useRef } from 'react';

/**
 * Calls `load` every `ms` while the tab is visible. A hidden tab (another tab in front, the
 * window minimised) doesn't ask the server, and coming back to it catches up at once. Socket
 * updates keep arriving either way; this only stops the timed checks nobody can see.
 */
export function usePolling(load: () => void, ms: number) {
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    const tick = () => { if (!document.hidden) latest.current(); };
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms]);
}
