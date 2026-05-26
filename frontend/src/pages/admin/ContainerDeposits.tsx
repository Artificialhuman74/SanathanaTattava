import React, { useEffect, useState } from 'react';
import api from '../../api/axios';
import {
  Package, CheckCircle2, AlertTriangle, Info, FileText,
  Phone, MapPin, Calendar, RefreshCcw, X, Download,
  ShieldCheck, IndianRupee, Image as ImageIcon, Loader2, ShieldAlert,
} from 'lucide-react';
import { formatIstDate } from '../../utils/dateTime';

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

type Tab = 'held' | 'refunded' | 'forfeited';

export default function ContainerDeposits() {
  const [rows, setRows]               = useState<Deposit[]>([]);
  const [loading, setLoading]         = useState(true);
  const [defaultRate, setDefaultRate] = useState(18);
  const [tab, setTab]                 = useState<Tab>('held');
  const [refundTarget,  setRefundTarget]  = useState<Deposit | null>(null);
  const [forfeitTarget, setForfeitTarget] = useState<Deposit | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes]   = useState('');
  const [taxRate, setTaxRate] = useState(18);

  const load = () => {
    setLoading(true);
    api.get('/admin/container-deposits')
      .then(r => {
        setRows(r.data.deposits || []);
        setDefaultRate(r.data.defaultForfeitTaxRate || 18);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = rows.filter(r => r.container_deposit_status === tab);
  const counts = {
    held:      rows.filter(r => r.container_deposit_status === 'held').length,
    refunded:  rows.filter(r => r.container_deposit_status === 'refunded').length,
    forfeited: rows.filter(r => r.container_deposit_status === 'forfeited').length,
  };

  const openRefund = (d: Deposit) => { setRefundTarget(d); setNotes(''); };
  const openForfeit = (d: Deposit) => { setForfeitTarget(d); setNotes(''); setTaxRate(defaultRate); };

  const doRefund = async () => {
    if (!refundTarget) return;
    setBusy(true);
    try {
      await api.post(`/admin/container-deposits/${refundTarget.id}/refund`, { notes });
      setRefundTarget(null);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to refund deposit');
    } finally { setBusy(false); }
  };

  const doForfeit = async () => {
    if (!forfeitTarget) return;
    setBusy(true);
    try {
      await api.post(`/admin/container-deposits/${forfeitTarget.id}/forfeit`, { notes, tax_rate: taxRate });
      setForfeitTarget(null);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to forfeit deposit');
    } finally { setBusy(false); }
  };

  const inr = (n: number) =>
    `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Package className="w-7 h-7 text-amber-600" />
          Container Deposits
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Track refundable container deposits and decide what to do when the container comes back.
        </p>
      </div>

      {/* Big plain-English explainer */}
      <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <Info className="w-6 h-6 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="text-[15px] leading-relaxed text-amber-900">
            <p className="font-bold mb-2">How container deposits work</p>
            <p className="mb-2">
              When a customer orders an oil for the <strong>first time</strong>, they pay a one-time
              <strong> refundable deposit</strong> for the container. The customer <strong>keeps that container</strong>
              and we re-fill it on every future order — no new deposit is charged on later orders.
            </p>
            <p className="mb-2 font-semibold text-amber-900">
              ⚠️ Do nothing on this page during normal business.
            </p>
            <p className="mb-2">
              These "Held" deposits are <strong>liabilities</strong> we owe back to customers — they should
              stay "Held" for as long as the customer is still buying from us. Only take action when:
            </p>
            <ul className="list-disc pl-6 space-y-1 mb-2">
              <li>
                <strong className="text-emerald-700">The customer says "I don't want to buy any more"</strong> and returns the container undamaged →
                click the GREEN button to refund the deposit.
              </li>
              <li>
                <strong className="text-red-700">The container is broken, lost, or the customer refuses to return it</strong> →
                click the RED button. A supplementary GST invoice is created automatically (required by Indian GST law).
              </li>
            </ul>
            <p className="text-sm text-amber-800">
              <strong>Repeat customers</strong> never appear in the green/red flow — they keep the container indefinitely.
            </p>
          </div>
        </div>
      </div>

      {/* Liability summary */}
      {counts.held > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
            <Package className="w-6 h-6 text-amber-700" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Total deposits currently held (liability)</p>
            <p className="text-2xl font-extrabold text-slate-900">
              {inr(rows.filter(r => r.container_deposit_status === 'held').reduce((s, r) => s + r.container_deposit, 0))}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">across {counts.held} {counts.held === 1 ? 'customer-container' : 'customer-containers'}</p>
          </div>
        </div>
      )}

      {/* Phase 9 — UPI refund verification + driver reimbursement queues */}
      <Phase9Queues onRefresh={load} />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        <TabBtn active={tab === 'held'}      onClick={() => setTab('held')}
                color="amber" count={counts.held}      label="Active (Held)" />
        <TabBtn active={tab === 'refunded'}  onClick={() => setTab('refunded')}
                color="emerald" count={counts.refunded}  label="Refunded" />
        <TabBtn active={tab === 'forfeited'} onClick={() => setTab('forfeited')}
                color="red" count={counts.forfeited} label="Forfeited (GST charged)" />
        <button onClick={load}
          className="ml-auto px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1.5">
          <RefreshCcw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <CheckCircle2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">
            {tab === 'held'      && 'No customers currently hold a container deposit.'}
            {tab === 'refunded'  && 'No refunded deposits yet.'}
            {tab === 'forfeited' && 'No forfeited deposits yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(d => (
            <DepositCard key={d.id} d={d} inr={inr}
              onRefund={() => openRefund(d)} onForfeit={() => openForfeit(d)} />
          ))}
        </div>
      )}

      {/* ───── Refund confirm modal ───── */}
      {refundTarget && (
        <Modal onClose={() => !busy && setRefundTarget(null)}>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Refund Container Deposit</h2>
                <p className="text-sm text-slate-500">Customer is leaving and has returned the container undamaged.</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-1.5 text-sm">
              <Row label="Customer"     value={refundTarget.customer_name} />
              <Row label="Phone"        value={refundTarget.customer_phone || '—'} />
              <Row label="Order"        value={refundTarget.order_number} />
              <Row label="Invoice"      value={refundTarget.invoice_number} />
              <Row label="Deposit amount" value={<span className="text-emerald-700 font-bold">{inr(refundTarget.container_deposit)}</span>} />
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 text-sm text-emerald-900">
              <p className="font-semibold mb-1.5">What happens when you click "Yes, Refund":</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>This deposit will be marked as <strong>refunded</strong> on our records.</li>
                <li>You will need to <strong>actually pay back {inr(refundTarget.container_deposit)}</strong> to the customer separately (UPI / cash).</li>
                <li>No GST is charged — refundable deposits are not taxable.</li>
              </ul>
            </div>

            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="e.g. Container returned with delivery on 25 May"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-5" />

            <div className="flex gap-3">
              <button onClick={() => setRefundTarget(null)} disabled={busy}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={doRefund} disabled={busy}
                className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-60">
                {busy ? 'Saving…' : 'Yes, Refund Deposit'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ───── Forfeit confirm modal ───── */}
      {forfeitTarget && (
        <Modal onClose={() => !busy && setForfeitTarget(null)}>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-7 h-7 text-red-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Forfeit Container Deposit</h2>
                <p className="text-sm text-slate-500">For broken or not-returned containers only.</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-1.5 text-sm">
              <Row label="Customer"     value={forfeitTarget.customer_name} />
              <Row label="Phone"        value={forfeitTarget.customer_phone || '—'} />
              <Row label="Order"        value={forfeitTarget.order_number} />
              <Row label="Invoice"      value={forfeitTarget.invoice_number} />
              <Row label="Deposit amount" value={<span className="text-red-700 font-bold">{inr(forfeitTarget.container_deposit)}</span>} />
            </div>

            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 mb-4 text-sm text-red-900">
              <p className="font-bold mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> What happens when you click "Yes, Forfeit":
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>The deposit ({inr(forfeitTarget.container_deposit)}) becomes a <strong>taxable supply</strong> from today's date.</li>
                <li>A new <strong>supplementary GST invoice</strong> will be created automatically.</li>
                <li>The customer will be <strong>emailed</strong> the supplementary invoice as a PDF.</li>
                <li><strong>You keep the deposit</strong> — no money goes back to the customer.</li>
                <li>You must show this in your <strong>next GSTR-1 return</strong> — this is the law.</li>
              </ul>
            </div>

            <label className="block text-sm font-medium text-slate-700 mb-1">
              GST rate to apply
              <span className="text-slate-500 font-normal"> (default 18% — plastic containers, HSN 3923)</span>
            </label>
            <div className="flex gap-2 mb-4">
              {[5, 12, 18].map(r => (
                <button key={r} type="button" onClick={() => setTaxRate(r)}
                  className={`flex-1 px-4 py-2.5 rounded-lg border-2 font-bold transition
                    ${taxRate === r
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  {r}%
                </button>
              ))}
            </div>

            <label className="block text-sm font-medium text-slate-700 mb-1">Reason / notes (optional)</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="e.g. Container damaged on return; customer agreed to forfeit"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-5" />

            <div className="flex gap-3">
              <button onClick={() => setForfeitTarget(null)} disabled={busy}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={doForfeit} disabled={busy}
                className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-60">
                {busy ? 'Generating invoice…' : 'Yes, Forfeit & Issue GST Invoice'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function TabBtn({ active, onClick, color, count, label }: {
  active: boolean; onClick: () => void; color: 'amber' | 'emerald' | 'red';
  count: number; label: string;
}) {
  const colorMap = {
    amber:   { active: 'border-amber-600 text-amber-700',   chip: 'bg-amber-100 text-amber-800' },
    emerald: { active: 'border-emerald-600 text-emerald-700', chip: 'bg-emerald-100 text-emerald-800' },
    red:     { active: 'border-red-600 text-red-700',       chip: 'bg-red-100 text-red-800' },
  }[color];
  return (
    <button onClick={onClick}
      className={`px-4 py-2.5 -mb-px border-b-2 font-semibold text-sm flex items-center gap-2
        ${active ? colorMap.active : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {label}
      <span className={`inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full text-xs font-bold ${colorMap.chip}`}>
        {count}
      </span>
    </button>
  );
}

function DepositCard({ d, inr, onRefund, onForfeit }: {
  d: Deposit; inr: (n: number) => string;
  onRefund: () => void; onForfeit: () => void;
}) {
  const isHeld      = d.container_deposit_status === 'held';
  const isRefunded  = d.container_deposit_status === 'refunded';
  const isForfeited = d.container_deposit_status === 'forfeited';

  const apiBase = (import.meta as any).env?.VITE_API_URL || '';
  const invoiceUrl = (n: string) => `${apiBase}/api/invoice/${n}`;

  return (
    <div className={`bg-white rounded-2xl border-2 p-5 ${
      isHeld ? 'border-amber-300' : isRefunded ? 'border-emerald-200' : 'border-red-200'
    }`}>
      <div className="flex flex-col lg:flex-row gap-5">
        {/* Left: customer info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 mb-2">
            <h3 className="text-lg font-bold text-slate-900 truncate">{d.customer_name}</h3>
            <span className="text-sm text-slate-500">Order #{d.order_number}</span>
          </div>
          <div className="space-y-1 text-sm text-slate-600">
            {d.customer_phone && (
              <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {d.customer_phone}</div>
            )}
            {d.customer_address && (
              <div className="flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> <span className="line-clamp-2">{d.customer_address}</span></div>
            )}
            <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Invoice issued {formatIstDate(d.created_at)}</div>
            <div className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              <a href={invoiceUrl(d.invoice_number)} target="_blank" rel="noreferrer"
                className="text-brand-700 hover:underline font-medium">
                {d.invoice_number}
              </a>
              <a href={invoiceUrl(d.invoice_number)} target="_blank" rel="noreferrer"
                className="text-slate-400 hover:text-slate-700" title="Open invoice PDF">
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
            {isForfeited && d.supplementary_invoice_number && (
              <div className="flex items-center gap-1.5 mt-2 px-2 py-1 bg-red-50 rounded text-red-800 text-xs">
                <FileText className="w-3.5 h-3.5" />
                <span>Supplementary GST invoice:</span>
                <a href={invoiceUrl(d.supplementary_invoice_number)} target="_blank" rel="noreferrer"
                  className="font-semibold underline">
                  {d.supplementary_invoice_number}
                </a>
              </div>
            )}
            {(isRefunded || isForfeited) && d.container_deposit_resolved_at && (
              <div className="text-xs text-slate-500 mt-2">
                Resolved {formatIstDate(d.container_deposit_resolved_at)}
                {d.resolved_by_name ? ` by ${d.resolved_by_name}` : ''}
              </div>
            )}
            {d.container_deposit_notes && (
              <div className="text-xs italic text-slate-500 mt-1">"{d.container_deposit_notes}"</div>
            )}
          </div>
        </div>

        {/* Middle: deposit amount */}
        <div className="lg:w-40 flex lg:flex-col items-center lg:items-end justify-between lg:justify-center gap-1 lg:border-l lg:pl-5 border-slate-100">
          <span className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Deposit</span>
          <span className={`text-2xl font-extrabold ${
            isHeld ? 'text-amber-700' : isRefunded ? 'text-emerald-700' : 'text-red-700'
          }`}>{inr(d.container_deposit)}</span>
        </div>

        {/* Right: action buttons */}
        {isHeld && (
          <div className="flex flex-col gap-2 lg:w-72">
            <button onClick={onRefund}
              className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 flex items-center justify-center gap-2 text-sm shadow-sm">
              <CheckCircle2 className="w-5 h-5" />
              Customer Quit — Refund Deposit
            </button>
            <button onClick={onForfeit}
              className="w-full px-4 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 flex items-center justify-center gap-2 text-sm shadow-sm">
              <AlertTriangle className="w-5 h-5" />
              Container Broken / Lost
            </button>
          </div>
        )}
        {isRefunded && (
          <div className="lg:w-40 flex items-center justify-center">
            <div className="px-4 py-2 rounded-full bg-emerald-100 text-emerald-800 text-sm font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Refunded
            </div>
          </div>
        )}
        {isForfeited && (
          <div className="lg:w-40 flex items-center justify-center">
            <div className="px-4 py-2 rounded-full bg-red-100 text-red-800 text-sm font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Forfeited
            </div>
          </div>
        )}
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

/* ─────────────────────────────────────────────────────────────────────
 * Phase 9 — UPI refund verification + driver reimbursement queues
 *
 * Two stacked tables. (1) Pending verification: driver paid via their
 * own UPI and uploaded a screenshot. Admin clicks Approve/Reject after
 * eyeballing the screenshot. (2) Pending reimbursement: proofs that
 * passed verification. Admin transfers the deposit back to the driver
 * out-of-band and clicks Reimburse to stamp the audit trail.
 * (3) Damage disputes: 48h consumer protest window resolution.
 * ───────────────────────────────────────────────────────────────────── */
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
interface Dispute {
  id: number;
  consumer_id: number;
  consumer_name: string;
  consumer_phone: string | null;
  deposit_amount: number;
  damage_photo_url: string | null;
  damage_dispute_status: string;
  dispute_deadline: string | null;
  dispute_opened_at: string | null;
  notes: string | null;
}

function Phase9Queues({ onRefresh }: { onRefresh: () => void }) {
  const [pendingV, setPendingV] = useState<PendingVerification[]>([]);
  const [pendingR, setPendingR] = useState<PendingReimbursement[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [totalOwed, setTotalOwed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const apiBase = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');
  const fullUrl = (u: string | null) => u ? (u.startsWith('http') ? u : `${apiBase}${u}`) : null;

  const load = async () => {
    setLoading(true);
    try {
      const [v, r, d] = await Promise.all([
        api.get('/admin/container-deposits/pending-verification'),
        api.get('/admin/container-deposits/pending-reimbursement'),
        api.get('/admin/damage-disputes'),
      ]);
      setPendingV(v.data.pending || []);
      setPendingR(r.data.pending || []);
      setTotalOwed(r.data.totalOwedDriver || 0);
      setDisputes((d.data.disputes || []).filter((x: Dispute) => x.damage_dispute_status === 'open'));
    } catch {
      // non-fatal
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const verify = async (id: number, approved: boolean) => {
    const reason = approved ? null : prompt('Why are you rejecting this proof?');
    if (!approved && !reason) return;
    setBusyId(id);
    try {
      await api.post(`/admin/container-deposits/holdings/${id}/verify-proof`, {
        approved, notes: reason,
      });
      await load();
      onRefresh();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed');
    } finally { setBusyId(null); }
  };

  const reimburse = async (id: number, amount: number) => {
    const confirmed = window.confirm(`Confirm you have paid ₹${amount.toFixed(2)} to the driver?`);
    if (!confirmed) return;
    setBusyId(id);
    try {
      await api.post(`/admin/container-deposits/holdings/${id}/reimburse-driver`, {});
      await load();
      onRefresh();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed');
    } finally { setBusyId(null); }
  };

  const resolveDispute = async (id: number, resolution: 'upheld' | 'rejected') => {
    const notes = prompt(resolution === 'upheld'
      ? 'Notes — siding with the consumer (deposit will be returned manually):'
      : 'Notes — siding with the driver (forfeit stands):');
    if (notes === null) return;
    setBusyId(id);
    try {
      await api.post(`/admin/damage-disputes/${id}/resolve`, { resolution, notes });
      await load();
      onRefresh();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed');
    } finally { setBusyId(null); }
  };

  if (loading) {
    return <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading driver UPI queues…</div>;
  }

  if (pendingV.length === 0 && pendingR.length === 0 && disputes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {pendingV.length > 0 && (
        <div className="bg-white border border-blue-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-700" />
            <h2 className="font-bold text-blue-900">Driver UPI proofs awaiting your check ({pendingV.length})</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingV.map(p => (
              <div key={p.id} className="p-4 flex flex-col md:flex-row gap-4">
                <button
                  onClick={() => setPreviewUrl(fullUrl(p.refund_proof_url))}
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
                  <button
                    onClick={() => verify(p.id, true)}
                    disabled={busyId === p.id}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => verify(p.id, false)}
                    disabled={busyId === p.id}
                    className="px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-sm font-semibold rounded-lg disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingR.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IndianRupee className="w-5 h-5 text-amber-700" />
              <h2 className="font-bold text-amber-900">Drivers awaiting reimbursement ({pendingR.length})</h2>
            </div>
            <p className="text-sm font-bold text-amber-900">You owe drivers: ₹{Number(totalOwed).toFixed(2)}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingR.map(p => (
              <div key={p.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0 text-sm">
                  <p className="font-semibold text-slate-800">{p.driver_name || 'unknown driver'}</p>
                  <p className="text-xs text-slate-500">Paid {p.consumer_name} ₹{Number(p.deposit_amount).toFixed(2)} via UPI — proof verified by {p.verified_by_name} on {formatIstDate(p.admin_verified_at)}</p>
                  {p.driver_phone && <p className="text-xs text-slate-500">Driver: {p.driver_phone}</p>}
                </div>
                <button
                  onClick={() => reimburse(p.id, p.deposit_amount)}
                  disabled={busyId === p.id}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex-shrink-0"
                >
                  Mark reimbursed
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {disputes.length > 0 && (
        <div className="bg-white border border-red-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-700" />
            <h2 className="font-bold text-red-900">Open damage disputes ({disputes.length})</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {disputes.map(d => (
              <div key={d.id} className="p-4 flex flex-col md:flex-row gap-4">
                <button
                  onClick={() => setPreviewUrl(fullUrl(d.damage_photo_url))}
                  className="w-24 h-24 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex-shrink-0 hover:ring-2 hover:ring-red-300"
                >
                  {d.damage_photo_url
                    ? <img src={fullUrl(d.damage_photo_url) || ''} alt="damage" className="w-full h-full object-cover" />
                    : <ImageIcon className="w-6 h-6 text-slate-300 mx-auto mt-7" />
                  }
                </button>
                <div className="flex-1 min-w-0 text-sm">
                  <p className="font-semibold text-slate-800">{d.consumer_name} disputes forfeit · ₹{Number(d.deposit_amount).toFixed(2)}</p>
                  {d.consumer_phone && <p className="text-xs text-slate-500">{d.consumer_phone}</p>}
                  <p className="text-xs text-slate-400">Opened {d.dispute_opened_at ? formatIstDate(d.dispute_opened_at) : '—'} · Deadline {d.dispute_deadline ? formatIstDate(d.dispute_deadline) : '—'}</p>
                  {d.notes && <p className="text-xs text-slate-600 italic mt-1 whitespace-pre-wrap">{d.notes}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => resolveDispute(d.id, 'upheld')}
                    disabled={busyId === d.id}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                  >
                    Side with consumer
                  </button>
                  <button
                    onClick={() => resolveDispute(d.id, 'rejected')}
                    disabled={busyId === d.id}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                  >
                    Uphold forfeit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative">
        <button onClick={onClose}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 p-1">
          <X className="w-5 h-5" />
        </button>
        {children}
      </div>
    </div>
  );
}
