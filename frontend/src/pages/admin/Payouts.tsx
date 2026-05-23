import { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Landmark, Link2, Send, RefreshCw, AlertCircle, Check, Clock,
  Loader2, Wallet, Users as UsersIcon, UserCheck, ChevronRight,
} from 'lucide-react';

interface PayoutTrader {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  tier: number;
  status: string;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  razorpay_linked_account_id: string | null;
  razorpay_account_status: string | null;
  pending_amount: number;
  transferring_amount: number;
  transferred_amount: number;
  pending_count: number;
}

interface PendingCommission {
  id: number;
  trader_id: number;
  trader_name: string;
  amount: number;
  rate: number;
  type: string;
  status: 'pending' | 'transferring' | 'transfer_failed';
  razorpay_transfer_id: string | null;
  razorpay_linked_account_id: string | null;
  razorpay_account_status: string | null;
  razorpay_payment_id: string | null;
  order_number: string | null;
  order_amount: number | null;
  created_at: string;
}

const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const maskAccount = (acc: string | null) => {
  if (!acc) return '—';
  if (acc.length <= 4) return acc;
  return '•'.repeat(Math.max(0, acc.length - 4)) + acc.slice(-4);
};

const COMM_STATUS_STYLE: Record<string, string> = {
  pending:         'bg-amber-100 text-amber-700',
  transferring:    'bg-blue-100 text-blue-700',
  transfer_failed: 'bg-red-100 text-red-700',
  transferred:     'bg-emerald-100 text-emerald-700',
};

