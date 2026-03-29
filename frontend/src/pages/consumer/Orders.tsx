import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  ShoppingBag, X, Package, Phone, MapPin, Star, Truck, User,
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
  delivered:  'Delivered',
  cancelled:  'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700',
  confirmed:  'bg-blue-100 text-blue-700',
  processing: 'bg-purple-100 text-purple-700',
  shipped:    'bg-orange-100 text-orange-700',
  delivered:  'bg-emerald-100 text-emerald-700',
  cancelled:  'bg-red-100 text-red-700',
};

const PAYMENT_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700',
  paid:     'bg-emerald-100 text-emerald-700',
  failed:   'bg-red-100 text-red-700',
  refunded: 'bg-slate-100 text-slate-600',
};

export default function ConsumerOrders() {
  const { consumer, consumerLogout } = useAuth();
  const navigate = useNavigate();
  const [orders,   setOrders]   = useState<ConsumerOrder[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<ConsumerOrder | null>(null);

  useEffect(() => {
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
  }, [consumer]);

  const totalOrders  = orders.length;
  const pending      = orders.filter(o => o.status === 'pending').length;
  const delivered    = orders.filter(o => o.status === 'delivered').length;
  const totalSpent   = orders.reduce((s, o) => s + parseFloat(String(o.total_amount)), 0);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Orders</h1>
        <p className="text-slate-500 text-sm mt-0.5">Welcome back, {consumer?.name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Orders',  value: totalOrders, color: 'text-brand-600' },
          { label: 'Pending',       value: pending,     color: 'text-amber-600' },
          { label: 'Delivered',     value: delivered,   color: 'text-emerald-600' },
          { label: 'Total Spent',   value: `₹${totalSpent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, color: 'text-purple-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 p-4 text-center shadow-sm">
            <p className={`text-xl font-extrabold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Orders List */}
      {orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center text-slate-400">
          <ShoppingBag size={48} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium text-lg">No orders yet</p>
          <p className="text-sm mt-1">Start shopping to place your first order</p>
          <button onClick={() => navigate('/shop')} className="btn-primary mt-4">
            Browse Products
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <div
              key={order.id}
              onClick={() => setSelected(order)}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-5 cursor-pointer hover:shadow-md transition-all"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
                    <ShoppingBag size={18} className="text-brand-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-slate-900">{order.order_number}</p>
                      <span className={`badge ${STATUS_COLORS[order.status] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABELS[order.status] || order.status}
                      </span>
                      <span className={`badge ${PAYMENT_COLORS[order.payment_status] || 'bg-slate-100 text-slate-600'}`}>
                        {order.payment_status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {order.item_count ?? (order.items?.length ?? 0)} items · {new Date(order.created_at).toLocaleDateString('en-IN')}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Dealer: <span className="text-slate-600 font-medium">{order.dealer_name}</span>
                      {order.delivery_dealer_name && <> · Delivery: <span className="text-slate-600 font-medium">{order.delivery_dealer_name}</span></>}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-extrabold text-slate-900 text-lg">₹{parseFloat(String(order.total_amount)).toFixed(2)}</p>
                  <p className="text-xs text-brand-600 font-medium mt-0.5">View details →</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Order Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelected(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900">Order {selected.order_number}</h3>
                <p className="text-xs text-slate-400">{new Date(selected.created_at).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status] || selected.status}</span>
                <button onClick={() => setSelected(null)} className="btn-ghost p-2"><X size={18} /></button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Items */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Package size={12} />Items</p>
                <div className="space-y-2">
                  {(selected.items || []).length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">No item details available</p>
                  )}
                  {(selected.items || []).map((item, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl text-sm">
                      <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 overflow-hidden flex-shrink-0">
                        {item.image_url
                          ? <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                          : <Package size={16} className="text-slate-300 m-auto mt-3" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{item.product_name}</p>
                        <p className="text-xs text-slate-400">₹{parseFloat(String(item.price)).toFixed(2)} × {item.quantity} {item.unit || ''}</p>
                      </div>
                      <p className="font-bold flex-shrink-0">₹{parseFloat(String(item.total)).toFixed(2)}</p>
                    </div>
                  ))}
                  <div className="flex justify-between items-center px-3 pt-2 border-t border-slate-200">
                    <span className="font-bold">Total</span>
                    <span className="font-extrabold text-brand-600 text-lg">₹{parseFloat(String(selected.total_amount)).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Payment */}
              <div className={`p-3 rounded-xl flex items-center gap-2 ${PAYMENT_COLORS[selected.payment_status] || 'bg-slate-50'}`}>
                <p className="text-sm font-semibold">Payment: {selected.payment_status}</p>
              </div>

              {/* Dealer Info */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Dealer Information</p>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm flex-shrink-0">
                    {selected.dealer_name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{selected.dealer_name}</p>
                    <span className={`badge text-xs ${selected.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                      {selected.dealer_tier === 1 ? 'Tier 1 Dealer' : 'Sub-Dealer'}
                    </span>
                    {selected.dealer_phone && (
                      <p className="text-sm text-slate-600 mt-1 flex items-center gap-1"><Phone size={12} />{selected.dealer_phone}</p>
                    )}
                  </div>
                </div>

                {selected.delivery_dealer_name && (
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-200 mt-2">
                    <Truck size={14} className="text-teal-600" />
                    <div>
                      <p className="text-xs text-slate-400">Delivery by</p>
                      <p className="font-semibold text-sm text-slate-900">{selected.delivery_dealer_name}</p>
                      {selected.delivery_dealer_phone && (
                        <p className="text-xs text-slate-500 flex items-center gap-1"><Phone size={10} />{selected.delivery_dealer_phone}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
