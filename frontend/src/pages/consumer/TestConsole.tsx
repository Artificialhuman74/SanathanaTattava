import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { consumerApi } from '../../contexts/AuthContext';
import { drawSeenKey, drawInfoSeenKey } from '../../config/luckyDraw';
import toast from 'react-hot-toast';
import {
  ArrowLeft, FlaskConical, Trophy, Package, Truck, RefreshCw, AlertTriangle, Bell, Loader2,
} from 'lucide-react';

interface Order {
  id: number;
  order_number: string;
  status: string;
  delivery_status: string | null;
  total_amount: number;
}

interface Holding {
  id: number;
  status: string;
  container_type: string;
  product_name: string;
}

const opts = { skipBaseRotation: true, skipAuthRedirect: true };

function Section({ icon: Icon, title, subtitle, children }: { icon: React.ElementType; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 sm:p-6 mb-5">
      <div className="flex items-center gap-2.5 mb-1">
        <Icon size={16} className="text-slate-500" />
        <h2 className="font-bold text-slate-900 text-sm">{title}</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

function ActionButton({ onClick, label, loading, tone = 'default' }: { onClick: () => void; label: string; loading?: boolean; tone?: 'default' | 'danger' }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5 ${
        tone === 'danger' ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {loading && <Loader2 size={12} className="animate-spin" />}
      {label}
    </button>
  );
}

export default function TestConsole() {
  const navigate = useNavigate();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [luckyDrawStatus, setLuckyDrawStatus] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);

  const refreshAll = async () => {
    const [ld, ord, hold] = await Promise.all([
      consumerApi.get('/lucky-draw/consumer/status', opts).catch(() => ({ data: null })),
      consumerApi.get('/dev-tools/orders/mine', opts).catch(() => ({ data: { orders: [] } })),
      consumerApi.get('/dev-tools/containers/mine', opts).catch(() => ({ data: { holdings: [] } })),
    ]);
    setLuckyDrawStatus(ld.data);
    setOrders(ord.data.orders || []);
    setHoldings(hold.data.holdings || []);
  };

  useEffect(() => {
    consumerApi.get('/dev-tools/status', opts)
      .then(({ data }) => {
        if (!data.enabled) { navigate('/shop', { replace: true }); return; }
        setCheckingAccess(false);
        refreshAll();
        consumerApi.get('/dev-tools/notifications/templates', opts).then(r => setTemplates(r.data.templates || []));
      })
      .catch(() => navigate('/shop', { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (key: string, fn: () => Promise<any>, successMsg: string, after?: (data: any) => void) => {
    setBusy(key);
    try {
      const res = await fn();
      after?.(res?.data);
      toast.success(successMsg);
      await refreshAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  /* The reveal is a play-once moment per draw, remembered in localStorage.
   * Forcing a win again has to forget that, or the server records a new draw
   * and the screen still shows the calm already-watched state, which looks
   * exactly like the tool doing nothing.
   *
   * Both flags go: the reveal itself, and the follow-up card that comes after
   * it, so a replay starts from the very beginning of the sequence. */
  const clearDrawFlags = async () => {
    try {
      const { data } = await consumerApi.get('/lucky-draw/consumer/status', opts);
      const c = data?.cycle;
      if (!c?.latest_draw) return;
      localStorage.removeItem(drawSeenKey(c.scheme_id, c.latest_draw.month_key));
      localStorage.removeItem(drawInfoSeenKey(c.scheme_id, c.latest_draw.month_key));
    } catch { /* the toast already said the win landed */ }
  };

  const forceWin = () =>
    run(
      'ld-win',
      async () => {
        const res = await consumerApi.post('/dev-tools/lucky-draw/force-win', {}, opts);
        await clearDrawFlags();
        return res;
      },
      "You're this round's winner. Open Bhagya Chakra to watch the reveal.",
    );

  const runDraw = () =>
    run(
      'ld-draw',
      async () => {
        const res = await consumerApi.post('/dev-tools/lucky-draw/run-draw', {}, opts);
        await clearDrawFlags();
        return res;
      },
      'Draw run. Open Bhagya Chakra to watch the reveal.',
    );

  if (checkingAccess) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <button onClick={() => navigate('/shop')} className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6">
        <ArrowLeft size={14} /> Back to shop
      </button>

      <div className="flex items-center gap-2.5 mb-1">
        <FlaskConical size={20} className="text-slate-700" />
        <h1 className="text-xl font-bold text-slate-900">Test Console</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6 flex items-center gap-1.5">
        <AlertTriangle size={13} className="text-amber-500" />
        Dev/testing only — manually triggers backend state changes on your own account. Never available in production.
      </p>

      {/* ── Lucky draw ────────────────────────────────────────────────── */}
      <Section icon={Trophy} title="Bhagya Chakra" subtitle="Force states that normally require the monthly draw job (not built yet) or real month-by-month play.">
        <p className="text-xs text-slate-500 mb-1">
          Enrollment: <span className="font-semibold text-slate-700">
            {luckyDrawStatus?.active_enrollment
              ? `${luckyDrawStatus.active_enrollment.scheme_name}, ${luckyDrawStatus.active_enrollment.status}`
              : 'not enrolled'}
          </span>
        </p>
        {luckyDrawStatus?.cycle && (
          <p className="text-xs text-slate-500 mb-3">
            Cycle: <span className="font-semibold text-slate-700">
              month {luckyDrawStatus.cycle.month_number} of {luckyDrawStatus.cycle.total_months}
              {', '}
              {luckyDrawStatus.cycle.won
                ? 'won'
                : luckyDrawStatus.cycle.entered ? 'entered this month' : 'not entered this month'}
              {luckyDrawStatus.cycle.latest_draw
                ? `, last draw ${luckyDrawStatus.cycle.latest_draw.month_key} (${luckyDrawStatus.cycle.latest_draw.winner_display_name})`
                : ', no draw run yet'}
            </span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <ActionButton
            label="Join a scheme (skip payment)"
            loading={busy === 'ld-enroll'}
            onClick={() => run('ld-enroll', () => consumerApi.post('/dev-tools/lucky-draw/force-enroll', {}, opts), "You're enrolled and qualifying")}
          />
          <ActionButton
            label="Force win"
            loading={busy === 'ld-win'}
            onClick={forceWin}
          />
          <ActionButton
            label="Run this month's draw"
            loading={busy === 'ld-draw'}
            onClick={runDraw}
          />
          <ActionButton
            label="Replay this month's free order"
            loading={busy === 'ld-reclaim'}
            onClick={() => run(
              'ld-reclaim',
              () => consumerApi.post('/dev-tools/lucky-draw/reset-monthly-claim', {}, opts),
              "This month's free order is undone. Open Bhagya Chakra to place it again.",
            )}
          />
          <ActionButton
            label="Force 13th-month guarantee"
            loading={busy === 'ld-13th'}
            onClick={() => run('ld-13th', () => consumerApi.post('/dev-tools/lucky-draw/force-13th-month', {}, opts), 'Round marked completed via guarantee')}
          />
          <ActionButton
            label="Simulate a missed month"
            loading={busy === 'ld-miss'}
            onClick={() => run('ld-miss', () => consumerApi.post('/dev-tools/lucky-draw/simulate-missed-month', {}, opts), 'Recorded a missed month')}
          />
          <ActionButton
            tone="danger"
            label="Reset my enrollment"
            loading={busy === 'ld-reset'}
            onClick={() => run('ld-reset', () => consumerApi.post('/dev-tools/lucky-draw/reset', {}, opts), 'Cleared — free to enroll fresh')}
          />
        </div>
        <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
          Start with "Join a scheme (skip payment)" if you're not enrolled, then place a test order so you qualify.
          Replay this month's free order removes the ₹0 order, its invoice and the container that came with it, so a
          winner's monthly claim can be walked through from the start as often as you like.
          Run this month's draw picks a winner among everyone who ordered in this month's window, which is what makes the
          shop page's result takeover appear. Force win is re-runnable — run it again on an enrollment that has already won and the reveal replays from its first frame.
        </p>
        <Link to="/shop/lucky-draw" className="inline-block mt-1.5 text-xs text-brand-700 hover:underline">Open Bhagya Chakra →</Link>
      </Section>

      {/* ── Orders / delivery ────────────────────────────────────────── */}
      <Section icon={Truck} title="Order & delivery lifecycle" subtitle="Create a throwaway order, then step it through the same delivery states a real dealer would.">
        <ActionButton
          label="Create test order"
          loading={busy === 'order-create'}
          onClick={() => run('order-create', () => consumerApi.post('/dev-tools/orders/create-test-order', {}, opts), 'Test order created')}
        />
        <div className="mt-3 space-y-2">
          {orders.length === 0 && <p className="text-xs text-slate-400">No test orders yet.</p>}
          {orders.map(o => (
            <div key={o.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-parchment-100 border border-[#e8dcc8]">
              <div className="min-w-0">
                <p className="text-xs font-mono text-slate-700 truncate">{o.order_number}</p>
                <p className="text-[11px] text-slate-500">{o.delivery_status || 'pending'}</p>
              </div>
              <ActionButton
                label={o.delivery_status === 'delivered' ? 'Delivered' : 'Advance →'}
                loading={busy === `order-${o.id}`}
                onClick={() => o.delivery_status !== 'delivered' && run(`order-${o.id}`, () => consumerApi.post(`/dev-tools/orders/${o.id}/advance-delivery`, {}, opts), 'Advanced delivery status')}
              />
            </div>
          ))}
        </div>
      </Section>

      {/* ── Container holdings ───────────────────────────────────────── */}
      <Section icon={Package} title="Container holdings" subtitle="Fast-forward straight to a held container without a full order + delivery cycle first.">
        <ActionButton
          label="Force a held container"
          loading={busy === 'ctr-create'}
          onClick={() => run('ctr-create', () => consumerApi.post('/dev-tools/containers/force-held', {}, opts), 'Container marked held')}
        />
        <div className="mt-3 space-y-2">
          {holdings.length === 0 && <p className="text-xs text-slate-400">No test holdings yet.</p>}
          {holdings.map(h => (
            <div key={h.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-parchment-100 border border-[#e8dcc8]">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700 truncate">{h.product_name} · {h.container_type}</p>
                <p className="text-[11px] text-slate-500">{h.status}</p>
              </div>
              {h.status === 'held' && (
                <div className="flex gap-1.5 flex-shrink-0">
                  <ActionButton
                    label="Refund"
                    loading={busy === `ctr-refund-${h.id}`}
                    onClick={() => run(`ctr-refund-${h.id}`, () => consumerApi.post(`/dev-tools/containers/${h.id}/trigger-refund`, { destination: 'store_credit' }, opts), 'Refund requested')}
                  />
                  <ActionButton
                    label="Dispute"
                    loading={busy === `ctr-dispute-${h.id}`}
                    onClick={() => run(`ctr-dispute-${h.id}`, () => consumerApi.post(`/dev-tools/containers/${h.id}/trigger-dispute`, {}, opts), 'Damage dispute opened')}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ── Notifications ─────────────────────────────────────────────── */}
      <Section icon={Bell} title="Notifications" subtitle="Fire any notification type on demand to check the bell UI and copy.">
        <div className="flex flex-wrap gap-2">
          {templates.map(t => (
            <ActionButton
              key={t}
              label={t.replace(/_/g, ' ')}
              loading={busy === `notif-${t}`}
              onClick={() => run(`notif-${t}`, () => consumerApi.post('/dev-tools/notifications/fire', { template: t }, opts), 'Notification sent — check the bell')}
            />
          ))}
        </div>
      </Section>

      <button
        onClick={() => refreshAll()}
        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600"
      >
        <RefreshCw size={12} /> Refresh state
      </button>
    </div>
  );
}
