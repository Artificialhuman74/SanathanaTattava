import React, { useEffect, useState } from 'react';
import api from '../../api/axios';
import { ShoppingCart, X, Package, ChevronDown } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-blue-100 text-blue-700',
  processing: 'bg-purple-100 text-purple-700',
  shipped: 'bg-cyan-100 text-cyan-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-600',
};

const STATUS_STEPS = ['pending','confirmed','processing','shipped','delivered'];

export default function MyOrders() {
  const [orders,  setOrders]  = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail,  setDetail]  = useState<any>(null);
  const [filter,  setFilter]  = useState('');

  useEffect(() => {
    api.get('/trader/orders').then(r => setOrders(r.data.orders)).finally(() => setLoading(false));
  }, []);

  const viewDetail = async (id: number) => {
    const { data } = await api.get(`/trader/orders/${id}`);
    setDetail(data);
  };

  const filtered = filter ? orders.filter(o => o.status === filter) : orders;
  const totalSpend = orders.filter(o => o.status === 'delivered').reduce((s: number, o: any) => s + o.total_amount, 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">My Orders</h2>
        <p className="text-slate-500 text-sm mt-0.5">{orders.length} orders · <span className="text-emerald-600 font-medium">${totalSpend.toFixed(2)} total spent</span></p>
      </div>

      {/* Status Filter */}
      <div className="flex gap-2 flex-wrap">
        {['', 'pending','confirmed','processing','shipped','delivered','cancelled'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              filter === s
                ? s ? `${STATUS_COLORS[s]} border border-current/30` : 'bg-brand-600 text-white'
                : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
            }`}>
            {s || 'All'} ({s ? orders.filter(o => o.status === s).length : orders.length})
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" /></div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o: any) => (
                  <tr key={o.id}>
                    <td className="font-mono text-brand-600 font-medium">{o.order_number}</td>
                    <td className="font-bold">${o.total_amount.toFixed(2)}</td>
                    <td><span className={`badge ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600'}`}>{o.status}</span></td>
                    <td className="text-xs text-slate-400">{new Date(o.created_at).toLocaleDateString()}</td>
                    <td>
                      <button onClick={() => viewDetail(o.id)} className="btn-ghost text-brand-600 text-xs font-semibold">
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-14 text-slate-400">
                <ShoppingCart size={36} className="mx-auto mb-2 opacity-30" />
                <p>{filter ? `No ${filter} orders` : 'No orders yet'}</p>
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
            <div className="p-5 space-y-5">
              {/* Progress */}
              {detail.order.status !== 'cancelled' && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Order Progress</p>
                  <div className="flex items-center gap-1">
                    {STATUS_STEPS.map((s, i) => {
                      const currentIdx = STATUS_STEPS.indexOf(detail.order.status);
                      const done    = i <= currentIdx;
                      const active  = i === currentIdx;
                      return (
                        <React.Fragment key={s}>
                          <div className={`flex flex-col items-center ${i > 0 ? 'flex-1' : ''}`}>
                            {i > 0 && <div className={`h-0.5 w-full mb-2 ${done ? 'bg-brand-500' : 'bg-slate-200'}`} />}
                            <div className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-brand-600 ring-4 ring-brand-100' : done ? 'bg-brand-500' : 'bg-slate-200'}`} />
                            <p className={`text-xs mt-1 whitespace-nowrap ${active ? 'text-brand-600 font-bold' : done ? 'text-slate-600' : 'text-slate-300'}`}>{s}</p>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}

              {detail.order.notes && (
                <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
                  <p className="text-xs text-slate-400 mb-1 font-medium">Notes</p>
                  {detail.order.notes}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Items Ordered</p>
                <div className="space-y-2">
                  {detail.items.map((item: any) => (
                    <div key={item.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                      <div className="w-12 h-12 rounded-lg bg-white border border-slate-100 overflow-hidden flex-shrink-0">
                        {item.image_url
                          ? <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                          : <Package size={16} className="text-slate-300 m-auto mt-4" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{item.product_name}</p>
                        <p className="text-xs text-slate-400">{item.sku} · ×{item.quantity} {item.unit} @ ${item.price.toFixed(2)}</p>
                      </div>
                      <p className="font-bold text-sm">${item.total.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal</span>
                  <span>${detail.order.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Discount</span>
                  <span>-${(detail.order.discount || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 text-base pt-1">
                  <span>Total</span>
                  <span className="text-brand-600">${detail.order.total_amount.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
