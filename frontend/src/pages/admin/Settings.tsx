import React, { useEffect, useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Settings, Percent, Save, Info } from 'lucide-react';

export default function AdminSettings() {
  const [discountPct, setDiscountPct] = useState<string>('10');
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    api.get('/admin/settings')
      .then(r => setDiscountPct(String(r.data.referral_discount_percent ?? 10)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 text-sm mt-0.5">Configure platform-wide settings</p>
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
    </div>
  );
}
