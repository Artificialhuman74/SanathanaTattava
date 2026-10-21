import { useEffect, useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Smartphone, Info } from 'lucide-react';

/**
 * The oldest Android build each app may run. Phones on an older build see
 * "Update to keep using the app" at launch, with only a Play Store button.
 * Newer versions on the Play Store are offered to everyone anyway; this is for
 * when an old build must stop working (for example, after a breaking server change).
 */
export default function AppUpdateSettings({ settings }: { settings: Record<string, string> }) {
  const [consumer, setConsumer] = useState('0');
  const [delivery, setDelivery] = useState('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setConsumer(String(settings.app_min_version_consumer ?? 0));
    setDelivery(String(settings.app_min_version_delivery ?? 0));
  }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', {
        app_min_version_consumer: Number(consumer) || 0,
        app_min_version_delivery: Number(delivery) || 0,
      });
      toast.success('App update rules saved');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
        <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
          <Smartphone className="w-5 h-5 text-brand-600" />
        </div>
        <div>
          <h2 className="font-bold text-slate-900">App updates</h2>
          <p className="text-xs text-slate-400">Make old Android builds update before they open</p>
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
        <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-semibold mb-1">How updates are shown</p>
          <ul className="list-disc pl-4 text-xs leading-relaxed text-blue-700">
            <li>When a newer version is live on the Play Store, both apps offer it at launch. Customers can tap “Not now”.</li>
            <li>Builds older than the version code below can’t skip it: they only get “Update on Play Store”.</li>
            <li>Use the version code (the whole number Play Console shows, e.g. 9), not the name (e.g. 7.2). 0 means no requirement.</li>
          </ul>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="form-label mb-0">Sanathana Tattva app · oldest allowed</span>
          <input type="number" min={0} step={1} value={consumer} onChange={e => setConsumer(e.target.value)} className="form-input text-lg font-bold text-slate-900" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="form-label mb-0">ST Delivery app · oldest allowed</span>
          <input type="number" min={0} step={1} value={delivery} onChange={e => setDelivery(e.target.value)} className="form-input text-lg font-bold text-slate-900" />
        </label>
      </div>

      <button disabled={saving} onClick={save} className="btn-primary px-6">
        Save update rules
      </button>
    </div>
  );
}
