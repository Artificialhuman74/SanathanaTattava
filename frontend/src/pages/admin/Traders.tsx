import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Users, Search, ChevronDown, Star, UserCheck, UserX, Phone, Mail,
  Calendar, Truck, ChevronRight, ChevronUp, Edit2, Check, X, Trash2,
} from 'lucide-react';

interface Trader {
  id: number;
  name: string;
  email: string;
  phone: string;
  tier: number;
  referral_code: string;
  referrer_name: string;
  referrer_id: number;
  sub_count: number;
  consumer_order_count: number;
  order_count: number;
  status: string;
  will_deliver: boolean;
  delivery_enabled: boolean;
  commission_rate: number;
  created_at: string;
  sub_dealers?: Trader[];
}

export default function AdminTraders() {
  const [traders,      setTraders]      = useState<Trader[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [tierFilter,   setTierFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded,     setExpanded]     = useState<Set<number>>(new Set());
  const [editRate,     setEditRate]     = useState<{ id: number; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Trader | null>(null);

  const fetchTraders = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (search)       params.search = search;
    if (tierFilter)   params.tier   = tierFilter;
    if (statusFilter) params.status = statusFilter;
    api.get('/admin/traders', { params })
      .then(r => setTraders(r.data.traders || r.data))
      .finally(() => setLoading(false));
  }, [search, tierFilter, statusFilter]);

  useEffect(() => { fetchTraders(); }, [fetchTraders]);

  const toggleStatus = async (trader: Trader) => {
    const newStatus = trader.status === 'active' ? 'suspended' : 'active';
    try {
      await api.put(`/admin/traders/${trader.id}/status`, { status: newStatus });
      toast.success(newStatus === 'active' ? 'Trader activated' : 'Trader suspended');
      fetchTraders();
    } catch { toast.error('Failed to update status'); }
  };

  const toggleDelivery = async (trader: Trader) => {
    const isOn = !!(trader.will_deliver && trader.delivery_enabled);
    const newVal = !isOn;
    // Optimistic update
    setTraders(prev => prev.map(t =>
      t.id === trader.id ? { ...t, will_deliver: newVal as any, delivery_enabled: newVal as any } : t
    ));
    try {
      await api.put(`/admin/traders/${trader.id}/delivery`, { enabled: newVal });
      toast.success(newVal ? 'Delivery enabled' : 'Delivery disabled');
      fetchTraders();
    } catch {
      // Revert on failure
      setTraders(prev => prev.map(t =>
        t.id === trader.id ? { ...t, will_deliver: trader.will_deliver, delivery_enabled: trader.delivery_enabled } : t
      ));
      toast.error('Failed to update delivery status');
    }
  };

  const deleteTrader = async (trader: Trader) => {
    try {
      await api.delete(`/admin/traders/${trader.id}`);
      toast.success(`${trader.name} deleted`);
      setConfirmDelete(null);
      fetchTraders();
    } catch { toast.error('Failed to delete trader'); }
  };

  const saveCommissionRate = async (id: number) => {
    if (!editRate || editRate.id !== id) return;
    const rate = parseFloat(editRate.value);
    if (isNaN(rate) || rate < 0 || rate > 50) { toast.error('Rate must be 0–50%'); return; }
    try {
      await api.put(`/admin/traders/${id}/commission-rate`, { commission_rate: rate });
      toast.success('Commission rate updated');
      setEditRate(null);
      fetchTraders();
    } catch { toast.error('Failed to update rate'); }
  };

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const tier1 = traders.filter(t => t.tier === 1).length;
  const tier2 = traders.filter(t => t.tier === 2).length;

  const TraderRow = ({ t, indent = false }: { t: Trader; indent?: boolean }) => (
    <>
      <tr key={t.id} className={indent ? 'bg-slate-50/60' : ''}>
        <td>
          <div className="flex items-center gap-3">
            {indent && <div className="w-4 h-px bg-slate-300 flex-shrink-0 ml-2" />}
            <div className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {t.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-sm">{t.name}</p>
              <p className="text-slate-400 text-xs flex items-center gap-1"><Mail size={10} />{t.email}</p>
              {t.phone && <p className="text-slate-400 text-xs flex items-center gap-1"><Phone size={10} />{t.phone}</p>}
            </div>
          </div>
        </td>
        <td>
          {t.tier === 1
            ? <span className="badge bg-indigo-100 text-indigo-700 gap-1"><Star size={10} />Tier 1</span>
            : <span className="badge bg-purple-100 text-purple-700">Sub-Dealer</span>
          }
        </td>
        <td>
          {t.referral_code
            ? <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">{t.referral_code}</span>
            : <span className="text-slate-300 text-xs">—</span>
          }
        </td>
        <td className="text-sm text-slate-600">{t.referrer_name || <span className="text-slate-300">—</span>}</td>
        <td>
          {t.tier === 1 ? (
            <button
              onClick={() => toggleExpand(t.id)}
              className="flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
            >
              {t.sub_count ?? 0}
              {t.sub_count > 0 && (expanded.has(t.id) ? <ChevronUp size={12} /> : <ChevronRight size={12} />)}
            </button>
          ) : <span className="text-slate-300">—</span>}
        </td>
        <td className="text-center text-sm font-medium text-slate-700">{t.consumer_order_count ?? 0}</td>
        <td>
          {/* Commission Rate */}
          {editRate?.id === t.id ? (
            <div className="flex items-center gap-1">
              <input
                type="number" min={0} max={50} step={0.5}
                value={editRate.value}
                onChange={e => setEditRate({ id: t.id, value: e.target.value })}
                className="w-16 px-2 py-1 border border-slate-300 rounded text-xs"
              />
              <span className="text-xs text-slate-400">%</span>
              <button onClick={() => saveCommissionRate(t.id)} className="p-1 text-emerald-600 hover:text-emerald-700"><Check size={12} /></button>
              <button onClick={() => setEditRate(null)} className="p-1 text-red-500 hover:text-red-600"><X size={12} /></button>
            </div>
          ) : (
            <button
              onClick={() => setEditRate({ id: t.id, value: String(t.commission_rate ?? 0) })}
              className="flex items-center gap-1 text-sm text-slate-700 hover:text-brand-600 group"
            >
              {t.commission_rate ?? 0}%
              <Edit2 size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </td>
        <td>
          {/* Delivery toggle — admin fully controls */}
          <div className="flex flex-col gap-1">
            <span className={`text-xs ${(t.will_deliver && t.delivery_enabled) ? 'text-emerald-600' : 'text-slate-400'}`}>
              {(t.will_deliver && t.delivery_enabled) ? 'Delivery on' : 'No delivery'}
            </span>
            <button
              onClick={() => toggleDelivery(t)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                (t.will_deliver && t.delivery_enabled) ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${
                (t.will_deliver && t.delivery_enabled) ? 'translate-x-[18px]' : 'translate-x-[2px]'
              }`} />
            </button>
          </div>
        </td>
        <td>
          <span className={`badge ${t.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
            {t.status}
          </span>
        </td>
        <td className="text-xs text-slate-400 whitespace-nowrap">
          <span className="flex items-center gap-1"><Calendar size={10} />{new Date(t.created_at).toLocaleDateString('en-IN')}</span>
        </td>
        <td>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleStatus(t)}
              className={`btn-ghost p-2 text-xs font-medium gap-1 ${t.status === 'active' ? 'text-red-500 hover:text-red-700' : 'text-emerald-600 hover:text-emerald-800'}`}
            >
              {t.status === 'active' ? <><UserX size={14} />Suspend</> : <><UserCheck size={14} />Activate</>}
            </button>
            <button
              onClick={() => setConfirmDelete(t)}
              className="btn-ghost p-2 text-xs font-medium gap-1 text-slate-400 hover:text-red-600"
              title="Delete trader permanently"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded sub-dealers */}
      {t.tier === 1 && expanded.has(t.id) && (t.sub_dealers || []).map(sub => (
        <TraderRow key={sub.id} t={sub} indent />
      ))}
    </>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Traders</h2>
        <p className="text-slate-500 text-sm mt-0.5">{traders.length} total · {tier1} Tier 1 · {tier2} Sub-Dealers</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Traders', value: traders.length,                                   color: 'bg-brand-50 text-brand-600' },
          { label: 'Tier 1',        value: tier1,                                             color: 'bg-indigo-50 text-indigo-600' },
          { label: 'Sub-Dealers',   value: tier2,                                             color: 'bg-purple-50 text-purple-600' },
          { label: 'Active',        value: traders.filter(t => t.status === 'active').length, color: 'bg-emerald-50 text-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4 text-center">
            <p className={`text-2xl font-extrabold ${color.split(' ')[1]}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Filter Tabs */}
        <div className="flex rounded-xl bg-slate-100 p-1">
          {[
            { value: '',  label: 'All' },
            { value: '1', label: 'Tier 1' },
            { value: '2', label: 'Sub-Dealers' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTierFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tierFilter === value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="form-input pl-9"
            placeholder="Search by name or email..."
          />
        </div>
        <div className="relative">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="form-input appearance-none pr-8 min-w-28">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Trader</th>
                  <th>Tier</th>
                  <th>Referral Code</th>
                  <th>Parent Dealer</th>
                  <th>Sub-Dealers</th>
                  <th>C.Orders</th>
                  <th>Commission</th>
                  <th>Delivery</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {traders.filter(t => t.tier === 1 || tierFilter === '2').map(t => (
                  <TraderRow key={t.id} t={t} />
                ))}
                {tierFilter === '2' && traders.filter(t => t.tier === 2).map(t => (
                  <TraderRow key={t.id} t={t} />
                ))}
              </tbody>
            </table>
            {traders.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <Users size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">No traders found</p>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Delete Trader</h3>
                <p className="text-xs text-slate-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Are you sure you want to permanently delete <span className="font-semibold text-slate-900">{confirmDelete.name}</span>?
              Their orders and commission history will remain, but the account will be removed.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteTrader(confirmDelete)}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
