import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import { useOrderUpdates } from '../../hooks/useOrderUpdates';
import toast from 'react-hot-toast';
import { ShoppingBag, X, Package, Phone, Truck, ChevronRight, RotateCcw } from 'lucide-react';

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
  consumer_pincode: string;
  items: OrderItem[];
  item_count: number;
}

interface OrderItem {
  product_id: number;
  product_name: string;
  image_url: string | null;
  sku: string;
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

export default function ConsumerOrders() {
  const { consumer, consumerLogout } = useAuth();
  const navigate = useNavigate();
  const [orders,   setOrders]   = useState<ConsumerOrder[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<ConsumerOrder | null>(null);

  const fetchOrders = useCallback(() => {
    if (!consumer) { navigate('/shop/login', { replace: true }); return; }
    consumerApi.get('/consumer/orders')
      .then(r => setOrders(r.data.orders || r.data || []))
      .catch(err => {
        if (err.response?.status === 401) {
          consumerLogout();
          navigate('/shop/login', { replace: true });
        } else {
          toast.error('Failed to load orders');
        }
      })
      .finally(() => setLoading(false));
  }, [consumer]); // eslint-disable-line

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useOrderUpdates(() => { fetchOrders(); });

  const handleOrderAgain = (order: ConsumerOrder, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!order.items?.length) { navigate('/shop'); return; }
    sessionStorage.setItem('reorder_ids', JSON.stringify(
      order.items.map(i => ({ id: i.product_id, qty: i.quantity }))
    ));
    navigate('/shop');
    toast.success('Select your items again!');
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Order History</h1>

      {orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <ShoppingBag size={44} className="mx-auto mb-3 text-gray-200" />
          <p className="font-semibold text-gray-700">No orders yet</p>
          <p className="text-sm text-gray-400 mt-1">Start shopping to place your first order</p>
          <button onClick={() => navigate('/shop')} className="mt-4 px-6 py-2.5 bg-brand-600 text-white rounded-full text-sm font-semibold">
            Browse Products
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <div
              key={order.id}
              onClick={() => setSelected(order)}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
            >
              {/* Status header */}
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[order.status] || 'text-gray-600 bg-gray-50'}`}>
                  {STATUS_LABELS[order.status] || order.status}
                </span>
                <ChevronRight size={16} className="text-gray-300" />
              </div>

              {/* Order meta */}
              <div className="px-4 pb-2">
                <p className="text-base font-extrabold text-gray-900">₹{parseFloat(String(order.total_amount)).toFixed(2)}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {PAYMENT_LABELS[order.payment_status] || order.payment_status}
                  {' · '}
                  {order.item_count ?? (order.items?.length ?? 0)} {(order.item_count ?? (order.items?.length ?? 0)) === 1 ? 'item' : 'items'}
                  {' · '}
                  {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>

              {/* Item thumbnails */}
              {order.items?.length > 0 && (
                <div className="px-4 pb-3 flex gap-2">
                  {order.items.slice(0, 4).map((item, i) => (
                    <div key={i} className="relative w-14 h-14 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 border border-gray-100">
                      {item.image_url
                        ? <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                        : <Package size={20} className="text-gray-300 m-auto mt-3" />
                      }
                      {item.quantity > 1 && (
                        <span className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[9px] font-bold px-1 rounded">×{item.quantity}</span>
                      )}
                    </div>
                  ))}
                  {order.items.length > 4 && (
                    <div className="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 border border-gray-100">
                      <span className="text-xs font-bold text-gray-500">+{order.items.length - 4}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Order Again */}
              <div className="px-4 pb-4">
                <button
                  onClick={e => handleOrderAgain(order, e)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors"
                >
                  <RotateCcw size={14} />
                  Order Again
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Order Detail Modal ─────────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelected(null)} />
          <div className="relative bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Handle bar (mobile) */}
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
                  {(!selected.items || selected.items.length === 0) && (
                    <p className="text-sm text-gray-400 text-center py-4">No item details available</p>
                  )}
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
                      <p className="text-xs text-gray-500 flex items-center gap-1"><Phone size={10} />{selected.dealer_phone}</p>
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
                    <div>
                      <p className="text-xs text-gray-400">Delivery by</p>
                      <p className="font-semibold text-sm text-gray-900">{selected.delivery_dealer_name}</p>
                      {selected.delivery_dealer_phone && (
                        <p className="text-xs text-gray-500 flex items-center gap-1"><Phone size={10} />{selected.delivery_dealer_phone}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Order again */}
              <button
                onClick={e => handleOrderAgain(selected, e)}
                className="w-full flex items-center justify-center gap-2 py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold"
              >
                <RotateCcw size={14} />
                Order Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
