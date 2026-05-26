import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Banknote, Phone, MapPin, Calendar, RefreshCcw, X, AlertCircle } from 'lucide-react';
import api from '../../api/axios';
import { formatIstDate } from '../../utils/dateTime';

interface PendingRefund {
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

export default function AdminManualRefunds() {
  const [rows, setRows] = useState<PendingRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<PendingRefund | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/admin/manual-refunds')
      .then(r => setRows(r.data.refunds || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Banknote className="w-6 h-6 text-emerald-600" />
            Manual Container Refunds
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Container deposits that the dealer has marked refunded with bank-transfer destination.
            Pay the consumer out-of-band, then stamp the UTR here to close the loop.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          <RefreshCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </header>

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-base font-semibold text-slate-800">All caught up</p>
          <p className="text-sm text-slate-500 mt-1">No pending manual refunds.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map(r => (
            <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-semibold text-slate-900">{r.consumer_name}</p>
                    <span className="text-[10px] uppercase font-semibold tracking-wide px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">
                      Awaiting UTR
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                    {r.consumer_phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{r.consumer_phone}</span>}
                    {r.consumer_address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{r.consumer_address}</span>}
                    {r.resolved_at && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />refunded {formatIstDate(r.resolved_at)}</span>}
                  </div>
                  <div className="mt-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-800">{r.container_type}</span> ·
                    {' '}deposit ₹{Number(r.deposit_amount).toFixed(0)}
                    {r.linked_dealer_name && <span> · picked up by {r.linked_dealer_name}</span>}
                  </div>
                  {r.notes && (
                    <p className="mt-2 text-xs text-slate-500 italic">"{r.notes}"</p>
                  )}
                </div>
                <button
                  onClick={() => setTarget(r)}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold flex-shrink-0"
                >
                  Settle ₹{Number(r.deposit_amount).toFixed(0)}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {target && (
        <SettleModal
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => { setTarget(null); load(); }}
        />
      )}
    </div>
  );
}

function SettleModal({
  target,
  onClose,
  onDone,
}: {
  target: PendingRefund;
  onClose: () => void;
  onDone: () => void;
}) {
  const [utr, setUtr] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (utr.trim().length < 4) {
      toast.error('UTR must be at least 4 characters');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/manual-refunds/${target.id}/settle`, {
        utr: utr.trim(),
        notes: notes.trim() || undefined,
      });
      toast.success('Refund settled');
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to settle refund');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900">Settle manual refund</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 mb-4">
          <p className="font-medium">{target.consumer_name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {target.container_type} · ₹{Number(target.deposit_amount).toFixed(0)}
          </p>
        </div>

        <p className="text-xs text-slate-600 mb-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          Make the bank transfer to the consumer first, then enter the UTR/reference here. This
          action is irreversible — you can't change the UTR later.
        </p>

        <label className="block text-xs font-semibold text-slate-700 mb-1">Bank UTR / reference</label>
        <input
          value={utr}
          onChange={e => setUtr(e.target.value)}
          placeholder="e.g. UTR123456789"
          className="w-full rounded-lg border border-slate-200 text-sm p-2 mb-3 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />

        <label className="block text-xs font-semibold text-slate-700 mb-1">Notes (optional)</label>
        <textarea
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Internal note for the audit trail"
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
            disabled={busy || utr.trim().length < 4}
            className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Confirm settlement'}
          </button>
        </div>
      </div>
    </div>
  );
}
