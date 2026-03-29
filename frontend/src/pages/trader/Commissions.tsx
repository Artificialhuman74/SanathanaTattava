import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import {
  DollarSign, Clock, CheckCircle2, TrendingUp, Info, AlertCircle,
} from 'lucide-react';

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
  order_id: number;
  amount: number;
  rate: number;
  type: 'direct' | 'override';
  status: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700',
  paid:      'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const WEEK_STATUS_COLORS: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700',
  processed: 'bg-emerald-100 text-emerald-700',
};

export default function TraderCommissions() {
  const { isTier1 } = useAuth();
  const [data,    setData]    = useState<CommissionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/trader/commissions')
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );

  const pending = parseFloat(String(data?.summary?.pending_amount || 0));
  const paid    = parseFloat(String(data?.summary?.paid_amount    || 0));
  const total   = parseFloat(String(data?.summary?.total_amount   || 0));

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">My Commissions</h2>
        <p className="text-slate-500 text-sm mt-0.5">Track your commission earnings from consumer orders</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Pending Commission', value: `₹${pending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, icon: Clock,         color: 'bg-amber-50 text-amber-600',   border: 'border-amber-200' },
          { label: 'Paid Commission',    value: `₹${paid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,    icon: CheckCircle2,  color: 'bg-emerald-50 text-emerald-600', border: 'border-emerald-200' },
          { label: 'Total Earned',       value: `₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,   icon: TrendingUp,    color: 'bg-brand-50 text-brand-600',    border: 'border-brand-200' },
        ].map(({ label, value, icon: Icon, color, border }) => (
          <div key={label} className={`card p-5 border-l-4 ${border}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                <Icon size={18} />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">{label}</p>
                <p className="text-2xl font-extrabold text-slate-900 mt-0.5">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Info Card */}
      <div className="card p-4 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-1">How commissions work:</p>
            <ul className="space-y-1 text-blue-700 text-xs">
              <li><strong>Direct</strong> — Commission from orders placed by your own consumers</li>
              {isTier1 && <li><strong>Override</strong> — Additional commission from orders placed through your sub-dealers' consumers (Tier 1 override)</li>}
              <li>Commissions are processed weekly and paid out every Monday</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Weekly Breakdown */}
      {(data?.weeklyBreakdown || []).length > 0 && (
        <div className="card">
          <div className="p-5 border-b border-slate-100">
            <h3 className="font-bold text-slate-900">Weekly Breakdown</h3>
            <p className="text-slate-400 text-xs mt-0.5">Commission totals by week</p>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Orders</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.weeklyBreakdown || []).map((w, i) => (
                  <tr key={i}>
                    <td className="text-sm text-slate-600">
                      {new Date(w.week_start).toLocaleDateString('en-IN')} – {new Date(w.week_end).toLocaleDateString('en-IN')}
                    </td>
                    <td className="text-center font-semibold">{w.count}</td>
                    <td className="font-bold text-emerald-600">₹{parseFloat(String(w.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td>
                      <span className={`badge ${WEEK_STATUS_COLORS[w.status] || 'bg-slate-100 text-slate-600'}`}>
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

      {/* Recent Commissions */}
      <div className="card">
        <div className="p-5 border-b border-slate-100">
          <h3 className="font-bold text-slate-900">Recent Commission Records</h3>
          <p className="text-slate-400 text-xs mt-0.5">Per-order commission details</p>
        </div>
        {(data?.commissions || []).length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <AlertCircle size={36} className="mx-auto mb-2 opacity-30" />
            <p className="font-medium">No commission records yet</p>
            <p className="text-sm mt-1">Commissions appear when consumer orders are delivered</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Amount</th>
                  <th>Rate</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {(data?.commissions || []).map(c => (
                  <tr key={c.id}>
                    <td className="font-mono text-brand-600 font-medium text-xs">{c.order_number}</td>
                    <td className="font-bold text-emerald-600">₹{parseFloat(String(c.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="text-sm text-slate-600">{c.rate}%</td>
                    <td>
                      <span className={`badge text-xs ${
                        c.type === 'direct'
                          ? 'bg-brand-100 text-brand-700'
                          : 'bg-indigo-100 text-indigo-700'
                      }`}>
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
    </div>
  );
}
