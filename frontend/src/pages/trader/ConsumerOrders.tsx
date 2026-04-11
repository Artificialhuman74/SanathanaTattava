import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrderUpdates } from '../../hooks/useOrderUpdates';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  ShoppingBag, Search, ChevronDown, X, Phone, MapPin, Package,
  User, Truck, AlertTriangle, CheckCircle2, ChevronRight,
} from 'lucide-react';

interface ConsumerOrder {
  id: number;
  order_number: string;
  consumer_id: number;
  consumer_name: string;
  consumer_phone: string;
  consumer_address: string;
  consumer_pincode: string;
  dealer_id: number;
  dealer_name: string;
  dealer_tier: number;
  delivery_dealer_id: number | null;
  delivery_dealer_name: string | null;
  total_amount: number;
  status: string;
  payment_status: string;
  created_at: string;
  items: OrderItem[];
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

interface SubDealer {
  id: number;
  name: string;
  delivery_enabled: boolean;
}

const STATUS_OPTIONS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

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

export default function TraderConsumerOrders() {
  const { user, isTier1 } = useAuth();
  const [orders,       setOrders]       = useState<ConsumerOrder[]>([]);
  const [subDealers,   setSubDealers]   = useState<SubDealer[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected,     setSelected]     = useState<ConsumerOrder | null>(null);
  const [updatingId,     setUpdatingId]     = useState<number | null>(null);
  const [stockWarning,   setStockWarning]   = useState<{ items: any[]; adminPhone: string | null; adminName: string } | null>(null);
  const [pendingStatus,  setPendingStatus]  = useState<string | null>(null);

  const fetchOrders = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (search)       params.search = search;
    if (statusFilter) params.status = statusFilter;
    const promises: Promise<any>[] = [api.get('/trader/consumer-orders', { params })];
    if (isTier1) promises.push(api.get('/trader/sub-dealers'));

    Promise.all(promises).then(([ordRes, subRes]) => {
      setOrders(ordRes.data.orders || ordRes.data || []);
      if (subRes) {
        const subs = subRes.data.sub_dealers || subRes.data || [];
        setSubDealers(subs.filter((s: SubDealer) => s.delivery_enabled));
      }
    }).finally(() => setLoading(false));
  }, [search, statusFilter, isTier1]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Real-time: auto-refresh when any order status changes or new order assigned
  useOrderUpdates(() => { fetchOrders(); });

  const assignDeliveryDealer = async (orderId: number, dealerId: number | null) => {
    setUpdatingId(orderId);
    try {
      await api.put(`/trader/consumer-orders/${orderId}/assign-delivery`, { delivery_dealer_id: dealerId });
      toast.success(dealerId ? 'Delivery dealer assigned' : 'Delivery assignment removed');
      fetchOrders();
      if (selected?.id === orderId) {
        setSelected(prev => prev ? {
          ...prev,
          delivery_dealer_id:   dealerId,
          delivery_dealer_name: subDealers.find(s => s.id === dealerId)?.name || null,
        } : null);
      }
    } catch { toast.error('Failed to assign delivery dealer'); }
    finally { setUpdatingId(null); }
  };

  const updateStatus = async (orderId: number, newStatus: string) => {
    // Before packing (processing), pre-check dealer stock
    if (newStatus === 'processing') {
      try {
        const [checkRes, contactRes] = await Promise.all([
          api.get(`/trader/consumer-orders/${orderId}/stock-check`),
          api.get('/trader/admin-contact'),
        ]);
        if (!checkRes.data.canPack) {
          setStockWarning({
            items: checkRes.data.items,
            adminPhone: contactRes.data.phone,
            adminName: contactRes.data.name,
          });
          setPendingStatus(null);
          return;
        }
      } catch {
        // If pre-check fails, let the server validate and return the error
      }
    }

    setUpdatingId(orderId);
    try {
      await api.put(`/trader/consumer-orders/${orderId}/status`, { status: newStatus });
      toast.success(`Order marked as ${newStatus}`);
      fetchOrders();
      setSelected(prev => prev ? { ...prev, status: newStatus } : null);
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to update status';
      toast.error(msg);
    } finally {
      setUpdatingId(null);
    }
  };

  const NEXT_STATUS: Record<string, string> = {
    pending:    'confirmed',
    confirmed:  'processing',
    processing: 'shipped',
    shipped:    'delivered',
  };

