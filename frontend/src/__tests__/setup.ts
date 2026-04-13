import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ── Mock browser APIs not available in jsdom ────────────────────────────────

// Web Audio API (used by notificationSound.ts)
Object.defineProperty(window, 'AudioContext', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    createOscillator: vi.fn(() => ({
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      type: '',
      frequency: { setValueAtTime: vi.fn() },
    })),
    createGain: vi.fn(() => ({
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    })),
    destination: {},
    currentTime: 0,
  })),
});

// Notification API
Object.defineProperty(window, 'Notification', {
  writable: true,
  value: Object.assign(
    vi.fn().mockImplementation(() => ({ close: vi.fn() })),
    { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') }
  ),
});

// matchMedia (used by react-hot-toast and media query hooks)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// IntersectionObserver (used by some scroll components)
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
});

// localStorage mock (persists within a test, cleared between tests)
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem:    (key: string) => store[key] ?? null,
    setItem:    (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear:      () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key:        (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Silence console.error for React prop-type warnings in test output
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Warning:')) return;
    originalError(...args);
  };
});
afterAll(() => { console.error = originalError; });

// Clear localStorage between tests
afterEach(() => { localStorage.clear(); });
