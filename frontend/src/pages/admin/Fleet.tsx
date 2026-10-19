import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { AlarmClock, Loader2, RefreshCw } from 'lucide-react';
import { useSocket } from '../../contexts/SocketContext';
import LiquidLoader from '../../components/LiquidLoader';
import FleetMap, { FleetMapData } from './FleetMap';

/**
 * Live fleet (handoff §4.14, canvas "AdminFleet"): every order the ST Partner app is
 * dispatching, by stage, with the urgent "no rider for 30 minutes" alerts on top and the
 * three ways to answer them.
 */

interface Point { lat: number; lng: number }
interface FleetOrder {
  id: number;
  order_number: string;
  area: string;
  customer: string;
  stage: string;
  stage_key: StageKey;
  stage_label: string;
  who: string;
  minutes_in_stage: number | null;
  attention: boolean;
  with_rider: boolean;
  riders_passed: number;
  shop: { id: number; name: string; lat: number | null; lng: number | null } | null;
  customer_pos: Point | null;
  rider: { id: number; name: string; vehicle_type: string | null; vehicle_plate: string | null; pos: Point | null } | null;
  alert: boolean;
  can_ask_shop: boolean;
}
interface Partner { id: number; name: string; role: 'rider' | 'trader'; busy: boolean; pos: Point | null }
interface Fleet {
  orders: FleetOrder[];
  partners: Partner[];
  counts: { deciding: number; finding: number; finding_late: number; out: number; riders_online: number; partners_online: number; attention: number; alerts: number };
  dispatch_enabled: boolean;
  at: string;
}

type StageKey = 'late' | 'deciding' | 'search' | 'packing' | 'toShop' | 'out' | 'hours' | 'back';
const STAGE: Record<StageKey, string> = {
  late: 'bg-red-100 text-red-700',
  deciding: 'bg-amber-100 text-amber-700',
  search: 'bg-red-100 text-red-700',
  packing: 'bg-parchment-200 text-[#5c3d1a]',
  toShop: 'bg-violet-100 text-violet-700',
  out: 'bg-blue-100 text-blue-700',
  hours: 'bg-slate-100 text-slate-600',
  back: 'bg-orange-100 text-orange-700',
};

type Filter = 'all' | 'attn' | 'rider' | 'trader';
const POLL_MS = 15_000;

const duration = (m: number | null) => {
  if (m == null) return '—';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

function UrgentAlert({ o, onDone }: { o: FleetOrder; onDone: () => void }) {
  const [busy, setBusy] = useState<'take' | 'ask' | 'keep' | null>(null);
  const [confirmTake, setConfirmTake] = useState(false);
  const shopName = o.shop?.name || 'the shop';

  const act = async (kind: 'take' | 'ask' | 'keep') => {
    if (kind === 'take' && !confirmTake) { setConfirmTake(true); return; }
    setBusy(kind);
    try {
      if (kind === 'take') await api.post(`/delivery/orders/${o.id}/takeover`);
      if (kind === 'ask') await api.post(`/admin/dispatch/orders/${o.id}/ask-shop`);
      if (kind === 'keep') await api.post(`/admin/dispatch/orders/${o.id}/keep-searching`);
      toast.success(kind === 'take' ? `${o.order_number} is yours to deliver` : kind === 'ask' ? `Ringing ${shopName} again` : 'Still searching for a rider');
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'That didn’t work. Try again.');
    } finally {
      setBusy(null);
      setConfirmTake(false);
    }
  };

  const noShop = o.stage === 'admin';
  const title = noShop
    ? `No shop covers this order · ${o.order_number}`
    : `No rider for ${duration(o.minutes_in_stage)} · ${o.order_number}`;
  const passed = o.riders_passed ? ` ${o.riders_passed} rider${o.riders_passed === 1 ? '' : 's'} passed on it.` : ' No rider has been free nearby.';
  const detail = noShop
    ? `Customer: ${o.customer}${o.area ? `, ${o.area}` : ''}. Deliver it yourself from the website.`
    : `${o.who.replace(' (packed)', '')}${o.who.includes('(packed)') ? ' packed it' : ' has it'}. Customer: ${o.customer}${o.area ? `, ${o.area}` : ''}.${passed}`;

  return (
    <div role="alert" className="rounded-[20px] bg-red-50 border border-red-200 px-4 py-3.5 flex flex-wrap items-center gap-3.5">
      <span className="fleet-urgent w-10 h-10 flex-none rounded-full bg-red-600 grid place-items-center" aria-hidden="true">
        <AlarmClock size={20} className="text-white" />
      </span>
      <div className="flex-1 min-w-[240px]">
        <p className="text-[15px] font-bold text-red-800">{title}</p>
        <p className="text-[13px] text-red-900/90 mt-0.5">{detail}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {noShop ? (
          <Link to="/admin/consumer-orders" className="px-4 py-2.5 rounded-2xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700">
            Open consumer orders
          </Link>
        ) : (
          <>
            <button
              onClick={() => act('take')}
              disabled={!!busy}
              className={`px-4 py-2.5 rounded-2xl text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60 ${confirmTake ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-brand-600 text-white hover:bg-brand-700'}`}
            >
              {busy === 'take' && <Loader2 size={14} className="animate-spin" />}
              {confirmTake ? 'Yes, I’ll deliver it' : 'Take over delivery'}
            </button>
            {o.can_ask_shop && (
              <button
                onClick={() => act('ask')}
                disabled={!!busy}
                className="px-4 py-2.5 rounded-2xl border border-surface-300 bg-surface-50 text-slate-700 text-sm font-semibold hover:bg-parchment-200 inline-flex items-center gap-2 disabled:opacity-60"
              >
                {busy === 'ask' && <Loader2 size={14} className="animate-spin" />}
                Ask {shopName} to deliver
              </button>
            )}
          </>
        )}
        <button
          onClick={() => (confirmTake ? setConfirmTake(false) : act('keep'))}
          disabled={!!busy}
          className="px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-100 inline-flex items-center gap-2 disabled:opacity-60"
        >
          {busy === 'keep' && <Loader2 size={14} className="animate-spin" />}
          {confirmTake ? 'Cancel' : 'Keep searching'}
        </button>
      </div>
    </div>
  );
}

