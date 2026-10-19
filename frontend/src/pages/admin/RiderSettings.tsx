import { useEffect, useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Bike, Info, Timer, Radio } from 'lucide-react';

/**
 * ST Partner rider deliveries: the rider's flat fee, which comes out of the linked trader's
 * commission when a rider delivers, plus the switch that sends paid orders through the app's
 * dispatch (ring the shop, then riders).
 */
export default function RiderSettings({ settings }: { settings: Record<string, string> }) {
  const [fee, setFee] = useState('45');
  const [dispatchOn, setDispatchOn] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFee(String(settings.rider_fee_per_delivery ?? 45));
    setDispatchOn(String(settings.partner_dispatch_enabled ?? '0') === '1');
  }, [settings]);

  const num = (v: string, d: number) => (v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  const usual = 124;
  const riderCut = Math.min(num(fee, 0), usual);
  const traderCut = usual - riderCut;

  const save = async (patch: Record<string, unknown>, done: string) => {
    setSaving(true);
    try {
      await api.put('/admin/settings', patch);
      toast.success(done);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
            <Bike className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Rider deliveries</h2>
            <p className="text-xs text-slate-400">Used when an outside rider delivers a trader’s order</p>
          </div>
          <span className="ml-auto badge bg-amber-100 text-amber-700">New</span>
        </div>

        <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
          <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-1">How rider orders are paid</p>
            <ul className="list-disc pl-4 text-xs leading-relaxed text-blue-700">
              <li>The rider gets the fixed fee below, sent to their bank (Razorpay Route) after delivery.</li>
              <li>It comes out of the linked trader’s commission; the trader keeps the rest.</li>
              <li>If the commission is smaller than the fee, the rider gets the whole commission.</li>
              <li>Orders the founder delivers still route as they do today.</li>
            </ul>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="form-label mb-0">Rider fee per delivery</span>
            <span className="relative block">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-500">₹</span>
              <input type="number" min={0} step={1} value={fee} onChange={e => setFee(e.target.value)} className="form-input pl-9 text-lg font-bold text-slate-900" />
            </span>
          </label>
        </div>

        <div aria-live="polite" className="rounded-2xl bg-parchment-50 border border-parchment-200 px-4 py-3.5">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-earth-700">Example · ₹1,240 order, 10% commission</p>
          <div className="grid gap-2.5 sm:grid-cols-3">
            <Example label="Trader delivers it" value={`₹${usual}`} who="to trader" />
            <Example label="Rider delivers it" value={`₹${traderCut}`} who="to trader" />
            <Example label="…and" value={`₹${riderCut}`} who="to rider" />
          </div>
        </div>

        <button
          disabled={saving}
          onClick={() => save({ rider_fee_per_delivery: num(fee, 45) }, 'Rider settings saved')}
          className="btn-primary px-6"
        >
          Save rider settings
        </button>
      </div>

      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
            <Timer className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Dispatch rules</h2>
            <p className="text-xs text-slate-400">Fixed for now. Shown here so you know what partners see.</p>
          </div>
        </div>
        <dl className="grid gap-2.5 grid-cols-2 sm:grid-cols-4">
          <Rule label="Time to accept" value="20 min" />
          <Rule label="Reminder ring" value="Every 2 min" />
          <Rule label="Alert you if no rider" value="After 30 min" />
          <Rule label="Auto-offline after" value="3 missed" />
        </dl>
        <div className="flex items-center gap-3 rounded-xl border border-parchment-200 bg-white px-4 py-3">
          <Radio className="w-5 h-5 text-brand-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">Send paid orders through the ST Partner app</p>
            <p className="text-xs text-slate-500">Rings the shop first, then nearby riders. Orders paid before you switch this on stay as they are.</p>
          </div>
          <button
            role="switch"
            aria-checked={dispatchOn}
            disabled={saving}
            onClick={() => {
              const next = !dispatchOn;
              setDispatchOn(next);
              save({ partner_dispatch_enabled: next ? '1' : '0' }, next ? 'Orders now ring partners in the app' : 'App dispatch turned off');
            }}
            className={`relative h-7 w-12 rounded-full transition-colors ${dispatchOn ? 'bg-brand-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${dispatchOn ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
      </div>
    </>
  );
}

function Example({ label, value, who }: { label: string; value: string; who: string }) {
  return (
    <div className="rounded-xl bg-white border border-parchment-100 px-3 py-2.5">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold text-slate-900">
        {value} <span className="text-xs font-medium text-slate-500">{who}</span>
      </p>
    </div>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-parchment-50 px-3 py-2.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-base font-bold text-slate-900">{value}</dd>
    </div>
  );
}
