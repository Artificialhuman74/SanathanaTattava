import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, RefreshCcw,
  Info, ShoppingBag, Package, ChevronLeft,
} from 'lucide-react';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import { formatIstDate } from '../../utils/dateTime';

interface LedgerEntry {
  id: number;
  delta: number;
  reason: string | null;
  source_type: string | null;
  source_id: number | null;
  created_at: string;
}

interface WalletResponse {
  balance: number;
  ledger: LedgerEntry[];
}

export default function ConsumerWallet() {
  const { consumer, consumerLogout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WalletResponse | null>(null);
  const [filter, setFilter] = useState<'all' | 'credit' | 'debit'>('all');

  const load = useCallback(() => {
    if (!consumer) { navigate('/shop/login', { replace: true }); return; }
    setLoading(true);
    consumerApi.get<WalletResponse>('/consumer/store-credit')
      .then(r => setData(r.data))
      .catch(err => {
        if (err.response?.status === 401) {
          consumerLogout();
          navigate('/shop/login', { replace: true });
        } else {
          toast.error('Failed to load wallet');
        }
      })
      .finally(() => setLoading(false));
  }, [consumer]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const balance = data?.balance ?? 0;
  const ledger = data?.ledger ?? [];

  const totalEarned = ledger.filter(e => e.delta > 0).reduce((s, e) => s + e.delta, 0);
  const totalSpent  = ledger.filter(e => e.delta < 0).reduce((s, e) => s + Math.abs(e.delta), 0);

  const filtered = ledger.filter(e =>
    filter === 'all' ? true :
    filter === 'credit' ? e.delta > 0 :
    e.delta < 0
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Hero / Balance Card ─────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-emerald-700 via-emerald-600 to-emerald-500 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 pb-8">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 text-emerald-50 hover:text-white text-sm"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="p-2 rounded-full hover:bg-white/10 transition disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-5 h-5" />
            <p className="text-sm font-medium tracking-wide uppercase opacity-90">My Wallet</p>
          </div>

          <p className="text-5xl sm:text-6xl font-extrabold tracking-tight">
            ₹{balance.toFixed(2)}
          </p>
          <p className="text-sm text-emerald-50 mt-2">Available store credit</p>

          {/* Stats strip */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/10 backdrop-blur-sm px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-emerald-50/80 font-semibold">Total earned</p>
              <p className="text-lg font-bold mt-0.5">₹{totalEarned.toFixed(2)}</p>
            </div>
            <div className="rounded-xl bg-white/10 backdrop-blur-sm px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-emerald-50/80 font-semibold">Total used</p>
              <p className="text-lg font-bold mt-0.5">₹{totalSpent.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 -mt-4">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Info className="w-4.5 h-4.5 text-emerald-600" />
          </div>
          <div className="text-xs text-slate-600 leading-relaxed">
            <p className="font-semibold text-slate-800 text-sm mb-0.5">How store credit works</p>
            Credit is added when you return a container and choose <span className="font-medium text-emerald-700">"Store credit"</span> as the refund destination.
            It can be applied to any future order at checkout — no expiry, no minimum.
          </div>
        </div>
      </div>

      {/* ── Quick actions ───────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 mt-4 grid grid-cols-2 gap-3">
        <Link
          to="/shop"
          className="rounded-xl bg-white border border-slate-200 p-3 flex items-center gap-3 active:bg-slate-50 transition"
        >
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
            <ShoppingBag className="w-4.5 h-4.5 text-amber-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Shop now</p>
            <p className="text-[11px] text-slate-500">Use your credit</p>
          </div>
        </Link>
        <Link
          to="/shop/containers"
          className="rounded-xl bg-white border border-slate-200 p-3 flex items-center gap-3 active:bg-slate-50 transition"
        >
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Package className="w-4.5 h-4.5 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">My containers</p>
            <p className="text-[11px] text-slate-500">Return to earn credit</p>
          </div>
        </Link>
      </div>

      {/* ── Transaction list ───────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 mt-6 pb-12">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Transactions</h2>
          <div className="flex bg-slate-100 rounded-full p-0.5">
            {(['all', 'credit', 'debit'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${
                  filter === f
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {f === 'all' ? 'All' : f === 'credit' ? 'Added' : 'Used'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <Wallet className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-sm font-semibold text-slate-800">
              {ledger.length === 0 ? 'No transactions yet' : 'No matching transactions'}
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
              {ledger.length === 0
                ? 'Return a container and choose "Store credit" to start your wallet.'
                : 'Try a different filter.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map(e => (
              <TxRow key={e.id} entry={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TxRow({ entry }: { entry: LedgerEntry }) {
  const positive = entry.delta > 0;
  const label = entry.reason
    || (positive ? 'Credit added' : 'Credit applied');
  return (
    <li className="rounded-xl bg-white border border-slate-200 px-3 py-3 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center ${
        positive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
      }`}>
        {positive
          ? <ArrowDownCircle className="w-5 h-5" />
          : <ArrowUpCircle className="w-5 h-5" />
        }
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 truncate">{label}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {formatIstDate(entry.created_at)}
          {entry.source_type && ` · ${sourceLabel(entry.source_type)}`}
        </p>
      </div>
      <span className={`text-base font-bold flex-shrink-0 ${positive ? 'text-emerald-700' : 'text-slate-700'}`}>
        {positive ? '+' : '−'}₹{Math.abs(entry.delta).toFixed(2)}
      </span>
    </li>
  );
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'container_refund':  return 'Container refund';
    case 'order_redemption':  return 'Used at checkout';
    case 'admin_adjustment':  return 'Adjustment';
    default:                  return s;
  }
}
