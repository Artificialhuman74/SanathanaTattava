import React, { useEffect, useState } from 'react';
import api from '../../api/axios';
import {
  RotateCcw, Loader2, AlertCircle, MapPin, Phone, CheckCircle2, XCircle,
} from 'lucide-react';

type Pickup = {
  id: number;
  invoice_id: number;
  container_type: string;
  deposit_amount: number;
  refund_destination: 'manual_bank' | 'store_credit';
  requested_at: string;
  notes: string | null;
  consumer_id: number;
  consumer_name: string;
  consumer_phone: string | null;
  consumer_address: string | null;
  current_product_name: string;
  original_product_name: string;
};

export default function ContainerPickups() {
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState<number | null>(null);
  const [modal, setModal] = useState<{ pickup: Pickup; outcome: 'refunded' | 'forfeited' } | null>(null);
  const [notes, setNotes] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/delivery/container-pickups');
      setPickups(data.pickups || []);
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load pickups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!modal) return;
    setResolving(modal.pickup.id);
    try {
      await api.post(`/delivery/container-pickups/${modal.pickup.id}/resolve`, {
        outcome: modal.outcome,
        notes: notes || undefined,
      });
      setModal(null);
      setNotes('');
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to resolve pickup');
    } finally {
      setResolving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <RotateCcw className="w-5 h-5 text-emerald-700" />
        <h1 className="text-lg font-bold text-slate-800">Container Pickups</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {pickups.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <RotateCcw className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No pickup tasks right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pickups.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{p.consumer_name}</p>
                  <p className="text-xs text-slate-500">Holding #{p.id} · {p.container_type}</p>
                </div>
                <span
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
                    p.refund_destination === 'store_credit'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {p.refund_destination === 'store_credit' ? 'Store credit' : 'Bank refund'}
                </span>
              </div>

              <div className="text-xs text-slate-600 space-y-1 mb-3">
                <p>Product: <span className="text-slate-800">{p.current_product_name}</span></p>
                <p>Deposit: <span className="text-slate-800">₹{Number(p.deposit_amount).toFixed(2)}</span></p>
                {p.consumer_phone && (
                  <a href={`tel:${p.consumer_phone}`} className="flex items-center gap-1 text-emerald-700">
                    <Phone className="w-3 h-3" /> {p.consumer_phone}
                  </a>
                )}
                {p.consumer_address && (
                  <p className="flex items-start gap-1">
                    <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>{p.consumer_address}</span>
                  </p>
                )}
                {p.notes && (
                  <p className="mt-1 p-2 bg-slate-50 rounded text-slate-700 italic">"{p.notes}"</p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setModal({ pickup: p, outcome: 'refunded' }); setNotes(''); }}
                  disabled={resolving === p.id}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> Refund
                </button>
                <button
                  onClick={() => { setModal({ pickup: p, outcome: 'forfeited' }); setNotes(''); }}
                  disabled={resolving === p.id}
                  className="flex-1 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 text-sm font-semibold rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> Forfeit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-4">
            <h3 className="text-base font-bold text-slate-800 mb-2">
              {modal.outcome === 'refunded' ? 'Confirm refund' : 'Confirm forfeit'}
            </h3>
            <p className="text-xs text-slate-600 mb-3">
              {modal.outcome === 'refunded'
                ? `Container is in good condition. Deposit ₹${Number(modal.pickup.deposit_amount).toFixed(2)} will be ${
                    modal.pickup.refund_destination === 'store_credit'
                      ? 'credited to the consumer immediately.'
                      : 'flagged for manual bank transfer by admin.'
                  }`
                : 'Container is damaged or missing. Deposit will NOT be refunded.'}
            </p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes (optional) — e.g. dented lid, missing cap"
              className="w-full border border-slate-200 rounded-lg p-2 text-sm mb-3 h-20"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setModal(null)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={resolving !== null}
                className={`flex-1 py-2 text-white text-sm font-semibold rounded-lg disabled:opacity-50 ${
                  modal.outcome === 'refunded'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {resolving !== null ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
