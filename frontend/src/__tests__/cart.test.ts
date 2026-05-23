/**
 * Cart behaviour tests (pure unit tests, no React rendering).
 *
 * These tests exercise the cartStorage primitives in combination to verify
 * the cart UX behaviours expected by the application:
 *
 *  - Cart starts empty when localStorage is empty
 *  - "addToCart" (save with incremented qty) increases quantity
 *  - "removeFromCart" (save without the item) removes the item
 *  - clearCart empties the array
 *  - Cart persists across "reload" (re-reading from localStorage)
 *  - Quantity cannot go below 1 (sanitize enforces > 0)
 *  - Adding the same product twice merges quantities
 *
 * NOTE: loadCart / saveCart / clearCart / getCartCount are already covered
 * individually in services/cartStorage.test.ts — this file focuses on the
 * higher-level cart manipulation patterns the application uses.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadCart, saveCart, clearCart, getCartCount } from '../services/cartStorage';

// ── Helpers that mirror the app's cart logic ─────────────────────────────────

type Product = { id: number; name: string; price: number; category: string; stock: number; unit: string };

function makeProduct(id: number): Product {
  return { id, name: `Product ${id}`, price: id * 10, category: 'test', stock: 100, unit: 'piece' };
}

/** Add one unit of a product (or increment existing) */
function addToCart(product: Product, qty = 1) {
  const cart = loadCart<Product>();
  const existing = cart.find(i => i.product.id === product.id);
  if (existing) {
    existing.quantity += qty;
    saveCart(cart);
  } else {
    saveCart([...cart, { product, quantity: qty }]);
  }
}

/** Remove a product entirely from the cart */
function removeFromCart(productId: number) {
  const cart = loadCart<Product>().filter(i => i.product.id !== productId);
  saveCart(cart);
}

/** Change a product's quantity, enforcing minimum of 1 */
function setQuantity(productId: number, qty: number) {
  const cart = loadCart<Product>();
  const item = cart.find(i => i.product.id === productId);
  if (!item) return;
  item.quantity = Math.max(1, qty);
  saveCart(cart);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Cart behaviours', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Cart starts empty
  it('cart starts empty when localStorage is empty', () => {
    expect(loadCart()).toEqual([]);
    expect(getCartCount()).toBe(0);
  });

  // addToCart increases quantity
  it('addToCart increases the quantity of an item already in the cart', () => {
    const p = makeProduct(1);
    addToCart(p, 2);
    addToCart(p, 3);
    const cart = loadCart<Product>();
    expect(cart.length).toBe(1);
    expect(cart[0].quantity).toBe(5);
  });

  // addToCart adds new items
  it('addToCart adds a new item when product is not yet in the cart', () => {
    addToCart(makeProduct(1));
    addToCart(makeProduct(2));
    expect(loadCart().length).toBe(2);
  });

  // removeFromCart removes item
  it('removeFromCart removes an item from the cart', () => {
    addToCart(makeProduct(1), 3);
    addToCart(makeProduct(2), 1);
    removeFromCart(1);
    const cart = loadCart<Product>();
    expect(cart.length).toBe(1);
    expect(cart[0].product.id).toBe(2);
  });

  // removeFromCart on non-existent item is safe
  it('removeFromCart on a product not in the cart is a no-op', () => {
    addToCart(makeProduct(1), 2);
    removeFromCart(999);
    expect(loadCart().length).toBe(1);
  });

  // clearCart empties the array
  it('clearCart empties the cart', () => {
    addToCart(makeProduct(1), 5);
    addToCart(makeProduct(2), 3);
    clearCart();
    expect(loadCart()).toEqual([]);
    expect(getCartCount()).toBe(0);
  });

  // Cart persists across "reload" (re-reading from localStorage)
  it('cart persists across re-reads (simulating a page reload)', () => {
    addToCart(makeProduct(1), 4);
    addToCart(makeProduct(2), 6);

    // Re-read simulates what happens after a page reload
    const reloaded = loadCart<Product>();
    expect(reloaded.length).toBe(2);
    expect(reloaded.find(i => i.product.id === 1)?.quantity).toBe(4);
    expect(reloaded.find(i => i.product.id === 2)?.quantity).toBe(6);
  });

  // Quantity cannot go below 1
  it('quantity is clamped to minimum 1 when setQuantity is called with 0 or less', () => {
    addToCart(makeProduct(1), 5);
    setQuantity(1, 0);
    expect(loadCart()[0].quantity).toBe(1);

    setQuantity(1, -3);
    expect(loadCart()[0].quantity).toBe(1);
  });

  // Items with quantity 0 are removed by saveCart's sanitize logic
  it('saving an item with quantity 0 removes it from the cart', () => {
    saveCart([
      { product: makeProduct(1), quantity: 3 },
      { product: makeProduct(2), quantity: 0 },
    ]);
    const cart = loadCart();
    expect(cart.length).toBe(1);
    expect(cart[0].product.id).toBe(1);
  });

  // Adding the same product twice merges quantities
  it('adding the same product twice merges quantities', () => {
    const p = makeProduct(7);
    addToCart(p, 2);
    addToCart(p, 5);

    const cart = loadCart<Product>();
    expect(cart.filter(i => i.product.id === 7).length).toBe(1);
    expect(cart[0].quantity).toBe(7);
  });

  // getCartCount reflects total across all items
  it('getCartCount returns the total quantity of all items', () => {
    addToCart(makeProduct(1), 3);
    addToCart(makeProduct(2), 7);
    expect(getCartCount()).toBe(10);
  });
});
