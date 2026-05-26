import React, { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import {
  Package, Truck, CheckCircle2, ChevronRight,
  ToggleLeft, ToggleRight, Loader2, AlertCircle, MapPin,
  Users, Info,
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
  pending:          'Not yet accepted',
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
  const isAdmin = user?.role === 'admin';

  const [orders, setOrders] = useState<any[]>([]);
  const [fleetOrders, setFleetOrders] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, [isAdmin]);

  const fetchData = async () => {
    try {
      const calls: Promise<any>[] = [
        api.get('/delivery/orders/assigned'),
        api.get('/delivery/stats'),
      ];
      if (isAdmin) calls.push(api.get('/delivery/fleet/orders'));

      const results = await Promise.all(calls);
      setOrders(results[0].data.orders || []);
      setStats(results[1].data.stats || null);
      if (isAdmin) setFleetOrders(results[2].data.orders || []);
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
              {isOnline
                ? 'You will be considered for new delivery assignments'
                : 'You will NOT be assigned new deliveries until you go online'}
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
        <div className="mt-3 flex items-start gap-2 text-xs text-slate-600 bg-white/60 rounded-lg p-2.5">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
          <span>
            <b>What this toggle does:</b> turning it OFF also turns off your
            <b> "Will deliver"</b> flag, so the system skips you when routing new orders.
            Turning it ON enables both again.
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Stats Grid (own deliveries) */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
          <Package className="w-5 h-5 text-blue-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-slate-800">{activeOrders.length}</p>
          <p className="text-[10px] text-slate-500 font-medium">My Active</p>
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

      {/* Admin: Fleet view */}
      {isAdmin && (
        <FleetView orders={fleetOrders} onOpen={id => navigate(`/delivery/orders/${id}`)} />
      )}

      {/* My Active / Assigned Orders */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-slate-800">
            {isAdmin ? 'My Delivery Requests' : 'Active Orders'}
          </h2>
          {!isAdmin && (
            <button
              onClick={() => navigate('/delivery/orders')}
              className="text-sm text-emerald-600 font-medium flex items-center gap-1"
            >
              View All <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {activeOrders.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-8 text-center">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">
              {isAdmin
                ? 'No deliveries assigned to admin right now'
                : 'No active orders right now'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {isAdmin
                ? 'Admin is only used as last-resort fallback'
                : 'New orders will appear here when assigned'}
            </p>
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

function FleetView({ orders, onOpen }: { orders: any[]; onOpen: (id: number) => void }) {
  const counts = orders.reduce(
    (acc: Record<string, number>, o) => {
      const s = o.delivery_status || 'pending';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    { pending: 0, accepted: 0, packed: 0, out_for_delivery: 0 },
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-600" />
          <h2 className="text-base font-bold text-slate-800">Fleet — All Traders' Orders</h2>
        </div>
        <span className="text-xs text-slate-500">{orders.length} active</span>
      </div>

      {/* Status summary chips */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <StatusChip label="Not accepted" count={counts.pending} tone="amber" />
        <StatusChip label="Accepted"     count={counts.accepted} tone="blue" />
        <StatusChip label="Packed"       count={counts.packed} tone="purple" />
        <StatusChip label="Delivering"   count={counts.out_for_delivery} tone="orange" />
      </div>

      {orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-6 text-center">
          <p className="text-sm text-slate-500">No active deliveries across the fleet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
          {orders.slice(0, 15).map(o => {
            const status = o.delivery_status || 'pending';
            const unassigned = !o.delivery_dealer_id;
            return (
              <button
                key={o.id}
                onClick={() => onOpen(o.id)}
                className="w-full p-3 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        #{o.order_number}
                      </p>
                      <span className="text-xs text-slate-400">·</span>
                      <p className="text-xs text-slate-500 truncate">{o.consumer_name || 'Customer'}</p>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {unassigned ? (
                        <span className="text-red-600 font-semibold">UNASSIGNED</span>
                      ) : (
                        <>
                          Dealer: <b>{o.dealer_name || `#${o.delivery_dealer_id}`}</b>
                          {o.dealer_role === 'admin' && <span className="text-amber-600 ml-1">(admin fallback)</span>}
                        </>
                      )}
                    </p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${DELIVERY_STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'}`}>
                    {DELIVERY_STATUS_LABELS[status] || status}
                  </span>
                </div>
              </button>
            );
          })}
          {orders.length > 15 && (
            <div className="p-2 text-center text-xs text-slate-400">
              + {orders.length - 15} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusChip({ label, count, tone }: { label: string; count: number; tone: string }) {
  const tones: Record<string, string> = {
    amber:  'bg-amber-50 border-amber-200 text-amber-800',
    blue:   'bg-blue-50 border-blue-200 text-blue-800',
    purple: 'bg-purple-50 border-purple-200 text-purple-800',
    orange: 'bg-orange-50 border-orange-200 text-orange-800',
  };
  return (
    <div className={`rounded-lg border p-2 text-center ${tones[tone]}`}>
      <p className="text-base font-bold leading-none">{count}</p>
      <p className="text-[9px] font-semibold mt-1 uppercase tracking-wide">{label}</p>
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
