import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  TrendingUp, AlertCircle, Loader2, CheckCircle2, RefreshCw, HelpCircle, ChevronDown,
} from 'lucide-react';
import { formatIstDate } from '../../utils/dateTime';

interface CommissionData {
  summary: {
    total_count: number;
    pending_amount: number;
    paid_amount: number;
    total_amount: number;
  };
  commissions: CommissionEntry[];
  weeklyBreakdown: WeeklyEntry[];
  payouts: any[];
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
  razorpay_transfer_id: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:         'bg-amber-100 text-amber-700',
  transferring:    'bg-blue-100 text-blue-700',
  transferred:     'bg-emerald-100 text-emerald-700',
  transfer_failed: 'bg-red-100 text-red-700',
  paid:            'bg-emerald-100 text-emerald-700',
};

const STATUS_LABEL: Record<string, string> = {
  pending:         'Pending',
  transferring:    'Transferring',
  transferred:     'Paid to Razorpay',
  transfer_failed: 'Transfer Failed',
  paid:            'Paid',
};

const PAID_STATUSES = new Set(['transferred', 'paid']);

const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export default function TraderCommissions() {
  const { isTier1 } = useAuth();
  const [data,       setData]       = useState<CommissionData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [syncingId,  setSyncingId]  = useState<number | null>(null);

  const fetchData = () => {
    setLoading(true);
    api.get('/trader/commissions')
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const syncTransfer = async (c: CommissionEntry) => {
    setSyncingId(c.id);
    try {
      const { data } = await api.post('/payments/sync-transfer/me', { commission_id: c.id });
      if (data.mapped_status === 'transferred') {
        toast.success('Transfer confirmed — money is in your Razorpay account');
      } else if (data.mapped_status === 'transfer_failed') {
        toast.error('Transfer failed — contact admin');
      } else {
        toast(`Transfer status: ${data.razorpay_status}`, { icon: 'ℹ️' });
      }
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to sync');
    } finally {
      setSyncingId(null);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );

  const total      = parseFloat(String(data?.summary?.total_amount || 0));
  const paidToBank = (data?.commissions || [])
    .filter(c => PAID_STATUSES.has(c.status))
    .reduce((sum, c) => sum + parseFloat(String(c.amount)), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">My Commissions</h2>
        <p className="text-slate-500 text-sm mt-0.5">Earnings auto-settle to your linked bank account</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: 'Total Earned', value: fmt(total),      icon: TrendingUp,   color: 'bg-slate-50 text-slate-600',     border: 'border-slate-200' },
          { label: 'Paid to Bank', value: fmt(paidToBank), icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600', border: 'border-emerald-200' },
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

      {/* Simple Guide — collapsible */}
      <details className="card bg-blue-50 border-blue-200 group" open>
        <summary className="flex items-center justify-between gap-3 p-4 cursor-pointer list-none">
          <div className="flex items-center gap-2">
            <HelpCircle size={18} className="text-blue-600" />
            <span className="font-bold text-blue-900 text-sm">How do I earn money? (tap to show/hide)</span>
          </div>
          <ChevronDown size={18} className="text-blue-600 transition-transform group-open:rotate-180" />
        </summary>

        <div className="px-4 pb-4 space-y-4 text-sm text-blue-900">
          <div>
            <p className="font-bold mb-1">In simple words</p>
            <p className="text-blue-800">
              Every time a customer buys something using your referral code, you get a small share of that
              order as <b>commission</b>. The money comes <b>straight to your bank account</b> by itself.
              You don't need to ask anyone. You don't need to fill any UPI ID.
            </p>
          </div>

          <div>
            <p className="font-bold mb-1">Step by step</p>
            <ol className="list-decimal pl-5 space-y-1 text-blue-800">
              <li>Customer places an order and <b>pays online</b>.</li>
              <li>Your commission appears in this page within a few minutes.</li>
              <li>The system <b>automatically sends the money to your bank</b> using Razorpay.</li>
              <li>Money usually reaches your bank in <b>1 to 2 working days</b>.</li>
            </ol>
          </div>

          <div>
            <p className="font-bold mb-1">What the words mean</p>
            <ul className="space-y-1 text-blue-800">
              <li><b>Total Earned</b> — all the commission you have ever earned.</li>
              <li><b>Paid to Bank</b> — the money that has already gone to your bank.</li>
              <li><b>Direct</b> — commission from a customer <b>you</b> brought.</li>
              {isTier1 && <li><b>Override</b> — commission from a customer brought by <b>your sub-dealer</b>.</li>}
              <li><b>Paid to Razorpay</b> — money sent, will reach your bank in 1–2 days.</li>
              <li><b>Transferring</b> — money is on the way right now.</li>
            </ul>
          </div>

          <div className="bg-white/70 rounded-lg p-3 border border-blue-200">
            <p className="font-bold mb-1 text-blue-900">Important</p>
            <ul className="space-y-1 text-blue-800">
              <li>Make sure your <b>PAN</b> and <b>bank account</b> are added in <b>My Profile</b>. Without these, money cannot be sent.</li>
              <li>If you don't see your commission after a customer pays, wait a few minutes and refresh the page.</li>
              <li>Still have a problem? Call admin.</li>
            </ul>
          </div>
        </div>
      </details>

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
                      {formatIstDate(w.week_start)} – {formatIstDate(w.week_end)}
                    </td>
                    <td className="text-center font-semibold">{w.count}</td>
                    <td className="font-bold text-emerald-600">{fmt(parseFloat(String(w.amount)))}</td>
                    <td>
                      <span className={`badge ${STATUS_COLORS[w.status] || 'bg-amber-100 text-amber-700'}`}>
                        {STATUS_LABEL[w.status] || w.status}
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
                <tr><th>Order #</th><th>Amount</th><th>Rate</th><th>Type</th><th>Status</th><th>Date</th><th></th></tr>
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
                      <div>
                        <span className={`badge ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_LABEL[c.status] || c.status}
                        </span>
                        {c.status === 'transferred' && (
                          <p className="text-[10px] text-slate-400 mt-0.5">Bank settlement: 1–2 days</p>
                        )}
                      </div>
                    </td>
                    <td className="text-xs text-slate-400">{formatIstDate(c.created_at)}</td>
                    <td>
                      {c.status === 'transferring' && c.razorpay_transfer_id && (
                        <button
                          onClick={() => syncTransfer(c)}
                          disabled={syncingId === c.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {syncingId === c.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                          {syncingId === c.id ? 'Checking…' : 'Sync'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
