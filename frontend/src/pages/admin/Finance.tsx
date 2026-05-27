import React, { useEffect, useMemo, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  TrendingUp, TrendingDown, Download, Plus, Trash2,
  ShoppingBag, Users, BarChart3, Warehouse, IndianRupee, X, Package,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line,
} from 'recharts';
import * as XLSX from 'xlsx';

/* ── Types ─────────────────────────────────────────────────────────────── */
interface Summary {
  month: string;
  income: {
    total: number;
    consumer_orders:  { amount: number; count: number };
    manual:           { amount: number; count: number };
    trader_payments:  { amount: number; count: number };
    container_forfeits?: { amount: number; count: number };
  };
  expense: {
    total: number; restock: number; commission: number;
    container_payouts?: {
      amount: number;
      driver_reimbursed: { amount: number; count: number };
      manual_refunds:    { amount: number; count: number };
      store_credit:      { amount: number; count: number };
    };
  };
  net: number;
}
interface ConsumerOrderRow {
  id: number; order_number: string; total_amount: number; subtotal: number;
  container_costs_total: number; discount_amount: number;
  status: string; payment_status: string; created_at: string;
  consumer_name: string; consumer_phone: string; linked_dealer_name: string | null;
}
interface TraderSalesRow {
  trader_id: number; trader_name: string; trader_tier: number;
  order_count: number; gross_sales: number; commission_earned: number;
}
interface MonthlyPoint {
  month: string;
  income_consumer: number; income_manual: number; income_trader_payment: number;
  expense_restock: number; expense_commission: number;
  income: number; expense: number; net: number;
}
interface RestockExpenseRow {
  trader_id: number; trader_name: string; trader_tier: number;
  product_id: number; product_name: string; sku: string; unit: string;
  cost_price: number; total_qty: number; expense: number;
}
interface ManualIncomeEntry {
  id: number; source: string; description: string | null;
  amount: number; recorded_date: string; created_at: string;
}
interface TraderPayment {
  id: number; trader_id: number; trader_name: string; trader_tier: number;
  amount: number; payment_date: string; notes: string | null; created_at: string;
}
interface TraderOption { id: number; name: string; tier: number; phone: string }

type Tab = 'overview' | 'consumer' | 'traders' | 'restock' | 'containers';

/* ── Helpers ───────────────────────────────────────────────────────────── */
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
};
const todayMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const todayDate = () => new Date().toISOString().slice(0, 10);

