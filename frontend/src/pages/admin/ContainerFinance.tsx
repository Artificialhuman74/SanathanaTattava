import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Package, CheckCircle2, AlertTriangle, Info, RefreshCcw, X,
  Phone, MapPin, Calendar, FileText, Download, ShieldCheck, ShieldAlert,
  IndianRupee, Image as ImageIcon, Loader2, Search, Filter, Trash2,
  Banknote, History, Wallet, Inbox,
} from 'lucide-react';
import api from '../../api/axios';
import { formatIstDate } from '../../utils/dateTime';

/**
 * Phase 10 — unified Container Finance page.
 *
 * Replaces the old "Container Deposits" + "Manual Refunds" pages by stitching
 * three sub-pages together: an action queue (everything an admin still needs
 * to do), a searchable history of every container_finance_log event, and a
 * disputes table. Proof images stay viewable in History until either the
 * 30-day auto-purge cron deletes them or an admin manually removes them.
 */

type Tab = 'queue' | 'history' | 'disputes';

export default function ContainerFinance() {
  const [tab, setTab] = useState<Tab>('queue');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Wallet className="w-7 h-7 text-amber-600" />
          Container Finance
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Deposits, refunds, forfeits, driver reimbursements and disputes — one place.
        </p>
      </header>

      <div className="flex gap-2 border-b border-slate-200 overflow-x-auto">
        <TabBtn active={tab === 'queue'}    onClick={() => setTab('queue')}    icon={Inbox}        label="Action queue" />
        <TabBtn active={tab === 'history'}  onClick={() => setTab('history')}  icon={History}      label="History" />
        <TabBtn active={tab === 'disputes'} onClick={() => setTab('disputes')} icon={ShieldAlert}  label="Disputes" />
      </div>

      {tab === 'queue'    && <QueueTab setPreview={setPreviewUrl} />}
      {tab === 'history'  && <HistoryTab setPreview={setPreviewUrl} />}
      {tab === 'disputes' && <DisputesTab setPreview={setPreviewUrl} />}

      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreviewUrl(null)}>
          <img src={previewUrl} alt="full" className="max-w-full max-h-full rounded-xl" />
          <button onClick={() => setPreviewUrl(null)} className="absolute top-4 right-4 bg-white/90 p-2 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Queue tab — every outstanding action: held deposits, UPI proofs to
 * verify, drivers to reimburse, manual refunds awaiting UTR/UPI ref.
 * ───────────────────────────────────────────────────────────────────── */

interface Deposit {
  id: number;
  invoice_number: string;
  order_id: number;
  order_number: string;
  order_status: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  container_deposit: number;
  container_deposit_status: 'held' | 'refunded' | 'forfeited' | 'none';
  container_deposit_resolved_at: string | null;
  container_deposit_notes: string | null;
  resolved_by_name: string | null;
  created_at: string;
  supplementary_invoice_id: number | null;
  supplementary_invoice_number: string | null;
}

interface PendingVerification {
  id: number;
  consumer_name: string;
  consumer_phone: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  container_type: string;
  deposit_amount: number;
  refund_proof_url: string | null;
  resolved_at: string;
  notes: string | null;
}
interface PendingReimbursement {
  id: number;
  consumer_name: string;
  driver_name: string | null;
  driver_phone: string | null;
  container_type: string;
  deposit_amount: number;
  refund_proof_url: string | null;
  admin_verified_at: string;
  verified_by_name: string;
}
interface PendingManualRefund {
  id: number;
  consumer_id: number;
  consumer_name: string;
  consumer_phone: string | null;
  consumer_email: string | null;
  consumer_address: string | null;
  linked_dealer_name: string | null;
  container_type: string;
  deposit_amount: number;
  resolved_at: string | null;
  refund_destination: string;
  notes: string | null;
}

