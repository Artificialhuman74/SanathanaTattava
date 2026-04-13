/**
 * Consumer Shop Page Tests
 *
 * Covers: product display, category filtering, cart persistence.
 * Shop.tsx uses `api.get` (main axios instance) for products + settings.
 */
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// vi.hoisted — variables accessible inside hoisted vi.mock factories
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

const mockProducts = [
  { id: 1, name: 'Sesame Oil',  price: 120, category: 'oils',   stock: 30, unit: 'bottle', image_url: null, description: 'Pure sesame oil',   sku: 'S01' },
  { id: 2, name: 'Coconut Oil', price: 80,  category: 'oils',   stock: 10, unit: 'bottle', image_url: null, description: 'Pure coconut oil',  sku: 'C01' },
  { id: 3, name: 'Turmeric',    price: 45,  category: 'spices', stock: 50, unit: 'pack',   image_url: null, description: 'Fresh turmeric',    sku: 'T01' },
];

import Shop from '../../../pages/consumer/Shop';
import { saveCart, loadCart, clearCart, getCartCount } from '../../../services/cartStorage';

function renderShop() {
  return render(
    <MemoryRouter>
      <Toaster />
      <Shop />
    </MemoryRouter>
  );
}

describe('Consumer Shop page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/consumer/products')) {
        return Promise.resolve({ data: { products: mockProducts, categories: ['oils', 'spices'] } });
      }
      if (url.includes('/consumer/settings')) {
        return Promise.resolve({ data: { referral_discount_percent: 10 } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  test('renders product names after API load', async () => {
    renderShop();
    await waitFor(() => {
      expect(screen.getByText('Sesame Oil')).toBeTruthy();
      expect(screen.getByText('Coconut Oil')).toBeTruthy();
      expect(screen.getByText('Turmeric')).toBeTruthy();
    });
  });

  test('renders category chip buttons (All + each category)', async () => {
    renderShop();
    await waitFor(() => {
      // The "All" chip button renders only when categories.length > 0
      // Use getByRole('button') to avoid matching <option> or product labels
      const allButtons = screen.getAllByRole('button');
      const chipLabels = allButtons.map(b => b.textContent?.trim());
      expect(chipLabels).toContain('All');
      expect(chipLabels).toContain('oils');
      expect(chipLabels).toContain('spices');
    }, { timeout: 3000 });
  });

  test('renders product prices in rupees', async () => {
    renderShop();
    await waitFor(() => {
      expect(screen.getByText(/120/)).toBeTruthy();
    });
  });
});

// ── Cart storage unit tests ─────────────────────────────────────────────────

describe('Cart storage', () => {
  beforeEach(() => localStorage.clear());

  test('saved cart is readable back from localStorage', () => {
    saveCart([{ product: mockProducts[0], quantity: 2 }]);
    const cart = loadCart();
    expect(cart.length).toBe(1);
    expect(cart[0].product.name).toBe('Sesame Oil');
    expect(cart[0].quantity).toBe(2);
  });

  test('cart persists across re-reads (simulates page reload)', () => {
    saveCart([
      { product: mockProducts[0], quantity: 1 },
      { product: mockProducts[1], quantity: 3 },
    ]);
    expect(loadCart().length).toBe(2);
    expect(loadCart()[1].quantity).toBe(3);
  });

  test('getCartCount sums all quantities', () => {
    saveCart([
      { product: mockProducts[0], quantity: 2 },
      { product: mockProducts[2], quantity: 5 },
    ]);
    expect(getCartCount()).toBe(7);
  });

  test('clearCart empties cart and emits event', () => {
    const handler = vi.fn();
    window.addEventListener('cart-updated', handler);
    saveCart([{ product: mockProducts[0], quantity: 3 }]);
    clearCart();
    expect(loadCart().length).toBe(0);
    expect(handler).toHaveBeenLastCalledWith(expect.objectContaining({ detail: 0 }));
    window.removeEventListener('cart-updated', handler);
  });
});
