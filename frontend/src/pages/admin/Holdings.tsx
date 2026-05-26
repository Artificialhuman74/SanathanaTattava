import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Package, Search, RefreshCcw, AlertTriangle, Clock, Truck,
  CheckCircle2, XCircle, ShieldAlert, X, History, ChevronRight,
} from 'lucide-react';
import api from '../../api/axios';
import { formatIstDate } from '../../utils/dateTime';

type Status = 'pending_delivery' | 'held' | 'refund_requested' | 'refunded' | 'forfeited';
type Destination = 'manual_bank' | 'store_credit' | null;

interface Holding {
  id: number;
  consumer_id: number;
  consumer_name: string;
  consumer_email: string | null;
  consumer_phone: string | null;
  linked_dealer_name: string | null;
  container_type: string;
  deposit_amount: number;
  status: Status;
  refund_destination: Destination;
  manual_refund_utr: string | null;
  current_product_name: string;
  original_product_name: string;
  requested_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
}

interface ListResponse {
  holdings: Holding[];
  statusCounts: Partial<Record<Status, number>>;
}

interface AuditEntry {
  id: number;
  actor_user_id: number;
  actor_name: string;
  action: string;
  before_status: Status | null;
  after_status: Status | null;
  before_destination: Destination;
  after_destination: Destination;
  notes: string | null;
  created_at: string;
}

interface DetailResponse {
  holding: Holding & { invoice_number: string | null };
  audit: AuditEntry[];
}

const STATUS_META: Record<Status, { label: string; chip: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending_delivery: { label: 'Pending delivery', chip: 'bg-amber-50  text-amber-700  border-amber-200',  icon: Truck },
  held:             { label: 'Held',             chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Package },
  refund_requested: { label: 'Refund requested', chip: 'bg-blue-50   text-blue-700   border-blue-200',   icon: Clock },
  refunded:         { label: 'Refunded',         chip: 'bg-slate-100 text-slate-700  border-slate-200',  icon: CheckCircle2 },
  forfeited:        { label: 'Forfeited',        chip: 'bg-red-50    text-red-700    border-red-200',    icon: XCircle },
};

const STATUS_ORDER: Status[] = ['pending_delivery', 'held', 'refund_requested', 'refunded', 'forfeited'];