function QueueTab({ setPreview }: { setPreview: (u: string | null) => void }) {
  const [deposits, setDeposits]       = useState<Deposit[]>([]);
  const [pendingV, setPendingV]       = useState<PendingVerification[]>([]);
  const [pendingR, setPendingR]       = useState<PendingReimbursement[]>([]);
  const [manualRefunds, setManualRefunds] = useState<PendingManualRefund[]>([]);
  const [defaultRate, setDefaultRate] = useState(18);
  const [totalOwed, setTotalOwed]     = useState(0);
  const [loading, setLoading]         = useState(true);
  const [busyId, setBusyId]           = useState<number | null>(null);

  const [refundTarget,  setRefundTarget]  = useState<Deposit | null>(null);
  const [forfeitTarget, setForfeitTarget] = useState<Deposit | null>(null);
  const [settleTarget,  setSettleTarget]  = useState<PendingManualRefund | null>(null);

  const apiBase = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');
  const fullUrl = (u: string | null) => u ? (u.startsWith('http') ? u : `${apiBase}${u}`) : null;

  const load = async () => {
    setLoading(true);
    try {
      const [d, v, r, m] = await Promise.all([
        api.get('/admin/container-deposits'),
        api.get('/admin/container-deposits/pending-verification'),
        api.get('/admin/container-deposits/pending-reimbursement'),
        api.get('/admin/manual-refunds'),
      ]);
      setDeposits(d.data.deposits || []);
      setDefaultRate(d.data.defaultForfeitTaxRate || 18);
      setPendingV(v.data.pending || []);
      setPendingR(r.data.pending || []);
      setTotalOwed(r.data.totalOwedDriver || 0);
      setManualRefunds(m.data.refunds || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to load queues');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const heldDeposits  = deposits.filter(d => d.container_deposit_status === 'held');
  const heldLiability = heldDeposits.reduce((s, d) => s + d.container_deposit, 0);

  const verify = async (id: number, approved: boolean) => {
    const reason = approved ? null : prompt('Why are you rejecting this proof?');
    if (!approved && !reason) return;
    setBusyId(id);
    try {
      await api.post(`/admin/container-deposits/holdings/${id}/verify-proof`, { approved, notes: reason });
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed');
    } finally { setBusyId(null); }
  };

  const reimburse = async (id: number, amount: number) => {
    if (!window.confirm(`Confirm you have paid ₹${amount.toFixed(2)} to the driver?`)) return;
    setBusyId(id);
    try {
      await api.post(`/admin/container-deposits/holdings/${id}/reimburse-driver`, {});
      toast.success('Reimbursement recorded');
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed');
    } finally { setBusyId(null); }
  };

  if (loading) {
    return <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading queue…</div>;
  }

  const empty =
    heldDeposits.length === 0 &&
    pendingV.length === 0 &&
    pendingR.length === 0 &&
    manualRefunds.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button onClick={load} className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1.5">
          <RefreshCcw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Liability summary */}
      {heldDeposits.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
            <Package className="w-6 h-6 text-amber-700" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Deposits currently held (liability)</p>
            <p className="text-2xl font-extrabold text-slate-900">₹{heldLiability.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-0.5">{heldDeposits.length} customer{heldDeposits.length === 1 ? '' : 's'}</p>
          </div>
        </div>
      )}

      {empty && (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <CheckCircle2 className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
          <p className="text-slate-700 font-semibold">Nothing pending</p>
          <p className="text-slate-500 text-sm mt-1">All container holdings are in their resting state.</p>
        </div>
      )}

      {/* UPI proofs awaiting verification */}
      {pendingV.length > 0 && (
        <Section icon={ShieldCheck} accent="blue" title={`Driver UPI proofs awaiting check (${pendingV.length})`}>
          <div className="divide-y divide-slate-100">
            {pendingV.map(p => (
              <div key={p.id} className="p-4 flex flex-col md:flex-row gap-4">
                <button
                  onClick={() => setPreview(fullUrl(p.refund_proof_url))}
                  className="w-24 h-24 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex-shrink-0 hover:ring-2 hover:ring-blue-300"
                >
                  {p.refund_proof_url
                    ? <img src={fullUrl(p.refund_proof_url) || ''} alt="proof" className="w-full h-full object-cover" />
                    : <ImageIcon className="w-6 h-6 text-slate-300 mx-auto mt-7" />
                  }
                </button>
                <div className="flex-1 min-w-0 text-sm">
                  <p className="font-semibold text-slate-800">{p.consumer_name} · {p.container_type}</p>
                  <p className="text-xs text-slate-500">Driver: {p.driver_name || 'unknown'} {p.driver_phone && `· ${p.driver_phone}`}</p>
                  <p className="text-xs text-slate-500">Deposit: <strong className="text-slate-800">₹{Number(p.deposit_amount).toFixed(2)}</strong></p>
                  <p className="text-xs text-slate-400 mt-1">Uploaded {formatIstDate(p.resolved_at)}</p>
                  {p.notes && <p className="text-xs text-slate-600 italic mt-1">"{p.notes}"</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => verify(p.id, true)} disabled={busyId === p.id}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => verify(p.id, false)} disabled={busyId === p.id}
                    className="px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-sm font-semibold rounded-lg disabled:opacity-50">
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Drivers awaiting reimbursement */}
      {pendingR.length > 0 && (
        <Section
          icon={IndianRupee} accent="amber"
          title={`Drivers awaiting reimbursement (${pendingR.length})`}
          right={<span className="text-sm font-bold text-amber-900">You owe drivers: ₹{Number(totalOwed).toFixed(2)}</span>}
        >
          <div className="divide-y divide-slate-100">
            {pendingR.map(p => (
              <div key={p.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0 text-sm">
                  <p className="font-semibold text-slate-800">{p.driver_name || 'unknown driver'}</p>
                  <p className="text-xs text-slate-500">Paid {p.consumer_name} ₹{Number(p.deposit_amount).toFixed(2)} via UPI — verified by {p.verified_by_name} on {formatIstDate(p.admin_verified_at)}</p>
                  {p.driver_phone && <p className="text-xs text-slate-500">Driver: {p.driver_phone}</p>}
                </div>
                <button onClick={() => reimburse(p.id, p.deposit_amount)} disabled={busyId === p.id}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex-shrink-0">
                  Mark reimbursed
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Manual refunds awaiting reference */}
      {manualRefunds.length > 0 && (
        <Section icon={Banknote} accent="emerald" title={`Manual refunds awaiting reference (${manualRefunds.length})`}>
          <ul className="divide-y divide-slate-100">
            {manualRefunds.map(r => (
              <li key={r.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-semibold text-slate-900">{r.consumer_name}</p>
                    <span className="text-[10px] uppercase font-semibold tracking-wide px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">
                      Awaiting reference
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                    {r.consumer_phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{r.consumer_phone}</span>}
                    {r.consumer_address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{r.consumer_address}</span>}
                    {r.resolved_at && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />refunded {formatIstDate(r.resolved_at)}</span>}
                  </div>
                  <div className="mt-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-800">{r.container_type}</span> · deposit ₹{Number(r.deposit_amount).toFixed(0)}
                    {r.linked_dealer_name && <span> · picked up by {r.linked_dealer_name}</span>}
                  </div>
                  {r.notes && <p className="mt-2 text-xs text-slate-500 italic">"{r.notes}"</p>}
                </div>
                <button onClick={() => setSettleTarget(r)}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold flex-shrink-0">
                  Settle ₹{Number(r.deposit_amount).toFixed(0)}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Held deposits */}
      {heldDeposits.length > 0 && (
        <Section icon={Package} accent="amber" title={`Active (held) deposits (${heldDeposits.length})`}
          right={<details className="text-xs text-amber-800"><summary className="cursor-pointer">How to act</summary>
            <div className="mt-2 max-w-md font-normal text-slate-700">
              <p><strong className="text-emerald-700">Customer quit and returned undamaged →</strong> Refund.</p>
              <p className="mt-1"><strong className="text-red-700">Container broken / lost →</strong> Forfeit (issues GST invoice).</p>
              <p className="mt-1 text-slate-500">Repeat customers should never be touched — they keep the container.</p>
            </div>
          </details>}
        >
          <div className="divide-y divide-slate-100">
            {heldDeposits.map(d => (
              <DepositRow key={d.id} d={d}
                onRefund={() => setRefundTarget(d)}
                onForfeit={() => setForfeitTarget(d)} />
            ))}
          </div>
        </Section>
      )}

      {/* Modals */}
      {refundTarget && (
        <RefundDepositModal
          target={refundTarget}
          onClose={() => setRefundTarget(null)}
          onDone={() => { setRefundTarget(null); load(); }}
        />
      )}
      {forfeitTarget && (
        <ForfeitDepositModal
          target={forfeitTarget}
          defaultRate={defaultRate}
          onClose={() => setForfeitTarget(null)}
          onDone={() => { setForfeitTarget(null); load(); }}
        />
      )}
      {settleTarget && (
        <SettleManualRefundModal
          target={settleTarget}
          onClose={() => setSettleTarget(null)}
          onDone={() => { setSettleTarget(null); load(); }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * History tab — searchable container_finance_log.
 * ───────────────────────────────────────────────────────────────────── */

interface FinanceEvent {
  id: number;
  holding_id: number | null;
  consumer_id: number | null;
  driver_user_id: number | null;
  event_type: string;
  amount: number;
  direction: 'income' | 'expense' | 'neutral';
  actor_user_id: number | null;
  reference: string | null;
  created_at: string;
  consumer_name: string | null;
  consumer_phone: string | null;
  driver_name: string | null;
  actor_name: string | null;
  container_type: string | null;
  holding_status: string | null;
  refund_proof_url: string | null;
  damage_photo_url: string | null;
  manual_refund_utr: string | null;
  manual_refund_paid_at: string | null;
  manual_refund_method: string | null;
  resolved_at: string | null;
}

interface FinanceTotals {
  driver_paid_total: number;
  verified_total: number;
  forfeited_total: number;
  store_credit_total: number;
  total_events: number;
}

const EVENT_TYPES: { value: string; label: string }[] = [
  { value: 'container_held',           label: 'Held'                  },
  { value: 'container_refunded',       label: 'Refunded'              },
  { value: 'container_forfeited',      label: 'Forfeited'             },
  { value: 'admin_verified_upi_proof', label: 'UPI proof verified'    },
  { value: 'driver_reimbursed',        label: 'Driver reimbursed'     },
  { value: 'manual_refund_settled',    label: 'Manual refund settled' },
  { value: 'store_credit_issued',      label: 'Store credit issued'   },
  { value: 'damage_disputed',          label: 'Damage disputed'       },
  { value: 'damage_dispute_resolved',  label: 'Dispute resolved'      },
];

function HistoryTab({ setPreview }: { setPreview: (u: string | null) => void }) {
  const [events, setEvents]   = useState<FinanceEvent[]>([]);
  const [totals, setTotals]   = useState<FinanceTotals | null>(null);
  const [total, setTotal]     = useState(0);
  const [q, setQ]             = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [offset, setOffset]   = useState(0);
  const [limit]               = useState(100);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState<number | null>(null);

  const apiBase = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');
  const fullUrl = (u: string | null) => u ? (u.startsWith('http') ? u : `${apiBase}${u}`) : null;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit, offset };
      if (debouncedQ.trim()) params.q = debouncedQ.trim();
      if (eventTypes.length) params.event_type = eventTypes.join(',');
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = dateTo;
      const r = await api.get('/admin/container-finance/log', { params });
      setEvents(r.data.events || []);
      setTotals(r.data.totals || null);
      setTotal(r.data.pagination?.total || 0);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to load history');
    } finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [debouncedQ, eventTypes.join(','), dateFrom, dateTo, offset]);

  const toggleType = (v: string) =>
    setEventTypes(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  const purgeProof = async (holdingId: number | null, kind: 'refund' | 'damage') => {
    if (!holdingId) return;
    if (!window.confirm(`Permanently remove this ${kind === 'refund' ? 'refund' : 'damage'} proof image? The audit row will stay; only the image is deleted.`)) return;
    setPurging(holdingId * 10 + (kind === 'refund' ? 1 : 2));
    try {
      await api.delete(`/admin/container-finance/holdings/${holdingId}/proof`, { params: { kind } });
      toast.success('Proof image removed');
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed');
    } finally { setPurging(null); }
  };

  return (
    <div className="space-y-4">
      {/* totals strip */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Totalette label="Driver reimbursements (lifetime)" value={totals.driver_paid_total}  tone="expense" />
          <Totalette label="UPI proofs verified"              value={totals.verified_total}    tone="neutral" />
          <Totalette label="Container forfeits retained"       value={totals.forfeited_total}   tone="income"  />
          <Totalette label="Store credit issued"               value={totals.store_credit_total} tone="expense" />
        </div>
      )}

      {/* search + filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={e => { setOffset(0); setQ(e.target.value); }}
              placeholder="Search consumer / trader / UTR / event…"
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <Calendar className="w-3.5 h-3.5" />
            <input type="date" value={dateFrom} onChange={e => { setOffset(0); setDateFrom(e.target.value); }}
              className="border border-slate-200 rounded px-2 py-1 text-xs" />
            <span className="text-slate-400">→</span>
            <input type="date" value={dateTo} onChange={e => { setOffset(0); setDateTo(e.target.value); }}
              className="border border-slate-200 rounded px-2 py-1 text-xs" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-slate-400 hover:text-slate-700"><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          {EVENT_TYPES.map(t => (
            <button key={t.value}
              onClick={() => { setOffset(0); toggleType(t.value); }}
              className={`text-xs px-2 py-1 rounded-full border transition ${
                eventTypes.includes(t.value)
                  ? 'bg-amber-100 border-amber-300 text-amber-800 font-semibold'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >{t.label}</button>
          ))}
          {eventTypes.length > 0 && (
            <button onClick={() => setEventTypes([])} className="text-xs text-slate-500 hover:text-slate-800 ml-1 underline">Clear</button>
          )}
        </div>
      </div>

      {/* events list */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading events…</div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-base font-semibold text-slate-800">No events match</p>
          <p className="text-sm text-slate-500 mt-1">Try clearing filters or searching for a different term.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
          {events.map(e => (
            <EventRow key={e.id} e={e}
              fullUrl={fullUrl}
              onPreview={setPreview}
              onPurge={purgeProof}
              purging={purging} />
          ))}
        </div>
      )}

      {/* paginator */}
      {total > limit && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}
              className="px-3 py-1.5 rounded border border-slate-200 disabled:opacity-50">Prev</button>
            <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}
              className="px-3 py-1.5 rounded border border-slate-200 disabled:opacity-50">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Disputes tab — open + resolved damage disputes.
 * ───────────────────────────────────────────────────────────────────── */

interface Dispute {
  id: number;
  consumer_id: number;
  consumer_name: string;
  consumer_phone: string | null;
  deposit_amount: number;
  damage_photo_url: string | null;
  damage_dispute_status: 'none' | 'open' | 'upheld' | 'rejected';
  dispute_deadline: string | null;
  dispute_opened_at: string | null;
  notes: string | null;
}

function DisputesTab({ setPreview }: { setPreview: (u: string | null) => void }) {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');

  const apiBase = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');
  const fullUrl = (u: string | null) => u ? (u.startsWith('http') ? u : `${apiBase}${u}`) : null;

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/damage-disputes');
      setDisputes(r.data.disputes || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const resolveDispute = async (id: number, resolution: 'upheld' | 'rejected') => {
    const notes = prompt(resolution === 'upheld'
      ? 'Notes — siding with the consumer (deposit will be returned manually):'
      : 'Notes — siding with the driver (forfeit stands):');
    if (notes === null) return;
    setBusyId(id);
    try {
      await api.post(`/admin/damage-disputes/${id}/resolve`, { resolution, notes });
      toast.success('Dispute resolved');
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed');
    } finally { setBusyId(null); }
  };

  const filtered = disputes.filter(d => {
    if (filter === 'all') return true;
    if (filter === 'open') return d.damage_dispute_status === 'open';
    return d.damage_dispute_status === 'upheld' || d.damage_dispute_status === 'rejected';
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(['open', 'resolved', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-sm px-3 py-1.5 rounded-full border ${
              filter === f ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
            }`}>
            {f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'All'}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1.5">
          <RefreshCcw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-base font-semibold text-slate-800">No disputes</p>
          <p className="text-sm text-slate-500 mt-1">No damage disputes in this view.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {filtered.map(d => (
            <div key={d.id} className="p-4 flex flex-col md:flex-row gap-4">
              <button
                onClick={() => setPreview(fullUrl(d.damage_photo_url))}
                className="w-24 h-24 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex-shrink-0 hover:ring-2 hover:ring-red-300"
              >
                {d.damage_photo_url
                  ? <img src={fullUrl(d.damage_photo_url) || ''} alt="damage" className="w-full h-full object-cover" />
                  : <ImageIcon className="w-6 h-6 text-slate-300 mx-auto mt-7" />}
              </button>
              <div className="flex-1 min-w-0 text-sm">
                <p className="font-semibold text-slate-800">{d.consumer_name} disputes forfeit · ₹{Number(d.deposit_amount).toFixed(2)}</p>
                {d.consumer_phone && <p className="text-xs text-slate-500">{d.consumer_phone}</p>}
                <p className="text-xs text-slate-400">Opened {d.dispute_opened_at ? formatIstDate(d.dispute_opened_at) : '—'} · Deadline {d.dispute_deadline ? formatIstDate(d.dispute_deadline) : '—'}</p>
                <p className="mt-1">
                  <DisputeStatusBadge status={d.damage_dispute_status} />
                </p>
                {d.notes && <p className="text-xs text-slate-600 italic mt-1 whitespace-pre-wrap">{d.notes}</p>}
              </div>
              {d.damage_dispute_status === 'open' && (
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => resolveDispute(d.id, 'upheld')} disabled={busyId === d.id}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                    Side with consumer
                  </button>
                  <button onClick={() => resolveDispute(d.id, 'rejected')} disabled={busyId === d.id}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                    Uphold forfeit
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Building blocks ─────────────────────────────────────────────────── */

function TabBtn({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: any; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2.5 -mb-px border-b-2 font-semibold text-sm flex items-center gap-2 whitespace-nowrap
        ${active ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

function Section({
  icon: Icon, title, accent, right, children,
}: {
  icon: any; title: string; accent: 'amber' | 'blue' | 'emerald' | 'red';
  right?: React.ReactNode; children: React.ReactNode;
}) {
  const palette = {
    amber:   { wrap: 'border-amber-200',   bar: 'bg-amber-50 border-amber-200',     text: 'text-amber-900',   ic: 'text-amber-700'   },
    blue:    { wrap: 'border-blue-200',    bar: 'bg-blue-50 border-blue-200',       text: 'text-blue-900',    ic: 'text-blue-700'    },
    emerald: { wrap: 'border-emerald-200', bar: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-900', ic: 'text-emerald-700' },
    red:     { wrap: 'border-red-200',     bar: 'bg-red-50 border-red-200',         text: 'text-red-900',     ic: 'text-red-700'     },
  }[accent];
  return (
    <div className={`bg-white border ${palette.wrap} rounded-2xl overflow-hidden`}>
      <div className={`px-4 py-3 ${palette.bar} border-b flex items-center justify-between gap-2`}>
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 ${palette.ic}`} />
          <h2 className={`font-bold ${palette.text}`}>{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Totalette({ label, value, tone }: { label: string; value: number; tone: 'income' | 'expense' | 'neutral' }) {
  const t = tone === 'income' ? 'text-emerald-700' : tone === 'expense' ? 'text-red-700' : 'text-slate-800';
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={`text-lg font-extrabold mt-0.5 ${t}`}>₹{Number(value || 0).toFixed(2)}</p>
    </div>
  );
}

function DepositRow({ d, onRefund, onForfeit }: {
  d: Deposit; onRefund: () => void; onForfeit: () => void;
}) {
  const apiBase = (import.meta as any).env?.VITE_API_URL || '';
  const invoiceUrl = (n: string) => `${apiBase}/api/invoice/${n}`;
  return (
    <div className="p-4 flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3 mb-1">
          <h3 className="text-base font-bold text-slate-900 truncate">{d.customer_name}</h3>
          <span className="text-xs text-slate-500">Order #{d.order_number}</span>
        </div>
        <div className="space-y-0.5 text-xs text-slate-600">
          {d.customer_phone && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> {d.customer_phone}</div>}
          {d.customer_address && <div className="flex items-start gap-1.5"><MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" /> <span className="line-clamp-2">{d.customer_address}</span></div>}
          <div className="flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            <a href={invoiceUrl(d.invoice_number)} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline font-medium">{d.invoice_number}</a>
            <a href={invoiceUrl(d.invoice_number)} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700" title="Open invoice"><Download className="w-3 h-3" /></a>
          </div>
        </div>
      </div>
      <div className="lg:w-32 flex lg:flex-col items-center lg:items-end justify-between lg:justify-center gap-1 lg:border-l lg:pl-4 border-slate-100">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Deposit</span>
        <span className="text-xl font-extrabold text-amber-700">₹{Number(d.container_deposit).toFixed(2)}</span>
      </div>
      <div className="flex flex-col gap-2 lg:w-60">
        <button onClick={onRefund}
          className="w-full px-3 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 flex items-center justify-center gap-2 text-xs">
          <CheckCircle2 className="w-4 h-4" /> Customer quit — Refund
        </button>
        <button onClick={onForfeit}
          className="w-full px-3 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 flex items-center justify-center gap-2 text-xs">
          <AlertTriangle className="w-4 h-4" /> Broken / lost — Forfeit
        </button>
      </div>
    </div>
  );
}

function EventRow({
  e, fullUrl, onPreview, onPurge, purging,
}: {
  e: FinanceEvent;
  fullUrl: (u: string | null) => string | null;
  onPreview: (u: string | null) => void;
  onPurge: (holdingId: number | null, kind: 'refund' | 'damage') => void;
  purging: number | null;
}) {
  const meta = EVENT_META[e.event_type] || { label: e.event_type, tone: 'neutral' as const };
  const tone =
    e.direction === 'income' ? 'text-emerald-700' :
    e.direction === 'expense' ? 'text-red-700' : 'text-slate-700';
  const sign = e.direction === 'income' ? '+' : e.direction === 'expense' ? '−' : '';
  return (
    <div className="p-3 md:p-4 grid grid-cols-1 md:grid-cols-[auto,1fr,auto] gap-3 items-start">
      <div className="flex items-start gap-3 min-w-0">
        {/* Proof thumbnails */}
        <div className="flex flex-col gap-1">
          {e.refund_proof_url && (
            <button title="Refund UPI proof"
              onClick={() => onPreview(fullUrl(e.refund_proof_url))}
              className="relative w-14 h-14 rounded-md border border-slate-200 overflow-hidden bg-slate-50 hover:ring-2 hover:ring-amber-300">
              <img src={fullUrl(e.refund_proof_url) || ''} alt="refund proof" className="w-full h-full object-cover" />
              <button onClick={(ev) => { ev.stopPropagation(); onPurge(e.holding_id, 'refund'); }}
                disabled={purging === (e.holding_id || 0) * 10 + 1}
                title="Remove image"
                className="absolute -top-1 -right-1 bg-white border border-slate-200 rounded-full p-0.5 shadow-sm text-slate-500 hover:text-red-600">
                <Trash2 className="w-3 h-3" />
              </button>
            </button>
          )}
          {e.damage_photo_url && (
            <button title="Damage photo"
              onClick={() => onPreview(fullUrl(e.damage_photo_url))}
              className="relative w-14 h-14 rounded-md border border-slate-200 overflow-hidden bg-slate-50 hover:ring-2 hover:ring-red-300">
              <img src={fullUrl(e.damage_photo_url) || ''} alt="damage" className="w-full h-full object-cover" />
              <button onClick={(ev) => { ev.stopPropagation(); onPurge(e.holding_id, 'damage'); }}
                disabled={purging === (e.holding_id || 0) * 10 + 2}
                title="Remove image"
                className="absolute -top-1 -right-1 bg-white border border-slate-200 rounded-full p-0.5 shadow-sm text-slate-500 hover:text-red-600">
                <Trash2 className="w-3 h-3" />
              </button>
            </button>
          )}
          {!e.refund_proof_url && !e.damage_photo_url && (
            <div className="w-14 h-14 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center">
              <Info className="w-4 h-4 text-slate-300" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">
            {e.consumer_name || (e.holding_id ? `Holding #${e.holding_id}` : `Event #${e.id}`)}
            {e.container_type && <span className="text-slate-500 font-normal"> · {e.container_type}</span>}
          </p>
          <p className="text-xs mt-0.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.chip}`}>{meta.label}</span>
            {e.reference && <span className="ml-2 text-slate-500">ref {e.reference}</span>}
            {e.manual_refund_method && <span className="ml-2 text-slate-500">({e.manual_refund_method})</span>}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {formatIstDate(e.created_at)}
            {e.driver_name && <> · driver {e.driver_name}</>}
            {e.actor_name && <> · by {e.actor_name}</>}
            {e.consumer_phone && <> · {e.consumer_phone}</>}
          </p>
        </div>
      </div>
      <div /> {/* spacer */}
      <div className={`text-right text-base font-extrabold ${tone} whitespace-nowrap`}>
        {Number(e.amount) ? `${sign}₹${Number(e.amount).toFixed(2)}` : '—'}
      </div>
    </div>
  );
}

const EVENT_META: Record<string, { label: string; chip: string; tone: 'income' | 'expense' | 'neutral' }> = {
  container_held:            { label: 'Held',                 chip: 'bg-amber-100 text-amber-800',   tone: 'neutral' },
  container_refunded:        { label: 'Refunded',             chip: 'bg-emerald-100 text-emerald-800', tone: 'expense' },
  container_forfeited:       { label: 'Forfeited (income)',   chip: 'bg-red-100 text-red-800',       tone: 'income'  },
  admin_verified_upi_proof:  { label: 'UPI proof verified',   chip: 'bg-blue-100 text-blue-800',     tone: 'neutral' },
  driver_reimbursed:         { label: 'Driver reimbursed',    chip: 'bg-amber-100 text-amber-800',   tone: 'expense' },
  manual_refund_settled:     { label: 'Manual refund settled', chip: 'bg-emerald-100 text-emerald-800', tone: 'expense' },
  store_credit_issued:       { label: 'Store credit issued',  chip: 'bg-violet-100 text-violet-800', tone: 'expense' },
  damage_disputed:           { label: 'Damage disputed',      chip: 'bg-red-100 text-red-800',       tone: 'neutral' },
  damage_dispute_resolved:   { label: 'Dispute resolved',     chip: 'bg-slate-200 text-slate-800',   tone: 'neutral' },
};

function DisputeStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; chip: string }> = {
    open:     { label: 'Open',         chip: 'bg-red-100 text-red-800'         },
    upheld:   { label: 'Sided consumer', chip: 'bg-emerald-100 text-emerald-800' },
    rejected: { label: 'Forfeit upheld', chip: 'bg-slate-200 text-slate-800'     },
    none:     { label: '—',            chip: 'bg-slate-100 text-slate-500'      },
  };
  const m = map[status] || map.none;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.chip}`}>{m.label}</span>;
}

/* ── Modals ───────────────────────────────────────────────────────────── */

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative">
        <button onClick={onClose} className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 p-1">
          <X className="w-5 h-5" />
        </button>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium">{value}</span>
    </div>
  );
}

function RefundDepositModal({ target, onClose, onDone }: {
  target: Deposit; onClose: () => void; onDone: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy]   = useState(false);
  const inr = (n: number) => `₹${Number(n).toFixed(2)}`;
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/container-deposits/${target.id}/refund`, { notes });
      toast.success('Deposit refunded');
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed');
    } finally { setBusy(false); }
  };
  return (
    <Modal onClose={() => !busy && onClose()}>
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center"><CheckCircle2 className="w-7 h-7 text-emerald-600" /></div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Refund container deposit</h2>
            <p className="text-sm text-slate-500">Customer returned the container undamaged.</p>
          </div>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-1.5 text-sm">
          <Row label="Customer" value={target.customer_name} />
          <Row label="Order"    value={target.order_number} />
          <Row label="Invoice"  value={target.invoice_number} />
          <Row label="Deposit"  value={<span className="text-emerald-700 font-bold">{inr(target.container_deposit)}</span>} />
        </div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="e.g. Container returned with delivery on 25 May"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-5" />
        <div className="flex gap-3">
          <button onClick={onClose} disabled={busy} className="flex-1 px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-60">
            {busy ? 'Saving…' : 'Yes, refund deposit'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ForfeitDepositModal({ target, defaultRate, onClose, onDone }: {
  target: Deposit; defaultRate: number; onClose: () => void; onDone: () => void;
}) {
  const [notes, setNotes]     = useState('');
  const [taxRate, setTaxRate] = useState(defaultRate);
  const [busy, setBusy]       = useState(false);
  const inr = (n: number) => `₹${Number(n).toFixed(2)}`;
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/container-deposits/${target.id}/forfeit`, { notes, tax_rate: taxRate });
      toast.success('Deposit forfeited, GST invoice issued');
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed');
    } finally { setBusy(false); }
  };
  return (
    <Modal onClose={() => !busy && onClose()}>
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center"><AlertTriangle className="w-7 h-7 text-red-600" /></div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Forfeit container deposit</h2>
            <p className="text-sm text-slate-500">For broken or not-returned containers only.</p>
          </div>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-1.5 text-sm">
          <Row label="Customer" value={target.customer_name} />
          <Row label="Order"    value={target.order_number} />
          <Row label="Invoice"  value={target.invoice_number} />
          <Row label="Deposit"  value={<span className="text-red-700 font-bold">{inr(target.container_deposit)}</span>} />
        </div>
        <label className="block text-sm font-medium text-slate-700 mb-1">GST rate to apply</label>
        <div className="flex gap-2 mb-4">
          {[5, 12, 18].map(r => (
            <button key={r} type="button" onClick={() => setTaxRate(r)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 font-bold transition
                ${taxRate === r ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
              {r}%
            </button>
          ))}
        </div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Reason / notes (optional)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="e.g. Container damaged on return"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-5" />
        <div className="flex gap-3">
          <button onClick={onClose} disabled={busy} className="flex-1 px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-60">
            {busy ? 'Generating…' : 'Yes, forfeit & issue GST invoice'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SettleManualRefundModal({ target, onClose, onDone }: {
  target: PendingManualRefund; onClose: () => void; onDone: () => void;
}) {
  const [method, setMethod] = useState<'bank' | 'upi'>('bank');
  const [utr, setUtr]       = useState('');
  const [notes, setNotes]   = useState('');
  const [busy, setBusy]     = useState(false);

  const refLabel = method === 'upi' ? 'UPI transaction id' : 'Bank UTR / reference';
  const refPlaceholder = method === 'upi' ? 'e.g. 401234567890 or txn id from your UPI app' : 'e.g. UTR123456789';

  const submit = async () => {
    if (utr.trim().length < 4) { toast.error('Reference must be at least 4 characters'); return; }
    setBusy(true);
    try {
      await api.post(`/admin/manual-refunds/${target.id}/settle`, {
        utr: utr.trim(),
        method,
        notes: notes.trim() || undefined,
      });
      toast.success('Refund settled');
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to settle refund');
    } finally { setBusy(false); }
  };

  return (
    <Modal onClose={() => !busy && onClose()}>
      <div className="p-5">
        <h3 className="text-base font-bold text-slate-900 mb-3">Settle manual refund</h3>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 mb-4">
          <p className="font-medium">{target.consumer_name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{target.container_type} · ₹{Number(target.deposit_amount).toFixed(0)}</p>
        </div>

        <label className="block text-xs font-semibold text-slate-700 mb-1">Channel</label>
        <div className="flex gap-2 mb-3">
          {(['bank', 'upi'] as const).map(m => (
            <button key={m} onClick={() => setMethod(m)}
              className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-semibold transition ${
                method === m ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}>
              {m === 'bank' ? 'Bank transfer (UTR)' : 'UPI'}
            </button>
          ))}
        </div>

        <label className="block text-xs font-semibold text-slate-700 mb-1">{refLabel}</label>
        <input value={utr} onChange={e => setUtr(e.target.value)} placeholder={refPlaceholder}
          className="w-full rounded-lg border border-slate-200 text-sm p-2 mb-3 focus:outline-none focus:ring-2 focus:ring-emerald-200" />

        <label className="block text-xs font-semibold text-slate-700 mb-1">Notes (optional)</label>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Internal note for the audit trail"
          className="w-full rounded-lg border border-slate-200 text-sm p-2 mb-4 focus:outline-none focus:ring-2 focus:ring-emerald-200" />

        <p className="text-[11px] text-slate-500 mb-4">
          Pay first, then enter the reference here. This action is irreversible.
        </p>

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={busy || utr.trim().length < 4}
            className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Saving…' : 'Confirm settlement'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
