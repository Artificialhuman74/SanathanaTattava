import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Users, Copy, Check, Mail, Phone, QrCode, Truck,
  Edit2, CheckCircle2, X, AlertCircle, ShoppingBag, DollarSign,
} from 'lucide-react';

interface SubDealer {
  id: number;
  name: string;
  email: string;
  phone: string;
  referral_code: string;
  will_deliver: boolean;
  delivery_enabled: boolean;
  commission_rate: number;
  consumer_order_count: number;
  total_earned: number;
  status: string;
  created_at: string;
}

export default function TraderSubDealers() {
  const { user, isTier1 } = useAuth();
  const [subDealers,  setSubDealers]  = useState<SubDealer[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [copiedRef,   setCopiedRef]   = useState(false);
  const [editRate,    setEditRate]    = useState<{ id: number; value: string } | null>(null);
  const [updatingId,  setUpdatingId]  = useState<number | null>(null);

  const fetchSubDealers = useCallback(() => {
    setLoading(true);
    api.get('/trader/sub-dealers')
      .then(r => setSubDealers(r.data.subDealers || r.data.sub_dealers || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchSubDealers(); }, [fetchSubDealers]);

  const copyReferralCode = () => {
    if (user?.referral_code) {
      navigator.clipboard.writeText(user.referral_code);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    }
  };

  const toggleDelivery = async (dealer: SubDealer) => {
    if (!dealer.will_deliver) {
      toast.error('This sub-dealer opted out of delivery at registration');
      return;
    }
    const newVal = !dealer.delivery_enabled;
    setUpdatingId(dealer.id);
    try {
      await api.put(`/trader/sub-dealers/${dealer.id}/delivery`, { delivery_enabled: newVal });
      toast.success(newVal ? 'Delivery enabled' : 'Delivery disabled');
      fetchSubDealers();
    } catch { toast.error('Failed to update delivery'); }
    finally { setUpdatingId(null); }
  };

  const saveCommissionRate = async (id: number) => {
    if (!editRate || editRate.id !== id) return;
    const rate = parseFloat(editRate.value);
    if (isNaN(rate) || rate < 0 || rate > 50) { toast.error('Rate must be between 0 and 50%'); return; }
    setUpdatingId(id);
    try {
      await api.put(`/trader/sub-dealers/${id}/commission-rate`, { commission_rate: rate });
      toast.success('Commission rate updated');
      setEditRate(null);
      fetchSubDealers();
    } catch { toast.error('Failed to update commission rate'); }
    finally { setUpdatingId(null); }
  };

  if (!isTier1) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mb-4">
          <Users size={28} className="text-purple-500" />
        </div>
        <h3 className="font-bold text-slate-900 text-lg mb-2">Sub-Dealers — Tier 1 Only</h3>
        <p className="text-slate-500 text-sm max-w-sm">
          This section is only available for Tier 1 Parent Dealers. As a Sub-Dealer, you can manage your consumer orders and commissions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Sub-Dealers</h2>
        <p className="text-slate-500 text-sm mt-0.5">{subDealers.length} sub-dealers in your network</p>
      </div>

      {/* Invite Section */}
      <div className="card p-5 bg-gradient-to-r from-indigo-50 to-indigo-100 border-indigo-200">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-12 h-12 bg-indigo-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <QrCode size={22} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-indigo-900">Invite Sub-Dealers</p>
            <p className="text-indigo-700 text-sm mt-0.5">Share your referral code for sub-dealers to register under you</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-indigo-200">
              <span className="font-mono font-bold text-indigo-800 tracking-wider">{user?.referral_code || '—'}</span>
            </div>
            <button
              onClick={copyReferralCode}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              {copiedRef ? <Check size={16} /> : <Copy size={16} />}
              {copiedRef ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Sub-Dealers', value: subDealers.length, color: 'bg-indigo-50 text-indigo-600' },
          { label: 'Active',            value: subDealers.filter(d => d.status === 'active').length, color: 'bg-emerald-50 text-emerald-600' },
          { label: 'Can Deliver',       value: subDealers.filter(d => d.will_deliver).length, color: 'bg-teal-50 text-teal-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4 text-center">
            <p className={`text-2xl font-extrabold ${color.split(' ')[1]}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Sub-Dealer Cards */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
        </div>
      ) : subDealers.length === 0 ? (
        <div className="card p-12 text-center text-slate-400">
          <Users size={48} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium text-lg">No sub-dealers yet</p>
          <p className="text-sm mt-1">Share your referral code above to invite sub-dealers to join your network</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {subDealers.map(dealer => (
            <div key={dealer.id} className="card p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-base flex-shrink-0">
                    {dealer.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">{dealer.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="badge bg-purple-100 text-purple-700 text-xs">Sub-Dealer</span>
                      <span className={`badge text-xs ${dealer.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {dealer.status}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Referral Code</p>
                  <p className="font-mono font-bold text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded mt-0.5">{dealer.referral_code || '—'}</p>
                </div>
              </div>

              {/* Contact */}
              <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                <span className="flex items-center gap-1.5"><Mail size={13} />{dealer.email}</span>
                {dealer.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{dealer.phone}</span>}
              </div>

              {/* Delivery Status */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <div className="flex items-center gap-2">
                  {dealer.will_deliver
                    ? <Truck size={16} className="text-teal-600" />
                    : <Truck size={16} className="text-slate-400 opacity-40" />
                  }
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {dealer.will_deliver ? 'Will Deliver' : 'Opted Out at Registration'}
                    </p>
                    {dealer.will_deliver && (
                      <p className="text-xs text-slate-400">Toggle to enable/disable delivery assignments</p>
                    )}
                  </div>
                </div>
                {dealer.will_deliver && (
                  <button
                    onClick={() => toggleDelivery(dealer)}
                    disabled={updatingId === dealer.id}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      dealer.delivery_enabled ? 'bg-teal-500' : 'bg-slate-300'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                      dealer.delivery_enabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                )}
              </div>

              {/* Commission Rate */}
              <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl">
                <div>
                  <p className="text-xs text-amber-700 font-medium">Commission Rate</p>
                  <p className="text-xs text-amber-600 mt-0.5">% of consumer order amount</p>
                </div>
                {editRate?.id === dealer.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={0} max={50} step={0.5}
                      value={editRate.value}
                      onChange={e => setEditRate({ id: dealer.id, value: e.target.value })}
                      className="w-16 px-2 py-1.5 border border-amber-300 rounded-lg text-sm font-semibold text-center bg-white"
                    />
                    <span className="text-sm text-amber-700 font-semibold">%</span>
                    <button
                      onClick={() => saveCommissionRate(dealer.id)}
                      disabled={updatingId === dealer.id}
                      className="p-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
                    >
                      <Check size={14} />
                    </button>
                    <button onClick={() => setEditRate(null)} className="p-1.5 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditRate({ id: dealer.id, value: String(dealer.commission_rate ?? 0) })}
                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-sm font-semibold transition-colors"
                  >
                    {dealer.commission_rate ?? 0}%
                    <Edit2 size={12} />
                  </button>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 p-3 bg-brand-50 rounded-xl">
                  <ShoppingBag size={16} className="text-brand-600" />
                  <div>
                    <p className="text-xs text-slate-500">Consumer Orders</p>
                    <p className="font-bold text-slate-900">{dealer.consumer_order_count ?? 0}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl">
                  <DollarSign size={16} className="text-emerald-600" />
                  <div>
                    <p className="text-xs text-slate-500">Total Earned</p>
                    <p className="font-bold text-slate-900">₹{parseFloat(String(dealer.total_earned || 0)).toFixed(0)}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
