import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Settings, Percent, Save, Info, MapPin, Navigation,
  RefreshCw, Loader2, AlertTriangle, Users, Clock, Zap,
} from 'lucide-react';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface LocationData {
  id: number;
  latitude: number | null;
  longitude: number | null;
  h3_index: string | null;
  availability_status: string;
  will_deliver: number;
  delivery_enabled: number;
}

export default function AdminSettings() {
  const [discountPct, setDiscountPct] = useState<string>('10');
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);

  // Automated payouts
  const [autoPayoutEnabled, setAutoPayoutEnabled] = useState(true);
  const [autoPayoutDay,     setAutoPayoutDay]     = useState('5');
  const [autoPayoutTime,    setAutoPayoutTime]    = useState('18:00');
  const [autoPayoutLastRun, setAutoPayoutLastRun] = useState<string | null>(null);
  const [payoutSaving,      setPayoutSaving]      = useState(false);

  // Bulk trader commission
  const [bulkRate,       setBulkRate]       = useState('');
  const [bulkSaving,     setBulkSaving]     = useState(false);
  const [bulkConfirming, setBulkConfirming] = useState(false);

  // Delivery location state
  const [location,          setLocation]          = useState<LocationData | null>(null);
  const [gpsUpdating,       setGpsUpdating]       = useState(false);
  const [gpsError,          setGpsError]          = useState('');
  const [showGpsDisclaimer, setShowGpsDisclaimer] = useState(false);
  const [availSaving,       setAvailSaving]       = useState(false);

  const fetchLocation = useCallback(() => {
    api.get('/location/dealer/me')
      .then(r => setLocation(r.data.location))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/admin/settings')
      .then(r => {
        /* The API wraps values in { settings: {...} }. Reading the flat
         * shape here was the bug that kept the discount stuck at "10"
         * on screen while the real setting applied correctly. */
        const s = r.data.settings || {};
        setDiscountPct(String(s.referral_discount_percent ?? 10));
        setAutoPayoutEnabled(String(s.auto_payout_enabled ?? '1') === '1');
        setAutoPayoutDay(String(s.auto_payout_day ?? '5'));
        setAutoPayoutTime(String(s.auto_payout_time ?? '18:00'));
        setAutoPayoutLastRun(s.auto_payout_last_run ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    fetchLocation();
  }, [fetchLocation]);

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
          const h3 = res.location?.h3_index || '';
          toast.success(`GPS location updated! H3: ${h3}`);
          fetchLocation();
        } catch (err: any) {
          const msg = err?.response?.data?.error || 'Failed to update location.';
          setGpsError(msg);
          toast.error(msg);
        } finally {
          setGpsUpdating(false);
        }
      },
      (error) => {
        const msgs: Record<number, string> = {
          1: 'Location permission denied. Please allow location access in your browser settings.',
          2: 'Location unavailable. Check your GPS settings.',
          3: 'Location request timed out. Try again.',
        };
        const msg = msgs[error.code] || 'Unknown error getting location.';
        setGpsError(msg);
        setGpsUpdating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, [fetchLocation]);

  const handleAvailability = async (status: string) => {
    setAvailSaving(true);
    try {
      await api.put('/location/dealer/availability', { status });
      toast.success(`Availability set to ${status}`);
      fetchLocation();
    } catch {
      toast.error('Failed to update availability');
    } finally {
      setAvailSaving(false);
    }
  };

  const handleSave = async () => {
    const val = parseFloat(discountPct);
    if (isNaN(val) || val < 0 || val > 100) {
      toast.error('Discount must be between 0 and 100');
      return;
    }
    setSaving(true);
    try {
      await api.put('/admin/settings', { referral_discount_percent: val });
      toast.success('Settings saved!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePayoutSchedule = async () => {
    setPayoutSaving(true);
    try {
      await api.put('/admin/settings', {
        auto_payout_enabled: autoPayoutEnabled ? '1' : '0',
        auto_payout_day:     autoPayoutDay,
        auto_payout_time:    autoPayoutTime,
      });
      toast.success(
        autoPayoutEnabled
          ? `Automated payouts on: every ${DAY_NAMES[Number(autoPayoutDay)]} at ${autoPayoutTime} IST.`
          : 'Automated payouts turned off.'
      );
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save payout schedule');
    } finally {
      setPayoutSaving(false);
    }
  };

  const handleBulkCommission = async () => {
    const rate = parseFloat(bulkRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Rate must be between 0 and 100');
      return;
    }
    setBulkSaving(true);
    try {
      const { data } = await api.put('/admin/bulk/commission-rate', { rate });
      toast.success(`Commission set to ${rate}% for ${data.tradersUpdated} trader${data.tradersUpdated === 1 ? '' : 's'}.`);
      setBulkConfirming(false);
      setBulkRate('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update commission rates');
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 text-sm mt-0.5">Configure platform-wide settings and your delivery location</p>
      </div>

      <div className="card p-6 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
            <Settings className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Consumer Discount</h2>
            <p className="text-xs text-slate-400">Applied to all consumers who have a dealer referral code</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-20">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Info Banner */}
            <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
              <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">How referral discounts work:</p>
                <ul className="space-y-1 list-disc list-inside text-xs text-blue-700">
                  <li>Consumers who sign up or check out with a dealer referral code get this discount on every order.</li>
                  <li>Consumers without any referral code (direct orders) pay full price.</li>
                  <li>Discount is applied to the subtotal before order total is calculated.</li>
                </ul>
              </div>
            </div>

            {/* Discount Input */}
            <div>
              <label className="form-label flex items-center gap-1.5">
                <Percent size={14} />
                Referral Discount Percentage
              </label>
              <div className="flex items-center gap-3 mt-1.5">
                <div className="relative max-w-xs">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={discountPct}
                    onChange={e => setDiscountPct(e.target.value)}
                    className="form-input pr-10 text-lg font-bold text-slate-900"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                </div>
                <div className="flex-1">
                  {parseFloat(discountPct) > 0 && (
                    <p className="text-sm text-emerald-700 font-medium bg-emerald-50 px-3 py-2 rounded-lg">
                      A consumer with referral code gets <strong>{discountPct}% off</strong> every order.
                    </p>
                  )}
                  {parseFloat(discountPct) === 0 && (
                    <p className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                      Discount is currently disabled (0%).
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2">Set to 0 to disable referral discounts entirely.</p>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-2 px-6"
            >
              {saving ? (
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" />
              ) : (
                <Save size={16} />
              )}
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        )}
      </div>
      {/* ── Automated Payouts ─────────────────────────────────────────── */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Automated Payouts</h2>
            <p className="text-xs text-slate-400">Process pending commissions into weekly payouts on a schedule</p>
          </div>
        </div>

        {/* Enable toggle */}
        <label className="flex items-center justify-between cursor-pointer select-none">
          <div>
            <p className="font-semibold text-sm text-slate-800">Run payouts automatically</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Does exactly what the "Process Week" button does, on schedule. You'll get a notification each time it runs.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoPayoutEnabled}
            onClick={() => setAutoPayoutEnabled(v => !v)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              autoPayoutEnabled ? 'bg-brand-600' : 'bg-slate-300'
            }`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
              autoPayoutEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </label>

        {autoPayoutEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label flex items-center gap-1.5">
                <Clock size={14} /> Day of the week
              </label>
              <select
                value={autoPayoutDay}
                onChange={e => setAutoPayoutDay(e.target.value)}
                className="form-input"
              >
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={String(i)}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label flex items-center gap-1.5">
                <Clock size={14} /> Time (IST)
              </label>
              <input
                type="time"
                value={autoPayoutTime}
                onChange={e => setAutoPayoutTime(e.target.value)}
                className="form-input"
              />
            </div>
          </div>
        )}

        {autoPayoutEnabled && (
          <p className="text-xs text-slate-500 bg-parchment-100 border border-[#e8dcc8] rounded-lg px-3 py-2">
            If the server is offline (or this is enabled) after the scheduled time on the scheduled day, the run catches up the same day instead of skipping a week. At most one automatic run per day.
          </p>
        )}

        {autoPayoutLastRun && (
          <p className="text-xs text-slate-400">
            Last automatic run: {new Date(autoPayoutLastRun).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
          </p>
        )}

        <button
          onClick={handleSavePayoutSchedule}
          disabled={payoutSaving}
          className="btn-primary flex items-center gap-2 px-6"
        >
          {payoutSaving
            ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" />
            : <Save size={16} />}
          {payoutSaving ? 'Saving…' : 'Save Schedule'}
        </button>
      </div>

      {/* ── Bulk Trader Commission ────────────────────────────────────── */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Trader Commissions</h2>
            <p className="text-xs text-slate-400">Set every trader's commission rate in one go</p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
          <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800 leading-relaxed">
            This overwrites the rate for <strong>all traders at once</strong>. Individual rates can still be adjusted per trader on the Partners page afterwards. Already-recorded commissions keep the rate they were computed with; only future orders use the new rate.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div className="relative max-w-[10rem]">
            <label className="form-label flex items-center gap-1.5">
              <Percent size={14} /> Rate for all traders
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={bulkRate}
              onChange={e => { setBulkRate(e.target.value); setBulkConfirming(false); }}
              placeholder="e.g. 10"
              className="form-input pr-9 text-lg font-bold text-slate-900"
            />
            <span className="absolute right-3 bottom-3 text-slate-400 font-bold">%</span>
          </div>

          {!bulkConfirming ? (
            <button
              onClick={() => {
                const rate = parseFloat(bulkRate);
                if (isNaN(rate) || rate < 0 || rate > 100) { toast.error('Rate must be between 0 and 100'); return; }
                setBulkConfirming(true);
              }}
              className="btn-secondary px-5"
            >
              Apply to all traders
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkCommission}
                disabled={bulkSaving}
                className="px-5 py-2.5 rounded-[18px] bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {bulkSaving && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                {bulkSaving ? 'Applying…' : `Yes, set every trader to ${bulkRate}%`}
              </button>
              <button
                onClick={() => setBulkConfirming(false)}
                disabled={bulkSaving}
                className="btn-ghost px-4"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Delivery Location ─────────────────────────────────────────── */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
            <Navigation className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Delivery Location</h2>
            <p className="text-xs text-slate-400">Your GPS position is used for order assignment when no trader is nearby</p>
          </div>
        </div>

        {/* Current location display */}
        {location?.latitude && location?.longitude ? (
          <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-1.5">
            <p className="text-xs text-blue-600 font-semibold flex items-center gap-1"><MapPin size={12} /> Current GPS Location</p>
            <p className="text-sm text-blue-900 font-mono">
              {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
            </p>
            {location.h3_index && (
              <p className="text-xs text-blue-500">H3 Cell: <span className="font-mono">{location.h3_index}</span></p>
            )}
          </div>
        ) : (
          <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 flex gap-2">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">GPS location not set</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Without a location, admin is used as a last-resort fallback only — not in H3 spatial search.
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2.5 p-3 rounded-xl bg-amber-50/60 border border-amber-100">
          <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 leading-relaxed">
            <span className="font-semibold">Be at the warehouse / dispatch point</span> when updating GPS. Orders are routed to you based on proximity to customers.
          </p>
        </div>

        <button
          onClick={() => { setGpsError(''); setShowGpsDisclaimer(true); }}
          disabled={gpsUpdating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {gpsUpdating ? (
            <><Loader2 size={18} className="animate-spin" /> Getting location...</>
          ) : (
            <><RefreshCw size={18} />{location?.latitude ? 'Update GPS Location' : 'Set GPS Location'}</>
          )}
        </button>

        {gpsError && (
          <div className="p-3 bg-red-50 rounded-xl border border-red-100">
            <p className="text-xs text-red-700">{gpsError}</p>
          </div>
        )}

        {/* Availability toggle */}
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Availability Status</p>
          <div className="flex gap-2">
            {(['available', 'busy', 'offline'] as const).map(s => (
              <button
                key={s}
                disabled={availSaving}
                onClick={() => handleAvailability(s)}
                className={`flex-1 py-2 text-sm font-medium rounded-xl border transition-colors capitalize disabled:opacity-50 ${
                  location?.availability_status === s
                    ? s === 'available' ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                      : s === 'busy' ? 'bg-amber-100 border-amber-300 text-amber-800'
                      : 'bg-slate-200 border-slate-300 text-slate-700'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* GPS Disclaimer Modal */}
      {showGpsDisclaimer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 bg-white rounded-2xl shadow-xl overflow-hidden animate-fade-in">
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
                <p>By updating your GPS location, you confirm:</p>
                <ul className="space-y-2">
                  <li className="flex gap-2">
                    <span className="text-amber-500 font-bold mt-0.5">1.</span>
                    <span><strong>You are at the warehouse / dispatch point.</strong> This location is used to assign orders when no trader is nearby.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-amber-500 font-bold mt-0.5">2.</span>
                    <span><strong>This replaces your previous location.</strong> Your old GPS and H3 cell will be overwritten.</span>
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
                  Proceed
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
