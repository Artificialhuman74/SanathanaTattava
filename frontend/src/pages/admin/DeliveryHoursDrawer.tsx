import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Copy, Loader2, X } from 'lucide-react';
import { timeAgo } from '../../utils/dateTime';

/**
 * Admin edits a shop's delivery hours (handoff §4.10, canvas "AdminHours"): one row per day
 * with an open switch, a bar on a 6 AM–10 PM track, and half-hour steppers. Same rules as
 * the shop's own screen in ST Partner (backend services/deliveryHours.js).
 */

interface Day { weekday: number; enabled: boolean; start: number; end: number }

const MIN = 360;
const MAX = 1320;
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const clock = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/** Where a time sits on the 6 AM–10 PM track, and how wide a span is on it. */
const at = (m: number) => `${(((m - MIN) / (MAX - MIN)) * 100).toFixed(2)}%`;
const span = (mins: number) => `${((mins / (MAX - MIN)) * 100).toFixed(2)}%`;

function Stepper({ value, onDown, onUp, downLabel, upLabel }: {
  value: number; onDown: () => void; onUp: () => void; downLabel: string; upLabel: string;
}) {
  const step = 'w-7 h-7 rounded-lg border border-surface-300 bg-surface-50 text-slate-700 grid place-items-center hover:bg-parchment-200 transition-colors';
  return (
    <span className="flex items-center gap-1">
      <button type="button" className={step} onClick={onDown} aria-label={downLabel}><ChevronLeft size={14} /></button>
      <span className="flex-1 text-center text-[13px] font-semibold tabular-nums whitespace-nowrap">{clock(value)}</span>
      <button type="button" className={step} onClick={onUp} aria-label={upLabel}><ChevronRight size={14} /></button>
    </span>
  );
}

export default function DeliveryHoursDrawer({ shop, onClose, onSaved }: {
  shop: { id: number; name: string };
  onClose: () => void;
  onSaved: (summary: string) => void;
}) {
  const [days, setDays] = useState<Day[] | null>(null);
  const [editor, setEditor] = useState<{ name: string | null; role: string | null; at: string | null }>({ name: null, role: null, at: null });
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const firstName = shop.name.split(/\s+/)[0];

  useEffect(() => {
    api.get(`/admin/dispatch/hours/${shop.id}`)
      .then(({ data }) => {
        setDays(data.days);
        setEditor({ name: data.updated_by_name, role: data.updated_by_role, at: data.updated_at });
      })
      .catch(() => { toast.error('Could not load hours'); onClose(); });
  }, [shop.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setDay = (i: number, patch: Partial<Day>) =>
    setDays((prev) => prev && prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const copyMonday = () =>
    setDays((prev) => prev && prev.map((d, j) => (j > 0 && j < 5 ? { ...prev[0], weekday: j } : d)));

  const save = async () => {
    if (!days) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/admin/dispatch/hours/${shop.id}`, {
        days: days.map(({ enabled, start, end }) => ({ enabled, start, end })),
        notify,
      });
      toast.success('Hours saved');
      onSaved(data.summary);
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save hours');
    } finally {
      setSaving(false);
    }
  };

  const changedBy = editor.at
    ? `Last changed by ${editor.name || 'someone'}${editor.role === 'admin' ? ' (admin)' : editor.role === 'trader' ? ' (shop)' : ''} · ${timeAgo(editor.at)}`
    : 'Not set yet · these are the starting hours';

  // Portal: the page wrapper animates with a transform, which would pin "fixed" to it, not the screen.
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/35" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="hours-title"
        className="hours-drawer absolute top-0 right-0 bottom-0 w-full max-w-[560px] bg-surface-50 border-l border-surface-300 shadow-2xl flex flex-col"
      >
        <div className="px-6 py-5 border-b border-surface-300 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 id="hours-title" className="text-lg font-bold text-slate-900">Delivery hours · {shop.name}</h2>
            <p className="text-[13px] text-slate-500 mt-1">{changedBy}</p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full grid place-items-center text-slate-500 hover:bg-parchment-200">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!days ? (
            <div className="h-48 grid place-items-center"><Loader2 className="animate-spin text-brand-600" /></div>
          ) : (
            <>
              <div aria-hidden="true" className="hidden sm:grid grid-cols-[56px_44px_1fr_116px_116px] gap-2.5 pb-1.5 text-xs font-semibold text-[#5c3d1a]">
                <span>Day</span><span>Open</span><span>6 AM ··· 10 PM</span><span>Opens</span><span>Closes</span>
              </div>
              {days.map((d, i) => (
                <div
                  key={d.weekday}
                  className="grid grid-cols-[56px_44px_1fr] sm:grid-cols-[56px_44px_1fr_116px_116px] gap-2.5 items-center min-h-12 py-1.5 border-t border-parchment-200"
                >
                  <span className="text-sm font-semibold text-[#3d2e1a]">{SHORT[i]}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={d.enabled}
                    aria-label={`${NAMES[i]} ${d.enabled ? 'open' : 'closed'}`}
                    onClick={() => setDay(i, { enabled: !d.enabled })}
                    className={`relative w-10 h-[22px] rounded-full transition-colors ${d.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-[left] duration-200 ${d.enabled ? 'left-[21px]' : 'left-[3px]'}`} />
                  </button>
                  <span aria-hidden="true" className="relative h-3 rounded-full bg-parchment-200">
                    {d.enabled && (
                      <span className="hours-bar absolute inset-y-0 rounded-full bg-brand-600" style={{ left: at(d.start), width: span(d.end - d.start) }} />
                    )}
                  </span>
                  {d.enabled ? (
                    <div className="col-span-3 sm:col-span-2 grid grid-cols-2 gap-2.5">
                      <Stepper
                        value={d.start}
                        onDown={() => setDay(i, { start: Math.max(MIN, d.start - 30) })}
                        onUp={() => setDay(i, { start: Math.min(d.end - 60, d.start + 30) })}
                        downLabel={`${NAMES[i]} open earlier`} upLabel={`${NAMES[i]} open later`}
                      />
                      <Stepper
                        value={d.end}
                        onDown={() => setDay(i, { end: Math.max(d.start + 60, d.end - 30) })}
                        onUp={() => setDay(i, { end: Math.min(MAX, d.end + 30) })}
                        downLabel={`${NAMES[i]} close earlier`} upLabel={`${NAMES[i]} close later`}
                      />
                    </div>
                  ) : (
                    <span className="col-span-3 sm:col-span-2 text-[13px] text-slate-500">Closed — orders wait for the next open day</span>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={copyMonday}
                className="mt-2.5 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold text-brand-600 hover:bg-parchment-200"
              >
                <Copy size={16} /> Copy Monday to all weekdays
              </button>

              <label className="mt-2 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-parchment-100 border border-surface-300 text-[13px] text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-brand-600"
                />
                <span><strong className="text-slate-900">Tell {firstName} about this change</strong><br />They get a notification in the ST Partner app.</span>
              </label>
            </>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-surface-300 flex justify-end gap-2.5">
          <button onClick={onClose} className="px-5 py-2.5 rounded-2xl border border-surface-300 bg-surface-50 text-sm font-semibold text-slate-700 hover:bg-parchment-200">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!days || saving}
            className="px-5 py-2.5 rounded-2xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />} Save hours
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
