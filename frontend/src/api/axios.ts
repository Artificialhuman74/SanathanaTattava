import axios from 'axios';
import { getApiHttpBaseUrl, rotateApiBaseUrl, shouldRotateApiBase } from '../config/apiBase';

/* Public/unauthenticated calls (login, register) legitimately return 401
 * for "wrong credentials" — that's a normal API response the caller wants
 * to handle itself, not a sign the user's session died. Mark those calls
 * with `skipAuthRedirect: true` so the interceptor below doesn't hijack
 * them with a forced logout + redirect.
 *
 * `skipBaseRotation: true` is a separate, more severe opt-out: it stops a
 * failing call from flipping `activeApiBaseUrl` for the WHOLE app (see
 * config/apiBase.ts). That rotation exists to fail over between real API
 * hosts, but a 404-with-HTML-body on a route that simply isn't deployed
 * everywhere yet (e.g. a feature that only exists locally) looks
 * identical to "wrong host" — and rotating there mid-session silently
 * repoints every other request at a different backend, with a different
 * JWT secret, which then force-logs-out an otherwise perfectly valid
 * session. Mark any call to a route that might not exist on every
 * deployment target with this flag. */
declare module 'axios' {
  export interface AxiosRequestConfig {
    skipAuthRedirect?: boolean;
    skipBaseRotation?: boolean;
  }
}

const api = axios.create({
  baseURL: getApiHttpBaseUrl(),
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  config.baseURL = getApiHttpBaseUrl();
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const cfg = err?.config || {};
    if (!cfg.skipBaseRotation && !cfg.__apiFailoverRetried && shouldRotateApiBase(err) && rotateApiBaseUrl()) {
      cfg.__apiFailoverRetried = true;
      cfg.baseURL = getApiHttpBaseUrl();
      return api.request(cfg);
    }

    if (err.response?.status === 401 && !cfg.skipAuthRedirect) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