export default function AdminFleet() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [, tick] = useState(0);
  const { on, off } = useSocket();

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data } = await api.get('/admin/dispatch/fleet');
      if (!data || !Array.isArray(data.orders) || !Array.isArray(data.partners)) throw new Error('Unexpected fleet response');
      setFleet(data);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    // "updated N s ago" stays honest between polls.
    const clock = setInterval(() => tick((n) => n + 1), 5_000);
    return () => { clearInterval(id); clearInterval(clock); };
  }, [load]);

  useEffect(() => {
    const now = () => load();
    on('dispatch:alert', now);
    on('order_status_updated', now);
    return () => { off('dispatch:alert', now); off('order_status_updated', now); };
  }, [on, off, load]);

  const mapData: FleetMapData = useMemo(() => {
    const out: FleetMapData = { shops: [], riders: [], customers: [] };
    if (!fleet) return out;
    const shops = new Map<number, FleetMapData['shops'][number]>();
    for (const o of fleet.orders) {
      if (o.shop?.lat != null && o.shop.lng != null) {
        const s = shops.get(o.shop.id) || { id: o.shop.id, name: o.shop.name, pos: { lat: o.shop.lat, lng: o.shop.lng }, needsRider: false };
        if (o.stage === 'rider_search') s.needsRider = true;
        shops.set(o.shop.id, s);
      }
      if (o.customer_pos) out.customers.push({ id: o.id, label: `${o.order_number} · ${o.customer}`, pos: o.customer_pos });
    }
    out.shops = [...shops.values()];
    out.riders = fleet.partners.filter((p) => p.role === 'rider' && p.pos).map((p) => ({ id: p.id, name: p.name, pos: p.pos!, busy: p.busy }));
    return out;
  }, [fleet]);

  if (!fleet) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        {error ? (
          <>
            <p className="text-slate-600">Couldn’t load the fleet.</p>
            <button onClick={load} className="btn-primary">Try again</button>
          </>
        ) : <LiquidLoader size={76} />}
      </div>
    );
  }

  const { orders, counts } = fleet;
  const alerts = orders.filter((o) => o.alert);
  const shown = orders.filter((o) =>
    filter === 'all' || (filter === 'attn' && o.attention) || (filter === 'rider' && o.with_rider) || (filter === 'trader' && !o.with_rider));
  const secondsAgo = Math.max(0, Math.round((Date.now() - new Date(fleet.at).getTime()) / 1000));
  const updated = secondsAgo < 10 ? 'updated just now' : secondsAgo < 60 ? `updated ${secondsAgo} s ago` : `updated ${Math.round(secondsAgo / 60)} min ago`;

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: `All · ${orders.length}` },
    { id: 'attn', label: `Needs attention · ${counts.attention}` },
    { id: 'rider', label: 'With riders' },
    { id: 'trader', label: 'With traders' },
  ];

  return (
    <div className="space-y-[18px] animate-fade-in">
      {alerts.map((o) => <UrgentAlert key={o.id} o={o} onDone={load} />)}

      {!fleet.dispatch_enabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          App dispatch is switched off, so new orders aren’t being sent to the ST Partner app.{' '}
          <Link to="/admin/settings" className="font-semibold underline">Turn it on in Settings</Link>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Live fleet</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {orders.length} order{orders.length === 1 ? '' : 's'} on the move · {counts.riders_online} rider{counts.riders_online === 1 ? '' : 's'} online · {updated}
          </p>
        </div>
        <button onClick={load} disabled={refreshing} className="btn-ghost text-sm gap-2" aria-label="Refresh">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { n: counts.deciding, label: 'Trader deciding', ink: 'text-amber-700' },
          { n: counts.finding, label: counts.finding_late ? `Finding a rider · ${counts.finding_late} late` : 'Finding a rider', ink: 'text-red-700' },
          { n: counts.out, label: 'Out for delivery', ink: 'text-blue-700' },
          { n: counts.riders_online, label: 'Riders online', ink: 'text-brand-600' },
        ].map((t) => (
          <div key={t.label} className="rounded-3xl bg-surface-50 border border-surface-300 p-4 text-center">
            <p className={`text-2xl font-extrabold ${t.ink}`}>{t.n}</p>
            <p className="text-xs text-slate-500 mt-0.5">{t.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 items-stretch">
        <section aria-label="Map" className="flex-[1_1_380px] min-w-0 rounded-3xl bg-surface-50 border border-surface-300 overflow-hidden flex flex-col">
          <FleetMap data={mapData} />
          <div className="px-3.5 py-2.5 flex flex-wrap gap-3.5 text-xs text-slate-700">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] bg-brand-600" />Shop</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-gold-500 ring-2 ring-white outline outline-1 outline-gold-500" />Rider</span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="12" height="14" viewBox="0 0 18 20" aria-hidden="true"><path d="M9 19s-9-8-9-14a9 9 0 0 1 18 0c0 6-9 14-9 14z" fill="#1d4ed8" /></svg>Customer
            </span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border-2 border-dashed border-red-600" />Needs a rider</span>
          </div>
        </section>

        <section aria-label="Orders in progress" className="flex-[999_1_520px] min-w-0 rounded-3xl bg-surface-50 border border-surface-300 overflow-hidden">
          <div className="px-3.5 py-3 border-b border-surface-300 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter">
            {filters.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${filter === f.id ? 'bg-brand-600 text-white' : 'bg-parchment-200 text-slate-700 hover:bg-parchment-300'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-parchment-100 border-b border-surface-300 text-left text-[#5c3d1a]">
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Stage</th>
                  <th className="px-4 py-3 font-semibold">With</th>
                  <th className="px-4 py-3 font-semibold text-right">In stage</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => {
                  const late = o.stage_key === 'late';
                  return (
                    <tr key={o.id} className="border-b border-parchment-200 last:border-0 hover:bg-parchment-100 transition-colors">
                      <td className="px-4 py-3 text-[#3d2e1a]">
                        <span className="block font-semibold">{o.order_number}</span>
                        <span className="block text-xs text-slate-500">{o.area || o.customer}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STAGE[o.stage_key] || STAGE.hours}`}>{o.stage_label}</span>
                      </td>
                      <td className="px-4 py-3 text-[#3d2e1a]">
                        {o.who}
                        {o.rider?.vehicle_plate && <span className="block text-xs text-slate-500 font-mono">{o.rider.vehicle_plate}</span>}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${late ? 'font-bold text-red-700' : 'text-[#3d2e1a]'}`}>{duration(o.minutes_in_stage)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && (
              <p className="text-center text-sm text-slate-500 py-12">
                {orders.length === 0 ? 'No orders on the move right now.' : 'Nothing here with this filter.'}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
