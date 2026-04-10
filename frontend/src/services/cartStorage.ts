const CART_KEY = 'tradehub_consumer_cart_v1';

export interface StoredCartItem<T = any> {
  product: T;
  quantity: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function sanitize<T>(items: any[]): StoredCartItem<T>[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => ({
      product: it?.product,
      quantity: Number(it?.quantity || 0),
    }))
    .filter((it) => it.product && Number.isFinite(it.quantity) && it.quantity > 0)
    .map((it) => ({ ...it, quantity: Math.floor(it.quantity) }));
}

function emitCartEvents(count: number) {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent('cart-updated', { detail: count }));
  window.dispatchEvent(new CustomEvent('cart-count', { detail: count }));
}

export function loadCart<T = any>(): StoredCartItem<T>[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    return sanitize<T>(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function getCartCount(): number {
  return loadCart().reduce((sum, item) => sum + item.quantity, 0);
}

export function saveCart<T = any>(items: StoredCartItem<T>[]) {
  if (!isBrowser()) return;
  const safe = sanitize<T>(items as any[]);
  if (!safe.length) {
    localStorage.removeItem(CART_KEY);
    emitCartEvents(0);
    return;
  }
  localStorage.setItem(CART_KEY, JSON.stringify(safe));
  emitCartEvents(safe.reduce((sum, i) => sum + i.quantity, 0));
}

export function clearCart() {
  if (!isBrowser()) return;
  localStorage.removeItem(CART_KEY);
  emitCartEvents(0);
}
