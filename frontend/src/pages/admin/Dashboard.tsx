import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import {
  Users, Package, ShoppingBag, TrendingUp, Wallet,
  AlertTriangle, ChevronRight, ArrowUpRight, ShieldAlert,
  RotateCcw, PackageX, ClipboardList, CheckCircle2, BarChart3,
} from 'lucide-react';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Line, ComposedChart,
} from 'recharts';
import { formatIstDate } from '../../utils/dateTime';

/* Field names match the /admin/stats response exactly. The previous
 * dashboard read consumerOrders / pendingCommissions / recentConsumerOrders,
 * which the API never sends — so those cards and the orders table always
 * rendered blank. The real keys are totalCOrders / pendingComm / recentCOrders. */
interface AdminStats {
  totalTraders: number;
  tier1Traders: number;
  tier2Traders: number;
  totalConsumers: number;
  totalProducts: number;
  lowStock: number;
  totalCOrders: number;
  revenue: number;
  pendingComm: number;
  recentCOrders: any[];
}

interface MonthlyPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

interface AlertItem { label: string; value: string }
interface Alert {
  key: string;
  severity: 'critical' | 'warning' | 'info';
  icon: 'dispute' | 'container' | 'stock' | 'order';
  title: string;
  detail: string;
  count: number;
  link: string;
  items: AlertItem[];
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700',
  confirmed:  'bg-blue-100 text-blue-700',
  processing: 'bg-purple-100 text-purple-700',
  shipped:    'bg-orange-100 text-orange-700',
  delivered:  'bg-emerald-100 text-emerald-700',
  cancelled:  'bg-red-100 text-red-700',
};

/* Severity → the full visual treatment for an alert row. Semantic colour is
 * reserved for exactly this: red = conflict, amber = owed action, blue =
 * routine queue. Nothing else on the page competes for these hues. */
const SEVERITY_STYLE: Record<Alert['severity'], { ring: string; iconWrap: string }> = {
  critical: { ring: 'border-red-200 hover:border-red-300',     iconWrap: 'bg-red-50 text-red-600' },
  warning:  { ring: 'border-amber-200 hover:border-amber-300', iconWrap: 'bg-amber-50 text-amber-600' },
  info:     { ring: 'border-blue-200 hover:border-blue-300',   iconWrap: 'bg-blue-50 text-blue-600' },
};

const ALERT_ICON: Record<Alert['icon'], React.ElementType> = {
  dispute:   ShieldAlert,
  container: RotateCcw,
  stock:     PackageX,
  order:     ClipboardList,
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
};

