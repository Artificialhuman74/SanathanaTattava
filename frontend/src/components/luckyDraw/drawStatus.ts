import { consumerApi } from '../../contexts/AuthContext';

/**
 * Fetch the consumer's draw status, retrying transport failures.
 *
 * Every screen that shows the draw hangs off this one call, and each of them
 * used to make it exactly once and treat any failure as "there is nothing to
 * show" — so a single dropped request silently emptied the card for the whole
 * page load, with no retry and nothing on screen to say so. On a hard reload
 * that request races every other start-up call against a container that may
 * have just cold-started, which is why the draw would appear when moving
 * around the app and vanish on refresh.
 *
 * Only transport failures and 5xx are retried. A 401 or a 4xx is the server's
 * real answer and retrying it would just repeat the same reply more slowly.
 *
 * `skipBaseRotation` stays on deliberately (see api/axios.ts): a failure here
 * must never repoint the whole app at a different backend and log the session
 * out. Retrying against the SAME base is the safe half of that trade.
 */
export async function fetchDrawStatus(attempts = 4): Promise<any> {
  let lastErr: any;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const { data } = await consumerApi.get('/lucky-draw/consumer/status', {
        skipBaseRotation: true,
        skipAuthRedirect: true,
      });
      return data;
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      if (status && status < 500) throw err;          // a real answer; don't hammer it
      if (i < attempts - 1) {
        await new Promise(resolve => { window.setTimeout(resolve, 400 * 2 ** i); });
      }
    }
  }
  throw lastErr;
}