function downloadXlsx(filename: string, sheets: { name: string; rows: any[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

/* ── Component ─────────────────────────────────────────────────────────── */
export default function AdminFinance() {
  const [tab, setTab]     = useState<Tab>('overview');
  const [month, setMonth] = useState<string>(todayMonth());

  const [summary, setSummary]   = useState<Summary | null>(null);
  const [monthly, setMonthly]   = useState<MonthlyPoint[]>([]);
  const [orders, setOrders]     = useState<ConsumerOrderRow[]>([]);
  const [tSales, setTSales]     = useState<TraderSalesRow[]>([]);
  const [restock, setRestock]   = useState<RestockExpenseRow[]>([]);
  const [manual, setManual]     = useState<ManualIncomeEntry[]>([]);
  const [payments, setPayments] = useState<TraderPayment[]>([]);
  const [traders, setTraders]   = useState<TraderOption[]>([]);
  const [loading, setLoading]   = useState(true);

  const [showAddIncome,  setShowAddIncome]  = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);

  const fetchAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/admin/finance/summary',         { params: { month } }),
      api.get('/admin/finance/monthly',         { params: { months: 12 } }),
      api.get('/admin/finance/consumer-orders', { params: { month } }),
      api.get('/admin/finance/trader-sales',    { params: { month } }),
      api.get('/admin/finance/restock-expense', { params: { month } }),
      api.get('/admin/finance/manual-income',   { params: { month } }),
      api.get('/admin/finance/trader-payments', { params: { month } }),
      api.get('/admin/finance/traders'),
    ]).then(([s, mo, co, ts, rs, mi, tp, tr]) => {
      setSummary(s.data);
      setMonthly(mo.data.series || []);
      setOrders(co.data.orders || []);
      setTSales(ts.data.traders || []);
      setRestock(rs.data.rows || []);
      setManual(mi.data.entries || []);
      setPayments(tp.data.payments || []);
      setTraders(tr.data.traders || []);
    }).catch(() => toast.error('Failed to load finance data'))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── Exports ─────────────────────────────────────────────────────────── */
  const exportConsumerOrders = () => {
    downloadXlsx(`consumer-orders-${month}.xlsx`, [{
      name: 'Consumer Orders',
      rows: orders.map(o => ({
        'Order #': o.order_number,
        'Date': new Date(o.created_at).toLocaleString('en-IN'),
        'Consumer': o.consumer_name,
        'Phone': o.consumer_phone,
        'Linked Partner': o.linked_dealer_name || '—',
        'Subtotal': o.subtotal,
        'Container': o.container_costs_total,
        'Discount': o.discount_amount,
        'Total (₹)': o.total_amount,
        'Order Status': o.status,
        'Payment': o.payment_status,
      })),
    }]);
  };
  const exportTraderSales = () => {
    downloadXlsx(`trader-sales-${month}.xlsx`, [{
      name: 'Trader Sales',
      rows: tSales.map(t => ({
        'Partner': t.trader_name,
        'Tier': t.trader_tier === 1 ? 'Tier 1' : 'Sub-Partner',
        'Orders': t.order_count,
        'Gross Sales (₹)': t.gross_sales,
        'Commission Earned (₹)': t.commission_earned,
      })),
    }]);
  };
  const exportMonthly = () => {
    downloadXlsx(`monthly-pnl-12mo.xlsx`, [{
      name: 'Monthly P&L',
      rows: monthly.map(m => ({
        'Month': m.month,
        'Consumer Orders (₹)': m.income_consumer,
        'Manual Income (₹)': m.income_manual,
        'Partner Payments (₹)': m.income_trader_payment,
        'Total Income (₹)': m.income,
        'Restock Cost (₹)': m.expense_restock,
        'Commission (₹)': m.expense_commission,
        'Total Expense (₹)': m.expense,
        'Net (₹)': m.net,
      })),
    }]);
  };
  const exportRestock = () => {
    downloadXlsx(`restock-expense-${month}.xlsx`, [{
      name: 'Restock Expense',
      rows: restock.map(r => ({
        'Partner': r.trader_name,
        'Tier': r.trader_tier === 1 ? 'Tier 1' : 'Sub-Partner',
        'Product': r.product_name,
        'SKU': r.sku,
        'Cost Price (₹)': r.cost_price,
        'Quantity': r.total_qty,
        'Unit': r.unit,
        'Expense (₹)': r.expense,
      })),
    }]);
  };

  /* ── Add forms submit ────────────────────────────────────────────────── */
  const addManualIncome = async (form: { source: string; description: string; amount: string; recorded_date: string }) => {
    try {
      await api.post('/admin/finance/manual-income', {
        source: form.source.trim(),
        description: form.description.trim() || null,
        amount: Number(form.amount),
        recorded_date: form.recorded_date,
      });
      toast.success('Income logged');
      setShowAddIncome(false);
      fetchAll();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to log'); }
  };
  const addTraderPayment = async (form: { trader_id: number; amount: string; payment_date: string; notes: string }) => {
    try {
      await api.post('/admin/finance/trader-payments', {
        trader_id: form.trader_id,
        amount: Number(form.amount),
        payment_date: form.payment_date,
        notes: form.notes.trim() || null,
      });
      toast.success('Partner payment logged');
      setShowAddPayment(false);
      fetchAll();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to log'); }
  };

  const deleteManual = async (id: number) => {
    if (!confirm('Delete this income entry?')) return;
    await api.delete(`/admin/finance/manual-income/${id}`);
    fetchAll();
  };
  const deletePayment = async (id: number) => {
    if (!confirm('Delete this payment entry?')) return;
    await api.delete(`/admin/finance/trader-payments/${id}`);
    fetchAll();
  };

  /* ── Render ──────────────────────────────────────────────────────────── */
  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'overview',   label: 'Overview',        icon: BarChart3 },
    { key: 'consumer',   label: 'Consumer Orders', icon: ShoppingBag },
    { key: 'traders',    label: 'Partner Sales',   icon: Users },
    { key: 'restock',    label: 'Restock Expense', icon: Warehouse },
    { key: 'containers', label: 'Container Finance', icon: Package },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Finance & Books</h2>
          <p className="text-slate-500 text-sm mt-0.5">Track income, expenses, and partner-wise activity by month</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Month</label>
          <input
            type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="form-input py-1.5 text-sm"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit flex-wrap">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors
              ${tab === key ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
        </div>
      )}

      {/* ────────────── OVERVIEW ────────────── */}
      {!loading && tab === 'overview' && summary && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard
              label="Total Income"     value={inr(summary.income.total)}
              tone="emerald" icon={TrendingUp}
              sub={`${summary.income.consumer_orders.count} consumer orders`}
            />
            <KpiCard
              label="Total Expense"    value={inr(summary.expense.total)}
              tone="red" icon={TrendingDown}
              sub={`${inr(summary.expense.restock)} restock + ${inr(summary.expense.commission)} commission`}
            />
            <KpiCard
              label="Net"              value={inr(summary.net)}
              tone={summary.net >= 0 ? 'emerald' : 'red'} icon={IndianRupee}
              sub={summary.net >= 0 ? 'Profit' : 'Loss'}
            />
          </div>

          {/* Income breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <h3 className="font-semibold text-slate-900 mb-3">Income breakdown ({monthLabel(month)})</h3>
              <Breakdown rows={[
                { label: 'Consumer orders',    value: summary.income.consumer_orders.amount, color: 'bg-emerald-500' },
                { label: 'Partner payments',   value: summary.income.trader_payments.amount, color: 'bg-indigo-500' },
                { label: 'Manual / misc.',     value: summary.income.manual.amount,          color: 'bg-amber-500' },
                { label: 'Container forfeits retained', value: summary.income.container_forfeits?.amount || 0, color: 'bg-teal-500' },
              ]} total={summary.income.total} />
            </div>
            <div className="card p-4">
              <h3 className="font-semibold text-slate-900 mb-3">Expense breakdown ({monthLabel(month)})</h3>
              <Breakdown rows={[
                { label: 'Restock cost',     value: summary.expense.restock,    color: 'bg-rose-500' },
                { label: 'Commissions',      value: summary.expense.commission, color: 'bg-orange-500' },
                { label: 'Driver reimbursements', value: summary.expense.container_payouts?.driver_reimbursed.amount || 0, color: 'bg-amber-600' },
                { label: 'Manual refunds',        value: summary.expense.container_payouts?.manual_refunds.amount    || 0, color: 'bg-emerald-600' },
                { label: 'Store credit issued',   value: summary.expense.container_payouts?.store_credit.amount      || 0, color: 'bg-violet-500' },
              ]} total={summary.expense.total} />
            </div>
          </div>

          {/* 12-month chart */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-900">Last 12 months — income vs expense</h3>
              <button onClick={exportMonthly} className="btn-ghost text-xs flex items-center gap-1.5">
                <Download size={14} /> Export Excel
              </button>
            </div>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={monthly.map(m => ({ ...m, label: monthLabel(m.month) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Legend />
                  <Bar dataKey="income"  name="Income"  fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ width: '100%', height: 240 }} className="mt-4">
              <ResponsiveContainer>
                <LineChart data={monthly.map(m => ({ ...m, label: monthLabel(m.month) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="net" name="Net" stroke="#0ea5e9" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Manual income */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-900">Manual / misc income — {monthLabel(month)}</h3>
              <button onClick={() => setShowAddIncome(true)} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
                <Plus size={14} /> Log income
              </button>
            </div>
            {manual.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No misc income logged for this month.</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Date</th><th>Source</th><th>Description</th><th className="text-right">Amount</th><th></th></tr></thead>
                  <tbody>
                    {manual.map(m => (
                      <tr key={m.id}>
                        <td className="text-sm text-slate-500">{m.recorded_date}</td>
                        <td className="text-sm font-medium">{m.source}</td>
                        <td className="text-sm text-slate-500">{m.description || '—'}</td>
                        <td className="text-right font-semibold text-emerald-600">{inr(m.amount)}</td>
                        <td>
                          <button onClick={() => deleteManual(m.id)} className="text-slate-400 hover:text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Trader payments */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-900">Partner payments (first distribution) — {monthLabel(month)}</h3>
              <button onClick={() => setShowAddPayment(true)} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
                <Plus size={14} /> Log payment
              </button>
            </div>
            {payments.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No partner payments logged for this month.</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Date</th><th>Partner</th><th>Notes</th><th className="text-right">Amount</th><th></th></tr></thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id}>
                        <td className="text-sm text-slate-500">{p.payment_date}</td>
                        <td className="text-sm font-medium">
                          {p.trader_name}
                          <span className="ml-2 badge text-xs bg-indigo-100 text-indigo-700">
                            {p.trader_tier === 1 ? 'Tier 1' : 'Sub-Partner'}
                          </span>
                        </td>
                        <td className="text-sm text-slate-500">{p.notes || '—'}</td>
                        <td className="text-right font-semibold text-emerald-600">{inr(p.amount)}</td>
                        <td>
                          <button onClick={() => deletePayment(p.id)} className="text-slate-400 hover:text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ────────────── CONSUMER ORDERS ────────────── */}
      {!loading && tab === 'consumer' && (
        <div className="card">
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <div>
              <h3 className="font-semibold text-slate-900">Consumer orders — {monthLabel(month)}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{orders.length} orders · gross {inr(orders.reduce((s, o) => s + o.total_amount, 0))}</p>
            </div>
            <button onClick={exportConsumerOrders} className="btn-ghost text-xs flex items-center gap-1.5">
              <Download size={14} /> Export Excel
            </button>
          </div>
          {orders.length === 0 ? (
            <div className="p-12 text-center text-slate-400">No consumer orders this month.</div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead><tr>
                  <th>Order #</th><th>Date</th><th>Consumer</th>
                  <th>Linked Partner</th><th>Status</th><th>Payment</th>
                  <th className="text-right">Total</th>
                </tr></thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id}>
                      <td className="font-mono text-xs">{o.order_number}</td>
                      <td className="text-xs text-slate-500">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                      <td><div className="text-sm font-medium">{o.consumer_name}</div><div className="text-xs text-slate-400">{o.consumer_phone}</div></td>
                      <td className="text-sm">{o.linked_dealer_name || '—'}</td>
                      <td><StatusPill status={o.status} /></td>
                      <td><StatusPill status={o.payment_status} /></td>
                      <td className="text-right font-semibold">{inr(o.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ────────────── TRADER SALES ────────────── */}
      {!loading && tab === 'traders' && (
        <>
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-900">Partner-wise sales — {monthLabel(month)}</h3>
              <button onClick={exportTraderSales} className="btn-ghost text-xs flex items-center gap-1.5">
                <Download size={14} /> Export Excel
              </button>
            </div>
            {tSales.length === 0 ? (
              <p className="text-sm text-slate-400 py-12 text-center">No partner activity this month.</p>
            ) : (
              <div style={{ width: '100%', height: Math.max(240, tSales.length * 36 + 80) }}>
                <ResponsiveContainer>
                  <BarChart data={tSales} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" fontSize={12} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="trader_name" fontSize={12} width={120} />
                    <Tooltip formatter={(v: number) => inr(v)} />
                    <Legend />
                    <Bar dataKey="gross_sales"        name="Gross Sales"        fill="#10b981" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="commission_earned"  name="Commission Earned"  fill="#f59e0b" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="card">
            <div className="table-wrapper">
              <table>
                <thead><tr>
                  <th>Partner</th><th>Tier</th><th className="text-right">Orders</th>
                  <th className="text-right">Gross Sales</th><th className="text-right">Commission</th>
                </tr></thead>
                <tbody>
                  {tSales.map(t => (
                    <tr key={t.trader_id}>
                      <td className="font-medium text-sm">{t.trader_name}</td>
                      <td>
                        <span className={`badge text-xs ${t.trader_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                          {t.trader_tier === 1 ? 'Tier 1' : 'Sub-Partner'}
                        </span>
                      </td>
                      <td className="text-right">{t.order_count}</td>
                      <td className="text-right font-semibold text-emerald-600">{inr(t.gross_sales)}</td>
                      <td className="text-right font-semibold text-amber-600">{inr(t.commission_earned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ────────────── RESTOCK EXPENSE ────────────── */}
      {!loading && tab === 'restock' && (
        <div className="card">
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <div>
              <h3 className="font-semibold text-slate-900">Restock expense per partner — {monthLabel(month)}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Cost price × quantity restocked · total {inr(restock.reduce((s, r) => s + r.expense, 0))}</p>
            </div>
            <button onClick={exportRestock} className="btn-ghost text-xs flex items-center gap-1.5">
              <Download size={14} /> Export Excel
            </button>
          </div>
          {restock.length === 0 ? (
            <div className="p-12 text-center text-slate-400">No restocks this month.</div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead><tr>
                  <th>Partner</th><th>Product</th>
                  <th className="text-right">Qty</th><th className="text-right">Cost / unit</th>
                  <th className="text-right">Expense</th>
                </tr></thead>
                <tbody>
                  {restock.map((r, i) => (
                    <tr key={`${r.trader_id}-${r.product_id}-${i}`}>
                      <td>
                        <div className="text-sm font-medium">{r.trader_name}</div>
                        <span className={`badge text-xs ${r.trader_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                          {r.trader_tier === 1 ? 'Tier 1' : 'Sub-Partner'}
                        </span>
                      </td>
                      <td>
                        <div className="text-sm font-medium">{r.product_name}</div>
                        <div className="text-xs text-slate-400">{r.sku}</div>
                      </td>
                      <td className="text-right text-sm">{r.total_qty} {r.unit}</td>
                      <td className="text-right text-sm text-slate-500">{inr(r.cost_price)}</td>
                      <td className="text-right font-semibold text-rose-600">{inr(r.expense)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'containers' && (
        <ContainerFinanceLog />
      )}

      {/* ── Modals ── */}
      {showAddIncome && (
        <AddIncomeModal onClose={() => setShowAddIncome(false)} onSubmit={addManualIncome} />
      )}
      {showAddPayment && (
        <AddPaymentModal traders={traders} onClose={() => setShowAddPayment(false)} onSubmit={addTraderPayment} />
      )}
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, tone, icon: Icon }: { label: string; value: string; sub?: string; tone: 'emerald' | 'red'; icon: any }) {
  const toneClasses = tone === 'emerald'
    ? 'text-emerald-600 bg-emerald-50'
    : 'text-red-600 bg-red-50';
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneClasses}`}>
          <Icon size={18} />
        </div>
      </div>
      <p className="text-2xl font-extrabold text-slate-900 mt-2">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function Breakdown({ rows, total }: { rows: { label: string; value: number; color: string }[]; total: number }) {
  if (total <= 0) return <p className="text-sm text-slate-400 py-4 text-center">No activity.</p>;
  return (
    <div className="space-y-3">
      {rows.map(r => {
        const pct = total > 0 ? (r.value / total) * 100 : 0;
        return (
          <div key={r.label}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-600">{r.label}</span>
              <span className="font-medium text-slate-900">{inr(r.value)} <span className="text-xs text-slate-400 ml-1">{pct.toFixed(1)}%</span></span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full ${r.color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      <div className="flex justify-between text-sm font-semibold pt-2 border-t border-slate-100">
        <span>Total</span><span>{inr(total)}</span>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    delivered: 'bg-emerald-100 text-emerald-700',
    pending:   'bg-amber-100 text-amber-700',
    paid:      'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-red-100 text-red-700',
    refunded:  'bg-slate-200 text-slate-700',
  };
  return <span className={`badge text-xs ${map[status] || 'bg-slate-100 text-slate-600'}`}>{status}</span>;
}

function AddIncomeModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (f: any) => void }) {
  const [form, setForm] = useState({ source: '', description: '', amount: '', recorded_date: todayDate() });
  return (
    <Modal title="Log misc income" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="form-label">Source</label>
          <input className="form-input" placeholder="e.g. Bank interest, rental, refund received"
            value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Description (optional)</label>
          <input className="form-input"
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Amount (₹)</label>
            <input type="number" min="0" step="0.01" className="form-input"
              value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Date</label>
            <input type="date" className="form-input"
              value={form.recorded_date} onChange={e => setForm({ ...form, recorded_date: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={() => onSubmit(form)} className="btn-primary"
          disabled={!form.source.trim() || !form.amount || Number(form.amount) <= 0}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function AddPaymentModal({ traders, onClose, onSubmit }: { traders: TraderOption[]; onClose: () => void; onSubmit: (f: any) => void }) {
  const [form, setForm] = useState({ trader_id: 0, amount: '', payment_date: todayDate(), notes: '' });
  return (
    <Modal title="Log partner payment" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-3">Use this to record money received from a partner — e.g. the initial distribution they paid for.</p>
      <div className="space-y-3">
        <div>
          <label className="form-label">Partner</label>
          <select className="form-input" value={form.trader_id}
            onChange={e => setForm({ ...form, trader_id: Number(e.target.value) })}>
            <option value={0}>Select partner...</option>
            {traders.map(t => <option key={t.id} value={t.id}>{t.name} ({t.tier === 1 ? 'Tier 1' : 'Sub-Partner'})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Amount (₹)</label>
            <input type="number" min="0" step="0.01" className="form-input"
              value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Date</label>
            <input type="date" className="form-input"
              value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="form-label">Notes (optional)</label>
          <input className="form-input" placeholder="e.g. First batch — 50 cans"
            value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={() => onSubmit(form)} className="btn-primary"
          disabled={!form.trader_id || !form.amount || Number(form.amount) <= 0}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Container Finance Log ─────────────────────────────────────────────── */
interface ContainerFinanceEvent {
  id: number;
  holding_id: number | null;
  consumer_id: number | null;
  driver_user_id: number | null;
  event_type: string;
  amount: number | null;
  direction: string | null;
  actor_user_id: number | null;
  reference: string | null;
  created_at: string;
  consumer_name: string | null;
  driver_name: string | null;
  actor_name: string | null;
}
interface ContainerFinanceTotals {
  driver_paid_total: number;
  verified_total: number;
  total_events: number;
}

const EVENT_LABEL: Record<string, string> = {
  driver_upi_paid_consumer: 'Driver paid consumer (UPI)',
  admin_verified_upi_proof: 'Admin verified UPI proof',
  admin_rejected_upi_proof: 'Admin rejected UPI proof',
  driver_reimbursed: 'Driver reimbursed',
  container_forfeited: 'Container forfeited (damage)',
  store_credit_issued: 'Store credit issued',
  bank_refund_pending: 'Bank refund pending',
  consumer_opened_dispute: 'Consumer opened dispute',
  admin_dispute_upheld: 'Admin upheld forfeit',
  admin_dispute_rejected: 'Admin sided with consumer',
};
const eventLabel = (k: string) => EVENT_LABEL[k] || k.replace(/_/g, ' ');

function ContainerFinanceLog() {
  const [events, setEvents] = useState<ContainerFinanceEvent[]>([]);
  const [totals, setTotals] = useState<ContainerFinanceTotals>({
    driver_paid_total: 0, verified_total: 0, total_events: 0,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/container-finance/log', { params: { limit: 200 } });
      setEvents(data.events || []);
      setTotals(data.totals || { driver_paid_total: 0, verified_total: 0, total_events: 0 });
    } catch (err) {
      console.error(err);
      toast.error('Failed to load container finance log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-500">Loading container finance log…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-2 text-slate-600 text-sm font-medium">
            <IndianRupee size={16} className="text-emerald-600" />
            Driver reimbursed (total)
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{inr(totals.driver_paid_total)}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-2 text-slate-600 text-sm font-medium">
            <IndianRupee size={16} className="text-blue-600" />
            UPI proofs verified (total)
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{inr(totals.verified_total)}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-2 text-slate-600 text-sm font-medium">
            <Package size={16} className="text-amber-600" />
            Container events logged
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{totals.total_events.toLocaleString('en-IN')}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Container Money Trail</h3>
          <button
            onClick={load}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            Refresh
          </button>
        </div>
        {events.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No container finance events yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">When</th>
                  <th className="text-left px-4 py-2 font-medium">Event</th>
                  <th className="text-left px-4 py-2 font-medium">Consumer</th>
                  <th className="text-left px-4 py-2 font-medium">Driver</th>
                  <th className="text-left px-4 py-2 font-medium">Actor</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="text-left px-4 py-2 font-medium">Dir.</th>
                  <th className="text-left px-4 py-2 font-medium">Ref</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-2 text-slate-900">{eventLabel(e.event_type)}</td>
                    <td className="px-4 py-2 text-slate-700">{e.consumer_name || '—'}</td>
                    <td className="px-4 py-2 text-slate-700">{e.driver_name || '—'}</td>
                    <td className="px-4 py-2 text-slate-700">{e.actor_name || '—'}</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-900">
                      {e.amount != null ? inr(e.amount) : '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{e.direction || '—'}</td>
                    <td className="px-4 py-2 text-slate-500 truncate max-w-[220px]" title={e.reference || ''}>
                      {e.reference || '—'}
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