export default function AdminDashboard() {
  const [stats,   setStats]   = useState<AdminStats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [alerts,  setAlerts]  = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/admin/stats'),
      api.get('/admin/finance/monthly', { params: { months: 12 } }),
    ])
      .then(([s, m]) => { setStats(s.data); setMonthly(m.data.series || m.data || []); })
      .finally(() => setLoading(false));

    api.get('/admin/action-center')
      .then(r => setAlerts(r.data.alerts || []))
      .catch(() => {})
      .finally(() => setAlertsLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );
  if (!stats) return null;

  const statCards = [
    { label: 'Total Revenue',       value: inr(stats.revenue || 0),          sub: 'From delivered orders',   icon: TrendingUp,  color: 'emerald', link: '/admin/finance' },
    { label: 'Pending Commissions', value: inr(stats.pendingComm || 0), sub: 'To be paid out',        icon: Wallet,      color: 'amber',   link: '/admin/payouts' },
    { label: 'Consumer Orders',     value: stats.totalCOrders,             sub: 'Total placed',            icon: ShoppingBag, color: 'brand',   link: '/admin/consumer-orders' },
    { label: 'Partners',            value: stats.totalTraders,               sub: `${stats.tier1Traders} Tier 1 · ${stats.tier2Traders} Sub`, icon: Users, color: 'teal', link: '/admin/traders' },
  ];

  const colorMap: Record<string, string> = {
    brand:   'bg-brand-50 text-brand-600',
    teal:    'bg-teal-50 text-teal-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber:   'bg-amber-50 text-amber-600',
  };

  const chartData = monthly.map(m => ({ ...m, label: monthLabel(m.month) }));
  const thisMonth = monthly.length ? monthly[monthly.length - 1] : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-slate-500 text-sm mt-1">Your books, and anything that needs attention</p>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map(({ label, value, sub, icon: Icon, color, link }) => (
          <div
            key={label}
            onClick={() => link && navigate(link)}
            className={`card p-4 flex items-start gap-3 ${link ? 'cursor-pointer hover:shadow-card-hover transition-all' : ''}`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
              <Icon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-500 text-xs font-medium">{label}</p>
              <p className="text-xl font-extrabold text-slate-900 mt-0.5 truncate">{value}</p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Finance & Books ──────────────────────────────────────────── */}
        <div className="card p-5 lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Finance &amp; Books</h3>
              <p className="text-slate-400 text-xs mt-0.5">Income vs expense, and net, over 12 months</p>
            </div>
            <button
              onClick={() => navigate('/admin/finance')}
              className="btn-ghost text-brand-600 text-xs flex items-center gap-1 flex-shrink-0"
            >
              Open Finance <ChevronRight size={14} />
            </button>
          </div>

          {thisMonth && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
              <div>
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">This month net</p>
                <p className={`text-lg font-extrabold ${thisMonth.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {thisMonth.net >= 0 ? '+' : '−'}{inr(Math.abs(thisMonth.net))}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Income</p>
                <p className="text-lg font-bold text-slate-700">{inr(thisMonth.income)}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Expense</p>
                <p className="text-lg font-bold text-slate-700">{inr(thisMonth.expense)}</p>
              </div>
            </div>
          )}

          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee6d6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                       tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} width={38} />
                <Tooltip
                  formatter={(v: number, name: string) => [inr(v), name]}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e8dcc8', fontSize: '13px', background: '#fffbf2' }}
                  cursor={{ fill: 'rgba(180,160,120,0.08)' }}
                />
                <Legend iconSize={9} wrapperStyle={{ fontSize: '11px', paddingTop: 4 }} />
                <Bar dataKey="income"  name="Income"  fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="expense" name="Expense" fill="#e08a3c" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Line type="monotone" dataKey="net" name="Net" stroke="#1a6b2e" strokeWidth={2.5} dot={{ r: 2.5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-52 text-slate-400">
              <BarChart3 size={32} className="mb-2 opacity-30" />
              <p className="text-sm">No financial activity yet</p>
            </div>
          )}
        </div>

        {/* ── Action Center ────────────────────────────────────────────── */}
        <div className="card p-5 lg:col-span-2 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Action Center</h3>
              <p className="text-slate-400 text-xs mt-0.5">Everything that needs you, most urgent first</p>
            </div>
            {alerts.length > 0 && (
              <span className="flex-shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
                {alerts.length}
              </span>
            )}
          </div>

          {alertsLoading ? (
            <div className="flex-1 flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10 px-4">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <p className="font-semibold text-slate-700 text-sm">All clear</p>
              <p className="text-xs text-slate-400 mt-1 max-w-[15rem]">
                No disputes, no low stock, no refunds waiting. Nothing needs your attention right now.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map(a => {
                const s = SEVERITY_STYLE[a.severity];
                const Icon = ALERT_ICON[a.icon];
                return (
                  <button
                    key={a.key}
                    onClick={() => navigate(a.link)}
                    className={`w-full text-left rounded-xl border bg-white p-3.5 transition-all hover:shadow-sm ${s.ring}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.iconWrap}`}>
                        <Icon size={17} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900 text-sm leading-tight">{a.title}</p>
                          <ArrowUpRight size={13} className="text-slate-300 flex-shrink-0 ml-auto" />
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 leading-snug">{a.detail}</p>
                        {a.items.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {a.items.map((it, i) => (
                              <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-parchment-100 border border-[#e8dcc8] rounded-md px-1.5 py-0.5 text-slate-600">
                                <span className="truncate max-w-[8rem]">{it.label}</span>
                                <span className="font-semibold text-slate-800">{it.value}</span>
                              </span>
                            ))}
                            {a.count > a.items.length && (
                              <span className="text-[11px] text-slate-400 px-1 py-0.5">+{a.count - a.items.length} more</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Low-stock quick banner (kept: one-tap jump when stock is short) ── */}
      {stats.lowStock > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm cursor-pointer hover:bg-amber-100 transition-colors w-fit"
          onClick={() => navigate('/admin/inventory')}
        >
          <AlertTriangle size={15} />
          <span className="font-medium">{stats.lowStock} {stats.lowStock === 1 ? 'product is' : 'products are'} running low on stock</span>
          <ArrowUpRight size={13} />
        </div>
      )}

      {/* ── Recent Consumer Orders ───────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between p-5 border-b border-[#e8dcc8]">
          <div>
            <h3 className="font-bold text-slate-900 text-base">Recent Consumer Orders</h3>
            <p className="text-slate-400 text-xs mt-0.5">Latest orders from consumers</p>
          </div>
          <button onClick={() => navigate('/admin/consumer-orders')} className="btn-ghost text-brand-600 text-xs flex items-center gap-1">
            View all <ChevronRight size={14} />
          </button>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Consumer</th>
                <th>Partner</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {(stats.recentCOrders || []).map((o: any) => (
                <tr key={o.id}>
                  <td className="font-mono text-brand-600 font-medium text-xs">{o.order_number}</td>
                  <td>
                    <p className="font-medium text-slate-900 text-sm">{o.consumer_name}</p>
                    <p className="text-xs text-slate-400">{o.consumer_phone}</p>
                  </td>
                  <td>
                    <p className="text-sm text-slate-700">{o.dealer_name || '—'}</p>
                    {o.dealer_name && (
                      <span className={`badge text-xs ${o.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                        {o.dealer_tier === 1 ? 'Tier 1' : 'Sub-Dealer'}
                      </span>
                    )}
                  </td>
                  <td className="font-semibold">₹{parseFloat(o.total_amount).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600'}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="text-slate-400 text-xs">{formatIstDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(stats.recentCOrders || []).length === 0 && (
            <div className="text-center py-10 text-slate-400">
              <ShoppingBag size={32} className="mx-auto mb-2 opacity-30" />
              <p>No consumer orders yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Quick Links ──────────────────────────────────────────────────── */}
      <div>
        <h3 className="font-bold text-slate-900 mb-3">Quick Links</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Inventory',        icon: Package,      path: '/admin/inventory',         color: 'bg-emerald-50 text-emerald-600' },
            { label: 'Partners',         icon: Users,        path: '/admin/traders',           color: 'bg-brand-50 text-brand-600' },
            { label: 'Consumer Orders',  icon: ShoppingBag,  path: '/admin/consumer-orders',   color: 'bg-pink-50 text-pink-600' },
            { label: 'Payouts',          icon: Wallet,       path: '/admin/payouts',           color: 'bg-amber-50 text-amber-600' },
            { label: 'Finance',          icon: TrendingUp,   path: '/admin/finance',           color: 'bg-teal-50 text-teal-600' },
            { label: 'Containers',       icon: RotateCcw,    path: '/admin/container-finance',  color: 'bg-blue-50 text-blue-600' },
          ].map(({ label, icon: Icon, path, color }) => (
            <button
              key={label}
              onClick={() => navigate(path)}
              className="card p-4 flex flex-col items-center gap-2 hover:shadow-card-hover transition-all text-center"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
                <Icon size={18} />
              </div>
              <span className="text-xs font-semibold text-slate-700">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
