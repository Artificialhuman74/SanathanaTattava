import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSeo } from '../../hooks/useSeo';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import RollingNumber from '../../components/RollingNumber';
import { loadCart, saveCart } from '../../services/cartStorage';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Search, Package, Plus, Minus, X, Trash2, Tag, Info, Star, MessageSquare,
} from 'lucide-react';
import { consumerApi } from '../../contexts/AuthContext';
import { formatIstDate } from '../../utils/dateTime';

interface Product {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
  container_cost: number;
  container_type?: '2.8L' | '5L' | null;
  stock: number;
  image_url: string;
  image_urls?: string | null;
  unit: string;
  sku: string;
}

type CartMode = 'refill' | 'buy';

interface CartItem {
  product: Product;
  quantity: number;
  mode: CartMode;
}

interface FlyItem {
  id: number;
  image: string;
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  endX: number;
  endY: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  trail: Array<{ x: number; y: number; life: number }>;
}

interface CollapseItem {
  id: number;
  kind: 'image' | 'button';
  image?: string;
  width: number;
  height: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  liftPx: number;
  borderRadius: number;
  background?: string;
  borderColor?: string;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
}

function parseImageList(raw?: string | null): string[] {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(v => String(v || '').trim()).filter(Boolean);
    }
  } catch {
    // keep fallback parsing
  }

  if (text.includes('\n')) {
    return text.split('\n').map(v => v.trim()).filter(Boolean);
  }
  if (!text.startsWith('data:') && text.includes(',')) {
    return text.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [text];
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((v) => {
    const img = v.trim();
    if (!img || seen.has(img)) return;
    seen.add(img);
    out.push(img);
  });
  return out;
}

function getProductImages(product: Product): string[] {
  return dedupe([product.image_url || '', ...parseImageList(product.image_urls || '')]);
}

function getPrimaryImage(product: Product): string {
  return getProductImages(product)[0] || '';
}

/* Time-of-day greeting. Three buckets, local clock, computed once per
 * render. Used by the logged-in H1 in the toolbar so the page opens
 * with a tiny warm beat instead of "Hi, {name}." every time. */
function timeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getBounceConstraints(rect: DOMRect) {
  const viewportPad = 8;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const localPadX = Math.min(30, rect.width * 0.12);
  const localPadY = Math.min(24, rect.height * 0.1);

  const minX = Math.max((rect.width / 2) + viewportPad, centerX - localPadX);
  const maxX = Math.min(window.innerWidth - (rect.width / 2) - viewportPad, centerX + localPadX);
  const minY = Math.max((rect.height / 2) + viewportPad, centerY - localPadY);
  const maxY = Math.min(window.innerHeight - (rect.height / 2) - viewportPad, centerY + localPadY);

  return { minX, maxX, minY, maxY };
}

/* First-visit welcome callout for the steel-can mechanic.
 * Shown above the toolbar on a visitor's first time on Shop. Once
 * dismissed (or once a first cart-add happens implicitly), we set
 * the localStorage key so it never comes back. */
const SHOP_INTRO_KEY = 'st_shop_intro_seen';

