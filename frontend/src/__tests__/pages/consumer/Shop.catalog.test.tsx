/**
 * Consumer Shop — Catalog & UX Tests (Part 12)
 *
 * Tests:
 *  - Loading state is shown while the API call is in-flight
 *  - Product cards render after the API resolves
 *  - Empty state ("No products found") shows when the API returns []
 *  - Typing a search term triggers an API call with the `search` param
 *  - Clicking a category button triggers an API call with the `category` param
 *
 * Filtering is server-side (Shop.tsx passes `search` and `category` as query
 * params to `/consumer/products`) so these tests verify the API is invoked
 * with the correct arguments rather than testing DOM filtering.
 */
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// ── Hoist mocks so they are available inside vi.mock factories ───────────────
const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }));

vi.mock('../../../api/axios', () => ({
  default: {
    get: mockApiGet,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    consumer: { id: 1, name: 'Test Consumer', email: 'test@test.com', linked_dealer_id: null },
    consumerToken: 'fake-token',
    isConsumer: true,
    user: null, token: null, loading: false,
    isAdmin: false, isTrader: false, isTier1: false,
  }),
  consumerApi: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('../../../contexts/SocketContext', () => ({
  useSocket: () => ({ socket: null, on: vi.fn(), off: vi.fn() }),
}));

// ── Fixture data ─────────────────────────────────────────────────────────────

const mockProducts = [
  { id: 1, name: 'Sesame Oil',  price: 120, category: 'oils',   stock: 30, unit: 'bottle', image_url: null, description: 'Pure sesame oil',  sku: 'S01' },
  { id: 2, name: 'Coconut Oil', price: 80,  category: 'oils',   stock: 10, unit: 'bottle', image_url: null, description: 'Pure coconut oil', sku: 'C01' },
  { id: 3, name: 'Turmeric',    price: 45,  category: 'spices', stock: 50, unit: 'pack',   image_url: null, description: 'Fresh turmeric',   sku: 'T01' },
];

// ── Import the page under test after mocks are set up ────────────────────────
import Shop from '../../../pages/consumer/Shop';

// ── Render helper ─────────────────────────────────────────────────────────────
function renderShop() {
  return render(
    <MemoryRouter>
      <Toaster />
      <Shop />
    </MemoryRouter>
  );
}

// ── Default mock implementation ───────────────────────────────────────────────
function setupDefaultMock() {
  mockApiGet.mockImplementation((url: string) => {
    if (url.includes('/consumer/products')) {
      return Promise.resolve({ data: { products: mockProducts, categories: ['oils', 'spices'] } });
    }
    if (url.includes('/consumer/settings')) {
      return Promise.resolve({ data: { referral_discount_percent: 0 } });
    }
    return Promise.resolve({ data: {} });
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Shop — catalog UX (Part 12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setupDefaultMock();
  });

  // ── Loading state ──────────────────────────────────────────────────────────

  test('shows a loading spinner while the API is in-flight', async () => {
    // Delay the API response so the loading state is visible
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/consumer/products')) {
        return new Promise(() => {}); // never resolves — keeps loading state
      }
      if (url.includes('/consumer/settings')) {
        return Promise.resolve({ data: { referral_discount_percent: 0 } });
      }
      return Promise.resolve({ data: {} });
    });

    renderShop();

    // Spinner is a div with animate-spin class
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });

  // ── Products render ────────────────────────────────────────────────────────

  test('renders product names after the API call resolves', async () => {
    renderShop();
    await waitFor(() => {
      expect(screen.getByText('Sesame Oil')).toBeTruthy();
      expect(screen.getByText('Coconut Oil')).toBeTruthy();
      expect(screen.getByText('Turmeric')).toBeTruthy();
    });
  });

  test('renders product prices', async () => {
    renderShop();
    await waitFor(() => {
      expect(screen.getByText(/120/)).toBeTruthy();
    });
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  test('renders "No products found" empty state when API returns empty array', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/consumer/products')) {
        return Promise.resolve({ data: { products: [], categories: [] } });
      }
      if (url.includes('/consumer/settings')) {
        return Promise.resolve({ data: { referral_discount_percent: 0 } });
      }
      return Promise.resolve({ data: {} });
    });

    renderShop();

    await waitFor(() => {
      expect(screen.getByText(/no products found/i)).toBeTruthy();
    });
  });

  // ── Search input ───────────────────────────────────────────────────────────

  test('typing in the search input triggers an API call with the search param', async () => {
    renderShop();

    // Wait for initial load to complete
    await waitFor(() => expect(screen.getByText('Sesame Oil')).toBeTruthy());

    vi.clearAllMocks();
    setupDefaultMock();

    const searchInput = screen.getByPlaceholderText(/search/i);
    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, 'sesame');

    // The component debounces/re-fetches when `search` state changes.
    // Wait for the API to be called with the search param.
    await waitFor(() => {
      const calls = mockApiGet.mock.calls.filter(([url]) => url.includes('/consumer/products'));
      const searchCall = calls.find(([, config]) => config?.params?.search === 'sesame');
      expect(searchCall).toBeDefined();
    }, { timeout: 3000 });
  });

  // ── Category filter ────────────────────────────────────────────────────────

  test('clicking a category chip triggers an API call with the category param', async () => {
    renderShop();

    // Wait for products and category chips to render
    await waitFor(() => {
      const allButtons = screen.getAllByRole('button');
      expect(allButtons.some(b => b.textContent?.trim() === 'oils')).toBe(true);
    });

    vi.clearAllMocks();
    setupDefaultMock();

    // Click the "oils" category chip button.
    // Category chips sit in a flex row alongside the "All" button and the
    // search bar area. Use getAllByRole to find the chip that has ONLY "oils"
    // as its accessible name (not product cards which also have "oils" text).
    const allButtons = screen.getAllByRole('button');
    const oilsBtn = allButtons.find(b => b.textContent?.trim() === 'oils');
    expect(oilsBtn).toBeDefined();
    await act(async () => { fireEvent.click(oilsBtn!); });

    await waitFor(() => {
      const calls = mockApiGet.mock.calls.filter(([url]) => url.includes('/consumer/products'));
      const catCall = calls.find(([, config]) => config?.params?.category === 'oils');
      expect(catCall).toBeDefined();
    }, { timeout: 3000 });
  });

  test('clicking "All" chip clears the category filter', async () => {
    // Start with a category selected
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/consumer/products')) {
        return Promise.resolve({ data: { products: mockProducts, categories: ['oils', 'spices'] } });
      }
      if (url.includes('/consumer/settings')) {
        return Promise.resolve({ data: { referral_discount_percent: 0 } });
      }
      return Promise.resolve({ data: {} });
    });

    renderShop();

    await waitFor(() => {
      const allBtns0 = screen.getAllByRole('button');
      expect(allBtns0.some(b => b.textContent?.trim() === 'oils')).toBe(true);
    });

    // Select a category first
    const allBtnsFirst = screen.getAllByRole('button');
    const oilsBtnFirst = allBtnsFirst.find(b => b.textContent?.trim() === 'oils');
    expect(oilsBtnFirst).toBeDefined();
    await act(async () => { fireEvent.click(oilsBtnFirst!); });

    vi.clearAllMocks();
    setupDefaultMock();

    // Now click "All" to clear
    const allBtns = screen.getAllByRole('button');
    const allBtn = allBtns.find(b => b.textContent?.trim() === 'All');
    expect(allBtn).toBeDefined();
    await act(async () => { fireEvent.click(allBtn!); });

    await waitFor(() => {
      const calls = mockApiGet.mock.calls.filter(([url]) => url.includes('/consumer/products'));
      // When "All" is selected, category param should not be set
      const allCall = calls.find(([, config]) => !config?.params?.category);
      expect(calls.length).toBeGreaterThan(0);
      expect(allCall).toBeDefined();
    }, { timeout: 3000 });
  });
});
