import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import {
  CheckCircle2, XCircle, Loader2, AlertCircle, Clock,
  TrendingUp, Package,
} from 'lucide-react';

export default function DeliveryHistory() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const [historyRes, statsRes] = await Promise.all([
        api.get('/delivery/history?limit=50'),
        api.get('/delivery/stats'),
      ]);
      setOrders(historyRes.data.orders || []);
      setStats(statsRes.data.stats || null);
    } catch (err: any) {
      setError('Failed to load delivery history');
    } finally {
      setLoading(false);
    }
  };

  const deliveredCount = stats?.completed || orders.filter(o => o.delivery_status === 'delivered').length;
  const failedCount = stats?.failed || orders.filter(o => o.delivery_status === 'failed').length;
  const totalCount = deliveredCount + failedCount;
  const successRate = totalCount > 0 ? ((deliveredCount / totalCount) * 100).toFixed(1) : '0';

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
    </div>
  );

  return (
    <div className="p-4 space-y-5 animate-fade-in">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
          <Package className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-slate-800">{totalCount}</p>
          <p className="text-[10px] text-slate-500 font-medium">Total</p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
          <TrendingUp className="w-5 h-5 text-blue-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-slate-800">{successRate}%</p>
          <p className="text-[10px] text-slate-500 font-medium">Success Rate</p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
          <XCircle className="w-5 h-5 text-red-400 mx-auto mb-1" />
          <p className="text-xl font-bold text-slate-800">{failedCount}</p>
          <p className="text-[10px] text-slate-500 font-medium">Failed</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* History List */}
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-3">Delivery History</h2>

        {orders.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-8 text-center">
            <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No delivery history yet</p>
            <p className="text-xs text-slate-400 mt-1">Completed deliveries will appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map(order => {
              const status = order.delivery_status || order.status;
              const isDelivered = status === 'delivered';
              const date = order.delivery_verified_at || order.updated_at || order.created_at;
              return (
                <button
                  key={order.id}
                  onClick={() => navigate(`/delivery/orders/${order.id}`)}
                  className="w-full bg-white rounded-xl border border-slate-100 p-3 text-left hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isDelivered ? 'bg-emerald-100' : 'bg-red-100'
                    }`}>
                      {isDelivered
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        : <XCircle className="w-4 h-4 text-red-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-800">
                          #{order.order_number}
                        </p>
                        <p className="text-sm font-semibold text-slate-700">
                          ₹{parseFloat(order.total_amount || 0).toFixed(0)}
                        </p>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-xs text-slate-500 truncate">
                          {order.consumer_name || 'Customer'}
                        </p>
                        <p className="text-[10px] text-slate-400 flex-shrink-0 ml-2">
                          {date ? new Date(date).toLocaleDateString('en-IN') : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
