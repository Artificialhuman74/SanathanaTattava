import React, { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import {
  Package, Truck, CheckCircle2, Clock, ChevronRight,
  ToggleLeft, ToggleRight, Loader2, AlertCircle, MapPin,
} from 'lucide-react';

interface DeliveryContext {
  isOnline: boolean;
  toggleAvailability: () => Promise<void>;
  toggling: boolean;
}

const DELIVERY_STATUS_COLORS: Record<string, string> = {
  pending:          'bg-amber-100 text-amber-700',
  accepted:         'bg-blue-100 text-blue-700',
  packed:           'bg-purple-100 text-purple-700',
  out_for_delivery: 'bg-orange-100 text-orange-700',
  delivered:        'bg-emerald-100 text-emerald-700',
  failed:           'bg-red-100 text-red-600',
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending:          'New Order',
  accepted:         'Accepted',
  packed:           'Packed',
  out_for_delivery: 'Out for Delivery',
  delivered:        'Delivered',
  failed:           'Failed',
};

export default function DeliveryDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isOnline, toggleAvailability, toggling } = useOutletContext<DeliveryContext>();

  const [orders, setOrders] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [ordersRes, statsRes] = await Promise.all([
        api.get('/delivery/orders/assigned'),
        api.get('/delivery/stats'),
      ]);
      setOrders(ordersRes.data.orders || []);
      setStats(statsRes.data.stats || null);
    } catch (err: any) {
      setError('Failed to load delivery data');
    } finally {
      setLoading(false);
    }
  };

  const activeOrders = orders.filter(o =>
    ['pending', 'accepted', 'packed', 'out_for_delivery'].includes(o.delivery_status || 'pending')
  );
  const outForDelivery = orders.filter(o => o.delivery_status === 'out_for_delivery');

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
    </div>
  );

  return (
    <div className="p-4 space-y-5 animate-fade-in">
      {/* Online/Offline Banner */}
      <div className={`rounded-2xl p-4 ${isOnline ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-100 border border-slate-200'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-lg font-bold ${isOnline ? 'text-emerald-700' : 'text-slate-600'}`}>
              You are {isOnline ? 'ONLINE' : 'OFFLINE'}
            </p>
            <p className="text-sm text-slate-500">
              {isOnline ? 'Ready to receive delivery orders' : 'Toggle online to start receiving orders'}
            </p>
          </div>
          <button
            onClick={toggleAvailability}
            disabled={toggling}
            className="p-2 disabled:opacity-50"
            aria-label="Toggle availability"
          >
            {isOnline
              ? <ToggleRight className="w-10 h-10 text-emerald-600" />
              : <ToggleLeft className="w-10 h-10 text-slate-400" />
            }
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
          <Package className="w-5 h-5 text-blue-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-slate-800">{activeOrders.length}</p>
          <p className="text-[10px] text-slate-500 font-medium">Active</p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
          <Truck className="w-5 h-5 text-orange-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-slate-800">{outForDelivery.length}</p>
          <p className="text-[10px] text-slate-500 font-medium">Delivering</p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-slate-800">{stats?.today_deliveries ?? 0}</p>
          <p className="text-[10px] text-slate-500 font-medium">Today</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Active Orders */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-slate-800">Active Orders</h2>
          <button
            onClick={() => navigate('/delivery/orders')}
            className="text-sm text-emerald-600 font-medium flex items-center gap-1"
          >
            View All <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {activeOrders.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-8 text-center">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No active orders right now</p>
            <p className="text-xs text-slate-400 mt-1">New orders will appear here when assigned</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeOrders.slice(0, 5).map(order => {
              const status = order.delivery_status || 'pending';
              return (
                <button
                  key={order.id}
                  onClick={() => navigate(`/delivery/orders/${order.id}`)}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 text-left hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        Order #{order.order_number}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {order.consumer_name || 'Customer'}
                      </p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${DELIVERY_STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'}`}>
                      {DELIVERY_STATUS_LABELS[status] || status}
                    </span>
                  </div>
                  {order.delivery_address && (
                    <div className="flex items-start gap-1.5 mt-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-slate-500 line-clamp-1">{order.delivery_address}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-50">
                    <p className="text-xs text-slate-400">
                      {order.items?.length || 0} items · ₹{parseFloat(order.total_amount || 0).toFixed(0)}
                    </p>
                    <QuickAction status={status} />
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

function QuickAction({ status }: { status: string }) {
  const configs: Record<string, { label: string; color: string }> = {
    pending:          { label: 'Accept',         color: 'bg-emerald-600 text-white' },
    accepted:         { label: 'Mark Packed',    color: 'bg-blue-600 text-white' },
    packed:           { label: 'Start Delivery', color: 'bg-orange-500 text-white' },
    out_for_delivery: { label: 'Enter OTP',      color: 'bg-purple-600 text-white' },
  };
  const config = configs[status];
  if (!config) return null;
  return (
    <span className={`text-[10px] font-semibold px-3 py-1 rounded-full ${config.color}`}>
      {config.label} →
    </span>
  );
}
