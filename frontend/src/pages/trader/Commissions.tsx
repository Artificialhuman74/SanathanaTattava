import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Clock, CheckCircle2, TrendingUp, Info, AlertCircle,
  ArrowDownToLine, X, Loader2, Wallet,
} from 'lucide-react';

interface CommissionData {
  summary: {
    total_count: number;
    pending_amount: number;
    paid_amount: number;
    total_amount: number;
  };
  available_balance: number;
  commissions: CommissionEntry[];
  weeklyBreakdown: WeeklyEntry[];
  payouts: any[];
  withdrawals: WithdrawalEntry[];
}

interface WeeklyEntry {
  week_start: string;
  week_end: string;
  count: number;
  amount: number;
  status: string;
}

interface CommissionEntry {
  id: number;
  order_number: string;
  amount: number;
  rate: number;
  type: 'direct' | 'override';
  status: string;
  created_at: string;
}

interface WithdrawalEntry {
  id: number;
  amount: number;
  upi_id: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_notes: string | null;
  requested_at: string;
  processed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700',
  paid:     'bg-emerald-100 text-emerald-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export default function TraderCommissions() {
  const { isTier1 } = useAuth();
  const [data,       setData]       = useState<CommissionData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [showModal,  setShowModal]  = useState(false);
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [upiId,      setUpiId]      = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = () => {
    setLoading(true);
    api.get('/trader/commissions')
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const submitWithdrawal = async () => {
    const amt = parseFloat(withdrawAmt);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!upiId.trim())    { toast.error('Enter your UPI ID'); return; }
    setSubmitting(true);
    try {
      await api.post('/trader/commissions/withdraw', { amount: amt, upi_id: upiId.trim() });
      toast.success('Withdrawal request submitted!');
      setShowModal(false);
      setWithdrawAmt('');
      setUpiId('');
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );

  const pending  = parseFloat(String(data?.summary?.pending_amount || 0));
  const paid     = parseFloat(String(data?.summary?.paid_amount    || 0));
  const total    = parseFloat(String(data?.summary?.total_amount   || 0));
  const available = parseFloat(String(data?.available_balance      || 0));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">My Commissions</h2>
          <p className="text-slate-500 text-sm mt-0.5">Track earnings and request withdrawals</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={available <= 0}
          className="btn-primary flex items-center gap-2 disabled:opacity-40"
        >
          <ArrowDownToLine size={16} /> Withdraw
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Available',  value: fmt(available), icon: Wallet,       color: 'bg-brand-50 text-brand-600',   border: 'border-brand-300' },
          { label: 'Pending',    value: fmt(pending),   icon: Clock,         color: 'bg-amber-50 text-amber-600',   border: 'border-amber-200' },
          { label: 'Processed',  value: fmt(paid),      icon: CheckCircle2,  color: 'bg-emerald-50 text-emerald-600', border: 'border-emerald-200' },
          { label: 'Total Earned', value: fmt(total),   icon: TrendingUp,    color: 'bg-slate-50 text-slate-600',   border: 'border-slate-200' },
        ].map(({ label, value, icon: Icon, color, border }) => (
          <div key={label} className={`card p-4 border-l-4 ${border}`}>
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                <Icon size={16} />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">{label}</p>
                <p className="text-xl font-extrabold text-slate-900 mt-0.5">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Info */}
      <div className="card p-4 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-800">
            <p className="font-semibold mb-1">How commissions work</p>
            <ul className="space-y-0.5 text-blue-700">
              <li><strong>Direct</strong> — earned from your own consumers' paid orders</li>
              {isTier1 && <li><strong>Override</strong> — earned from your sub-dealers' consumers' paid orders</li>}
              <li>Commissions are only added after the consumer completes payment</li>
              <li><strong>Available balance</strong> = total earned − pending or approved withdrawals</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Withdrawal History */}
      {(data?.withdrawals || []).length > 0 && (
        <div className="card">
          <div className="p-5 border-b border-slate-100">
            <h3 className="font-bold text-slate-900">Withdrawal Requests</h3>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>UPI ID</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Requested</th>
                  <th>Processed</th>
                </tr>
              </thead>
              <tbody>
                {(data?.withdrawals || []).map(w => (
                  <tr key={w.id}>
                    <td className="font-bold text-emerald-600">{fmt(parseFloat(String(w.amount)))}</td>
                    <td className="font-mono text-sm text-slate-600">{w.upi_id}</td>
                    <td>
                      <span className={`badge ${STATUS_COLORS[w.status] || 'bg-slate-100 text-slate-600'}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500">{w.admin_notes || '—'}</td>
                    <td className="text-xs text-slate-400">{new Date(w.requested_at).toLocaleDateString('en-IN')}</td>
                    <td className="text-xs text-slate-400">{w.processed_at ? new Date(w.processed_at).toLocaleDateString('en-IN') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Weekly Breakdown */}
      {(data?.weeklyBreakdown || []).length > 0 && (
        <div className="card">
          <div className="p-5 border-b border-slate-100">
            <h3 className="font-bold text-slate-900">Weekly Breakdown</h3>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>Week</th><th>Orders</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {(data?.weeklyBreakdown || []).map((w, i) => (
                  <tr key={i}>
                    <td className="text-sm text-slate-600">
                      {new Date(w.week_start).toLocaleDateString('en-IN')} – {new Date(w.week_end).toLocaleDateString('en-IN')}
                    </td>
                    <td className="text-center font-semibold">{w.count}</td>
                    <td className="font-bold text-emerald-600">{fmt(parseFloat(String(w.amount)))}</td>
                    <td>
                      <span className={`badge ${w.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {w.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Commission Records */}
      <div className="card">
        <div className="p-5 border-b border-slate-100">
          <h3 className="font-bold text-slate-900">Commission Records</h3>
          <p className="text-slate-400 text-xs mt-0.5">Per-order commission details</p>
        </div>
        {(data?.commissions || []).length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <AlertCircle size={36} className="mx-auto mb-2 opacity-30" />
            <p className="font-medium">No commissions yet</p>
            <p className="text-sm mt-1">Commissions appear after consumers complete payment</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>Order #</th><th>Amount</th><th>Rate</th><th>Type</th><th>Status</th><th>Date</th></tr>
              </thead>
              <tbody>
                {(data?.commissions || []).map(c => (
                  <tr key={c.id}>
                    <td className="font-mono text-brand-600 font-medium text-xs">{c.order_number}</td>
                    <td className="font-bold text-emerald-600">{fmt(parseFloat(String(c.amount)))}</td>
                    <td className="text-sm text-slate-600">{c.rate}%</td>
                    <td>
                      <span className={`badge text-xs ${c.type === 'direct' ? 'bg-brand-100 text-brand-700' : 'bg-indigo-100 text-indigo-700'}`}>
                        {c.type === 'direct' ? 'Direct' : 'Override'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="text-xs text-slate-400">{new Date(c.created_at).toLocaleDateString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Withdraw Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-slate-900 text-lg">Request Withdrawal</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-brand-50 rounded-xl text-sm text-brand-800 font-medium">
                Available balance: <span className="font-extrabold">{fmt(available)}</span>
              </div>

              <div>
                <label className="form-label">Amount (₹)</label>
                <input
                  type="number"
                  min="1"
                  max={available}
                  step="0.01"
                  value={withdrawAmt}
                  onChange={e => setWithdrawAmt(e.target.value)}
                  className="form-input"
                  placeholder="Enter amount"
                />
              </div>

              <div>
                <label className="form-label">UPI ID</label>
                <input
                  type="text"
                  value={upiId}
                  onChange={e => setUpiId(e.target.value)}
                  className="form-input"
                  placeholder="yourname@upi"
                />
              </div>

              <p className="text-xs text-slate-400">
                Withdrawals are reviewed and processed by admin. You'll be notified once approved.
              </p>

              <div className="flex gap-3">
                <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
                <button onClick={submitWithdrawal} disabled={submitting} className="btn-primary flex-1">
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
