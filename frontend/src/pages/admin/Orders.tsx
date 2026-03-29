import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { ShoppingCart, Search, ChevronDown, Eye, X } from 'lucide-react';

interface Order {
  id: number; order_number: string; trader_name: string; trader_email: string;
  tier: number; status: string; total_amount: number; created_at: string;
}
interface OrderDetail {
  order: Order & { notes: string };
  items: any[];
}

const STATUSES = ['pending','confirmed','processing','shipped','delivered','cancelled'];
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  confirmed: 'bg-blue-100 text-blue-700 border-blue-200',
  processing: 'bg-purple-100 text-purple-700 border-purple-200',
  shipped: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  delivered: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-100 text-red-600 border-red-200',
};

export default function AdminOrders() {
  const [orders,   setOrders]   = useState<Order[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [statusF,  setStatusF]  = useState('');
  const [detail,   setDetail]   = useState<OrderDetail | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (search)  params.search = search;
    if (statusF) params.status = statusF;
    api.get('/admin/orders', { params })
      .then(r => setOrders(r.data.orders))
      .finally(() => setLoading(false));
  }, [search, statusF]);

  useEffect(() => { fetch(); }, [fetch]);

  const viewDetail = async (id: number) => {
    const { data } = await api.get(`/admin/orders/${id}`);
    setDetail(data);
  };

  const updateStatus = async (id: number, status: string) => {
    setUpdating(id);
    try {
      await api.put(`/admin/orders/${id}/status`, { status });
      toast.success(`Order marked as ${status}`);
      fetch();
      if (detail?.order.id === id) setDetail(prev => prev ? { ...prev, order: { ...prev.order, status } } : prev);
    } catch { toast.error('Failed to update'); }
    finally { setUpdating(null); }
  };

  const totalRevenue = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total_amount, 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Orders</h2>
        <p className="text-slate-500 text-sm mt-0.5">{orders.length} total · Revenue from delivered: <span className="font-semibold text-emerald-600">${totalRevenue.toFixed(2)}</span></p>
      </div>

      {/* Status summary */}
      <div className="flex gap-2 flex-wrap">
        {STATUSES.map(s => {
          const cnt = orders.filter(o => o.status === s).length;
          return (
            <button key={s} onClick={() => setStatusF(statusF === s ? '' : s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all
                ${statusF === s ? STATUS_COLORS[s] : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              {s} ({cnt})
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="form-input pl-9" placeholder="Search by order # or trader..." />
        </div>
        <div className="relative">
          <select value={statusF} onChange={e => setStatusF(e.target.value)} className="form-input appearance-none pr-8 min-w-36">
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
        </div>
      </div>

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
                  <th>Trader</th>
                  <th>Tier</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id}>
                    <td className="font-mono text-brand-600 font-medium text-sm">{o.order_number}</td>
                    <td>
                      <p className="font-medium text-slate-900 text-sm">{o.trader_name}</p>
                      <p className="text-slate-400 text-xs">{o.trader_email}</p>
                    </td>
                    <td><span className={`badge ${o.tier === 1 ? 'bg-gold-500/10 text-gold-600' : 'bg-brand-50 text-brand-700'}`}>Tier {o.tier}</span></td>
                    <td className="font-bold">${o.total_amount.toFixed(2)}</td>
                    <td>
                      <select
                        value={o.status}
                        onChange={e => updateStatus(o.id, e.target.value)}
                        disabled={updating === o.id}
                        className={`text-xs font-semibold border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500 appearance-none ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="text-xs text-slate-400">{new Date(o.created_at).toLocaleDateString()}</td>
                    <td>
                      <button onClick={() => viewDetail(o.id)} className="btn-ghost p-2 text-brand-600">
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orders.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <ShoppingCart size={40} className="mx-auto mb-3 opacity-30" />
                <p>No orders found</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900">Order Details</h3>
                <p className="text-brand-600 text-sm font-mono mt-0.5">{detail.order.order_number}</p>
              </div>
              <button onClick={() => setDetail(null)} className="btn-ghost p-2"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-slate-400 text-xs">Trader</p><p className="font-semibold">{detail.order.trader_name}</p></div>
                <div><p className="text-slate-400 text-xs">Status</p><span className={`badge ${STATUS_COLORS[detail.order.status]}`}>{detail.order.status}</span></div>
                <div><p className="text-slate-400 text-xs">Tier</p><p className="font-semibold">Tier {detail.order.tier}</p></div>
                <div><p className="text-slate-400 text-xs">Date</p><p className="font-semibold">{new Date(detail.order.created_at).toLocaleDateString()}</p></div>
              </div>
              {detail.order.notes && (
                <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600">
                  <p className="text-xs text-slate-400 mb-1">Notes</p>
                  {detail.order.notes}
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Items</p>
                <div className="space-y-2">
                  {detail.items.map((item: any) => (
                    <div key={item.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                      <div className="w-10 h-10 rounded-lg bg-white border border-slate-100 overflow-hidden flex-shrink-0">
                        {item.image_url
                          ? <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                          : <ShoppingCart size={16} className="text-slate-300 m-auto mt-3" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{item.product_name}</p>
                        <p className="text-xs text-slate-400">{item.sku} · ×{item.quantity} {item.unit}</p>
                      </div>
                      <p className="font-bold text-sm">${item.total.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-slate-100 pt-3 flex justify-between items-center">
                <span className="font-bold text-slate-900">Total</span>
                <span className="text-xl font-extrabold text-brand-600">${detail.order.total_amount.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