export default function AdminHoldings() {
  const [data, setData]         = useState<ListResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch]     = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    const params: any = {};
    if (statusFilter !== 'all') params.status = statusFilter;
    if (search.trim()) params.search = search.trim();
    api.get('/admin/holdings', { params })
      .then(r => setData(r.data))
      .catch(() => setData({ holdings: [], statusCounts: {} }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

  const totalCount = useMemo(
    () => STATUS_ORDER.reduce((s, st) => s + (data?.statusCounts[st] || 0), 0),
    [data]
  );

  return (
    <div className="max-w-7xl mx-auto">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-emerald-600" />
            Container Holdings
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            All container_holdings rows across the platform. Use this to investigate
            stuck records and apply manual overrides for customer-service cases.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          <RefreshCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </header>

      {/* Status counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <CountTile label="Total" value={totalCount} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        {STATUS_ORDER.map(s => (
          <CountTile
            key={s}
            label={STATUS_META[s].label}
            value={data?.statusCounts[s] || 0}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            chip={STATUS_META[s].chip}
          />
        ))}
      </div>

      {/* Search */}
      <form onSubmit={onSearchSubmit} className="mb-4 flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search consumer name, email, or phone"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
        >
          Search
        </button>
      </form>

      {/* List */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
      ) : !data || data.holdings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          No holdings match your filters.
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="sm:hidden space-y-2">
            {data.holdings.map(h => (
              <HoldingCard key={h.id} h={h} onClick={() => setDetailId(h.id)} />
            ))}
          </ul>
          {/* Desktop: table */}
          <div className="hidden sm:block rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2.5 text-left">Consumer</th>
                  <th className="px-3 py-2.5 text-left">Container</th>
                  <th className="px-3 py-2.5 text-right">Deposit</th>
                  <th className="px-3 py-2.5 text-left">Status</th>
                  <th className="px-3 py-2.5 text-left">Dealer</th>
                  <th className="px-3 py-2.5 text-left">Updated</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.map(h => (
                  <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setDetailId(h.id)}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-900">{h.consumer_name}</p>
                      <p className="text-[11px] text-slate-400">{h.consumer_phone || h.consumer_email || '—'}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-slate-700">{h.container_type}</p>
                      <p className="text-[11px] text-slate-400 truncate max-w-[180px]">{h.current_product_name}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-800">
                      ₹{Number(h.deposit_amount).toFixed(0)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusChip status={h.status} />
                      {h.refund_destination && (
                        <p className="text-[10px] text-slate-400 mt-0.5">{h.refund_destination === 'manual_bank' ? 'bank' : 'credit'}{h.manual_refund_utr ? ' · paid' : ''}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 text-[12px]">{h.linked_dealer_name || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-[11px]">{formatIstDate(h.updated_at)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-400"><ChevronRight className="w-4 h-4 inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detailId !== null && (
        <DetailDrawer
          holdingId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => { setDetailId(null); load(); }}
        />
      )}
    </div>
  );
}

function CountTile({
  label, value, active, onClick, chip,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  chip?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border bg-white px-3 py-3 text-left transition ${
        active ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <p className={`text-[10px] uppercase font-semibold tracking-wide ${chip ? '' : 'text-slate-500'}`}>
        {chip
          ? <span className={`inline-block px-1.5 py-0.5 rounded border ${chip}`}>{label}</span>
          : label
        }
      </p>
      <p className="text-xl font-bold text-slate-900 mt-1">{value}</p>
    </button>
  );
}

function StatusChip({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-semibold tracking-wide px-2 py-0.5 rounded border ${meta.chip}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function HoldingCard({ h, onClick }: { h: Holding; onClick: () => void }) {
  return (
    <li
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white p-3 active:bg-slate-50 transition"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 text-sm truncate">{h.consumer_name}</p>
          <p className="text-[11px] text-slate-400">{h.container_type} · {h.current_product_name}</p>
        </div>
        <StatusChip status={h.status} />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Deposit ₹{Number(h.deposit_amount).toFixed(0)}</span>
        <span>{formatIstDate(h.updated_at)}</span>
      </div>
    </li>
  );
}

function DetailDrawer({
  holdingId,
  onClose,
  onChanged,
}: {
  holdingId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/admin/holdings/${holdingId}`)
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load holding'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [holdingId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="w-full sm:max-w-lg bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <p className="text-xs text-slate-500">Holding</p>
            <h3 className="text-base font-bold text-slate-900">#{holdingId}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {loading || !data ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading…</div>
        ) : (
          <div className="flex-1 p-5 space-y-5">
            {/* Status block */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between mb-2">
                <StatusChip status={data.holding.status} />
                <span className="text-xs font-medium text-slate-500">₹{Number(data.holding.deposit_amount).toFixed(2)}</span>
              </div>
              <p className="text-sm font-semibold text-slate-900">{data.holding.container_type} · {data.holding.current_product_name}</p>
              {data.holding.current_product_name !== data.holding.original_product_name && (
                <p className="text-xs text-slate-500 mt-0.5">originally {data.holding.original_product_name}</p>
              )}
              {data.holding.refund_destination && (
                <p className="text-xs text-slate-500 mt-1">
                  Refund destination: <span className="font-medium">{data.holding.refund_destination === 'manual_bank' ? 'Bank transfer' : 'Store credit'}</span>
                  {data.holding.manual_refund_utr && (
                    <span className="ml-1">· UTR <span className="font-mono">{data.holding.manual_refund_utr}</span></span>
                  )}
                </p>
              )}
            </div>

            {/* Consumer */}
            <DetailRow label="Consumer" value={data.holding.consumer_name} sub={data.holding.consumer_phone || data.holding.consumer_email || ''} />
            <DetailRow label="Linked dealer" value={data.holding.linked_dealer_name || 'None'} />
            <DetailRow label="Invoice" value={data.holding.invoice_number || '—'} />
            <DetailRow label="Created" value={formatIstDate(data.holding.created_at)} />
            <DetailRow label="Last updated" value={formatIstDate(data.holding.updated_at)} />
            {data.holding.notes && (
              <DetailRow label="Notes" value={data.holding.notes} multiline />
            )}

            {/* Override */}
            <div className="pt-2">
              <button
                onClick={() => setOverrideOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                <AlertTriangle className="w-4 h-4" /> Apply manual override
              </button>
              <p className="text-[11px] text-slate-400 mt-2 text-center">
                Use only for customer-service cases. Every change is logged.
              </p>
            </div>

            {/* Audit trail */}
            <div>
              <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wide mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                Audit trail ({data.audit.length})
              </h4>
              {data.audit.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No admin overrides yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.audit.map(a => (
                    <li key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-slate-700">{a.actor_name}</span>
                        <span className="text-[10px] text-slate-400">{formatIstDate(a.created_at)}</span>
                      </div>
                      <p className="text-slate-600">
                        <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{a.before_status}</span>
                        {' → '}
                        <span className="font-mono bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">{a.after_status}</span>
                      </p>
                      {(a.before_destination || a.after_destination) && (
                        <p className="text-slate-500 mt-1">
                          dest: {a.before_destination || '—'} → {a.after_destination || '—'}
                        </p>
                      )}
                      {a.notes && <p className="mt-1 italic text-slate-500">"{a.notes}"</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {overrideOpen && data && (
        <OverrideModal
          holding={data.holding}
          onClose={() => setOverrideOpen(false)}
          onDone={() => { setOverrideOpen(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function DetailRow({ label, value, sub, multiline }: { label: string; value: string; sub?: string; multiline?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">{label}</p>
      <p className={`text-sm text-slate-800 ${multiline ? 'whitespace-pre-wrap' : ''}`}>{value || '—'}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function OverrideModal({
  holding,
  onClose,
  onDone,
}: {
  holding: Holding;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newStatus, setNewStatus]           = useState<Status>(holding.status);
  const [newDestination, setNewDestination] = useState<'manual_bank' | 'store_credit' | ''>(holding.refund_destination || '');
  const [notes, setNotes]                   = useState('');
  const [busy, setBusy]                     = useState(false);

  const needsDestination = newStatus === 'refunded';

  const submit = async () => {
    if (needsDestination && !newDestination) {
      toast.error('Refunded status requires a refund destination');
      return;
    }
    if (!notes.trim()) {
      toast.error('Please add a note explaining the override');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/holdings/${holding.id}/override`, {
        new_status: newStatus,
        new_destination: needsDestination ? newDestination : null,
        notes: notes.trim(),
      });
      toast.success('Override applied');
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Override failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900">Manual override</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            Overrides bypass trader/consumer flow and are logged with your user id. If you move
            into <span className="font-semibold">refunded + store credit</span>, a ledger row is
            added automatically; reversing back removes it.
          </p>
        </div>

        <label className="block text-xs font-semibold text-slate-700 mb-1">New status</label>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {STATUS_ORDER.map(s => (
            <button
              key={s}
              onClick={() => setNewStatus(s)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border ${
                newStatus === s
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>

        {needsDestination && (
          <>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Refund destination</label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {(['manual_bank', 'store_credit'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setNewDestination(d)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border ${
                    newDestination === d
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {d === 'manual_bank' ? 'Bank transfer' : 'Store credit'}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Reason / notes <span className="text-red-500">*</span>
        </label>
        <textarea
          rows={3}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Why is this override required?"
          className="w-full rounded-lg border border-slate-200 text-sm p-2 mb-4 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !notes.trim()}
            className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60"
          >
            {busy ? 'Applying…' : 'Apply override'}
          </button>
        </div>
      </div>
    </div>
  );
}
