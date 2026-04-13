/**
 * Cart Storage Service Tests
 *
 * Covers: load/save/clear/count, persistence across calls,
 * sanitization of invalid data, cart-updated event firing.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  loadCart,
  saveCart,
  clearCart,
  getCartCount,
} from '../../services/cartStorage';

const CART_KEY = 'tradehub_consumer_cart_v1';

const mockProduct = (id: number) => ({
  id,
  name: `Product ${id}`,
  price: 100 * id,
  category: 'test',
  stock: 50,
  unit: 'piece',
});

describe('cartStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── loadCart ────────────────────────────────────────────────────────────

  test('loadCart returns [] when localStorage is empty', () => {
    expect(loadCart()).toEqual([]);
  });

  test('loadCart returns [] when stored JSON is corrupt', () => {
    localStorage.setItem(CART_KEY, 'not-valid-json{{');
    expect(loadCart()).toEqual([]);
  });

  test('loadCart filters out items with quantity ≤ 0', () => {
    localStorage.setItem(CART_KEY, JSON.stringify([
      { product: mockProduct(1), quantity: 3 },
      { product: mockProduct(2), quantity: 0 },
      { product: mockProduct(3), quantity: -1 },
    ]));
    const cart = loadCart();
    expect(cart.length).toBe(1);
    expect(cart[0].product.id).toBe(1);
  });

  test('loadCart filters out items missing a product', () => {
    localStorage.setItem(CART_KEY, JSON.stringify([
      { product: null,          quantity: 2 },
      { product: undefined,     quantity: 2 },
      { product: mockProduct(1), quantity: 2 },
    ]));
    const cart = loadCart();
    expect(cart.length).toBe(1);
  });

  // ── saveCart ────────────────────────────────────────────────────────────

  test('saveCart persists items to localStorage', () => {
    const items = [{ product: mockProduct(1), quantity: 3 }];
    saveCart(items);
    const stored = JSON.parse(localStorage.getItem(CART_KEY)!);
    expect(stored.length).toBe(1);
    expect(stored[0].quantity).toBe(3);
  });

  test('saveCart truncates fractional quantities to integers', () => {
    saveCart([{ product: mockProduct(1), quantity: 2.9 }]);
    expect(loadCart()[0].quantity).toBe(2);
  });

  test('saveCart removes key when given empty array', () => {
    saveCart([{ product: mockProduct(1), quantity: 2 }]);
    saveCart([]);
    expect(localStorage.getItem(CART_KEY)).toBeNull();
  });

  test('saveCart emits cart-updated event', () => {
    const handler = vi.fn();
    window.addEventListener('cart-updated', handler);

    saveCart([{ product: mockProduct(1), quantity: 2 }]);

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('cart-updated', handler);
  });

  // ── clearCart ───────────────────────────────────────────────────────────

  test('clearCart removes key from localStorage', () => {
    saveCart([{ product: mockProduct(1), quantity: 1 }]);
    clearCart();
    expect(localStorage.getItem(CART_KEY)).toBeNull();
  });

  test('clearCart emits cart-updated event with count 0', () => {
    const handler = vi.fn();
    window.addEventListener('cart-updated', handler);
    clearCart();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toBe(0);
    window.removeEventListener('cart-updated', handler);
  });

  // ── getCartCount ────────────────────────────────────────────────────────

  test('getCartCount returns 0 when cart is empty', () => {
    expect(getCartCount()).toBe(0);
  });

  test('getCartCount sums all item quantities', () => {
    saveCart([
      { product: mockProduct(1), quantity: 3 },
      { product: mockProduct(2), quantity: 5 },
    ]);
    expect(getCartCount()).toBe(8);
  });

  // ── Round-trip ──────────────────────────────────────────────────────────

  test('save then load round-trips items correctly', () => {
    const items = [
      { product: mockProduct(1), quantity: 2 },
      { product: mockProduct(2), quantity: 4 },
    ];
    saveCart(items);
    const loaded = loadCart();
    expect(loaded.length).toBe(2);
    expect(loaded[0].quantity).toBe(2);
    expect(loaded[1].quantity).toBe(4);
  });
});