export default function Shop() {
  const { consumer } = useAuth();
  const navigate = useNavigate();

  useSeo({
    title: 'Shop Cold-Pressed Oils — Coconut, Groundnut, Sunflower | Sanathana Tattva',
    description: 'Buy cold-pressed coconut, groundnut and sunflower oil online. Pressed in a wooden ghani without heat, delivered in a reusable steel can across South India.',
    path: '/shop',
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [introOpen, setIntroOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SHOP_INTRO_KEY) !== 'true';
  });
  const dismissIntro = () => {
    setIntroOpen(false);
    try { localStorage.setItem(SHOP_INTRO_KEY, 'true'); } catch { /* private mode */ }
  };

  const [cart, setCart] = useState<CartItem[]>(() =>
    loadCart<Product>().map(i => ({ product: i.product, quantity: i.quantity, mode: (i.mode === 'refill' ? 'refill' : 'buy') as CartMode }))
  );
  const [cartOpen, setCartOpen] = useState(false);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [refillCaps, setRefillCaps] = useState<Record<number, number>>({});
  const [shakingId, setShakingId] = useState<number | null>(null);
  const [cartIconBounce, setCartIconBounce] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [flyItems, setFlyItems] = useState<FlyItem[]>([]);
  const [collapseItems, setCollapseItems] = useState<CollapseItem[]>([]);
  const prevCartCountRef = useRef(0);
  const cartButtonRef = useRef<HTMLButtonElement | null>(null);
  const cardRefs = useRef<Record<number, HTMLElement | null>>({});
  const flyRafRefs = useRef<Record<number, number>>({});
  const collapseRafRefs = useRef<Record<number, number>>({});
  const flyStartTimeoutRefs = useRef<Record<number, number>>({});

  // Pre-fill cart from "order again" (set in Orders.tsx)
  useEffect(() => {
    const reorder = sessionStorage.getItem('reorder_ids');
    if (!reorder || !products.length) return;
    sessionStorage.removeItem('reorder_ids');
    try {
      const items: { id: number; qty: number }[] = JSON.parse(reorder);
      const newCart: CartItem[] = [];
      for (const { id, qty } of items) {
        const product = products.find(p => p.id === id);
        if (product && product.stock > 0) {
          newCart.push({ product, quantity: Math.min(qty, product.stock), mode: 'buy' });
        }
      }
      if (newCart.length) {
        setCart((prev) => {
          const keyOf = (i: CartItem) => `${i.product.id}::${i.mode}`;
          const map = new Map<string, CartItem>();
          prev.forEach((i) => map.set(keyOf(i), { ...i }));
          newCart.forEach((i) => {
            const k = keyOf(i);
            const ex = map.get(k);
            if (!ex) { map.set(k, i); return; }
            map.set(k, { ...ex, quantity: Math.min(i.product.stock, ex.quantity + i.quantity) });
          });
          return Array.from(map.values()).filter(i => i.quantity > 0);
        });
        setCartOpen(true);
        toast.success('Same order, back in the cart.');
      }
    } catch {
      // ignore bad session data
    }
  }, [products]);

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (search) params.search = search;
    if (catFilter) params.category = catFilter;
    api.get('/consumer/products', { params })
      .then(r => {
        setProducts(r.data.products || r.data || []);
        setCategories(r.data.categories || []);
      })
      .finally(() => setLoading(false));
  }, [search, catFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Reconcile persisted cart with latest product data/stock.
  useEffect(() => {
    if (!products.length) return;
    setCart((prev) => {
      const merged: CartItem[] = [];
      prev.forEach((item) => {
        const fresh = products.find(p => p.id === item.product.id);
        if (!fresh || fresh.stock <= 0) return;
        const qty = Math.min(item.quantity, fresh.stock);
        if (qty > 0) merged.push({ product: fresh, quantity: qty, mode: item.mode });
      });
      return merged;
    });
  }, [products]);

  useEffect(() => {
    api.get('/consumer/settings')
      .then(r => setDiscountPct(parseFloat(r.data.referral_discount_percent) || 0))
      .catch(() => {});
  }, []);

  /* Refill caps — count of 'held' containers per current_product_id. */
  useEffect(() => {
    if (!consumer) { setRefillCaps({}); return; }
    consumerApi.get('/consumer/refill-caps')
      .then(r => setRefillCaps(r.data.caps || {}))
      .catch(() => setRefillCaps({}));
  }, [consumer]);

  const cartInProduct = (id: number, mode: CartMode = 'buy') =>
    cart.find(i => i.product.id === id && i.mode === mode)?.quantity ?? 0;
  /* How many refills of this product are already reserved by other refill lines */
  const refillReserved = (id: number) =>
    cart.filter(i => i.product.id === id && i.mode === 'refill').reduce((s, i) => s + i.quantity, 0);

  useEffect(() => {
    return () => {
      Object.values(flyRafRefs.current).forEach((rafId) => cancelAnimationFrame(rafId));
      flyRafRefs.current = {};
      Object.values(collapseRafRefs.current).forEach((rafId) => cancelAnimationFrame(rafId));
      collapseRafRefs.current = {};
      Object.values(flyStartTimeoutRefs.current).forEach((timer) => clearTimeout(timer));
      flyStartTimeoutRefs.current = {};
    };
  }, []);

  const isTargetVisible = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
    if (Number(style.opacity || 1) < 0.35) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;
    return true;
  };

  const resolveCartTarget = (): HTMLElement | null => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-cart-fly-target]'));
    const visible = targets.filter(isTargetVisible);
    if (!visible.length) return cartButtonRef.current;

    // Prefer the "new" header cart that appears on scroll via higher priority.
    visible.sort((a, b) => {
      const pa = Number(a.dataset.cartFlyPriority || 0);
      const pb = Number(b.dataset.cartFlyPriority || 0);
      if (pb !== pa) return pb - pa;
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
    return visible[0];
  };

  const animateFlyToCart = (id: number, onLand: () => void, durationMs = 870) => {
    const startedAt = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      setFlyItems((prev) => prev.map((item) => {
        if (item.id !== id) return item;

        // Exact quadratic Bezier parabola to cart.
        const decelT = Math.log2(1 + 31 * t) / Math.log2(32);
        const mt = 1 - decelT;
        const x = mt * mt * item.startX + 2 * mt * decelT * item.controlX + decelT * decelT * item.endX;
        const y = mt * mt * item.startY + 2 * mt * decelT * item.controlY + decelT * decelT * item.endY;

        const numDots = 7;
        const tStep = 0.055;
        const trail = Array.from({ length: numDots }, (_, i) => {
          const dT = Math.max(0, decelT - (i + 1) * tStep);
          if (dT <= 0) return null;
          const m2 = 1 - dT;
          return {
            x: m2 * m2 * item.startX + 2 * m2 * dT * item.controlX + dT * dT * item.endX,
            y: m2 * m2 * item.startY + 2 * m2 * dT * item.controlY + dT * dT * item.endY,
            life: (numDots - i) / numDots,
          };
        }).filter((d): d is { x: number; y: number; life: number } => d !== null);

        return {
          ...item,
          x,
          y,
          scale: 0.62 - (0.34 * decelT),
          opacity: 0.98 - (0.76 * decelT),
          trail,
        };
      }));

      if (t < 1) {
        flyRafRefs.current[id] = requestAnimationFrame(step);
      } else {
        delete flyRafRefs.current[id];
        setFlyItems((prev) => prev.filter((item) => item.id !== id));
        onLand();
      }
    };

    flyRafRefs.current[id] = requestAnimationFrame(step);
  };

  const animateImageCollapse = (id: number, durationMs = 353) => {
    const startedAt = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);

      setCollapseItems((prev) => prev.map((item) => {
        if (item.id !== id) return item;

        // Phase 1: pull upward from current position with a slower bounce (+20%).
        if (t <= 0.55) {
          const p = t / 0.55;
          const bump = Math.sin(Math.PI * p);
          const easedLift = 1 - ((1 - p) * (1 - p));
          if (item.kind === 'image') {
            const desiredX = item.startX;
            const desiredY = item.startY - (item.liftPx * bump);
            const x = Math.min(item.maxX ?? desiredX, Math.max(item.minX ?? desiredX, desiredX));
            const y = Math.min(item.maxY ?? desiredY, Math.max(item.minY ?? desiredY, desiredY));
            return {
              ...item,
              x,
              y,
              scale: 1 + (0.12 * bump),
              opacity: 1,
            };
          }

          return {
            ...item,
            x: item.startX,
            y: item.startY - (item.liftPx * easedLift),
            scale: 1 + (0.05 * bump),
            opacity: 1,
          };
        }

        // Phase 2: collapse. For image clone, keep it anchored in place.
        const p = (t - 0.55) / 0.45;
        const ease = 1 - Math.pow(1 - p, 3);
        const liftedY = item.startY - item.liftPx;
        if (item.kind === 'image') {
          return {
            ...item,
            x: item.startX,
            y: item.startY,
            scale: 1.05 - (0.93 * ease),
            opacity: 1 - (0.9 * ease),
          };
        }

        return {
          ...item,
          x: item.startX + ((item.targetX - item.startX) * ease),
          y: liftedY + ((item.targetY - liftedY) * ease),
          scale: 1.05 - (0.92 * ease),
          opacity: 1 - (0.2 * ease),
        };
      }));

      if (t < 1) {
        collapseRafRefs.current[id] = requestAnimationFrame(step);
      } else {
        delete collapseRafRefs.current[id];
        setCollapseItems((prev) => prev.filter((item) => item.id !== id));
      }
    };

    collapseRafRefs.current[id] = requestAnimationFrame(step);
  };

  const triggerFlyToCart = (product: Product, sourceEl?: HTMLElement | null) => {
    const target = resolveCartTarget();
    const source = sourceEl || cardRefs.current[product.id];
    if (!target || !source) return;

    const srcRect = source.getBoundingClientRect();
    const card = source.closest('article');
    const imageNode = (source.closest('[data-product-card-root]')?.querySelector('[data-product-image]')
      || card?.querySelector('[data-product-image]')
      || document.querySelector(`[data-product-modal-image="${product.id}"]`)) as HTMLElement | null;
    const imageSrc = getPrimaryImage(product);
    const launchRect = imageNode?.getBoundingClientRect() || srcRect;

    const targetRect = target.getBoundingClientRect();
    const id = Date.now() + Math.random();

    const startX = launchRect.left + launchRect.width / 2;
    const startY = launchRect.top + launchRect.height / 2;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top - 6; // just above the cart icon
    const dx = endX - startX;
    const peakLift = Math.max(130, Math.abs(dx) * 0.26);
    const controlX = startX + (dx * 0.55);
    const controlY = Math.min(startY, endY) - peakLift;

    const item: FlyItem = {
      id,
      image: getPrimaryImage(product),
      startX,
      startY,
      controlX,
      controlY,
      endX,
      endY,
      x: startX,
      y: startY,
      scale: 1,
      opacity: 1,
      trail: [],
    };

    if (sourceEl) {
      const collapseId = id + 0.2;
      const buttonCollapse: CollapseItem = {
        id: collapseId,
        kind: 'button',
        width: srcRect.width,
        height: srcRect.height,
        startX: srcRect.left + srcRect.width / 2,
        startY: srcRect.top + srcRect.height / 2,
        targetX: startX,
        targetY: startY,
        x: srcRect.left + srcRect.width / 2,
        y: srcRect.top + srcRect.height / 2,
        scale: 1,
        opacity: 1,
        liftPx: Math.max(7, Math.min(16, srcRect.height * 0.35)),
        borderRadius: Math.max(10, Math.round(srcRect.height * 0.3)),
        background: '#15803d',
        borderColor: '#166534',
      };
      setCollapseItems((prev) => [...prev, buttonCollapse]);
      animateImageCollapse(collapseId);
    }

    if (imageNode && imageSrc) {
      const imageRect = imageNode.getBoundingClientRect();
      const constraints = getBounceConstraints(imageRect);
      const collapseId = id + 0.1;
      const collapse: CollapseItem = {
        id: collapseId,
        kind: 'image',
        image: imageSrc,
        width: imageRect.width,
        height: imageRect.height,
        startX: imageRect.left + imageRect.width / 2,
        startY: imageRect.top + imageRect.height / 2,
        targetX: startX,
        targetY: startY,
        x: imageRect.left + imageRect.width / 2,
        y: imageRect.top + imageRect.height / 2,
        scale: 1,
        opacity: 1,
        liftPx: Math.max(7, Math.min(14, imageRect.height * 0.06)),
        borderRadius: 14,
        minX: constraints.minX,
        maxX: constraints.maxX,
        minY: constraints.minY,
        maxY: constraints.maxY,
      };
      setCollapseItems((prev) => [...prev, collapse]);
      animateImageCollapse(collapseId);
    }

    flyStartTimeoutRefs.current[id] = window.setTimeout(() => {
      delete flyStartTimeoutRefs.current[id];
      setFlyItems(prev => [...prev, item]);
      animateFlyToCart(id, () => {
        // Dot has landed — bounce the cart icon
        setCartIconBounce(true);
        setTimeout(() => setCartIconBounce(false), 500);
        // Also bounce the layout header cart if it's visible
        window.dispatchEvent(new Event('cart-land'));
      });
    }, 290);
  };

  /* ── Cart helpers ─────────────────────────────────────────────────── */
  const addToCart = (product: Product, sourceEl?: HTMLElement | null, mode: CartMode = 'buy') => {
    if (product.stock === 0) {
      setShakingId(product.id);
      setTimeout(() => setShakingId(null), 450);
      return;
    }

    /* Refill mode: respect held-container cap (minus what's already reserved). */
    if (mode === 'refill') {
      const cap = refillCaps[product.id] || 0;
      const already = refillReserved(product.id);
      if (already >= cap) {
        toast.error(`You hold ${cap} container(s) of ${product.name}`);
        return;
      }
    }

    /* Stock check across all lines for this product (refill + buy). */
    const totalForProduct = cart
      .filter(i => i.product.id === product.id)
      .reduce((s, i) => s + i.quantity, 0);
    if (totalForProduct >= product.stock) return;

    const existingQty = cartInProduct(product.id, mode);

    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id && i.mode === mode);
      if (existing) {
        return prev.map(i =>
          i.product.id === product.id && i.mode === mode ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { product, quantity: 1, mode }];
    });

    // Animate only when first adding this (product, mode).
    if (existingQty === 0) {
      triggerFlyToCart(product, sourceEl);
    }
  };

  const updateQty = (id: number, qty: number, mode: CartMode = 'buy') => {
    if (qty < 1) { removeFromCart(id, mode); return; }
    const line = cart.find(i => i.product.id === id && i.mode === mode);
    if (!line) return;
    const product = line.product;
    /* Stock cap across both modes for this product */
    const otherModeQty = cart
      .filter(i => i.product.id === id && i.mode !== mode)
      .reduce((s, i) => s + i.quantity, 0);
    if (qty + otherModeQty > product.stock) return;
    /* Refill cap */
    if (mode === 'refill' && qty > (refillCaps[id] || 0)) return;
    setCart(prev => prev.map(i => (i.product.id === id && i.mode === mode) ? { ...i, quantity: qty } : i));
  };

  const removeFromCart = (id: number, mode: CartMode = 'buy') =>
    setCart(prev => prev.filter(i => !(i.product.id === id && i.mode === mode)));

  const cartTotal = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  /* Container deposits: per-unit × qty on Buy lines only; Refill lines free. */
  const containerCostsTotal = cart.reduce((s, i) => {
    if (i.mode === 'refill') return s;
    return s + (i.product.container_cost || 0) * i.quantity;
  }, 0);

  // Persist cart and broadcast cart count to shared header/state listeners.
  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  useEffect(() => {
    prevCartCountRef.current = cartCount;
  }, [cartCount]);

  // Open cart from header cart button
  useEffect(() => {
    const handler = () => setCartOpen(true);
    window.addEventListener('open-cart', handler);
    return () => window.removeEventListener('open-cart', handler);
  }, []);

  const goToCheckout = () => {
    if (cart.length === 0) { toast.error('Your cart is empty'); return; }
    setCartOpen(false);
    navigate('/shop/checkout', { state: { cart } });
  };

  const selectedBuyQty    = selectedProduct ? cartInProduct(selectedProduct.id, 'buy') : 0;
  const selectedRefillQty = selectedProduct ? cartInProduct(selectedProduct.id, 'refill') : 0;
  const selectedCap       = selectedProduct ? (refillCaps[selectedProduct.id] || 0) : 0;
  const selectedHasContainer = !!selectedProduct?.container_type;

  return (
    <div className="max-w-7xl mx-auto">

      {/* ── First-visit welcome callout ─────────────────────────────
          Explains the steel-can mechanic in one line — it's the
          unique brand promise and the thing a first-time visitor
          most needs to understand. Dismissable forever via
          localStorage; never resurfaces for returning visitors. */}
      {introOpen && (
        <div className="px-4 sm:px-6 pt-4">
          <div
            role="region"
            aria-label="Welcome to Sanathana Tattva"
            className="relative bg-brand-50 border border-brand-200 rounded-2xl p-4 sm:p-5 flex items-start gap-3"
          >
            <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
              <Package size={18} className="text-brand-700" />
            </div>
            <div className="flex-1 min-w-0 pr-7">
              <p className="font-semibold text-brand-900 text-sm sm:text-base">First time here?</p>
              <p className="text-sm text-brand-800 mt-1 leading-relaxed">
                Our oils ship in a reusable steel can. Bring it back on your next order to skip the deposit, or trade it in for store credit.
              </p>
              <button
                type="button"
                onClick={dismissIntro}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-900"
              >
                Got it
              </button>
            </div>
            <button
              type="button"
              onClick={dismissIntro}
              aria-label="Dismiss welcome message"
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-brand-700 hover:bg-brand-100 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Sticky toolbar: title + cart, search, then category chips.
          One grouped header bar keeps cart access available while
          scrolling. Filter chips replace the redundant <select>.
          z-20: below the layout's sticky nav header (z-40) so its
          notification dropdown isn't clipped. ── */}
      {/* Title row — NOT sticky. Scrolls away with the page so the
          layout's nav above us never collides with it. The persistent
          cart in the layout nav takes over once the in-toolbar cart
          scrolls out of view. */}
      <div className="px-4 sm:px-6 pt-5 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {consumer
              ? <h1 className="text-2xl font-bold text-slate-900 leading-tight truncate">{timeGreeting()}, {consumer.name.split(' ')[0]}</h1>
              : <h1 className="text-2xl font-bold text-slate-900 leading-tight">Shop</h1>
            }
            <p className="text-slate-500 text-xs font-medium mt-0.5">{products.length} {products.length === 1 ? 'product' : 'products'} available</p>
          </div>
          <button
            ref={cartButtonRef}
            data-cart-fly-target="shop"
            data-cart-fly-priority="1"
            onClick={() => setCartOpen(true)}
            aria-label={`Open cart with ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
            className={`relative w-11 h-11 flex items-center justify-center rounded-full bg-brand-600 text-white shadow-sm hover:bg-brand-700 transition-all flex-shrink-0 ${cartIconBounce ? 'animate-cart-land' : ''}`}
          >
            <ShoppingCart size={18} />
            {cartCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1.25rem] h-[1.25rem] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                <RollingNumber value={cartCount > 9 ? '9+' : cartCount} className="text-[10px] leading-none" />
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Sticky search + category chips — these stay pinned at the top
          of the viewport once the title scrolls past. Frosted glass:
          translucent fill + strong backdrop-blur + a saturation lift
          so the products behind the bar read through with their own
          warmth. z-20 keeps us below the layout nav (z-40) so its
          notification dropdown isn't clipped. */}
      <div
        className="sticky top-0 z-20 rounded-bl-[24px] rounded-br-[24px] border-b border-white/50"
        style={{
          background: 'rgba(253, 248, 240, 0.55)',
          backdropFilter: 'blur(22px) saturate(160%)',
          WebkitBackdropFilter: 'blur(22px) saturate(160%)',
          boxShadow: '0 8px 24px -16px rgba(60, 40, 10, 0.18)',
        }}
      >
        <div className="px-4 sm:px-6 pt-3 pb-2">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="form-input pl-9"
              placeholder="Search products"
              aria-label="Search products"
            />
          </div>
        </div>

        {/* Category chips: scroll horizontally on overflow instead of
            wrapping (keeps toolbar height predictable on long taxonomies). */}
        {categories.length > 0 && (
          <div
            className="pb-3 flex gap-2 overflow-x-auto px-4 sm:px-6"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' as any }}
          >
            <button
              type="button"
              onClick={() => setCatFilter('')}
              className={`flex-shrink-0 min-h-[36px] px-4 rounded-full text-xs font-semibold transition-colors ${
                !catFilter ? 'bg-brand-600 text-white' : 'bg-parchment-200 text-brand-800 hover:bg-parchment-300'
              }`}
            >
              All
            </button>
            {categories.map(c => (
              <button
                type="button"
                key={c}
                onClick={() => setCatFilter(catFilter === c ? '' : c)}
                className={`flex-shrink-0 min-h-[36px] px-4 rounded-full text-xs font-semibold transition-colors ${
                  catFilter === c ? 'bg-brand-600 text-white' : 'bg-parchment-200 text-brand-800 hover:bg-parchment-300'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Products grid: generous gap below the sticky toolbar so the
          grouping reads as a clear new section. */}
      <div className="px-4 sm:px-6 pt-8 pb-12">
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {products.map(p => {
            const buyQty    = cartInProduct(p.id, 'buy');
            const refillQty = cartInProduct(p.id, 'refill');
            const outOfStock = p.stock === 0;
            const images = getProductImages(p);
            const cap       = refillCaps[p.id] || 0;
            const hasContainer = !!p.container_type;
            return (
              <article
                key={p.id}
                ref={(el) => { cardRefs.current[p.id] = el; }}
                data-product-card-root={p.id}
                onClick={() => setSelectedProduct(p)}
                className={`card overflow-hidden flex flex-col transition-all hover:shadow-card-hover cursor-pointer ${outOfStock ? 'opacity-65' : ''}`}
              >
                <div data-product-image className="aspect-square relative overflow-hidden bg-parchment-100">
                  {images.length > 0
                    ? <ProductImageGallery images={images} name={p.name} />
                    : <div className="w-full h-full flex items-center justify-center"><Package className="w-10 h-10 text-slate-300" /></div>
                  }
                  {outOfStock && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                      <span className="bg-red-100 text-red-600 font-bold px-2 py-1 rounded-full text-xs">Out of Stock</span>
                    </div>
                  )}
                </div>

                <div className="p-3 pb-2 flex flex-col flex-1 min-h-0">
                  <span className="text-xs font-semibold text-brand-600 inline-flex items-center gap-1 whitespace-nowrap">
                    <Tag size={10} className="flex-shrink-0" />
                    {p.category}
                  </span>
                  <p className="font-bold text-slate-900 mt-1 leading-snug line-clamp-2 text-sm">{p.name}</p>
                  {p.stock > 0 && p.stock <= 10 && (
                    <p className="text-[11px] font-semibold text-amber-600 mt-1">
                      Only {p.stock} {p.stock === 1 ? 'can' : 'cans'} left
                    </p>
                  )}
                  <div className="mt-2">
                    <p className="text-base font-extrabold text-slate-900">₹{p.price.toFixed(2)}</p>
                    <p className="text-xs text-slate-500 truncate">per {p.unit || 'can'}</p>
                    {hasContainer && (p.container_cost || 0) > 0 && (
                      <p className="text-[11px] text-amber-700 font-medium mt-0.5">+₹{p.container_cost.toFixed(2)} can deposit (refundable)</p>
                    )}
                    {hasContainer && cap > 0 && (
                      <p className="text-[11px] text-emerald-700 font-medium mt-0.5">You hold {cap} · refills free</p>
                    )}
                  </div>
                </div>

                {/* Full-width touch-first CTA bar */}
                <div className="mt-auto border-t border-[#e8dcc8] p-2 bg-[#fdfaf5] space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  {/* Refill button (only when product has a container and consumer holds at least one) */}
                  {hasContainer && cap > 0 && (
                    refillQty === 0 ? (
                      <button
                        onClick={(e) => addToCart(p, e.currentTarget, 'refill')}
                        disabled={outOfStock}
                        className={`w-full min-h-[44px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                          outOfStock ? 'bg-slate-100 text-slate-500' : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99]'
                        }`}
                      >
                        <span className="truncate">Refill ({cap} held)</span>
                      </button>
                    ) : (
                      <div className="w-full min-h-[44px] rounded-xl border border-emerald-200 bg-emerald-50 flex items-center">
                        <button
                          onClick={() => updateQty(p.id, refillQty - 1, 'refill')}
                          className="w-11 h-11 flex items-center justify-center text-emerald-700"
                          aria-label="Decrease refill"
                        >
                          <Minus size={14} />
                        </button>
                        <div className="flex-1 text-center text-emerald-800 text-xs font-bold">Refill · {refillQty}/{cap}</div>
                        <button
                          onClick={() => addToCart(p, null, 'refill')}
                          disabled={refillQty >= cap}
                          className="w-11 h-11 flex items-center justify-center text-emerald-700 disabled:opacity-40"
                          aria-label="Increase refill"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )
                  )}
                  {/* Buy more / Add to Cart */}
                  {buyQty === 0 ? (
                    <button
                      onClick={(e) => addToCart(p, e.currentTarget, 'buy')}
                      className={`w-full min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                        outOfStock
                          ? `bg-red-50 text-red-500 ${shakingId === p.id ? 'animate-shake' : ''}`
                          : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.99]'
                      }`}
                    >
                      <ShoppingCart size={14} />
                      <span className="truncate">{hasContainer && cap > 0 ? 'Buy more' : 'Add to Cart'}</span>
                    </button>
                  ) : (
                    <div className="w-full min-h-[44px] rounded-xl border border-brand-200 bg-brand-50 flex items-center">
                      <button
                        onClick={() => updateQty(p.id, buyQty - 1, 'buy')}
                        className="w-11 h-11 flex items-center justify-center text-brand-700 active:scale-95 transition-transform"
                        aria-label={`Decrease ${p.name}`}
                      >
                        <Minus size={16} />
                      </button>
                      <div className="flex-1 text-center text-brand-800 text-sm font-bold">
                        <RollingNumber value={buyQty} className="text-sm leading-none" />
                      </div>
                      <button
                        onClick={() => addToCart(p, null, 'buy')}
                        className="w-11 h-11 flex items-center justify-center text-brand-700 active:scale-95 transition-transform"
                        aria-label={`Increase ${p.name}`}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
          {products.length === 0 && (
            <div className="col-span-full text-center py-16 text-slate-500">
              <Package size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="font-medium">
                {(search || catFilter) ? 'Nothing matches that.' : 'No oils available right now.'}
              </p>
              {(search || catFilter) && (
                <p className="text-xs text-slate-500 mt-1">Try a different search, or clear the filters.</p>
              )}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Product Detail Sheet */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button
            aria-label="Close product details"
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => setSelectedProduct(null)}
          />
          <div className="relative w-full max-w-2xl bg-[#fffbf2] rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden animate-slide-up">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e8dcc8]">
              <div className="flex items-center gap-2 text-slate-600 text-sm">
                <Info size={15} />
                Product details
              </div>
              <button onClick={() => setSelectedProduct(null)} className="btn-ghost p-2">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
              <div className="h-80 sm:h-96 bg-[#fdfaf5] relative" data-product-modal-image={selectedProduct.id}>
                {getProductImages(selectedProduct).length > 0
                  ? <ProductImageGallery images={getProductImages(selectedProduct)} name={selectedProduct.name} contain />
                  : <div className="w-full h-full flex items-center justify-center"><Package className="w-14 h-14 text-slate-300" /></div>
                }
              </div>
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-brand-600 inline-flex items-center gap-1 whitespace-nowrap">
                      <Tag size={10} />
                      {selectedProduct.category}
                    </p>
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900 mt-1 break-words">{selectedProduct.name}</h3>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xl font-extrabold text-slate-900">₹{selectedProduct.price.toFixed(2)}</p>
                    <p className="text-xs text-slate-500">per {selectedProduct.unit || 'can'}</p>
                    {selectedHasContainer && (selectedProduct.container_cost || 0) > 0 && (
                      <p className="text-xs text-amber-700 font-medium mt-0.5">+₹{selectedProduct.container_cost.toFixed(2)} can deposit (refundable)</p>
                    )}
                    {selectedHasContainer && selectedCap > 0 && (
                      <p className="text-xs text-emerald-700 font-medium mt-0.5">You hold {selectedCap} · refills free</p>
                    )}
                  </div>
                </div>

                <p className="text-sm leading-6 text-slate-700 whitespace-pre-wrap break-words">
                  {selectedProduct.description?.trim() || 'No description added for this product yet.'}
                </p>
              </div>

              {/* Reviews section */}
              <ProductReviews productId={selectedProduct.id} consumer={consumer} />
            </div>


            <div className="border-t border-[#e8dcc8] p-3 sm:p-4 bg-[#fffbf2] space-y-2">
              {/* Refill control */}
              {selectedHasContainer && selectedCap > 0 && (
                selectedRefillQty === 0 ? (
                  <button
                    onClick={(e) => addToCart(selectedProduct, e.currentTarget, 'refill')}
                    disabled={selectedProduct.stock === 0}
                    className="w-full min-h-[42px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    Refill ({selectedCap} held · no deposit)
                  </button>
                ) : (
                  <div className="w-full min-h-[42px] rounded-xl border border-emerald-200 bg-emerald-50 flex items-center">
                    <button
                      onClick={() => updateQty(selectedProduct.id, selectedRefillQty - 1, 'refill')}
                      className="w-11 h-11 flex items-center justify-center text-emerald-700"
                    >
                      <Minus size={16} />
                    </button>
                    <div className="flex-1 text-center text-emerald-800 text-sm font-bold">Refill · {selectedRefillQty}/{selectedCap}</div>
                    <button
                      onClick={() => addToCart(selectedProduct, null, 'refill')}
                      disabled={selectedRefillQty >= selectedCap}
                      className="w-11 h-11 flex items-center justify-center text-emerald-700 disabled:opacity-40"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )
              )}
              {/* Buy / Add to Cart */}
              {selectedBuyQty === 0 ? (
                <button
                  onClick={(e) => addToCart(selectedProduct, e.currentTarget, 'buy')}
                  className={`w-full min-h-[46px] rounded-xl text-sm sm:text-base font-semibold flex items-center justify-center gap-2 transition-colors ${
                    selectedProduct.stock === 0
                      ? 'bg-red-50 text-red-500'
                      : 'bg-brand-600 text-white hover:bg-brand-700'
                  }`}
                >
                  <ShoppingCart size={16} />
                  {selectedProduct.stock === 0 ? 'Out of Stock' : (selectedHasContainer && selectedCap > 0 ? 'Buy more' : 'Add to Cart')}
                </button>
              ) : (
                <div className="w-full min-h-[46px] rounded-xl border border-brand-200 bg-brand-50 flex items-center">
                  <button
                    onClick={() => updateQty(selectedProduct.id, selectedBuyQty - 1, 'buy')}
                    className="w-12 h-12 flex items-center justify-center text-brand-700 active:scale-95 transition-transform"
                    aria-label={`Decrease ${selectedProduct.name}`}
                  >
                    <Minus size={18} />
                  </button>
                  <div className="flex-1 text-center text-brand-800 text-base font-bold">
                    <RollingNumber value={selectedBuyQty} className="text-base leading-none" />
                  </div>
                  <button
                    onClick={() => addToCart(selectedProduct, null, 'buy')}
                    className="w-12 h-12 flex items-center justify-center text-brand-700 active:scale-95 transition-transform"
                    aria-label={`Increase ${selectedProduct.name}`}
                  >
                    <Plus size={18} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fly-to-cart: collapse-and-lift layer.
          Same z-index as the fly-trail layer below; DOM order keeps the
          trail on top. Avoids arbitrary [69]/[70] z-values. */}
      <div className="pointer-events-none fixed inset-0 z-50">
        {collapseItems.map(item => (
          <div
            key={item.id}
            className="absolute overflow-hidden shadow-md"
            style={{
              left: `${item.x}px`,
              top: `${item.y}px`,
              width: `${item.width}px`,
              height: `${item.height}px`,
              transform: `translate(-50%, -50%) scale(${item.scale})`,
              opacity: item.opacity,
              transformOrigin: 'center center',
              borderRadius: `${item.borderRadius}px`,
              background: item.kind === 'button' ? (item.background || '#15803d') : '#ffffff',
              border: `1px solid ${item.kind === 'button' ? (item.borderColor || '#166534') : '#ffffff99'}`,
            }}
          >
            {item.kind === 'image' && item.image
              ? <img src={item.image} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-brand-700/90" />
            }
          </div>
        ))}
      </div>

      {/* Fly-to-cart: trail dots + ghost image. Rendered after the
          collapse layer so it stacks above it via DOM order. */}
      <div className="pointer-events-none fixed inset-0 z-50">
        {flyItems.map(item => (
          <React.Fragment key={item.id}>
            {item.trail.map((node, idx) => {
              const size = 2.4 + (node.life * 3.6);
              return (
                <div
                  key={`${item.id}-trail-${idx}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600"
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${size}px`,
                    height: `${size}px`,
                    opacity: Math.max(0, item.opacity * node.life * 0.58),
                  }}
                />
              );
            })}
            <div
              className="absolute w-10 h-10 rounded-full overflow-hidden border border-brand-200 shadow-lg bg-white"
              style={{
                left: `${item.x}px`,
                top: `${item.y}px`,
                transform: `translate(-50%, -50%) scale(${item.scale})`,
                opacity: item.opacity,
              }}
            >
              {item.image
                ? <img src={item.image} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-brand-600"><ShoppingCart size={14} /></div>
              }
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* ── Cart Drawer ───────────────────────────────────────────────── */}
      <div className={`fixed inset-0 z-50 transition-all duration-300 ${cartOpen ? 'visible' : 'invisible pointer-events-none'}`}>
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${cartOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setCartOpen(false)}
        />

        {/* Mobile: bottom sheet | Desktop: right drawer */}
        <div className={`
          absolute bg-[#fffbf2] shadow-2xl flex flex-col
          sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-full sm:w-full sm:max-w-sm sm:rounded-none sm:rounded-l-2xl
          inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl
          sm:transition-transform sm:duration-300 sm:ease-out
          transition-transform duration-300 ease-out
          ${cartOpen
            ? 'translate-y-0 sm:translate-x-0'
            : 'translate-y-full sm:translate-x-full sm:translate-y-0'
          }
        `}>
          {/* Drag handle (mobile only) */}
          <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 rounded-full bg-parchment-300" />
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-b border-[#e8dcc8] flex-shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} className="text-brand-600" />
              <h3 className="font-bold text-slate-900 text-base">Cart ({cartCount})</h3>
            </div>
            <button onClick={() => setCartOpen(false)} className="w-8 h-8 rounded-full bg-parchment-200 flex items-center justify-center hover:bg-parchment-300 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 overscroll-contain">
            {cart.length === 0 ? (
              <div className="text-center py-16">
                <ShoppingCart size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="font-medium text-slate-700">Nothing in here yet.</p>
                <p className="text-xs mt-1 text-slate-500">Add a can to get going.</p>
              </div>
            ) : cart.map(({ product, quantity, mode }) => {
              const isBuy = mode === 'buy';
              const showsDeposit = isBuy && (product.container_cost || 0) > 0;
              return (
                <div key={`${product.id}::${mode}`} className="flex items-center gap-3 p-3 bg-parchment-100 rounded-2xl">
                  <div className="w-14 h-14 rounded-xl bg-[#fffbf2] border border-[#e8dcc8] overflow-hidden flex-shrink-0">
                    {getPrimaryImage(product)
                      ? <img src={getPrimaryImage(product)} alt={product.name} className="w-full h-full object-cover" />
                      : <Package size={18} className="text-slate-300 m-auto mt-4" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-sm text-slate-900 truncate">{product.name}</p>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        mode === 'refill' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {mode === 'refill' ? 'REFILL' : 'NEW'}
                      </span>
                    </div>
                    <p className="text-xs text-brand-600 font-semibold mt-0.5">₹{product.price.toFixed(2)}/{product.unit || 'unit'}</p>
                    {showsDeposit && (
                      <p className="text-xs text-amber-600 font-medium mt-0.5">+₹{(product.container_cost * quantity).toFixed(2)} container deposit</p>
                    )}
                    {mode === 'refill' && (
                      <p className="text-xs text-emerald-600 font-medium mt-0.5">Re-uses your held container (no deposit)</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => updateQty(product.id, quantity - 1, mode)}
                        className="w-7 h-7 rounded-lg bg-[#fffbf2] border border-[#e8dcc8] flex items-center justify-center hover:bg-parchment-200 active:scale-95 transition-all"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-sm font-bold w-6 text-center">{quantity}</span>
                      <button
                        onClick={() => updateQty(product.id, quantity + 1, mode)}
                        className="w-7 h-7 rounded-lg bg-[#fffbf2] border border-[#e8dcc8] flex items-center justify-center hover:bg-parchment-200 active:scale-95 transition-all"
                      >
                        <Plus size={12} />
                      </button>
                      <span className="ml-auto text-sm font-bold text-slate-900">₹{(product.price * quantity).toFixed(2)}</span>
                    </div>
                  </div>
                  <button onClick={() => removeFromCart(product.id, mode)} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>

          {cart.length > 0 && (() => {
            const baseSubtotal = cartTotal / 1.05;
            const gstAmount    = cartTotal - baseSubtotal;
            const rawTotal     = cartTotal + containerCostsTotal;
            const cartFinal    = Math.ceil(rawTotal);
            const cartRounding = cartFinal - rawTotal;
            return (
            <div className="p-4 border-t border-[#e8dcc8] space-y-2 flex-shrink-0 pb-safe">
              <div className="flex justify-between items-center text-sm text-slate-500">
                <span>{cartCount} item{cartCount !== 1 ? 's' : ''} (incl. GST)</span>
                <span>₹{cartTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400 pl-3">
                <span>Base price</span>
                <span>₹{baseSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400 pl-3">
                <span>GST (5%)</span>
                <span>₹{gstAmount.toFixed(2)}</span>
              </div>
              {containerCostsTotal > 0 && (
                <div className="flex justify-between items-baseline gap-3 text-sm text-amber-600 font-medium">
                  <span className="flex-1 min-w-0">Container deposit (refundable)</span>
                  <span className="whitespace-nowrap flex-shrink-0">+ ₹{containerCostsTotal.toFixed(2)}</span>
                </div>
              )}
              {cartRounding > 0 && (
                <div className="flex justify-between text-xs text-slate-500 italic">
                  <span>Rounding (up to nearest ₹)</span>
                  <span>+₹{cartRounding.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-900">Total</span>
                <span className="text-xl font-extrabold text-brand-600">₹{cartFinal}</span>
              </div>
              {cartRounding > 0 && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Your total has been rounded up to the nearest rupee.
                </p>
              )}
              {consumer?.referral_code_used && discountPct > 0 && (
                <p className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
                  <Tag size={11} /> {discountPct}% referral discount applied at checkout
                </p>
              )}
              <button onClick={goToCheckout} className="btn-primary w-full py-3.5 text-base font-semibold rounded-2xl active:scale-[0.98] transition-transform">
                Proceed to Checkout →
              </button>
            </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

/* ── Star rating display ─────────────────────────────────────────────── */
function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(n => (
        <Star key={n} size={size} className={n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200 fill-slate-200'} />
      ))}
    </div>
  );
}

/* ── Product reviews section ─────────────────────────────────────────── */
function ProductReviews({ productId, consumer }: { productId: number; consumer: any }) {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<any[]>([]);
  const [avg, setAvg] = useState<number | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    consumerApi.get(`/consumer/products/${productId}/reviews`)
      .then(r => {
        setReviews(r.data.reviews || []);
        setAvg(r.data.average_rating);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    if (consumer) {
      consumerApi.get(`/consumer/review/check?pid=${productId}`)
        .then(r => {
          setCanReview(r.data.can_review);
          setAlreadyReviewed(r.data.already_reviewed);
        })
        .catch(() => {});
    }
  }, [productId, consumer]);

  return (
    <div className="border-t border-[#e8dcc8] px-4 sm:px-5 pb-4 sm:pb-5 pt-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="text-slate-500" />
          <span className="font-semibold text-slate-800 text-sm">
            Reviews {reviews.length > 0 && `(${reviews.length})`}
          </span>
          {avg !== null && (
            <div className="flex items-center gap-1">
              <StarRow rating={Math.round(avg)} size={12} />
              <span className="text-xs text-slate-500">{avg.toFixed(1)}</span>
            </div>
          )}
        </div>
        {consumer && canReview && !alreadyReviewed && (
          <button
            onClick={() => navigate(`/shop/review?pid=${productId}`)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            Write a Review
          </button>
        )}
        {consumer && alreadyReviewed && (
          <span className="text-xs text-slate-400 italic">You reviewed this</span>
        )}
      </div>

      {loading && <p className="text-xs text-slate-400 py-2">Loading reviews…</p>}

      {!loading && reviews.length === 0 && (
        <p className="text-xs text-slate-400 py-2">No reviews yet. Be the first!</p>
      )}

      {/* Review list */}
      <div className="space-y-4">
        {reviews.map(r => {
          const imgs: string[] = (() => { try { return r.images ? JSON.parse(r.images) : []; } catch { return []; } })();
          return (
            <div key={r.id} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xs flex-shrink-0">
                  {r.consumer_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-800 truncate">{r.consumer_name}</span>
                    {r.verified_buyer === 1 && (
                      <span className="text-[10px] text-brand-600 font-medium bg-brand-50 px-1.5 py-0.5 rounded">Verified</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <StarRow rating={r.rating} size={11} />
                    <span className="text-[10px] text-slate-400">
                      {formatIstDate(r.created_at)}
                    </span>
                  </div>
                </div>
              </div>
              {r.body && <p className="text-xs text-slate-600 leading-5 ml-9">{r.body}</p>}
              {imgs.length > 0 && (
                <div className="flex gap-2 ml-9 flex-wrap">
                  {imgs.map((img, i) => (
                    <button key={i} onClick={() => setLightboxImg(img)} className="w-16 h-16 rounded-lg overflow-hidden border border-[#e8dcc8] flex-shrink-0">
                      <img src={img} alt="Review" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Image lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
          <img src={lightboxImg} alt="Review photo" className="max-w-full max-h-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}

function ProductImageGallery({ images, name, contain }: { images: string[]; name: string; contain?: boolean }) {
  const [desktopIndex, setDesktopIndex] = useState(0);
  const [mobileIndex, setMobileIndex] = useState(0);
  const mobileTrackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDesktopIndex(0);
    setMobileIndex(0);
    if (mobileTrackRef.current) {
      mobileTrackRef.current.scrollLeft = 0;
    }
  }, [images.join('|')]);

  const onMobileScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!el.clientWidth) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setMobileIndex(idx);
  };

  return (
    <div className="absolute inset-0">
      {/* Mobile: touch-first horizontal swipe */}
      <div className="sm:hidden h-full">
        <div
          ref={mobileTrackRef}
          onScroll={onMobileScroll}
          className="h-full flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
        >
          {images.map((img, idx) => (
            <div key={`${img}-${idx}`} className="w-full h-full flex-shrink-0 snap-center">
              <img src={img} alt={name} className={`w-full h-full ${contain ? 'object-contain' : 'object-cover'}`} />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <div className="absolute bottom-2 inset-x-0 flex items-center justify-center gap-1.5">
            {images.map((_, idx) => (
              <span
                key={idx}
                className={`w-1.5 h-1.5 rounded-full transition-all ${idx === mobileIndex ? 'bg-white w-4' : 'bg-white/60'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop: image + dots carousel controls */}
      <div className="hidden sm:block h-full relative">
        <img src={images[desktopIndex] || images[0]} alt={name} className={`w-full h-full ${contain ? 'object-contain' : 'object-cover'}`} />
        {images.length > 1 && (
          <div className="absolute bottom-2 inset-x-0 flex items-center justify-center gap-1.5">
            {images.map((_, idx) => (
              <button
                key={idx}
                onClick={(e) => { e.stopPropagation(); setDesktopIndex(idx); }}
                className={`h-1.5 rounded-full transition-all ${idx === desktopIndex ? 'bg-white w-5' : 'bg-white/60 w-1.5'}`}
                aria-label={`View image ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
