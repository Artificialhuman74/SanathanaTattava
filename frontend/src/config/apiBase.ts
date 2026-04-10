const API_OVERRIDE_KEY = 'tradehub_api_url';

const isBrowser = typeof window !== 'undefined';

function normalizeBaseUrl(raw?: string | null): string {
  if (!raw) return '';
  const clean = raw.trim().replace(/\/+$/, '');
  try {
    const url = new URL(clean);
    // People often set VITE_API_URL as ".../api"; this app expects only origin/base.
    if (url.pathname === '/api' || url.pathname === '/api/') {
      url.pathname = '';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    // Keep relative/local values as-is.
  }
  return clean;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const v = normalizeBaseUrl(value);
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function parseCsv(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((v) => normalizeBaseUrl(v))
    .filter(Boolean);
}

function isLocalHost(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(u.hostname);
  } catch {
    return false;
  }
}

const runtimeOrigin = isBrowser ? normalizeBaseUrl(window.location.origin) : '';
const envPrimary = normalizeBaseUrl(import.meta.env.VITE_API_URL);
const envFallback = normalizeBaseUrl(import.meta.env.VITE_API_URL_FALLBACK);
const envCandidates = parseCsv(import.meta.env.VITE_API_URL_CANDIDATES);
const override = isBrowser ? normalizeBaseUrl(localStorage.getItem(API_OVERRIDE_KEY)) : '';

const candidates = unique([
  override,
  envPrimary,
  ...envCandidates,
  envFallback,
  runtimeOrigin,
]);

let activeApiBaseUrl = candidates[0] || (isLocalHost(runtimeOrigin) ? '' : runtimeOrigin);

export function getApiBaseUrl(): string {
  return activeApiBaseUrl;
}

export function getApiHttpBaseUrl(): string {
  const base = getApiBaseUrl();
  return base ? `${base}/api` : '/api';
}

export function rotateApiBaseUrl(): string | null {
  const currentIndex = candidates.indexOf(activeApiBaseUrl);
  const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
  for (let i = nextIndex; i < candidates.length; i += 1) {
    const next = candidates[i];
    if (!next || next === activeApiBaseUrl) continue;
    activeApiBaseUrl = next;
    console.warn('[api] switched base URL to', next);
    return next;
  }
  return null;
}

export function shouldRotateApiBase(err: any): boolean {
  const status = err?.response?.status;
  const message = String(err?.response?.data?.message || '');
  const headers = err?.response?.headers || {};
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
  const body = typeof err?.response?.data === 'string' ? err.response.data : '';

  if (!err?.response) return true; // network / DNS / CORS failure
  if ([502, 503, 504].includes(status)) return true;
  if (status === 404 && /Application not found/i.test(message)) return true;
  // Wrong-host API calls often return HTML 404 pages instead of JSON.
  if (status === 404 && (contentType.includes('text/html') || /<!doctype html|<html/i.test(body))) return true;
  return false;
}
