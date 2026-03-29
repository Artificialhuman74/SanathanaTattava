import React, { useEffect, useState } from 'react';
import api from '../../api/axios';
import { Users, Search, Tag, Phone, MapPin, ShoppingBag, TrendingUp, X } from 'lucide-react';

interface Consumer {
  id: number;
  name: string;
  email: string;
  phone: string;
  pincode: string;
  address: string;
  referral_code_used: string | null;
  linked_dealer_id: number | null;
  dealer_name: string | null;
  dealer_tier: number | null;
  status: string;
  order_count: number;
  total_spent: number;
  created_at: string;
}

type FilterTab = 'all' | 'yes' | 'no';

export default function AdminConsumers() {
  const [consumers, setConsumers]   = useState<Consumer[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [tab,       setTab]         = useState<FilterTab>('all');
  const [search,    setSearch]      = useState('');
  const [selected,  setSelected]    = useState<Consumer | null>(null);

  const fetchConsumers = (filter: FilterTab) => {
    setLoading(true);
    const params: any = {};
    if (filter !== 'all') params.has_referral = filter;
    api.get('/admin/consumers', { params })
      .then(r => setConsumers(r.data.consumers || []))
      .catch(() => setConsumers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchConsumers(tab); }, [tab]);

  const filtered = consumers.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    (c.referral_code_used || '').toLowerCase().includes(search.toLowerCase())
  );

  const totalReferral = consumers.filter(c => c.linked_dealer_id !== null).length;
  const totalDirect   = consumers.filter(c => c.linked_dealer_id === null).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Consumers</h1>
        <p className="text-slate-500 text-sm mt-0.5">Manage all consumers sorted by referral status</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4 flex items-center gap-4">
          <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Users className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <p className="text-slate-500 text-sm">Total Consumers</p>
            <p className="text-2xl font-bold text-slate-900">{loading ? '…' : consumers.length}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-4">
          <div className="w-11 h-11 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Tag className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-slate-500 text-sm">Has Referral Code</p>
            <p className="text-2xl font-bold text-emerald-700">{loading ? '…' : totalReferral}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-4">
          <div className="w-11 h-11 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-slate-500 text-sm">Direct (No Referral)</p>
            <p className="text-2xl font-bold text-amber-700">{loading ? '…' : totalDirect}</p>
          </div>
        </div>
      </div>

      {/* Filter Tabs + Search */}
      <div className="card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          {/* Tabs */}
          <div className="flex rounded-xl overflow-hidden border border-slate-200 flex-shrink-0">
            {([['all', 'All'], ['yes', 'Has Referral'], ['no', 'Direct (No Referral)']] as [FilterTab, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setTab(v)}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${
                  tab === v ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="form-input pl-9 text-sm w-full"
              placeholder="Search name, email, code…"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left pb-3 font-semibold text-slate-500 text-xs uppercase tracking-wider pr-4">Consumer</th>
                  <th className="text-left pb-3 font-semibold text-slate-500 text-xs uppercase tracking-wider pr-4">Contact</th>
                  <th className="text-left pb-3 font-semibold text-slate-500 text-xs uppercase tracking-wider pr-4">Referral</th>
                  <th className="text-left pb-3 font-semibold text-slate-500 text-xs uppercase tracking-wider pr-4">Linked Dealer</th>
                  <th className="text-right pb-3 font-semibold text-slate-500 text-xs uppercase tracking-wider pr-4">Orders</th>
                  <th className="text-right pb-3 font-semibold text-slate-500 text-xs uppercase tracking-wider">Spent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => setSelected(c)}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-brand-700 text-xs font-bold">{c.name[0]?.toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900">{c.name}</p>
                          <p className="text-xs text-slate-400">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-slate-700">{c.phone || '—'}</p>
                      <p className="text-xs text-slate-400 flex items-center gap-1"><MapPin size={10} />{c.pincode || '—'}</p>
                    </td>
                    <td className="py-3 pr-4">
                      {c.referral_code_used ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-mono text-xs font-bold">
                          <Tag size={10} />
                          {c.referral_code_used}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                          Direct
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {c.dealer_name ? (
                        <div>
                          <p className="font-medium text-slate-700">{c.dealer_name}</p>
                          <p className="text-xs text-slate-400">Tier {c.dealer_tier}</p>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">Admin (Direct)</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="font-semibold text-slate-800">{c.order_count ?? 0}</span>
                    </td>
                    <td className="py-3 text-right">
                      <span className="font-bold text-brand-600">₹{(c.total_spent ?? 0).toFixed(2)}</span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <Users size={32} className="mx-auto mb-2 opacity-30" />
                      <p>No consumers found</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Consumer Detail Drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelected(null)} />
          <div className="relative ml-auto w-full max-w-sm bg-white h-full flex flex-col shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white z-10">
              <h3 className="font-bold text-slate-900">Consumer Details</h3>
              <button onClick={() => setSelected(null)} className="btn-ghost p-2"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-5">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center">
                  <span className="text-brand-700 text-xl font-bold">{selected.name[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-900">{selected.name}</p>
                  <p className="text-slate-500 text-sm">{selected.email}</p>
                  <span className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full ${selected.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                    {selected.status}
                  </span>
                </div>
              </div>

              {/* Info */}
              <div className="space-y-3">
                <InfoRow icon={<Phone size={14} />} label="Phone" value={selected.phone || '—'} />
                <InfoRow icon={<MapPin size={14} />} label="Pincode" value={selected.pincode || '—'} />
                {selected.address && <InfoRow icon={<MapPin size={14} />} label="Address" value={selected.address} />}
                <InfoRow
                  icon={<Tag size={14} />}
                  label="Referral Code Used"
                  value={
                    selected.referral_code_used
                      ? <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">{selected.referral_code_used}</span>
                      : <span className="text-amber-600 font-semibold">None (Direct)</span>
                  }
                />
                {selected.dealer_name && (
                  <InfoRow
                    icon={<Users size={14} />}
                    label="Linked Dealer"
                    value={<span>{selected.dealer_name} <span className="text-xs text-slate-400">(Tier {selected.dealer_tier})</span></span>}
                  />
                )}
                <InfoRow
                  icon={<ShoppingBag size={14} />}
                  label="Total Orders"
                  value={<span className="font-bold">{selected.order_count ?? 0}</span>}
                />
                <InfoRow
                  icon={<TrendingUp size={14} />}
                  label="Total Spent"
                  value={<span className="font-bold text-brand-600">₹{(selected.total_spent ?? 0).toFixed(2)}</span>}
                />
              </div>

              <p className="text-xs text-slate-400">
                Joined {new Date(selected.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-slate-400 mt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1">
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        <div className="text-sm text-slate-800 mt-0.5">{value}</div>
      </div>
    </div>
  );
}
