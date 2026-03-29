import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  ShoppingBag, Search, ChevronDown, X, Phone, MapPin, Package,
  User, Star, Truck, Clock, CheckCircle2, XCircle,
} from 'lucide-react';

interface ConsumerOrder {
  id: number;
  order_number: string;
  consumer_id: number;
  consumer_name: string;
  consumer_phone: string;
  consumer_email: string;
  consumer_address: string;
  consumer_pincode: string;
  dealer_id: number;
  dealer_name: string;
  dealer_phone: string;
  dealer_tier: number;
  delivery_dealer_id: number | null;
  delivery_dealer_name: string | null;
  total_amount: number;
  status: string;
  payment_status: string;
  created_at: string;
  items: OrderItem[];
  commission_breakdown: CommissionLine[];
}

interface OrderItem {
  product_name: string;
  quantity: number;
  price: number;
  total: number;
  unit_price?: number;
  subtotal?: number;
  image_url?: string;
  sku?: string;
}

interface CommissionLine {
  dealer_name: string;
  dealer_tier: number;
  type: string;
  rate: number;
  amount: number;
}

const STATUS_OPTIONS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_OPTIONS = ['pending', 'paid', 'failed', 'refunded'];

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

export default function AdminConsumerOrders() {
  const [orders,        setOrders]        = useState<ConsumerOrder[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState('');
  const [statusFilter,  setStatusFilter]  = useState('');
  const [payFilter,     setPayFilter]     = useState('');
  const [selected,      setSelected]      = useState<ConsumerOrder | null>(null);
  const [updatingId,    setUpdatingId]    = useState<number | null>(null);

  const fetchOrders = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (search)       params.search         = search;
    if (statusFilter) params.status         = statusFilter;
    if (payFilter)    params.payment_status = payFilter;
    api.get('/admin/consumer-orders', { params })
      .then(r => setOrders(r.data.orders || r.data))
      .finally(() => setLoading(false));
  }, [search, statusFilter, payFilter]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const updateStatus = async (id: number, field: 'status' | 'payment_status', value: string) => {
    setUpdatingId(id);
    try {
      await api.put(`/admin/consumer-orders/${id}/status`, { [field]: value });
      toast.success('Order updated');
      fetchOrders();
      if (selected?.id === id) {
        setSelected(prev => prev ? { ...prev, [field]: value } : null);
      }
    } catch { toast.error('Failed to update order'); }
    finally { setUpdatingId(null); }
  };

  const totalOrders    = orders.length;
  const pendingOrders  = orders.filter(o => o.status === 'pending').length;
  const pendingPayment = orders.filter(o => o.payment_status === 'pending').length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Consumer Orders</h2>
        <p className="text-slate-500 text-sm mt-0.5">Orders placed by consumers through the shop</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Orders',     value: totalOrders,    color: 'bg-brand-50 text-brand-600' },
          { label: 'Pending',          value: pendingOrders,  color: 'bg-amber-50 text-amber-600' },
          { label: 'Payment Pending',  value: pendingPayment, color: 'bg-red-50 text-red-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4 text-center">
            <p className={`text-2xl font-extrabold ${color.split(' ')[1]}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="form-input pl-9" placeholder="Search by order# or consumer..." />
        </div>
        <div className="relative">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="form-input appearance-none pr-8 min-w-36">
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
        </div>
        <div className="relative">
          <select value={payFilter} onChange={e => setPayFilter(e.target.value)} className="form-input appearance-none pr-8 min-w-36">
            <option value="">All Payments</option>
            {PAYMENT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Consumer</th>
                  <th>Dealer</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr
                    key={o.id}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => setSelected(o)}
                  >
                    <td className="font-mono text-brand-600 font-medium text-xs">{o.order_number}</td>
                    <td>
                      <p className="font-medium text-sm text-slate-900">{o.consumer_name}</p>
                      <p className="text-xs text-slate-400 flex items-center gap-1"><Phone size={9} />{o.consumer_phone}</p>
                    </td>
                    <td>
                      <p className="text-sm text-slate-700">{o.dealer_name}</p>
                      <span className={`badge text-xs ${o.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                        {o.dealer_tier === 1 ? 'Tier 1' : 'Sub-Dealer'}
                      </span>
                    </td>
                    <td className="font-semibold">₹{parseFloat(String(o.total_amount)).toFixed(2)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <select
                        value={o.status}
                        onChange={e => updateStatus(o.id, 'status', e.target.value)}
                        disabled={updatingId === o.id}
                        className={`badge border-0 cursor-pointer text-xs font-semibold rounded-full px-2 py-1 ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600'}`}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <select
                        value={o.payment_status}
                        onChange={e => updateStatus(o.id, 'payment_status', e.target.value)}
                        disabled={updatingId === o.id}
                        className={`badge border-0 cursor-pointer text-xs font-semibold rounded-full px-2 py-1 ${PAYMENT_COLORS[o.payment_status] || 'bg-slate-100 text-slate-600'}`}
                      >
                        {PAYMENT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="text-xs text-slate-400">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setSelected(o)}
                        className="btn-ghost text-xs text-brand-600"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orders.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <ShoppingBag size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">No consumer orders found</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelected(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900">Order {selected.order_number}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{new Date(selected.created_at).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
                <span className={`badge ${PAYMENT_COLORS[selected.payment_status]}`}>{selected.payment_status}</span>
                <button onClick={() => setSelected(null)} className="btn-ghost p-2"><X size={18} /></button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Consumer Info */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5"><User size={12} />Consumer Info</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs">Name</p>
                    <p className="font-semibold text-slate-900">{selected.consumer_name}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Phone</p>
                    <p className="font-semibold text-slate-900">{selected.consumer_phone}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Email</p>
                    <p className="font-semibold text-slate-900">{selected.consumer_email || '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Pincode</p>
                    <p className="font-semibold text-slate-900">{selected.consumer_pincode || '—'}</p>
                  </div>
                  {selected.consumer_address && (
                    <div className="col-span-2">
                      <p className="text-slate-400 text-xs">Address</p>
                      <p className="font-semibold text-slate-900">{selected.consumer_address}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Items */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Package size={12} />Order Items</p>
                <div className="space-y-2">
                  {(selected.items || []).map((item, i) => {
                    const unitPrice = item.price ?? item.unit_price ?? 0;
                    const lineTotal = item.total ?? item.subtotal ?? 0;
                    return (
                      <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl text-sm">
                        <div className="w-10 h-10 rounded-lg bg-white overflow-hidden flex-shrink-0 border border-slate-200">
                          {item.image_url ? <img src={item.image_url} className="w-full h-full object-cover" /> : <Package size={16} className="text-slate-300 m-auto mt-2.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900">{item.product_name}</p>
                          <p className="text-slate-400 text-xs">₹{parseFloat(String(unitPrice)).toFixed(2)} × {item.quantity}{item.sku ? ` · ${item.sku}` : ''}</p>
                        </div>
                        <p className="font-bold text-slate-900 flex-shrink-0">₹{parseFloat(String(lineTotal)).toFixed(2)}</p>
                      </div>
                    );
                  })}
                  <div className="flex justify-between items-center px-3 pt-2 border-t border-slate-200">
                    <span className="font-bold text-slate-900">Total</span>
                    <span className="font-extrabold text-brand-600 text-lg">₹{parseFloat(String(selected.total_amount)).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Dealer Info */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Star size={12} />Dealer Info</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs">Dealer Name</p>
                    <p className="font-semibold text-slate-900">{selected.dealer_name}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Tier</p>
                    <span className={`badge ${selected.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                      {selected.dealer_tier === 1 ? 'Tier 1' : 'Sub-Dealer'}
                    </span>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Phone</p>
                    <p className="font-semibold text-slate-900">{selected.dealer_phone || '—'}</p>
                  </div>
                  {selected.delivery_dealer_name && (
                    <div>
                      <p className="text-slate-400 text-xs">Delivery Dealer</p>
                      <p className="font-semibold text-slate-900">{selected.delivery_dealer_name}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Commission Breakdown */}
              {(selected.commission_breakdown || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Commission Breakdown</p>
                  <div className="space-y-2">
                    {selected.commission_breakdown.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-sm p-3 bg-emerald-50 rounded-xl">
                        <div>
                          <p className="font-semibold text-slate-900">{c.dealer_name}</p>
                          <p className="text-xs text-slate-400">{c.type} · {c.rate}%</p>
                        </div>
                        <p className="font-bold text-emerald-700">₹{parseFloat(String(c.amount)).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Update Actions */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="form-label">Update Status</label>
                  <select
                    value={selected.status}
                    onChange={e => updateStatus(selected.id, 'status', e.target.value)}
                    className="form-input"
                    disabled={updatingId === selected.id}
                  >
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Payment Status</label>
                  <select
                    value={selected.payment_status}
                    onChange={e => updateStatus(selected.id, 'payment_status', e.target.value)}
                    className="form-input"
                    disabled={updatingId === selected.id}
                  >
                    {PAYMENT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
