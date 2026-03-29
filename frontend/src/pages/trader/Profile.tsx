import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  UserCircle, MapPin, Phone, Mail, Star, Truck, Package,
  Shield, QrCode, Users, Copy, Check, Navigation,
  Edit2, Save, X, Loader2, RefreshCw, AlertTriangle,
} from 'lucide-react';

interface ProfileData {
  user: {
    id: number; name: string; email: string; phone: string;
    address: string; pincode: string; tier: number;
    referral_code: string; will_deliver: number; delivery_enabled: number;
    commission_rate: number; latitude: number | null; longitude: number | null;
    h3_index: string | null; availability_status: string; status: string;
    created_at: string;
  };
  referrer: { id: number; name: string; phone: string; email: string; referral_code: string } | null;
  subDealerCount: number;
  consumerCount: number;
  inventorySummary: { total_products: number; total_units: number; low_stock_count: number };
}

export default function TraderProfile() {
  const { user: authUser } = useAuth();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', address: '', pincode: '' });

  // GPS location update states
  const [gpsUpdating, setGpsUpdating] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [showGpsDisclaimer, setShowGpsDisclaimer] = useState(false);

  const fetchProfile = () => {
    api.get('/trader/my-profile')
      .then(r => {
        setData(r.data);
        setForm({
          name: r.data.user.name || '',
          phone: r.data.user.phone || '',
          address: r.data.user.address || '',
          pincode: r.data.user.pincode || '',
        });
      })
      .catch(() => toast.error('Failed to load profile'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProfile(); }, []);

  const copyCode = () => {
    if (data?.user.referral_code) {
      navigator.clipboard.writeText(data.user.referral_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: res } = await api.put('/trader/my-profile', form);
      if (res.user) {
        const stored = localStorage.getItem('user');
        if (stored) {
          const parsed = JSON.parse(stored);
          parsed.name = res.user.name;
          parsed.phone = res.user.phone;
          parsed.address = res.user.address;
          parsed.pincode = res.user.pincode;
          localStorage.setItem('user', JSON.stringify(parsed));
        }
      }
      toast.success('Profile updated');
      setEditing(false);
      fetchProfile();
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  // Show disclaimer popup first
  const handleUpdateGPS = useCallback(() => {
    setGpsError('');
    setShowGpsDisclaimer(true);
  }, []);

  // Actually fetch GPS after user confirms
  const handleConfirmGPS = useCallback(() => {
    setShowGpsDisclaimer(false);

    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }

    setGpsUpdating(true);
    setGpsError('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const { data: res } = await api.put('/location/dealer/update', { latitude, longitude });
          const h3 = res.location?.h3_index || res.h3_index || '';
          toast.success(`GPS location updated! H3: ${h3}`);
          fetchProfile(); // Refresh profile data
        } catch (err: any) {
          const msg = err?.response?.data?.error || 'Failed to update location on server.';
          setGpsError(msg);
          toast.error(msg);
        } finally {
          setGpsUpdating(false);
        }
      },
      (error) => {
        let msg: string;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            msg = 'Location permission denied. Please allow location access in your browser settings.';
            break;
          case error.POSITION_UNAVAILABLE:
            msg = 'Location unavailable. Check your GPS settings.';
            break;
          case error.TIMEOUT:
            msg = 'Location request timed out. Try again.';
            break;
          default:
            msg = 'Unknown error getting location.';
        }
        setGpsError(msg);
        setGpsUpdating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );

  if (!data) return <p className="text-center text-slate-400 py-12">Could not load profile.</p>;

  const { user, referrer, subDealerCount, consumerCount, inventorySummary } = data;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-2xl font-bold">{user.name[0]?.toUpperCase()}</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{user.name}</h1>
              <span className={`badge ${user.tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                {user.tier === 1 ? 'Tier 1 Dealer' : 'Sub-Dealer'}
              </span>
              <span className={`badge ${user.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {user.status}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Member since {new Date(user.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
          </div>
          {/* Referral Code */}
          <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3 border border-slate-200">
            <QrCode size={20} className="text-brand-600" />
            <div>
              <p className="text-xs text-slate-400 uppercase font-semibold tracking-wider">Referral Code</p>
              <p className="font-mono text-lg font-bold text-slate-900">{user.referral_code}</p>
            </div>
            <button onClick={copyCode} className="ml-2 p-2 rounded-lg hover:bg-slate-200 transition-colors">
              {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} className="text-slate-400" />}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Consumers', value: consumerCount, color: 'text-brand-600', icon: Users },
          { label: 'Sub-Dealers', value: subDealerCount, color: 'text-indigo-600', icon: Users },
          { label: 'Products Stocked', value: inventorySummary.total_products, color: 'text-purple-600', icon: Package },
          { label: 'Low Stock Items', value: inventorySummary.low_stock_count, color: inventorySummary.low_stock_count > 0 ? 'text-red-600' : 'text-emerald-600', icon: Package },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card p-4 text-center">
            <Icon size={18} className={`mx-auto mb-1 ${color}`} />
            <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contact Info — Editable */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <UserCircle size={14} /> Contact Information
            </h3>
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
              >
                <Edit2 size={14} />
                Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setForm({
                      name: user.name || '',
                      phone: user.phone || '',
                      address: user.address || '',
                      pincode: user.pincode || '',
                    });
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X size={14} />
                  Cancel
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Email (cannot be changed)</label>
                <input
                  type="email"
                  value={user.email}
                  disabled
                  className="w-full px-3 py-2.5 border border-slate-100 rounded-xl text-sm bg-slate-50 text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Shop / Business Address</label>
                <textarea
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none"
                  placeholder="Enter your full shop/business address"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Pincode</label>
                <input
                  type="text"
                  value={form.pincode}
                  onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="e.g. 400001"
                  maxLength={6}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {[
                { icon: Mail, label: 'Email', value: user.email },
                { icon: Phone, label: 'Phone', value: user.phone || 'Not set' },
                { icon: MapPin, label: 'Address', value: user.address || 'Not set' },
                { icon: MapPin, label: 'Pincode', value: user.pincode || 'Not set' },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3">
                  <Icon size={16} className="text-slate-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-sm font-medium text-slate-900">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* GPS Location & Delivery */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Navigation size={14} /> GPS Location & Delivery
          </h3>

          {/* Current GPS Info */}
          {user.latitude && user.longitude ? (
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
              <p className="text-xs text-blue-600 font-semibold flex items-center gap-1"><MapPin size={12} /> Current GPS Location</p>
              <p className="text-sm text-blue-900 font-mono">{user.latitude.toFixed(6)}, {user.longitude.toFixed(6)}</p>
              {user.h3_index && <p className="text-xs text-blue-500">H3 Cell: <span className="font-mono">{user.h3_index}</span></p>}
            </div>
          ) : (
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
              <div className="flex gap-2">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">GPS location not set</p>
                  <p className="text-xs text-amber-600 mt-0.5">Your location is needed to receive delivery assignments. Please set it below.</p>
                </div>
              </div>
            </div>
          )}

          {/* Warning about being at shop */}
          <div className="flex gap-2.5 p-3 rounded-xl bg-amber-50/60 border border-amber-100">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              <span className="font-semibold">Be at your shop</span> when updating GPS. This location is used to assign nearby deliveries to you.
            </p>
          </div>

          {/* Update GPS Button */}
          <button
            onClick={handleUpdateGPS}
            disabled={gpsUpdating}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold rounded-xl transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {gpsUpdating ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Getting location...
              </>
            ) : (
              <>
                <RefreshCw size={18} />
                {user.latitude ? 'Update My GPS Location' : 'Set My GPS Location'}
              </>
            )}
          </button>

          {/* GPS Error */}
          {gpsError && (
            <div className="p-3 bg-red-50 rounded-xl border border-red-100">
              <p className="text-xs text-red-700">{gpsError}</p>
            </div>
          )}

          {/* Delivery Status Info */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-2">
                <Truck size={16} className="text-slate-400" />
                <span className="text-sm text-slate-700">Will Deliver</span>
              </div>
              <span className={`badge ${user.will_deliver ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {user.will_deliver ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-slate-400" />
                <span className="text-sm text-slate-700">Delivery Enabled</span>
              </div>
              <span className={`badge ${user.delivery_enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {user.delivery_enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-2">
                <Navigation size={16} className="text-slate-400" />
                <span className="text-sm text-slate-700">Availability</span>
              </div>
              <span className={`badge ${
                user.availability_status === 'available' ? 'bg-emerald-100 text-emerald-700' :
                user.availability_status === 'busy' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>
                {user.availability_status}
              </span>
            </div>
          </div>
        </div>

        {/* Commission Info */}
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Star size={14} /> Commission
          </h3>
          <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-xl border border-emerald-100">
            <span className="text-slate-700 font-medium">Commission Rate</span>
            <span className="text-2xl font-extrabold text-emerald-700">{user.commission_rate}%</span>
          </div>
        </div>

        {/* Parent Dealer (Tier 2) */}
        {referrer && (
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Users size={14} /> Parent Dealer
            </h3>
            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100 space-y-2">
              <p className="font-semibold text-indigo-900 text-lg">{referrer.name}</p>
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2 text-indigo-700"><Phone size={14} /> {referrer.phone || '—'}</p>
                <p className="flex items-center gap-2 text-indigo-700"><Mail size={14} /> {referrer.email}</p>
                <p className="flex items-center gap-2 text-indigo-700"><QrCode size={14} /> Code: {referrer.referral_code}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* GPS Disclaimer Modal */}
      {showGpsDisclaimer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 bg-white rounded-2xl shadow-xl overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Location Disclaimer</h2>
                  <p className="text-amber-100 text-sm">Please read before proceeding</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
                <p>
                  By updating your GPS location, you confirm the following:
                </p>
                <ul className="space-y-2">
                  <li className="flex gap-2">
                    <span className="text-amber-500 font-bold mt-0.5">1.</span>
                    <span><strong>You are currently at your shop/store.</strong> This location will be used to assign delivery orders to you based on proximity to customers.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-amber-500 font-bold mt-0.5">2.</span>
                    <span><strong>Incorrect location = wrong assignments.</strong> If you set your location from somewhere other than your shop, deliveries may be incorrectly routed to you.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-amber-500 font-bold mt-0.5">3.</span>
                    <span><strong>This replaces your previous location.</strong> Your old GPS coordinates and H3 cell index will be overwritten.</span>
                  </li>
                </ul>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowGpsDisclaimer(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmGPS}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors"
                >
                  <Navigation size={16} />
                  I'm at my shop, proceed
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
