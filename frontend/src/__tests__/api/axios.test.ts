/**
 * Axios interceptor tests
 *
 * Behavior under test:
 *   - `api` (trader/admin instance): on 401 → clears token+user from
 *     localStorage and redirects to /login.
 *   - `consumerApi`: on 401 → simply rejects to the caller; does NOT
 *     redirect (consumer pages handle 401s themselves).
 *
 * Why this matters: see CLAUDE.md gotcha #4 — consumer pages that
 * accidentally use the main `api` will be wrongly bounced to /login.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Stub apiBase so the modules import cleanly under jsdom
vi.mock('../../config/apiBase', () => ({
  getApiHttpBaseUrl: () => '/api',
  rotateApiBaseUrl: () => null,           // never rotate during these tests
  shouldRotateApiBase: () => false,
}));

// Replace window.location with a writable plain object so we can observe
// .href assignments without jsdom navigating.
let locationHref = '';
beforeEach(() => {
  locationHref = '';
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      get href() { return locationHref; },
      set href(v: string) { locationHref = v; },
      assign: (v: string) => { locationHref = v; },
      replace: (v: string) => { locationHref = v; },
    },
  });
  localStorage.clear();
});

import api from '../../api/axios';
import { consumerApi } from '../../contexts/AuthContext';

/** Force an axios instance's next request to reject with the given status. */
function rejectWith(instance: any, status: number) {
  instance.defaults.adapter = (config: any) =>
    Promise.reject({ config, response: { status, data: { error: 'unauthorized' } } });
}

describe('api axios instance (trader/admin)', () => {
  test('redirects to /login and clears token+user on 401', async () => {
    localStorage.setItem('token', 'abc');
    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin' }));
    rejectWith(api, 401);

    await expect(api.get('/anything')).rejects.toBeDefined();

    expect(locationHref).toBe('/login');
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  test('does NOT redirect on non-401 errors (e.g. 500)', async () => {
    localStorage.setItem('token', 'abc');
    rejectWith(api, 500);

    await expect(api.get('/anything')).rejects.toBeDefined();

    expect(locationHref).toBe('');
    expect(localStorage.getItem('token')).toBe('abc');
  });
});

describe('consumerApi axios instance', () => {
  test('does NOT redirect on 401 — error propagates to caller', async () => {
    localStorage.setItem('consumer_token', 'xyz');
    rejectWith(consumerApi, 401);

    await expect(consumerApi.get('/anything')).rejects.toMatchObject({
      response: { status: 401 },
    });

    // Critical: consumer 401 must not steal the user away to /login
    expect(locationHref).toBe('');
    // consumer_token is NOT auto-cleared (consumer pages decide)
    expect(localStorage.getItem('consumer_token')).toBe('xyz');
  });

  test('attaches Bearer consumer_token (not token) to requests', async () => {
    localStorage.setItem('token', 'admin-tok');
    localStorage.setItem('consumer_token', 'consumer-tok');

    let seenAuth = '';
    consumerApi.defaults.adapter = (config: any) => {
      seenAuth = String(config.headers?.Authorization || '');
      return Promise.resolve({
        data: {}, status: 200, statusText: 'OK', headers: {}, config,
      });
    };

    await consumerApi.get('/anything');
    expect(seenAuth).toBe('Bearer consumer-tok');
  });
});

describe('api request interceptor', () => {
  test('attaches Bearer token (main token, not consumer_token)', async () => {
    localStorage.setItem('token', 'main-tok');
    localStorage.setItem('consumer_token', 'consumer-tok');

    let seenAuth = '';
    api.defaults.adapter = (config: any) => {
      seenAuth = String(config.headers?.Authorization || '');
      return Promise.resolve({
        data: {}, status: 200, statusText: 'OK', headers: {}, config,
      });
    };

    await api.get('/anything');
    expect(seenAuth).toBe('Bearer main-tok');
  });
});
