/**
 * Consumer Shop — Catalog & UX Tests (Part 12)
 *
 * Tests:
 *  - Loading state is shown while the API call is in-flight
 *  - Product cards render after the API resolves
 *  - Empty state ("No products found") shows when the API returns []
 *  - Typing a search term filters the grid instantly, with no extra API call
 *  - Category chips and the sort menu re-order/filter on the device
 *
 * The catalogue loads once; search, category and sort run client-side so
 * results change as you type without the grid reloading.
 */
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

    // The loader marks itself with data-loader (see LiquidLoader).
    const spinner = document.querySelector('[data-loader]');
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

  test('renders the empty state when the API returns no products', async () => {
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
      expect(screen.getByText(/no oils available right now/i)).toBeTruthy();
    });
  });

  // ── Search, category, sort (client-side) ───────────────────────────────────

  const productCalls = () => mockApiGet.mock.calls.filter(([url]) => url.includes('/consumer/products')).length;
  const shownNames = () => Array.from(document.querySelectorAll('article p.font-bold')).map(e => e.textContent);

  test('typing in the search filters instantly without refetching', async () => {
    renderShop();
    await waitFor(() => expect(screen.getByText('Sesame Oil')).toBeTruthy());
    const calls = productCalls();

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'sesame' } });

    expect(shownNames()).toEqual(['Sesame Oil']);
    // Description matches count too.
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'fresh' } });
    expect(shownNames()).toEqual(['Turmeric']);
    expect(productCalls()).toBe(calls);
  });

  test('category chips filter on the device and "All" clears them', async () => {
    renderShop();
    await waitFor(() => expect(screen.getByText('Sesame Oil')).toBeTruthy());
    const calls = productCalls();

    // Query by selector: getAllByRole over the whole page is very slow in jsdom.
    const chip = (label: string) => screen.getByText(label, { selector: 'button' });
    fireEvent.click(chip('spices'));
    expect(shownNames()).toEqual(['Turmeric']);
    fireEvent.click(chip('All'));
    expect(shownNames()).toHaveLength(3);
    expect(productCalls()).toBe(calls);
  });

  test('sorting by price re-orders the grid immediately', async () => {
    renderShop();
    await waitFor(() => expect(screen.getByText('Sesame Oil')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/sort products/i), { target: { value: 'price-asc' } });
    expect(shownNames()).toEqual(['Turmeric', 'Coconut Oil', 'Sesame Oil']);
    fireEvent.change(screen.getByLabelText(/sort products/i), { target: { value: 'price-desc' } });
    expect(shownNames()).toEqual(['Sesame Oil', 'Coconut Oil', 'Turmeric']);
  });
});
