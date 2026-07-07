import axios from 'axios';
import { getApiHttpBaseUrl, rotateApiBaseUrl, shouldRotateApiBase } from '../config/apiBase';

/* Public/unauthenticated calls (login, register) legitimately return 401
 * for "wrong credentials" — that's a normal API response the caller wants
 * to handle itself, not a sign the user's session died. Mark those calls
 * with `skipAuthRedirect: true` so the interceptor below doesn't hijack
 * them with a forced logout + redirect. */
declare module 'axios' {
  export interface AxiosRequestConfig {
    skipAuthRedirect?: boolean;
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
    if (!cfg.__apiFailoverRetried && shouldRotateApiBase(err) && rotateApiBaseUrl()) {
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
