import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  Phone, Mail, MessageCircle, Package, Truck,
  ChevronRight, X, ShoppingBag, RotateCcw,
} from 'lucide-react';

interface ConsumerOrder {
  id: number;
  order_number: string;
  total_amount: number;
  status: string;
  payment_status: string;
  created_at: string;
  dealer_name: string;
  dealer_phone: string;
  dealer_tier: number;
  delivery_dealer_name: string | null;
  delivery_dealer_phone: string | null;
  items: OrderItem[];
  item_count: number;
}

interface OrderItem {
  product_id: number;
  product_name: string;
  image_url: string | null;
  unit: string;
  quantity: number;
  price: number;
  total: number;
}

const STATUS_LABELS: Record<string, string> = {
  pending:    'Order Placed',
  confirmed:  'Confirmed',
  processing: 'Packed & Ready',
  shipped:    'Out for Delivery',
  delivered:  'Order Delivered',
  cancelled:  'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  pending:    'text-amber-600 bg-amber-50',
  confirmed:  'text-blue-600 bg-blue-50',
  processing: 'text-purple-600 bg-purple-50',
  shipped:    'text-orange-600 bg-orange-50',
  delivered:  'text-emerald-600 bg-emerald-50',
  cancelled:  'text-red-600 bg-red-50',
};

const PAYMENT_LABELS: Record<string, string> = {
  pending:  'Pending',
  paid:     'Paid online',
  failed:   'Payment failed',
  refunded: 'Refunded',
  cod:      'Cash on delivery',
};

