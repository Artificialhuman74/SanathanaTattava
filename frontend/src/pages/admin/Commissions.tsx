import { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  DollarSign, ChevronDown, Zap, Check, Clock, RefreshCw,
  Star, AlertCircle, ArrowDownToLine,
} from 'lucide-react';

interface CommissionSummary {
  dealer_id: number;
  dealer_name: string;
  dealer_tier: number;
  pending_amount: number;
  paid_amount: number;
  total_amount: number;
}

interface Payout {
  id: number;
  dealer_id: number;
  dealer_name: string;
  dealer_tier: number;
  week_start: string;
  week_end: string;
  order_count: number;
  amount: number;
  status: string;
  processed_at: string | null;
  created_at: string;
}

interface Withdrawal {
  id: number;
  trader_id: number;
  trader_name: string;
  trader_tier: number;
  amount: number;
  upi_id: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_notes: string | null;
  requested_at: string;
  processed_at: string | null;
}

const PAYOUT_STATUS_COLORS: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700',
  processed: 'bg-emerald-100 text-emerald-700',
  failed:    'bg-red-100 text-red-700',
};

const WITHDRAWAL_STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function AdminCommissions() {
  const [summary,      setSummary]      = useState<CommissionSummary[]>([]);
  const [payouts,      setPayouts]      = useState<Payout[]>([]);
  const [withdrawals,  setWithdrawals]  = useState<Withdrawal[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [processing,   setProcessing]   = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingId,   setUpdatingId]   = useState<number | null>(null);
  const [wFilter,      setWFilter]      = useState('pending');

  const fetchData = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (statusFilter) params.status = statusFilter;
    const wParams: any = {};
    if (wFilter) wParams.status = wFilter;
    Promise.all([
      api.get('/admin/commissions/summary'),
      api.get('/admin/commissions/payouts', { params }),
      api.get('/admin/withdrawals', { params: wParams }),
    ]).then(([summaryRes, payoutsRes, wRes]) => {
      setSummary(summaryRes.data.summary || []);
      setPayouts(payoutsRes.data.payouts || []);
      setWithdrawals(wRes.data.withdrawals || []);
    }).finally(() => setLoading(false));
  }, [statusFilter, wFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const processWeek = async () => {
    if (!window.confirm('Process commissions for this week? This will create payout records for all dealers.')) return;
    setProcessing(true);
    try {
      const { data } = await api.post('/admin/commissions/process-week');
      toast.success(`Processed ${data.count ?? 'all'} commission payouts`);
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to process commissions');
    } finally { setProcessing(false); }
  };

  const togglePayoutStatus = async (payout: Payout) => {
    const newStatus = payout.status === 'pending' ? 'processed' : 'pending';
    setUpdatingId(payout.id);
    try {
      await api.put(`/admin/commissions/payouts/${payout.id}`, { status: newStatus });
      toast.success(`Payout marked as ${newStatus}`);
      fetchData();
    } catch { toast.error('Failed to update payout'); }
    finally { setUpdatingId(null); }
  };

  const handleWithdrawal = async (w: Withdrawal, status: 'approved' | 'rejected', notes?: string) => {
    setUpdatingId(w.id);
    try {
      await api.put(`/admin/withdrawals/${w.id}`, { status, admin_notes: notes });
      toast.success(`Withdrawal ${status}`);
      fetchData();
    } catch { toast.error('Failed to update withdrawal'); }
    finally { setUpdatingId(null); }
  };

  const totalPending = summary.reduce((s, d) => s + (parseFloat(String(d.pending_amount)) || 0), 0);
  const totalPaid    = summary.reduce((s, d) => s + (parseFloat(String(d.paid_amount)) || 0), 0);
  const totalAll     = summary.reduce((s, d) => s + (parseFloat(String(d.total_amount)) || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Commissions</h2>
          <p className="text-slate-500 text-sm mt-0.5">Manage dealer commission payouts</p>
        </div>
        <button
          onClick={processWeek}
          disabled={processing}
          className="btn-primary flex items-center gap-2"
        >
          {processing ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Zap size={16} />}
          {processing ? 'Processing...' : "Process This Week's Commissions"}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Pending Payouts', value: `₹${totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, color: 'bg-amber-50 text-amber-600', icon: Clock },
          { label: 'Paid Out',        value: `₹${totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,    color: 'bg-emerald-50 text-emerald-600', icon: Check },
          { label: 'Total Earned',    value: `₹${totalAll.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,     color: 'bg-brand-50 text-brand-600', icon: DollarSign },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card p-4 flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
              <Icon size={18} />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">{label}</p>
              <p className="text-lg font-extrabold text-slate-900 mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Dealer Summary */}
      <div className="card">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-900">Commission Summary by Dealer</h3>
            <p className="text-slate-400 text-xs mt-0.5">All-time commission totals per dealer</p>
          </div>
          <button onClick={fetchData} className="btn-ghost p-2 text-slate-400 hover:text-slate-600">
            <RefreshCw size={16} />
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Dealer</th>
                  <th>Tier</th>
                  <th>Pending</th>
                  <th>Paid</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(d => (
                  <tr key={d.dealer_id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm">
                          {d.dealer_name?.[0]?.toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-900 text-sm">{d.dealer_name}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${d.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                        {d.dealer_tier === 1 ? <span className="flex items-center gap-1"><Star size={10} />Tier 1</span> : 'Sub-Dealer'}
                      </span>
                    </td>
                    <td className="font-semibold text-amber-600">
                      ₹{parseFloat(String(d.pending_amount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="font-semibold text-emerald-600">
                      ₹{parseFloat(String(d.paid_amount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="font-extrabold text-slate-900">
                      ₹{parseFloat(String(d.total_amount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {summary.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-400">No commission data yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Withdrawal Requests */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ArrowDownToLine size={18} className="text-brand-600" />
            <div>
              <h3 className="font-bold text-slate-900">Withdrawal Requests</h3>
              <p className="text-slate-400 text-xs mt-0.5">Approve or reject dealer withdrawal requests</p>
            </div>
          </div>
          <div className="relative">
            <select value={wFilter} onChange={e => setWFilter(e.target.value)} className="form-input appearance-none pr-8 min-w-32 text-sm">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Dealer</th>
                <th>Tier</th>
                <th>Amount</th>
                <th>UPI ID</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map(w => (
                <tr key={w.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xs">
                        {w.trader_name?.[0]?.toUpperCase()}
                      </div>
                      <span className="font-medium text-sm">{w.trader_name}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge text-xs ${w.trader_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                      {w.trader_tier === 1 ? <span className="flex items-center gap-1"><Star size={10} />Tier 1</span> : 'Sub-Dealer'}
                    </span>
                  </td>
                  <td className="font-bold text-emerald-600">
                    ₹{parseFloat(String(w.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="font-mono text-sm text-slate-600">{w.upi_id}</td>
                  <td>
                    <span className={`badge ${WITHDRAWAL_STATUS_COLORS[w.status] || 'bg-slate-100 text-slate-600'}`}>
                      {w.status}
                    </span>
                    {w.admin_notes && <p className="text-xs text-slate-400 mt-0.5">{w.admin_notes}</p>}
                  </td>
                  <td className="text-xs text-slate-400">{new Date(w.requested_at).toLocaleDateString('en-IN')}</td>
                  <td>
                    {w.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleWithdrawal(w, 'approved')}
                          disabled={updatingId === w.id}
                          className="btn-ghost text-xs text-emerald-600 hover:text-emerald-700 font-semibold"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            const notes = window.prompt('Reason for rejection (optional):') ?? '';
                            handleWithdrawal(w, 'rejected', notes);
                          }}
                          disabled={updatingId === w.id}
                          className="btn-ghost text-xs text-red-500 hover:text-red-600 font-semibold"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {w.status !== 'pending' && (
                      <span className="text-xs text-slate-400">
                        {w.processed_at ? new Date(w.processed_at).toLocaleDateString('en-IN') : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {withdrawals.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">No withdrawal requests</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payouts History */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-900">Payout History</h3>
            <p className="text-slate-400 text-xs mt-0.5">Weekly commission payouts</p>
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="form-input appearance-none pr-8 min-w-32 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="processed">Processed</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Dealer</th>
                <th>Tier</th>
                <th>Week</th>
                <th>Orders</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Processed At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map(p => (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xs">
                        {p.dealer_name?.[0]?.toUpperCase()}
                      </div>
                      <span className="font-medium text-sm text-slate-900">{p.dealer_name}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge text-xs ${p.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                      {p.dealer_tier === 1 ? 'Tier 1' : 'Sub-Dealer'}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500">
                    {new Date(p.week_start).toLocaleDateString('en-IN')} – {new Date(p.week_end).toLocaleDateString('en-IN')}
                  </td>
                  <td className="text-center text-sm font-medium">{p.order_count}</td>
                  <td className="font-bold text-emerald-600">
                    ₹{parseFloat(String(p.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td>
                    <span className={`badge ${PAYOUT_STATUS_COLORS[p.status] || 'bg-slate-100 text-slate-600'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="text-xs text-slate-400">
                    {p.processed_at ? new Date(p.processed_at).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td>
                    <button
                      onClick={() => togglePayoutStatus(p)}
                      disabled={updatingId === p.id}
                      className={`btn-ghost text-xs font-medium ${p.status === 'pending' ? 'text-emerald-600 hover:text-emerald-700' : 'text-amber-600 hover:text-amber-700'}`}
                    >
                      {updatingId === p.id
                        ? <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-current block" />
                        : p.status === 'pending' ? 'Mark Processed' : 'Mark Pending'
                      }
                    </button>
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400">
                    <AlertCircle size={32} className="mx-auto mb-2 opacity-30" />
                    <p>No payouts yet. Click "Process This Week's Commissions" to create payouts.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
