import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import {
  Users, Package, ShoppingCart, ShoppingBag, DollarSign, TrendingUp,
  AlertTriangle, Clock, ChevronRight, BarChart3, ArrowUpRight, Wallet,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

interface AdminStats {
  totalTraders: number;
  tier1Traders: number;
  tier2Traders: number;
  totalConsumers: number;
  totalProducts: number;
  lowStock: number;
  totalOrders: number;
  consumerOrders: number;
  revenue: number;
  pendingCommissions: number;
  pendingOrders: number;
  recentConsumerOrders: any[];
  categoryStats: any[];
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700',
  confirmed:  'bg-blue-100 text-blue-700',
  processing: 'bg-purple-100 text-purple-700',
  shipped:    'bg-orange-100 text-orange-700',
  delivered:  'bg-emerald-100 text-emerald-700',
  cancelled:  'bg-red-100 text-red-700',
};

const PIE_COLORS = ['#2563eb','#0d9488','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316'];

export default function AdminDashboard() {
  const [stats,   setStats]   = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/admin/stats').then(r => setStats(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );
  if (!stats) return null;

  const statCards = [
    { label: 'Total Traders',       value: stats.totalTraders,  sub: `${stats.tier1Traders} Tier 1 · ${stats.tier2Traders} Sub-Dealers`, icon: Users,        color: 'brand',   link: '/admin/traders' },
    { label: 'Consumers',           value: stats.totalConsumers, sub: 'Registered consumers',                                            icon: Users,        color: 'teal',    link: '/admin/consumer-orders' },
    { label: 'Products',            value: stats.totalProducts, sub: `${stats.lowStock} low stock`,                                      icon: Package,      color: 'emerald', link: '/admin/inventory' },
    { label: 'B2B Orders',          value: stats.totalOrders,   sub: `${stats.pendingOrders} pending`,                                   icon: ShoppingCart, color: 'violet',  link: '/admin/orders' },
    { label: 'Consumer Orders',     value: stats.consumerOrders, sub: 'Total placed',                                                    icon: ShoppingBag,  color: 'pink',    link: '/admin/consumer-orders' },
    { label: 'Total Revenue',       value: `₹${stats.revenue?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '0.00'}`, sub: 'From delivered orders', icon: TrendingUp, color: 'gold', link: null },
    { label: 'Pending Commissions', value: `₹${stats.pendingCommissions?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '0.00'}`, sub: 'To be paid out', icon: Wallet, color: 'amber', link: '/admin/commissions' },
  ];

  const colorMap: Record<string, string> = {
    brand:   'bg-brand-50 text-brand-600',
    teal:    'bg-teal-50 text-teal-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet:  'bg-violet-50 text-violet-600',
    pink:    'bg-pink-50 text-pink-600',
    gold:    'bg-yellow-50 text-yellow-600',
    amber:   'bg-amber-50 text-amber-600',
  };

  // Build bar chart data from category stats
  const barData = (stats.categoryStats || []).map((c: any) => ({
    category: c.category?.length > 10 ? c.category.substring(0, 10) + '...' : c.category,
    count: c.count,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-slate-500 text-sm mt-1">Overview of your TradeHub platform activity</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
              <p className="text-xl font-extrabold text-slate-900 mt-0.5">{value}</p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{sub}</p>
            </div>
            {link && <ChevronRight size={16} className="text-slate-300 flex-shrink-0 mt-1" />}
          </div>
        ))}
      </div>

      {/* Alerts */}
      {(stats.lowStock > 0 || stats.pendingOrders > 0) && (
        <div className="flex flex-wrap gap-3">
          {stats.lowStock > 0 && (
            <div
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm cursor-pointer hover:bg-amber-100 transition-colors"
              onClick={() => navigate('/admin/inventory')}
            >
              <AlertTriangle size={15} />
              <span className="font-medium">{stats.lowStock} products running low on stock</span>
              <ArrowUpRight size={13} />
            </div>
          )}
          {stats.pendingOrders > 0 && (
            <div
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-sm cursor-pointer hover:bg-blue-100 transition-colors"
              onClick={() => navigate('/admin/orders')}
            >
              <Clock size={15} />
              <span className="font-medium">{stats.pendingOrders} B2B orders need attention</span>
              <ArrowUpRight size={13} />
            </div>
          )}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Category Bar Chart */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Inventory by Category</h3>
              <p className="text-slate-400 text-xs mt-0.5">Products per category</p>
            </div>
            <button onClick={() => navigate('/admin/inventory')} className="btn-ghost text-brand-600 text-xs">View all <ChevronRight size={14} /></button>
          </div>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: any) => [v, 'Products']}
                  contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                />
                <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400">
              <BarChart3 size={32} className="mb-2 opacity-30" />
              <p className="text-sm">No category data yet</p>
            </div>
          )}
        </div>

        {/* Category Pie */}
        <div className="card p-5">
          <div className="mb-4">
            <h3 className="font-bold text-slate-900 text-base">Category Distribution</h3>
            <p className="text-slate-400 text-xs mt-0.5">Product breakdown</p>
          </div>
          {(stats.categoryStats || []).length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={stats.categoryStats} dataKey="count" nameKey="category" cx="50%" cy="50%" outerRadius={65} stroke="none">
                  {(stats.categoryStats || []).map((_: any, i: number) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '10px', fontSize: '12px' }} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400">
              <BarChart3 size={32} className="mb-2 opacity-30" />
              <p className="text-sm">No data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent Consumer Orders */}
      <div className="card">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
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
                <th>Dealer</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {(stats.recentConsumerOrders || []).map((o: any) => (
                <tr key={o.id}>
                  <td className="font-mono text-brand-600 font-medium text-xs">{o.order_number}</td>
                  <td>
                    <p className="font-medium text-slate-900 text-sm">{o.consumer_name}</p>
                    <p className="text-xs text-slate-400">{o.consumer_phone}</p>
                  </td>
                  <td>
                    <p className="text-sm text-slate-700">{o.dealer_name}</p>
                    <span className={`badge text-xs ${o.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                      {o.dealer_tier === 1 ? 'Tier 1' : 'Sub-Dealer'}
                    </span>
                  </td>
                  <td className="font-semibold">₹{parseFloat(o.total_amount).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600'}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="text-slate-400 text-xs">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(stats.recentConsumerOrders || []).length === 0 && (
            <div className="text-center py-10 text-slate-400">
              <ShoppingBag size={32} className="mx-auto mb-2 opacity-30" />
              <p>No consumer orders yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h3 className="font-bold text-slate-900 mb-3">Quick Links</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Inventory',        icon: Package,      path: '/admin/inventory',       color: 'bg-emerald-50 text-emerald-600' },
            { label: 'Traders',          icon: Users,        path: '/admin/traders',         color: 'bg-brand-50 text-brand-600' },
            { label: 'B2B Orders',       icon: ShoppingCart, path: '/admin/orders',          color: 'bg-violet-50 text-violet-600' },
            { label: 'Consumer Orders',  icon: ShoppingBag,  path: '/admin/consumer-orders', color: 'bg-pink-50 text-pink-600' },
            { label: 'Commissions',      icon: DollarSign,   path: '/admin/commissions',     color: 'bg-amber-50 text-amber-600' },
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
