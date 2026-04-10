import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import RollingNumber from '../../components/RollingNumber';
import { loadCart, saveCart } from '../../services/cartStorage';
import {
  ShoppingCart, Search, Package, Plus, Minus, X, Trash2, Tag, ChevronDown, Info,
} from 'lucide-react';

interface Product {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  image_url: string;
  image_urls?: string | null;
  unit: string;
  sku: string;
}

interface CartItem {
  product: Product;
  quantity: number;
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

export default function Shop() {
  const { consumer } = useAuth();
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [discountPct, setDiscountPct] = useState<number>(0);
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

  // Restore persisted cart
  useEffect(() => {
    setCart(loadCart<Product>());
  }, []);

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
          newCart.push({ product, quantity: Math.min(qty, product.stock) });
        }
      }
      if (newCart.length) {
        setCart((prev) => {
          const map = new Map<number, CartItem>();
          prev.forEach((i) => map.set(i.product.id, { ...i }));
          newCart.forEach((i) => {
            const ex = map.get(i.product.id);
            if (!ex) {
              map.set(i.product.id, i);
              return;
            }
            map.set(i.product.id, {
              product: i.product,
              quantity: Math.min(i.product.stock, ex.quantity + i.quantity),
            });
          });
          return Array.from(map.values()).filter(i => i.quantity > 0);
        });
        setCartOpen(true);
        toast.success('Your previous items are in the cart!');
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
        if (qty > 0) merged.push({ product: fresh, quantity: qty });
      });
      return merged;
    });
  }, [products]);

  useEffect(() => {
    api.get('/consumer/settings')
      .then(r => setDiscountPct(parseFloat(r.data.referral_discount_percent) || 0))
      .catch(() => {});
  }, []);

  const cartInProduct = (id: number) => cart.find(i => i.product.id === id)?.quantity ?? 0;

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

  const animateFlyToCart = (id: number, durationMs = 870) => {
    const startedAt = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      setFlyItems((prev) => prev.map((item) => {
        if (item.id !== id) return item;

        // Exact quadratic Bezier parabola to cart.
        const travelT = t;
        // log2-based deceleration curve (fast start -> smooth slowdown).
        const decelT = Math.log2(1 + 31 * travelT) / Math.log2(32);
        const mt = 1 - decelT;
        const x = mt * mt * item.startX + 2 * mt * decelT * item.controlX + decelT * decelT * item.endX;
        const y = mt * mt * item.startY + 2 * mt * decelT * item.controlY + decelT * decelT * item.endY;

        // Bezier-based trail: evenly spaced dots at prior t-values on the same curve.
        // Each dot is spaced 0.06 behind in decelT — prevents clustering at slow zones.
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
    const endY = targetRect.top + 6; // aim at the top of the cart icon
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
      animateFlyToCart(id);
    }, 290);
  };

  /* ── Cart helpers ─────────────────────────────────────────────────── */
  const addToCart = (product: Product, sourceEl?: HTMLElement | null) => {
    if (product.stock === 0) {
      setShakingId(product.id);
      setTimeout(() => setShakingId(null), 450);
      return;
    }

    const existingQty = cartInProduct(product.id);
    if (existingQty >= product.stock) return;

    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) {
        return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { product, quantity: 1 }];
    });

    // Animate only for unique product additions.
    if (existingQty === 0) {
      triggerFlyToCart(product, sourceEl);
    }
  };

  const updateQty = (id: number, qty: number) => {
    if (qty < 1) { removeFromCart(id); return; }
    const product = cart.find(i => i.product.id === id)?.product;
    if (product && qty > product.stock) return;
    setCart(prev => prev.map(i => i.product.id === id ? { ...i, quantity: qty } : i));
  };

  const removeFromCart = (id: number) => setCart(prev => prev.filter(i => i.product.id !== id));

  const cartTotal = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  // Persist cart and broadcast cart count to shared header/state listeners.
  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  useEffect(() => {
    if (cartCount > prevCartCountRef.current) {
      setCartIconBounce(true);
      const timer = setTimeout(() => setCartIconBounce(false), 420);
      prevCartCountRef.current = cartCount;
      return () => clearTimeout(timer);
    }
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

  const selectedQty = selectedProduct ? cartInProduct(selectedProduct.id) : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Header — sticky below the layout navbar (h-14 = 56px) */}
      <div className="sticky top-14 z-30 bg-white/95 backdrop-blur-sm flex items-center justify-between gap-3 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 border-b border-gray-100/80">
        <div>
          {consumer
            ? <h1 className="text-xl font-bold text-gray-900">Hi, {consumer.name.split(' ')[0]}!</h1>
            : <h1 className="text-xl font-bold text-gray-900">Shop</h1>
          }
          <p className="text-gray-400 text-xs mt-0.5">{products.length} products available</p>
        </div>
        <button
          ref={cartButtonRef}
          data-cart-fly-target="shop"
          data-cart-fly-priority="1"
          onClick={() => setCartOpen(true)}
          className="relative w-10 h-10 flex items-center justify-center rounded-full bg-brand-600 text-white shadow-sm hover:bg-brand-700 transition-colors"
        >
          <ShoppingCart size={18} />
          {cartCount > 0 && (
            <span className={`absolute -top-1.5 -right-1.5 min-w-[1.25rem] h-[1.25rem] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none ${cartIconBounce ? 'animate-drop-bounce' : ''}`}>
              <RollingNumber value={cartCount > 9 ? '9+' : cartCount} className="text-[10px] leading-none" />
            </span>
          )}
        </button>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="form-input pl-9"
            placeholder="Search products..."
          />
        </div>
        <div className="relative">
          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
            className="form-input appearance-none pr-8 min-w-36"
          >
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setCatFilter('')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              !catFilter ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All
          </button>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setCatFilter(catFilter === c ? '' : c)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                catFilter === c ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Products grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {products.map(p => {
            const inCart = cartInProduct(p.id);
            const outOfStock = p.stock === 0;
            const images = getProductImages(p);
            return (
              <article
                key={p.id}
                ref={(el) => { cardRefs.current[p.id] = el; }}
                data-product-card-root={p.id}
                onClick={() => setSelectedProduct(p)}
                className={`card overflow-hidden flex flex-col transition-all hover:shadow-card-hover cursor-pointer ${outOfStock ? 'opacity-65' : ''}`}
              >
                <div data-product-image className="aspect-square relative overflow-hidden bg-slate-100">
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
                  <span className="text-xs font-semibold text-brand-600 flex items-center gap-1 min-w-0 truncate">
                    <Tag size={10} className="flex-shrink-0" />
                    <span className="truncate">{p.category}</span>
                  </span>
                  <p className="font-bold text-slate-900 mt-1 leading-snug line-clamp-2 text-sm">{p.name}</p>
                  {p.stock > 0 && p.stock <= 10 && (
                    <p className="text-[11px] font-semibold text-amber-600 mt-1">
                      Only {p.stock} {p.stock === 1 ? 'can' : 'cans'} left
                    </p>
                  )}
                  <div className="mt-2">
                    <p className="text-base font-extrabold text-slate-900">₹{p.price.toFixed(2)}</p>
                    <p className="text-xs text-slate-400 truncate">per {p.unit || 'can'}</p>
                  </div>
                </div>

                {/* Full-width touch-first CTA bar */}
                <div className="mt-auto border-t border-[#e8dcc8] p-2 bg-white" onClick={(e) => e.stopPropagation()}>
                  {inCart === 0 ? (
                    <button
                      onClick={(e) => addToCart(p, e.currentTarget)}
                      className={`w-full min-h-[40px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                        outOfStock
                          ? `bg-red-50 text-red-500 ${shakingId === p.id ? 'animate-shake' : ''}`
                          : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.99]'
                      }`}
                    >
                      <ShoppingCart size={14} />
                      <span className="truncate">Add to Cart</span>
                    </button>
                  ) : (
                    <div className="w-full min-h-[40px] rounded-xl border border-brand-200 bg-brand-50 flex items-center">
                      <button
                        onClick={() => updateQty(p.id, inCart - 1)}
                        className="w-10 h-10 flex items-center justify-center text-brand-700 active:scale-95 transition-transform"
                        aria-label={`Decrease ${p.name}`}
                      >
                        <Minus size={16} />
                      </button>
                      <div className="flex-1 text-center text-brand-800 text-sm font-bold">
                        <RollingNumber value={inCart} className="text-sm leading-none" />
                      </div>
                      <button
                        onClick={() => addToCart(p)}
                        className="w-10 h-10 flex items-center justify-center text-brand-700 active:scale-95 transition-transform"
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
            <div className="col-span-full text-center py-16 text-slate-400">
              <Package size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No products found</p>
            </div>
          )}
        </div>
      )}

      {/* Product Detail Sheet */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button
            aria-label="Close product details"
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => setSelectedProduct(null)}
          />
          <div className="relative w-full max-w-2xl bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden animate-slide-up">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-600 text-sm">
                <Info size={15} />
                Product details
              </div>
              <button onClick={() => setSelectedProduct(null)} className="btn-ghost p-2">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
              <div className="h-72 sm:h-80 bg-slate-100 relative" data-product-modal-image={selectedProduct.id}>
                {getProductImages(selectedProduct).length > 0
                  ? <ProductImageGallery images={getProductImages(selectedProduct)} name={selectedProduct.name} />
                  : <div className="w-full h-full flex items-center justify-center"><Package className="w-14 h-14 text-slate-300" /></div>
                }
              </div>
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-brand-600 flex items-center gap-1">
                      <Tag size={10} />
                      <span className="truncate">{selectedProduct.category}</span>
                    </p>
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900 mt-1 break-words">{selectedProduct.name}</h3>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xl font-extrabold text-slate-900">₹{selectedProduct.price.toFixed(2)}</p>
                    <p className="text-xs text-slate-400">per {selectedProduct.unit || 'can'}</p>
                  </div>
                </div>

                <p className="text-sm leading-6 text-slate-600 whitespace-pre-wrap break-words">
                  {selectedProduct.description?.trim() || 'No description added for this product yet.'}
                </p>
              </div>
            </div>

            <div className="border-t border-slate-100 p-3 sm:p-4 bg-white">
              {selectedQty === 0 ? (
                <button
                  onClick={(e) => addToCart(selectedProduct, e.currentTarget)}
                  className={`w-full min-h-[46px] rounded-xl text-sm sm:text-base font-semibold flex items-center justify-center gap-2 transition-colors ${
                    selectedProduct.stock === 0
                      ? 'bg-red-50 text-red-500'
                      : 'bg-brand-600 text-white hover:bg-brand-700'
                  }`}
                >
                  <ShoppingCart size={16} />
                  {selectedProduct.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
                </button>
              ) : (
                <div className="w-full min-h-[46px] rounded-xl border border-brand-200 bg-brand-50 flex items-center">
                  <button
                    onClick={() => updateQty(selectedProduct.id, selectedQty - 1)}
                    className="w-12 h-12 flex items-center justify-center text-brand-700 active:scale-95 transition-transform"
                    aria-label={`Decrease ${selectedProduct.name}`}
                  >
                    <Minus size={18} />
                  </button>
                  <div className="flex-1 text-center text-brand-800 text-base font-bold">
                    <RollingNumber value={selectedQty} className="text-base leading-none" />
                  </div>
                  <button
                    onClick={() => addToCart(selectedProduct)}
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

      {/* Fly-to-cart animation layer */}
      <div className="pointer-events-none fixed inset-0 z-[69]">
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

      {/* Fly-to-cart animation layer */}
      <div className="pointer-events-none fixed inset-0 z-[70]">
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
              className="absolute -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full overflow-hidden border border-brand-200 shadow-lg bg-white"
              style={{
                left: `${item.x}px`,
                top: `${item.y}px`,
                transform: `scale(${item.scale})`,
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
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
          <div className="relative ml-auto w-full max-w-sm bg-white h-full flex flex-col shadow-2xl">

            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} className="text-brand-600" />
                <h3 className="font-bold text-slate-900">Cart ({cartCount})</h3>
              </div>
              <button onClick={() => setCartOpen(false)} className="btn-ghost p-2">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <ShoppingCart size={36} className="mx-auto mb-2 opacity-30" />
                  <p>Your cart is empty</p>
                  <p className="text-xs mt-1">Add some products to get started</p>
                </div>
              ) : cart.map(({ product, quantity }) => (
                <div key={product.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="w-12 h-12 rounded-lg bg-white border border-slate-100 overflow-hidden flex-shrink-0">
                    {getPrimaryImage(product)
                      ? <img src={getPrimaryImage(product)} alt={product.name} className="w-full h-full object-cover" />
                      : <Package size={16} className="text-slate-300 m-auto mt-3.5" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-900 truncate">{product.name}</p>
                    <p className="text-xs text-brand-600 font-semibold">₹{product.price.toFixed(2)}/{product.unit || 'can'}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => updateQty(product.id, quantity - 1)}
                        className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-sm font-bold w-6 text-center">{quantity}</span>
                      <button
                        onClick={() => updateQty(product.id, quantity + 1)}
                        className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"
                      >
                        <Plus size={12} />
                      </button>
                      <span className="ml-auto text-sm font-bold">₹{(product.price * quantity).toFixed(2)}</span>
                    </div>
                  </div>
                  <button onClick={() => removeFromCart(product.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {cart.length > 0 && (
              <div className="p-4 border-t border-slate-100 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 text-sm">{cartCount} items</span>
                  <span className="text-xl font-extrabold text-brand-600">₹{cartTotal.toFixed(2)}</span>
                </div>
                {consumer?.referral_code_used && discountPct > 0 && (
                  <p className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
                    <Tag size={11} /> {discountPct}% referral discount applied at checkout
                  </p>
                )}
                <button onClick={goToCheckout} className="btn-primary w-full py-3 text-base font-semibold">
                  Proceed to Checkout →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductImageGallery({ images, name }: { images: string[]; name: string }) {
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
              <img src={img} alt={name} className="w-full h-full object-cover" />
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
        <img src={images[desktopIndex] || images[0]} alt={name} className="w-full h-full object-cover" />
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