export default function Support() {
  const { consumer, consumerLogout } = useAuth();
  const navigate = useNavigate();
  const [orders,  setOrders]  = useState<ConsumerOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ConsumerOrder | null>(null);

  const fetchOrders = useCallback(() => {
    if (!consumer) return;
    setLoading(true);
    consumerApi.get('/consumer/orders')
      .then(r => setOrders(r.data.orders || r.data || []))
      .catch(err => {
        if (err.response?.status === 401) { consumerLogout(); navigate('/shop/login', { replace: true }); }
        else toast.error('Failed to load orders');
      })
      .finally(() => setLoading(false));
  }, [consumer]); // eslint-disable-line

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Get Support</h1>

      {/* ── Contact block ──────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-brand-600">
          <p className="text-white font-bold text-base">Contact Us</p>
          <p className="text-brand-200 text-xs mt-0.5">We're here to help</p>
        </div>
        <div className="divide-y divide-gray-50">
          <a
            href="tel:+919972922514"
            className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors active:bg-gray-100"
          >
            <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0">
              <Phone size={18} className="text-green-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">Call Us</p>
              <p className="text-xs text-gray-400">+91 99729 22514</p>
            </div>
            <ChevronRight size={14} className="text-gray-300" />
          </a>
          <a
            href="mailto:namaste@sanathanatattva.shop"
            className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors active:bg-gray-100"
          >
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Mail size={18} className="text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">Email Us</p>
              <p className="text-xs text-gray-400">namaste@sanathanatattva.shop</p>
            </div>
            <ChevronRight size={14} className="text-gray-300" />
          </a>
          <a
            href="https://wa.me/919972922514"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors active:bg-gray-100"
          >
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <MessageCircle size={18} className="text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">WhatsApp</p>
              <p className="text-xs text-gray-400">Chat with us on WhatsApp</p>
            </div>
            <ChevronRight size={14} className="text-gray-300" />
          </a>
        </div>
      </div>

      {/* ── Order support ──────────────────────────────────────────── */}
      {consumer && (
        <div>
          <h2 className="text-base font-bold text-gray-900 mb-3">Support for an Order</h2>
          <p className="text-sm text-gray-400 mb-4">Tap an order to see its full details and contact info.</p>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
              <ShoppingBag size={36} className="mx-auto mb-2 text-gray-200" />
              <p className="text-sm text-gray-400">No orders yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map(order => (
                <button
                  key={order.id}
                  onClick={() => setSelected(order)}
                  className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 active:scale-[0.99] transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] || 'text-gray-600 bg-gray-50'}`}>
                        {STATUS_LABELS[order.status] || order.status}
                      </span>
                    </div>
                    <p className="font-bold text-gray-900 text-sm">₹{parseFloat(String(order.total_amount)).toFixed(2)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {order.order_number}
                      {' · '}
                      {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!consumer && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
          <p className="text-sm text-gray-500 mb-3">Log in to get support for a specific order</p>
          <button
            onClick={() => navigate('/shop/login')}
            className="px-6 py-2.5 bg-brand-600 text-white rounded-full text-sm font-semibold"
          >
            Log In
          </button>
        </div>
      )}

      {/* ── Order Detail Modal ─────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelected(null)} />
          <div className="relative bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-10 h-1 bg-gray-200 rounded-full" />
            </div>

            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
              <div>
                <p className="font-bold text-gray-900">{selected.order_number}</p>
                <p className="text-xs text-gray-400">{new Date(selected.created_at).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[selected.status]}`}>
                  {STATUS_LABELS[selected.status] || selected.status}
                </span>
                <button onClick={() => setSelected(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">
                  <X size={16} className="text-gray-500" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5">

              {/* Items */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Items</p>
                <div className="space-y-2">
                  {(selected.items || []).map((item, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl text-sm">
                      <div className="w-12 h-12 rounded-lg bg-white border border-gray-100 overflow-hidden flex-shrink-0">
                        {item.image_url
                          ? <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                          : <Package size={16} className="text-gray-300 m-auto mt-3" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate text-gray-900">{item.product_name}</p>
                        <p className="text-xs text-gray-400">₹{parseFloat(String(item.price)).toFixed(2)} × {item.quantity} {item.unit || ''}</p>
                      </div>
                      <p className="font-bold text-gray-900 flex-shrink-0">₹{parseFloat(String(item.total)).toFixed(2)}</p>
                    </div>
                  ))}
                  <div className="flex justify-between items-center px-3 pt-2 border-t border-gray-100">
                    <span className="font-semibold text-gray-700">Total</span>
                    <span className="font-extrabold text-brand-600 text-lg">₹{parseFloat(String(selected.total_amount)).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Payment */}
              <div className={`px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${
                selected.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700' :
                selected.payment_status === 'failed' ? 'bg-red-50 text-red-600' :
                'bg-amber-50 text-amber-700'
              }`}>
                Payment: {PAYMENT_LABELS[selected.payment_status] || selected.payment_status}
              </div>

              {/* Dealer & Delivery */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Dealer</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm flex-shrink-0">
                    {selected.dealer_name?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">{selected.dealer_name}</p>
                    {selected.dealer_phone && (
                      <a href={`tel:${selected.dealer_phone}`} className="text-xs text-brand-600 flex items-center gap-1 mt-0.5">
                        <Phone size={10} />{selected.dealer_phone}
                      </a>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${selected.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                    {selected.dealer_tier === 1 ? 'Tier 1' : 'Sub-Dealer'}
                  </span>
                </div>
                {selected.delivery_dealer_name && (
                  <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                    <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                      <Truck size={14} className="text-teal-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400">Delivery Agent</p>
                      <p className="font-semibold text-sm text-gray-900">{selected.delivery_dealer_name}</p>
                      {selected.delivery_dealer_phone && (
                        <a href={`tel:${selected.delivery_dealer_phone}`} className="text-xs text-brand-600 flex items-center gap-1 mt-0.5">
                          <Phone size={10} />{selected.delivery_dealer_phone}
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Contact support for this order */}
              <div className="bg-brand-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wider mb-3">Still need help?</p>
                <div className="flex flex-col gap-2">
                  <a
                    href={`tel:+919972922514`}
                    className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-brand-100 hover:bg-brand-50 transition-colors"
                  >
                    <Phone size={16} className="text-brand-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Call Support</p>
                      <p className="text-xs text-gray-400">+91 99729 22514</p>
                    </div>
                  </a>
                  <a
                    href={`mailto:namaste@sanathanatattva.shop?subject=Order Support — ${selected.order_number}`}
                    className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-brand-100 hover:bg-brand-50 transition-colors"
                  >
                    <Mail size={16} className="text-brand-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Email Support</p>
                      <p className="text-xs text-gray-400">namaste@sanathanatattva.shop</p>
                    </div>
                  </a>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
