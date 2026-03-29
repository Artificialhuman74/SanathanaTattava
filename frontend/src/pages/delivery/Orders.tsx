import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import {
  Package, Loader2, AlertCircle, MapPin, ChevronRight,
  ShoppingBag,
} from 'lucide-react';

const DELIVERY_STATUS_COLORS: Record<string, string> = {
  pending:          'bg-amber-100 text-amber-700',
  accepted:         'bg-blue-100 text-blue-700',
  packed:           'bg-purple-100 text-purple-700',
  out_for_delivery: 'bg-orange-100 text-orange-700',
  delivered:        'bg-emerald-100 text-emerald-700',
  failed:           'bg-red-100 text-red-600',
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending:          'New',
  accepted:         'Accepted',
  packed:           'Packed',
  out_for_delivery: 'Delivering',
  delivered:        'Delivered',
  failed:           'Failed',
};

const TABS = [
  { key: 'all',              label: 'All' },
  { key: 'pending',          label: 'New' },
  { key: 'accepted',         label: 'Accepted' },
  { key: 'packed',           label: 'Packed' },
  { key: 'out_for_delivery', label: 'Delivering' },
];

export default function DeliveryOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const { data } = await api.get('/delivery/orders/assigned');
      setOrders(data.orders || []);
    } catch (err: any) {
      setError('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = activeTab === 'all'
    ? orders.filter(o => !['delivered', 'failed'].includes(o.delivery_status || 'pending'))
    : orders.filter(o => (o.delivery_status || 'pending') === activeTab);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
    </div>
  );

  return (
    <div className="animate-fade-in">
      {/* Tab Filters */}
      <div className="bg-white border-b border-slate-100 px-4 pt-3 pb-0 sticky top-0 z-10">
        <div className="flex gap-1 overflow-x-auto pb-3 -mx-1 px-1 scrollbar-hide">
          {TABS.map(tab => {
            const count = tab.key === 'all'
              ? orders.filter(o => !['delivered', 'failed'].includes(o.delivery_status || 'pending')).length
              : orders.filter(o => (o.delivery_status || 'pending') === tab.key).length;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  activeTab === tab.key
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label} {count > 0 && <span className="ml-1">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Orders List */}
      <div className="p-4 space-y-3">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {filteredOrders.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-8 text-center mt-4">
            <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No orders in this category</p>
          </div>
        ) : (
          filteredOrders.map(order => {
            const status = order.delivery_status || 'pending';
            return (
              <button
                key={order.id}
                onClick={() => navigate(`/delivery/orders/${order.id}`)}
                className="w-full bg-white rounded-xl border border-slate-100 p-4 text-left hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-800">
                        #{order.order_number}
                      </p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${DELIVERY_STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'}`}>
                        {DELIVERY_STATUS_LABELS[status] || status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {order.consumer_name || 'Customer'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 mt-1" />
                </div>

                {order.delivery_address && (
                  <div className="flex items-start gap-1.5 mt-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-slate-500 line-clamp-2">{order.delivery_address}</p>
                  </div>
                )}

                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-50">
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>{order.items?.length || 0} items</span>
                    <span className="font-semibold text-slate-600">
                      ₹{parseFloat(order.total_amount || 0).toFixed(0)}
                    </span>
                  </div>
                  {order.delivery_distance_km && (
                    <span className="text-xs text-slate-400">{parseFloat(order.delivery_distance_km).toFixed(1)} km</span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