export default function AdminPayouts() {
  const [traders, setTraders]               = useState<PayoutTrader[]>([]);
  const [commissions, setCommissions]       = useState<PendingCommission[]>([]);
  const [loading, setLoading]               = useState(true);
  const [traderFilter, setTraderFilter]     = useState<number | ''>('');
  const [busyTraderId, setBusyTraderId]         = useState<number | null>(null);
  const [busyCommissionId, setBusyCommissionId] = useState<number | null>(null);
  const [busyStep, setBusyStep]                 = useState<string | null>(null);
  const [payingAll, setPayingAll]           = useState(false);

  const fetchAll = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (traderFilter) params.trader_id = String(traderFilter);
    Promise.all([
      api.get('/admin/payouts/traders'),
      api.get('/admin/payouts/pending-commissions', { params }),
    ])
      .then(([t, c]) => {
        setTraders(t.data.traders || []);
        setCommissions(c.data.commissions || []);
      })
      .catch(() => toast.error('Failed to load payouts'))
      .finally(() => setLoading(false));
  }, [traderFilter]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleOnboard = async (t: PayoutTrader) => {
    if (!t.bank_account_number || !t.bank_ifsc || !t.bank_account_name) {
      toast.error('Trader has not added bank details yet'); return;
    }
    if (!window.confirm(`Onboard ${t.name} to Razorpay Route? This will create their linked account, register bank details, and submit KYC.`)) return;
    setBusyTraderId(t.id);
    try {
      const { data } = await api.post('/payments/onboard', { trader_id: t.id });
      toast.success(`Onboarding complete — awaiting Razorpay activation`);
      console.log('[onboard] steps:', data.steps);
      fetchAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Onboarding failed');
    } finally {
      setBusyTraderId(null);
    }
  };

  const handleSyncStatus = async (t: PayoutTrader) => {
    setBusyStep(`${t.id}:sync`);
    try {
      const { data } = await api.post('/payments/sync-account', { trader_id: t.id });
      if (data.mapped_status === 'activated') {
        toast.success(`${t.name} is now activated!`);
      } else {
        toast(`Current status: ${data.razorpay_status || data.mapped_status}`, { icon: 'ℹ️' });
      }
      fetchAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to sync status');
    } finally {
      setBusyStep(null);
    }
  };

  const handlePayAll = async () => {
    const payable = commissions.filter(c =>
      c.status === 'pending' && c.razorpay_account_status === 'activated' && c.razorpay_payment_id && !c.razorpay_transfer_id
    );
    if (payable.length === 0) { toast.error('No commissions ready to pay out'); return; }
    if (!window.confirm(`Pay out ${payable.length} commission${payable.length === 1 ? '' : 's'} totalling ${inr(payable.reduce((s, c) => s + c.amount, 0))}?`)) return;
    setPayingAll(true);
    try {
      const { data } = await api.post('/payments/pay-all');
      if (data.transferred > 0) toast.success(`${data.transferred} payout${data.transferred === 1 ? '' : 's'} initiated`);
      if (data.skipped > 0)     toast(`${data.skipped} skipped (account not activated)`, { icon: 'ℹ️' });
      if (data.errors?.length)  toast.error(`${data.errors.length} failed — check console`);
      fetchAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Pay all failed');
    } finally {
      setPayingAll(false);
    }
  };

  const handleTransfer = async (c: PendingCommission) => {
    if (!c.razorpay_linked_account_id) { toast.error('Trader has no linked account'); return; }
    if (!c.razorpay_payment_id)         { toast.error('Source payment not captured'); return; }
    if (!window.confirm(`Transfer ${inr(c.amount)} to ${c.trader_name} for order ${c.order_number}?`)) return;
    setBusyCommissionId(c.id);
    try {
      const { data } = await api.post('/payments/transfer', { commission_id: c.id });
      toast.success(`Transfer initiated (${data.transfer_id})`);
      fetchAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Transfer failed');
    } finally {
      setBusyCommissionId(null);
    }
  };

  const totalPending      = traders.reduce((s, t) => s + (Number(t.pending_amount) || 0), 0);
  const totalTransferring = traders.reduce((s, t) => s + (Number(t.transferring_amount) || 0), 0);
  const totalTransferred  = traders.reduce((s, t) => s + (Number(t.transferred_amount) || 0), 0);
  const linkedCount       = traders.filter(t => t.razorpay_linked_account_id).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Razorpay Payouts</h2>
          <p className="text-slate-500 text-sm mt-0.5">Manage trader bank accounts and transfer commissions via Razorpay Route</p>
        </div>
        <button onClick={fetchAll} className="btn-ghost p-2 text-slate-400 hover:text-slate-600">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Pending', value: inr(totalPending), color: 'bg-amber-50 text-amber-600', icon: Clock },
          { label: 'In Transfer', value: inr(totalTransferring), color: 'bg-blue-50 text-blue-600', icon: Send },
          { label: 'Transferred', value: inr(totalTransferred), color: 'bg-emerald-50 text-emerald-600', icon: Check },
          { label: 'Linked Accounts', value: `${linkedCount} / ${traders.length}`, color: 'bg-brand-50 text-brand-600', icon: Link2 },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card p-4 flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 font-medium">{label}</p>
              <p className="text-lg font-extrabold text-slate-900 mt-0.5 truncate">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Traders + bank info */}
      <div className="card">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UsersIcon size={18} className="text-brand-600" />
            <div>
              <h3 className="font-bold text-slate-900">Partners & Bank Accounts</h3>
              <p className="text-slate-400 text-xs mt-0.5">Create Razorpay linked accounts once bank details are filled</p>
            </div>
          </div>
        </div>

        {loading && traders.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Bank</th>
                  <th>Account</th>
                  <th>IFSC</th>
                  <th>Linked Account</th>
                  <th>Pending</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {traders.map(t => {
                  const hasBank    = !!(t.bank_account_number && t.bank_ifsc && t.bank_account_name);
                  const status     = t.razorpay_account_status;
                  const linked     = !!t.razorpay_linked_account_id;
                  const activated  = status === 'activated';
                  const syncBusy = busyStep === `${t.id}:sync`;

                  const statusBadge = () => {
                    if (!hasBank)   return <span className="badge bg-slate-100 text-slate-500">No bank details</span>;
                    if (!linked)    return <span className="badge bg-amber-100 text-amber-700">Not onboarded</span>;
                    if (status === 'created')           return <span className="badge bg-blue-100 text-blue-700">Account created</span>;
                    if (status === 'bank_added')        return <span className="badge bg-indigo-100 text-indigo-700">Bank registered</span>;
                    if (status === 'stakeholder_added') return <span className="badge bg-purple-100 text-purple-700">KYC submitted</span>;
                    if (status === 'under_review')      return <span className="badge bg-amber-100 text-amber-700">Under review</span>;
                    if (activated) return (
                      <div className="flex flex-col gap-0.5">
                        <span className="badge bg-emerald-100 text-emerald-700 w-fit"><Check size={10} /> Active</span>
                        <span className="text-xs font-mono text-slate-400">{t.razorpay_linked_account_id}</span>
                      </div>
                    );
                    return <span className="badge bg-slate-100 text-slate-500">{status || 'unknown'}</span>;
                  };

                  const actionButton = () => {
                    if (!hasBank) return <span className="text-xs text-slate-400">Needs bank details</span>;
                    if (activated) return (
                      <button
                        onClick={() => setTraderFilter(t.id)}
                        className="flex items-center gap-1 btn-ghost text-xs text-brand-600 hover:text-brand-700 font-semibold"
                      >
                        View commissions <ChevronRight size={12} />
                      </button>
                    );
                    // Awaiting Razorpay to activate after KYC submitted — show sync button
                    if (status === 'stakeholder_added' || status === 'under_review') return (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-slate-400 italic">Awaiting Razorpay…</span>
                        <button
                          onClick={() => handleSyncStatus(t)}
                          disabled={syncBusy}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {syncBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {syncBusy ? 'Checking…' : 'Sync Status'}
                        </button>
                      </div>
                    );
                    // Not yet onboarded or partially done — single onboard button
                    return (
                      <button
                        onClick={() => handleOnboard(t)}
                        disabled={busyTraderId === t.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {busyTraderId === t.id ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
                        {busyTraderId === t.id ? 'Onboarding…' : linked ? 'Resume Onboarding' : 'Onboard to Razorpay'}
                      </button>
                    );
                  };

                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm">
                            {t.name?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 text-sm">{t.name}</p>
                            <p className="text-xs text-slate-400">{t.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-sm text-slate-700">{t.bank_account_name || <span className="text-slate-400">—</span>}</td>
                      <td className="font-mono text-sm">{maskAccount(t.bank_account_number)}</td>
                      <td className="font-mono text-sm">{t.bank_ifsc || <span className="text-slate-400">—</span>}</td>
                      <td>{statusBadge()}</td>
                      <td className="font-semibold text-amber-600">
                        {inr(t.pending_amount)}
                        {t.pending_count > 0 && (
                          <span className="block text-xs font-normal text-slate-400">{t.pending_count} commission{t.pending_count === 1 ? '' : 's'}</span>
                        )}
                      </td>
                      <td>{actionButton()}</td>
                    </tr>
                  );
                })}
                {traders.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400">No traders found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending commissions */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Wallet size={18} className="text-brand-600" />
            <div>
              <h3 className="font-bold text-slate-900">Pending Commissions</h3>
              <p className="text-slate-400 text-xs mt-0.5">Trigger Route transfers per commission. Requires Razorpay Route activation.</p>
            </div>
          </div>
          <button
            onClick={handlePayAll}
            disabled={payingAll}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors disabled:opacity-50"
          >
            {payingAll ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {payingAll ? 'Processing…' : 'Pay All'}
          </button>
          {traderFilter !== '' && (
            <button
              onClick={() => setTraderFilter('')}
              className="btn-ghost text-xs text-slate-500 hover:text-slate-700"
            >
              Clear filter ({traders.find(t => t.id === traderFilter)?.name})
            </button>
          )}
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Partner</th>
                <th>Type</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map(c => {
                const canTransfer =
                  c.status === 'pending' &&
                  c.razorpay_account_status === 'activated' &&
                  !!c.razorpay_linked_account_id &&
                  !!c.razorpay_payment_id &&
                  !c.razorpay_transfer_id;
                const blockedReason =
                  !c.razorpay_linked_account_id             ? 'No linked account' :
                  c.razorpay_account_status !== 'activated' ? `Account ${c.razorpay_account_status || 'not activated'}` :
                  !c.razorpay_payment_id                    ? 'Order not paid'    :
                  c.status !== 'pending'                    ? `Status: ${c.status}` : '';
                return (
                  <tr key={c.id}>
                    <td className="font-mono text-xs">{c.order_number || '—'}</td>
                    <td className="text-sm text-slate-700">{c.trader_name}</td>
                    <td>
                      <span className={`badge ${c.type === 'override' ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'}`}>
                        {c.type}
                      </span>
                    </td>
                    <td className="text-sm text-slate-500">{c.rate}%</td>
                    <td className="font-bold text-emerald-600">{inr(c.amount)}</td>
                    <td>
                      <span className={`badge ${COMM_STATUS_STYLE[c.status] || 'bg-slate-100 text-slate-600'}`}>
                        {c.status}
                      </span>
                      {c.razorpay_transfer_id && (
                        <p className="text-xs font-mono text-slate-400 mt-0.5">{c.razorpay_transfer_id}</p>
                      )}
                    </td>
                    <td className="text-xs text-slate-400">{new Date(c.created_at).toLocaleDateString('en-IN')}</td>
                    <td>
                      {canTransfer ? (
                        <button
                          onClick={() => handleTransfer(c)}
                          disabled={busyCommissionId === c.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {busyCommissionId === c.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Send size={12} />}
                          {busyCommissionId === c.id ? 'Transferring...' : 'Transfer'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400" title={blockedReason}>{blockedReason || '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {commissions.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400">
                    <AlertCircle size={32} className="mx-auto mb-2 opacity-30" />
                    <p>No pending commissions{traderFilter ? ' for this trader' : ''}.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footnote */}
      <div className="card p-4 bg-slate-50 border-dashed">
        <p className="text-xs text-slate-500 leading-relaxed flex items-start gap-2">
          <Landmark size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Note:</strong> Razorpay Route must be activated on your merchant account before linked-account creation and transfers will succeed. Each transfer is funded from the captured consumer payment. Webhook events (<code>transfer.processed</code>, <code>transfer.failed</code>) update commission status automatically.
          </span>
        </p>
      </div>
    </div>
  );
}
