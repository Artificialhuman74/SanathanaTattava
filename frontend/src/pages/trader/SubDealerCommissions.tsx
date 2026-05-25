import { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Users, Banknote, Mail, RefreshCw, AlertCircle, Check, Clock,
  Loader2, X, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import { formatIstDate } from '../../utils/dateTime';

type Status = 'pending' | 'awaiting_confirmation' | 'paid' | 'disputed';

interface SubDealerCommission {
  id: number;
  trader_id: number;
  amount: number;
  rate: number;
  type: 'direct' | 'override';
  status: Status;
  payment_method: 'cash' | 'bank_transfer' | null;
  paid_at_offline: string | null;
  confirmed_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  payment_note: string | null;
  created_at: string;
  sub_dealer_name: string;
  sub_dealer_email: string | null;
  order_number: string | null;
  order_amount: number | null;
}

interface Summary {
  owed: number;
  awaiting: number;
  disputed: number;
  paid: number;
  owed_count: number;
}

const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_STYLE: Record<Status, string> = {
  pending:               'bg-amber-100 text-amber-700',
  awaiting_confirmation: 'bg-blue-100 text-blue-700',
  paid:                  'bg-emerald-100 text-emerald-700',
  disputed:              'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<Status, string> = {
  pending:               'Owed',
  awaiting_confirmation: 'Awaiting confirmation',
  paid:                  'Paid & confirmed',
  disputed:              'Disputed',
};

export default function SubDealerCommissions() {
  const [commissions, setCommissions] = useState<SubDealerCommission[]>([]);
  const [summary, setSummary]         = useState<Summary>({ owed: 0, awaiting: 0, disputed: 0, paid: 0, owed_count: 0 });
  const [loading, setLoading]         = useState(true);
  const [busyId, setBusyId]           = useState<number | null>(null);

  const [modal, setModal] = useState<{ open: boolean; comm: SubDealerCommission | null; method: 'cash' | 'bank_transfer'; note: string }>({
    open: false, comm: null, method: 'cash', note: '',
  });

  const fetchData = useCallback(() => {
    setLoading(true);
    api.get('/trader/sub-dealer-commissions')
      .then(r => {
        setCommissions(r.data.commissions || []);
        setSummary(r.data.summary || { owed: 0, awaiting: 0, disputed: 0, paid: 0, owed_count: 0 });
      })
      .catch((err) => {
        if (err?.response?.status === 403) {
          toast.error('Only tier-1 dealers can settle sub-dealer commissions');
        } else {
          toast.error('Failed to load sub-dealer commissions');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openLogModal = (c: SubDealerCommission) => {
    setModal({ open: true, comm: c, method: 'cash', note: '' });
  };

  const submitLog = async () => {
    if (!modal.comm) return;
    setBusyId(modal.comm.id);
    try {
      await api.post(`/trader/sub-dealer-commissions/${modal.comm.id}/log-payment`, {
        method: modal.method,
        note:   modal.note.trim() || undefined,
      });
      toast.success(`Payment logged. ${modal.comm.sub_dealer_name} will receive a confirmation email.`);
      setModal({ open: false, comm: null, method: 'cash', note: '' });
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to log payment');
    } finally {
      setBusyId(null);
    }
  };

  const resendEmail = async (c: SubDealerCommission) => {
    setBusyId(c.id);
    try {
      await api.post(`/trader/sub-dealer-commissions/${c.id}/resend-email`);
      toast.success('Confirmation email resent');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to resend');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Sub-Dealer Commissions</h2>
          <p className="text-slate-500 text-sm mt-0.5">
            Pay your sub-dealers (cash or bank transfer) and log the payment here. They will confirm via email.
          </p>
        </div>
        <button onClick={fetchData} className="btn-ghost p-2 text-slate-400 hover:text-slate-600">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'You Owe',     value: inr(summary.owed),     color: 'bg-amber-50 text-amber-600',   icon: Clock,
            sub: `${summary.owed_count} commission${summary.owed_count === 1 ? '' : 's'}` },
          { label: 'Awaiting Confirmation', value: inr(summary.awaiting), color: 'bg-blue-50 text-blue-600',     icon: Mail },
          { label: 'Disputed',    value: inr(summary.disputed), color: 'bg-red-50 text-red-600',       icon: ShieldAlert },
          { label: 'Settled',     value: inr(summary.paid),     color: 'bg-emerald-50 text-emerald-600', icon: Check },
        ].map(({ label, value, color, icon: Icon, sub }) => (
          <div key={label} className="card p-4 flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 font-medium">{label}</p>
              <p className="text-lg font-extrabold text-slate-900 mt-0.5 truncate">{value}</p>
              {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        <div className="flex items-center gap-2 p-5 border-b border-slate-100">
          <Users size={18} className="text-brand-600" />
          <div>
            <h3 className="font-bold text-slate-900">Commissions Owed to Your Sub-Dealers</h3>
            <p className="text-slate-400 text-xs mt-0.5">Mark as paid once you've handed over cash or transferred to their account</p>
          </div>
        </div>

        {loading && commissions.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Sub-Dealer</th>
                  <th>Order</th>
                  <th>Rate</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Method</th>
                  <th>Logged</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm">
                          {c.sub_dealer_name?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 text-sm">{c.sub_dealer_name}</p>
                          <p className="text-xs text-slate-400">{c.sub_dealer_email || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{c.order_number || '—'}</td>
                    <td className="text-sm text-slate-500">{c.rate}%</td>
                    <td className="font-bold text-emerald-600">{inr(c.amount)}</td>
                    <td>
                      <span className={`badge ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                      {c.status === 'disputed' && c.dispute_reason && (
                        <p className="text-xs text-red-500 mt-0.5 italic max-w-[180px] truncate" title={c.dispute_reason}>
                          "{c.dispute_reason}"
                        </p>
                      )}
                    </td>
                    <td className="text-sm text-slate-600">
                      {c.payment_method
                        ? (c.payment_method === 'cash' ? 'Cash' : 'Bank transfer')
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="text-xs text-slate-400">
                      {c.paid_at_offline ? formatIstDate(c.paid_at_offline) : '—'}
                    </td>
                    <td>
                      {c.status === 'pending' && (
                        <button
                          onClick={() => openLogModal(c)}
                          disabled={!c.sub_dealer_email}
                          title={!c.sub_dealer_email ? 'Sub-dealer has no email' : ''}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Banknote size={12} /> Mark as Paid
                        </button>
                      )}
                      {c.status === 'awaiting_confirmation' && (
                        <button
                          onClick={() => resendEmail(c)}
                          disabled={busyId === c.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {busyId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                          Resend Email
                        </button>
                      )}
                      {c.status === 'paid' && (
                        <span className="text-xs text-emerald-600 font-medium">
                          Confirmed {c.confirmed_at ? formatIstDate(c.confirmed_at) : ''}
                        </span>
                      )}
                      {c.status === 'disputed' && (
                        <span className="text-xs text-red-600 font-medium">Reconcile with sub-dealer</span>
                      )}
                    </td>
                  </tr>
                ))}
                {commissions.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-slate-400">
                      <AlertCircle size={32} className="mx-auto mb-2 opacity-30" />
                      <p>No sub-dealer commissions yet.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="card p-4 bg-amber-50/50 border-dashed border-amber-200">
        <p className="text-xs text-amber-800 leading-relaxed flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <span>
            When you mark a payment as paid, your sub-dealer receives a confirmation email. If they dispute it, the admin and you will both be notified — please keep proof of payment (transaction screenshot, signed receipt).
          </span>
        </p>
      </div>

      {/* Log payment modal */}
      {modal.open && modal.comm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden animate-fade-in">
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4 text-white flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Log Commission Payment</h2>
                <p className="text-emerald-100 text-sm">
                  {modal.comm.sub_dealer_name} — <strong>{inr(modal.comm.amount)}</strong>
                </p>
              </div>
              <button
                onClick={() => setModal({ open: false, comm: null, method: 'cash', note: '' })}
                className="p-1.5 rounded-lg hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Payment Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'bank_transfer'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setModal(s => ({ ...s, method: m }))}
                      className={`p-3 rounded-xl border text-sm font-medium transition-colors ${
                        modal.method === m
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {m === 'cash' ? '💵 Cash (in person)' : '🏦 Bank Transfer'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">
                  Note (optional)
                </label>
                <textarea
                  value={modal.note}
                  onChange={e => setModal(s => ({ ...s, note: e.target.value }))}
                  rows={3}
                  maxLength={500}
                  placeholder={modal.method === 'cash'
                    ? "e.g. 'Paid in cash on 5th May at shop'"
                    : "e.g. 'UPI ref: 23534543 to HDFC ****1234'"}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
                />
                <p className="text-xs text-slate-400 mt-1">{modal.note.length}/500</p>
              </div>

              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex gap-2">
                <Mail size={14} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  A confirmation email will be sent to <strong>{modal.comm.sub_dealer_email}</strong>. They will confirm or dispute it.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setModal({ open: false, comm: null, method: 'cash', note: '' })}
                  className="flex-1 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitLog}
                  disabled={busyId === modal.comm.id}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors disabled:opacity-50"
                >
                  {busyId === modal.comm.id ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
                  Confirm Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
