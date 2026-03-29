import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Search, ShoppingCart, Plus, Minus, X, Package, Trash2, ChevronDown,
  CheckCircle2, Tag,
} from 'lucide-react';

interface Product {
  id: number; name: string; description: string; category: string;
  price: number; stock: number; image_url: string; unit: string; sku: string;
}
interface CartItem { product: Product; quantity: number; }

export default function TraderProducts() {
  const [products,  setProducts]  = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [cart,      setCart]      = useState<CartItem[]>([]);
  const [cartOpen,  setCartOpen]  = useState(false);
  const [notes,     setNotes]     = useState('');
  const [placing,   setPlacing]   = useState(false);

  const fetch = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (search)    params.search   = search;
    if (catFilter) params.category = catFilter;
    api.get('/trader/products', { params })
      .then(r => { setProducts(r.data.products); setCategories(r.data.categories); })
      .finally(() => setLoading(false));
  }, [search, catFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  const addToCart = (product: Product) => {
    if (product.stock === 0) { toast.error('Out of stock'); return; }
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) { toast.error('Insufficient stock'); return prev; }
        return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      toast.success(`${product.name} added to cart`);
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQty = (id: number, qty: number) => {
    if (qty < 1) { removeFromCart(id); return; }
    const product = cart.find(i => i.product.id === id)?.product;
    if (product && qty > product.stock) { toast.error('Insufficient stock'); return; }
    setCart(prev => prev.map(i => i.product.id === id ? { ...i, quantity: qty } : i));
  };

  const removeFromCart = (id: number) => setCart(prev => prev.filter(i => i.product.id !== id));

  const cartTotal   = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const cartItems   = cart.reduce((s, i) => s + i.quantity, 0);

  const placeOrder = async () => {
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    setPlacing(true);
    try {
      await api.post('/trader/orders', {
        items: cart.map(i => ({ product_id: i.product.id, quantity: i.quantity })),
        notes: notes || undefined,
      });
      toast.success('Order placed successfully! 🎉');
      setCart([]); setNotes(''); setCartOpen(false); fetch();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to place order');
    } finally { setPlacing(false); }
  };

  const cartInProduct = (id: number) => cart.find(i => i.product.id === id)?.quantity ?? 0;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Products</h2>
          <p className="text-slate-500 text-sm mt-0.5">{products.length} products available</p>
        </div>
        <button
          onClick={() => setCartOpen(true)}
          className="relative btn-primary"
        >
          <ShoppingCart size={16} />
          <span className="hidden sm:inline">Cart</span>
          {cartItems > 0 && (
            <span className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
              {cartItems > 9 ? '9+' : cartItems}
            </span>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="form-input pl-9" placeholder="Search products..." />
        </div>
        <div className="relative">
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="form-input appearance-none pr-8 min-w-36">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setCatFilter('')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${!catFilter ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            All
          </button>
          {categories.map(c => (
            <button key={c} onClick={() => setCatFilter(catFilter === c ? '' : c)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${catFilter === c ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Products Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map(p => {
            const inCart = cartInProduct(p.id);
            const outOfStock = p.stock === 0;
            return (
              <div key={p.id} className={`card overflow-hidden flex flex-col transition-all hover:shadow-card-hover ${outOfStock ? 'opacity-60' : ''}`}>
                <div className="aspect-[4/3] relative overflow-hidden bg-slate-100">
                  {p.image_url
                    ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                    : <div className="w-full h-full flex items-center justify-center"><Package className="w-12 h-12 text-slate-300" /></div>
                  }
                  {inCart > 0 && (
                    <div className="absolute top-2 right-2 bg-brand-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      ×{inCart}
                    </div>
                  )}
                  {outOfStock && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                      <span className="bg-red-100 text-red-600 font-bold px-3 py-1 rounded-full text-xs">Out of Stock</span>
                    </div>
                  )}
                </div>
                <div className="p-4 flex flex-col flex-1">
                  <span className="text-xs font-semibold text-brand-600 flex items-center gap-1"><Tag size={10} />{p.category}</span>
                  <p className="font-bold text-slate-900 mt-1 leading-snug line-clamp-2 text-sm flex-1">{p.name}</p>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{p.description}</p>
                  <div className="flex items-center justify-between mt-3">
                    <div>
                      <p className="text-lg font-extrabold text-slate-900">${p.price.toFixed(2)}</p>
                      <p className="text-xs text-slate-400">{p.stock} {p.unit}s left</p>
                    </div>
                    <button
                      onClick={() => addToCart(p)}
                      disabled={outOfStock}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                        outOfStock ? 'bg-slate-100 text-slate-300 cursor-not-allowed' :
                        inCart > 0  ? 'bg-brand-600 text-white shadow-md' :
                        'bg-brand-50 text-brand-600 hover:bg-brand-600 hover:text-white'
                      }`}
                    >
                      {inCart > 0 ? <CheckCircle2 size={18} /> : <Plus size={18} />}
                    </button>
                  </div>
                </div>
              </div>
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

      {/* Cart Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
          <div className="relative ml-auto w-full max-w-sm bg-white h-full flex flex-col shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} className="text-brand-600" />
                <h3 className="font-bold text-slate-900">Cart ({cartItems} items)</h3>
              </div>
              <button onClick={() => setCartOpen(false)} className="btn-ghost p-2"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <ShoppingCart size={36} className="mx-auto mb-2 opacity-30" />
                  <p>Your cart is empty</p>
                </div>
              ) : cart.map(({ product, quantity }) => (
                <div key={product.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="w-12 h-12 rounded-lg bg-white border border-slate-100 overflow-hidden flex-shrink-0">
                    {product.image_url
                      ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                      : <Package size={16} className="text-slate-300 m-auto mt-4" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-900 truncate">{product.name}</p>
                    <p className="text-xs text-brand-600 font-semibold">${product.price.toFixed(2)} / {product.unit}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => updateQty(product.id, quantity - 1)} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100">
                        <Minus size={12} />
                      </button>
                      <span className="text-sm font-bold w-6 text-center">{quantity}</span>
                      <button onClick={() => updateQty(product.id, quantity + 1)} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100">
                        <Plus size={12} />
                      </button>
                      <span className="ml-auto text-sm font-bold text-slate-900">${(product.price * quantity).toFixed(2)}</span>
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
                <textarea
                  value={notes} onChange={e => setNotes(e.target.value)}
                  className="form-input resize-none text-sm"
                  rows={2} placeholder="Order notes (optional)..."
                />
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900">Total</span>
                  <span className="text-xl font-extrabold text-brand-600">${cartTotal.toFixed(2)}</span>
                </div>
                <button onClick={placeOrder} disabled={placing} className="btn-primary w-full py-3 text-base">
                  {placing ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <CheckCircle2 size={16} />}
                  {placing ? 'Placing Order...' : 'Place Order'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