  const NEXT_LABEL: Record<string, string> = {
    pending:    'Accept Order',
    confirmed:  'Mark as Packing',
    processing: 'Mark as Shipped',
    shipped:    'Mark as Delivered',
  };

const totalOrders   = orders.length;
  const pending       = orders.filter(o => o.status === 'pending').length;
  const delivered     = orders.filter(o => o.status === 'delivered').length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Consumer Orders</h2>
        <p className="text-slate-500 text-sm mt-0.5">
          {isTier1 ? 'Orders from your customers and sub-dealer customers' : 'Orders from your customers'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total',     value: totalOrders, color: 'text-brand-600' },
          { label: 'Pending',   value: pending,     color: 'text-amber-600' },
          { label: 'Delivered', value: delivered,   color: 'text-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4 text-center">
            <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
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
                  {isTier1 && <th>Dealer</th>}
                  <th>Amount</th>
                  <th>Delivery</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Date</th>
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
                      <p className="font-medium text-sm">{o.consumer_name}</p>
                      <p className="text-xs text-slate-400 flex items-center gap-1"><Phone size={9} />{o.consumer_phone}</p>
                      {o.consumer_pincode && <p className="text-xs text-slate-400 flex items-center gap-1"><MapPin size={9} />{o.consumer_pincode}</p>}
                    </td>
                    {isTier1 && (
                      <td>
                        <p className="text-sm text-slate-700">{o.dealer_name}</p>
                        <span className={`badge text-xs ${o.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                          {o.dealer_tier === 1 ? 'Tier 1' : 'Sub-Dealer'}
                        </span>
                      </td>
                    )}
                    <td className="font-semibold">₹{parseFloat(String(o.total_amount)).toFixed(2)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      {isTier1 ? (
                        <select
                          value={o.delivery_dealer_id ?? ''}
                          onChange={e => assignDeliveryDealer(o.id, e.target.value ? Number(e.target.value) : null)}
                          disabled={updatingId === o.id}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 min-w-28"
                        >
                          <option value="">Unassigned</option>
                          <option value={user?.id}>Handle personally</option>
                          {subDealers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {o.delivery_dealer_id === user?.id
                            ? <span className="font-medium text-brand-600">You</span>
                            : (o.delivery_dealer_name || '—')
                          }
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600'}`}>{o.status}</span>
                    </td>
                    <td>
                      <span className={`badge ${PAYMENT_COLORS[o.payment_status] || 'bg-slate-100 text-slate-600'}`}>{o.payment_status}</span>
                    </td>
                    <td className="text-xs text-slate-400">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
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
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900">Order {selected.order_number}</h3>
                <p className="text-xs text-slate-400">{new Date(selected.created_at).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
                <button onClick={() => setSelected(null)} className="btn-ghost p-2"><X size={18} /></button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Consumer */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2"><User size={12} />Consumer</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><p className="text-xs text-slate-400">Name</p><p className="font-semibold">{selected.consumer_name}</p></div>
                  <div><p className="text-xs text-slate-400">Phone</p><p className="font-semibold">{selected.consumer_phone}</p></div>
                  {selected.consumer_pincode && <div><p className="text-xs text-slate-400">Pincode</p><p className="font-semibold">{selected.consumer_pincode}</p></div>}
                  {selected.consumer_address && <div className="col-span-2"><p className="text-xs text-slate-400">Address</p><p className="font-semibold">{selected.consumer_address}</p></div>}
                </div>
              </div>

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

              {/* Delivery Assignment (Tier 1 only) */}
              {isTier1 && (
                <div className="bg-teal-50 rounded-xl p-4">
                  <p className="text-xs font-semibold text-teal-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Truck size={12} /> Delivery Assignment
                  </p>
                  <select
                    value={selected.delivery_dealer_id ?? ''}
                    onChange={e => assignDeliveryDealer(selected.id, e.target.value ? Number(e.target.value) : null)}
                    disabled={updatingId === selected.id}
                    className="form-input text-sm"
                  >
                    <option value="">Unassigned</option>
                    <option value={user?.id}>Handle personally (deliver yourself)</option>
                    {subDealers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {selected.delivery_dealer_id && (
                    <p className="text-xs text-teal-700 mt-2 font-medium">
                      Assigned to:{' '}
                      <strong>
                        {selected.delivery_dealer_id === user?.id
                          ? 'You (personal delivery)'
                          : selected.delivery_dealer_name}
                      </strong>
                    </p>
                  )}
                </div>
              )}

              {/* Status Actions */}
              {!['delivered', 'cancelled'].includes(selected.status) && (
                <div className="flex gap-2 pt-1">
                  {NEXT_STATUS[selected.status] && (
                    <button
                      onClick={() => updateStatus(selected.id, NEXT_STATUS[selected.status])}
                      disabled={updatingId === selected.id}
                      className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {updatingId === selected.id
                        ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        : <><CheckCircle2 size={15} />{NEXT_LABEL[selected.status]}<ChevronRight size={14} /></>
                      }
                    </button>
                  )}
                  {selected.status !== 'shipped' && (
                    <button
                      onClick={() => updateStatus(selected.id, 'cancelled')}
                      disabled={updatingId === selected.id}
                      className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Insufficient stock warning */}
      {stockWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setStockWarning(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={18} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Not enough stock to pack</h3>
                <p className="text-xs text-slate-500 mt-0.5">Contact admin to restock before packing this order.</p>
              </div>
            </div>

            {/* Per-item stock status */}
            <div className="space-y-2">
              {stockWarning.items.map((item, i) => (
                <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm ${item.ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <span className="font-medium text-slate-800 truncate mr-2">{item.product_name}</span>
                  <span className={`text-xs font-semibold flex-shrink-0 ${item.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                    {item.available} / {item.required} {item.ok ? '✓' : '✗'}
                  </span>
                </div>
              ))}
            </div>

            {/* Admin contact */}
            <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                <User size={14} className="text-brand-700" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Contact admin to restock</p>
                <p className="text-sm font-semibold text-slate-900">{stockWarning.adminName}</p>
              </div>
              {stockWarning.adminPhone && (
                <a
                  href={`tel:${stockWarning.adminPhone}`}
                  className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-semibold hover:bg-brand-700 flex-shrink-0"
                >
                  <Phone size={12} />
                  {stockWarning.adminPhone}
                </a>
              )}
            </div>

            <button
              onClick={() => setStockWarning(null)}
              className="w-full py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
