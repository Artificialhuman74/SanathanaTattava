import React, { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import {
  Package, Truck, CheckCircle2, ChevronRight,
  ToggleLeft, ToggleRight, Loader2, AlertCircle, MapPin,
  Users, Info, HelpCircle, ChevronDown,
  Recycle, PackagePlus, ArrowLeftRight, ArrowDownToLine, Link2,
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
  const [pickups, setPickups] = useState<any[]>([]);
  const [fleetOrders, setFleetOrders] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [helpOpen, setHelpOpen] = useState<boolean>(() => {
    const v = localStorage.getItem('delivery_help_open');
    return v === null ? true : v === '1';
  });
  useEffect(() => {
    localStorage.setItem('delivery_help_open', helpOpen ? '1' : '0');
  }, [helpOpen]);

  useEffect(() => {
    fetchData();
  }, [isAdmin]);

  const fetchData = async () => {
    try {
      const calls: Promise<any>[] = [
        api.get('/delivery/orders/assigned'),
        api.get('/delivery/stats'),
        api.get('/delivery/container-pickups'),
      ];
      if (isAdmin) calls.push(api.get('/delivery/fleet/orders'));

      const results = await Promise.all(calls);
      setOrders(results[0].data.orders || []);
      setStats(results[1].data.stats || null);
      setPickups(results[2].data.pickups || []);
      if (isAdmin) setFleetOrders(results[3].data.orders || []);
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

  /* Unified card feed: active orders + standalone pickups, newest first.
   * Each card is keyed by `${kind}-${id}` for scroll-into-view linking. */
  const stopCards: any[] = [
    ...activeOrders.map(o => ({
      kind: 'delivery',
      id: o.id,
      created_at: o.created_at,
      data: o,
    })),
    ...pickups.map(p => ({
      kind: 'pickup',
      id: p.id,
      created_at: p.requested_at || p.created_at,
      data: p,
    })),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  /* When the driver clicks a "Also pending" row, try to scroll to that card
   * on the same page. If it's not in the visible list, navigate to its
   * detail page. */
  const handlePendingLink = (entry: { kind: string; id: number }) => {
    const el = document.getElementById(`stop-${entry.kind}-${entry.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-emerald-400');
      setTimeout(() => el.classList.remove('ring-2', 'ring-emerald-400'), 1800);
      return;
    }
    if (entry.kind === 'delivery') navigate(`/delivery/orders/${entry.id}`);
    else navigate('/delivery/pickups');
  };

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

      {/* Simple Guide — collapsible, state persisted to localStorage */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl">
        <button
          type="button"
          onClick={() => setHelpOpen(o => !o)}
          className="w-full flex items-center justify-between gap-3 p-4 text-left"
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-emerald-700" />
            <span className="font-bold text-emerald-900 text-sm">How to deliver an order (tap to show/hide)</span>
          </div>
          <ChevronDown className={`w-5 h-5 text-emerald-700 transition-transform ${helpOpen ? 'rotate-180' : ''}`} />
        </button>

        {helpOpen && <div className="px-4 pb-4 space-y-4 text-sm text-emerald-900">
          <div>
            <p className="font-bold mb-1">In simple words</p>
            <p className="text-emerald-800">
              When a customer places an order near you, it will show up here. Take the order to the
              customer, ask them to check their <b>email</b> for a <b>6-digit OTP</b>, type it in this
              app, and you're done.
            </p>
          </div>

          <div>
            <p className="font-bold mb-1">Step by step</p>
            <ol className="list-decimal pl-5 space-y-1 text-emerald-800">
              <li>Turn the <b>ONLINE</b> switch above ON so the app can give you orders.</li>
              <li>A new order appears in <b>Active Orders</b>. Tap it to open.</li>
              <li>Check the <b>tags</b> on the card (NEW / REFILL / SWAP / PICKUP) so you know what to carry and what to collect — see the section below.</li>
              <li>Tap <b>Accept</b> → then <b>Mark Packed</b> when ready to leave.</li>
              <li>Tap <b>Start Delivery</b> when you leave for the customer.</li>
              <li>At the customer's door, ask them: <i>"Please check your email and tell me the 6-digit OTP."</i></li>
              <li>Type the OTP in the app and tap <b>Confirm</b>. Done — delivery is complete.</li>
            </ol>
          </div>

          <div>
            <p className="font-bold mb-1">What the tags mean</p>
            <ul className="space-y-2 text-emerald-800">
              <li>
                <span className="inline-block px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[11px] font-bold mr-1">NEW</span>
                First-time purchase that includes a refundable container deposit.
                <div className="text-emerald-700 text-xs mt-0.5"><b>Action:</b> Hand over the new sealed container. Nothing to collect back.</div>
              </li>
              <li>
                <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px] font-bold mr-1">REFILL</span>
                Customer already has a container from a previous order — they want it refilled.
                <div className="text-emerald-700 text-xs mt-0.5"><b>Action:</b> <b>Collect their empty container</b> and leave the filled one. Don't leave without the empty.</div>
              </li>
              <li>
                <span className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-bold mr-1">SWAP</span>
                Customer is changing the oil/product type, so the old container can't be refilled.
                <div className="text-emerald-700 text-xs mt-0.5"><b>Action:</b> <b>Collect the old empty container</b> and deliver the new filled one of the new type.</div>
              </li>
              <li>
                <span className="inline-block px-2 py-0.5 rounded bg-slate-200 text-slate-800 text-[11px] font-bold mr-1">PICKUP</span>
                Standalone container return — no goods to deliver. Customer wants their deposit refunded or store credit.
                <div className="text-emerald-700 text-xs mt-0.5"><b>Action:</b> <b>Only collect the empty container.</b> Do not hand over any product. Mark pickup complete in the app.</div>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-bold mb-1">What the buttons mean</p>
            <ul className="space-y-1 text-emerald-800">
              <li><b>Online / Offline</b> — Online means you are ready to take orders. Offline means you won't get new orders.</li>
              <li><b>Accept</b> — You agree to deliver this order.</li>
              <li><b>Mark Packed</b> — The bag is ready in your hand.</li>
              <li><b>Start Delivery</b> — You are leaving now to go to the customer.</li>
              <li><b>Enter OTP</b> — You have reached the customer; ask for their OTP.</li>
            </ul>
          </div>

          <div className="bg-white/70 rounded-lg p-3 border border-emerald-200">
            <p className="font-bold mb-1 text-emerald-900">If the customer doesn't have the OTP</p>
            <ul className="space-y-1 text-emerald-800">
              <li>Ask them to <b>check their email inbox</b> (including the spam folder) — the 6-digit OTP is sent there.</li>
              <li>If they still can't find it, open the order page and tap <b>Resend OTP</b>. A fresh code will be emailed to them.</li>
              <li>Still no OTP? Call admin before handing over the items.</li>
            </ul>
          </div>

          <div>
            <p className="font-bold mb-1">Important</p>
            <ul className="space-y-1 text-emerald-800">
              <li><b>Never hand over the items without entering the OTP.</b> The OTP is the only proof the customer received the order.</li>
              <li>If you cannot finish a delivery, open the order and mark it <b>Failed</b> with a reason.</li>
              <li>Use the <b>same email and password</b> as your trader login. No separate account.</li>
            </ul>
          </div>
        </div>}
      </div>

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

      {/* Active visits — orders + standalone pickups in one unified feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-slate-800">
            {isAdmin ? 'My Delivery Requests' : 'Active Visits'}
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

        {stopCards.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-8 text-center">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">
              {isAdmin
                ? 'No deliveries assigned to admin right now'
                : 'No active visits right now'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {isAdmin
                ? 'Admin is only used as last-resort fallback'
                : 'New orders and pickups will appear here when assigned'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {stopCards.slice(0, 8).map(card => (
              <StopCard
                key={`${card.kind}-${card.id}`}
                card={card}
                onOpen={() => {
                  if (card.kind === 'delivery') navigate(`/delivery/orders/${card.id}`);
                  else navigate('/delivery/pickups');
                }}
                onPendingClick={handlePendingLink}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Unified card that renders either a delivery order or a standalone
 * container pickup. Each card shows tagged lines + a footer listing
 * other open requests for the same consumer. The footer rows are
 * clickable and scroll to (or navigate to) the matching card.
 * ────────────────────────────────────────────────────────────────────── */
const LINE_BADGE: Record<string, { label: string; className: string; Icon: any }> = {
  new:      { label: 'NEW',     className: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icon: PackagePlus },
  refill:   { label: 'REFILL',  className: 'bg-sky-100 text-sky-700 border-sky-200',             Icon: Recycle },
  swap:     { label: 'SWAP',    className: 'bg-amber-100 text-amber-700 border-amber-200',       Icon: ArrowLeftRight },
  standard: { label: 'ITEM',    className: 'bg-slate-100 text-slate-600 border-slate-200',       Icon: Package },
};

function StopCard({
  card,
  onOpen,
  onPendingClick,
}: {
  card: { kind: 'delivery' | 'pickup'; id: number; data: any };
  onOpen: () => void;
  onPendingClick: (e: { kind: string; id: number }) => void;
}) {
  const isDelivery = card.kind === 'delivery';
  const d = card.data;
  const status = d.delivery_status || (isDelivery ? 'pending' : 'pickup_pending');
  const pending: any[] = d.consumer_pending_elsewhere || [];

  return (
    <div
      id={`stop-${card.kind}-${card.id}`}
      className="bg-white rounded-xl border border-slate-100 p-4 transition-shadow hover:shadow-md"
    >
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-start justify-between mb-2 gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">
              {isDelivery ? `Order #${d.order_number}` : `Pickup #PCK-${d.id}`}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">{d.consumer_name || 'Customer'}</p>
          </div>
          <span
            className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              isDelivery
                ? DELIVERY_STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'
                : 'bg-rose-100 text-rose-700'
            }`}
          >
            {isDelivery ? DELIVERY_STATUS_LABELS[status] || status : 'Pickup requested'}
          </span>
        </div>

        {(d.delivery_address || d.consumer_address) && (
          <div className="flex items-start gap-1.5 mt-2">
            <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-slate-500 line-clamp-1">
              {d.delivery_address || d.consumer_address}
            </p>
          </div>
        )}

        {/* Lines / tasks for THIS request */}
        <div className="mt-3 space-y-1.5">
          {isDelivery ? (
            (d.items || []).map((it: any) => {
              const meta = LINE_BADGE[it.line_type] || LINE_BADGE.standard;
              const Icon = meta.Icon;
              return (
                <div key={it.id} className="flex items-center gap-2 text-xs">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${meta.className}`}>
                    <Icon className="w-3 h-3" />
                    {meta.label}
                  </span>
                  <span className="text-slate-700 truncate">
                    {it.product_name} × {it.quantity}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-rose-100 text-rose-700 border-rose-200">
                <ArrowDownToLine className="w-3 h-3" />
                PICKUP
              </span>
              <span className="text-slate-700 truncate">
                {d.container_type} ({d.current_product_name}) · refund ₹{Math.round(d.deposit_amount || 0)}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-50">
          <p className="text-xs text-slate-400">
            {isDelivery
              ? `${d.items?.length || 0} items · ₹${parseFloat(d.total_amount || 0).toFixed(0)}`
              : `Destination: ${(d.refund_destination || 'pending').replace('_', ' ')}`}
          </p>
          <QuickAction status={status} />
        </div>
      </button>

      {/* Also pending for this customer — clickable cross-references */}
      {pending.length > 0 && (
        <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
            <Link2 className="w-3 h-3" />
            Also pending for this customer
          </p>
          <div className="space-y-1.5">
            {pending.map(p => (
              <button
                key={`${p.kind}-${p.id}`}
                onClick={(e) => { e.stopPropagation(); onPendingClick(p); }}
                className="w-full text-left flex items-center gap-2 text-xs bg-slate-50 hover:bg-slate-100 rounded-md px-2 py-1.5 transition-colors"
              >
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  p.kind === 'pickup' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {p.kind === 'pickup' ? <ArrowDownToLine className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
                  {p.kind === 'pickup' ? 'PICKUP' : 'ORDER'}
                </span>
                <span className="text-slate-700 truncate flex-1">{p.summary}</span>
                <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
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
