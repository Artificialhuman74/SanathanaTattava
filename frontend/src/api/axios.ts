import axios from 'axios';
import { getApiHttpBaseUrl, rotateApiBaseUrl, shouldRotateApiBase } from '../config/apiBase';

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

    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
