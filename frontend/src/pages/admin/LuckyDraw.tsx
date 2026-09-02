import React, { useEffect, useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import ChakraIcon from '../../components/luckyDraw/ChakraIcon';
import { LUCKY_DRAW_NAME } from '../../config/luckyDraw';
import DrawSchedulePanel from '../../components/luckyDraw/DrawSchedulePanel';
import { Plus, X, Loader2, Users, Gift, Play, Pause, Square, Trophy, Ticket, CalendarClock, AlertTriangle } from 'lucide-react';
import LiquidLoader from '../../components/LiquidLoader';
import EligibilityTree from '../../components/luckyDraw/EligibilityTree';

interface Scheme {
  id: number;
  name: string;
  status: string;
  joining_fee: number;
  enrollment_closes_at: string;
  starts_at: string;
  ends_at: string;
  enrolled_count: number;
  won_count: number;
  qualified_this_month: number;
  /** 1 only when a consumer can actually join right now. The status alone
   *  does not answer this: a lapsed window leaves it at 'enrollment_open'. */
  enrollment_open_now: number;
  draws_held: number;
}

type SchemeAction = 'start' | 'pause' | 'resume' | 'end';

/** What the admin can do to a scheme in each state (spec §9.2). Anything not
 *  listed is refused server-side too, so this only decides what to render. */
const ACTIONS: Record<string, { action: SchemeAction; label: string; icon: React.ElementType; danger?: boolean }[]> = {
  enrollment_open: [
    { action: 'start', label: 'Start round now', icon: Play },
    { action: 'end', label: 'Cancel', icon: Square, danger: true },
  ],
  running: [
    { action: 'pause', label: 'Pause', icon: Pause },
    { action: 'end', label: 'End round', icon: Square, danger: true },
  ],
  paused: [
    { action: 'resume', label: 'Resume', icon: Play },
    { action: 'end', label: 'End round', icon: Square, danger: true },
  ],
};

const STATUS_LABEL: Record<string, string> = {
  enrollment_open: 'Enrolling',
  running: 'Running',
  paused: 'Paused',
  ended: 'Ended',
  draft: 'Draft',
};

const STATUS_STYLE: Record<string, string> = {
  enrollment_open: 'bg-emerald-100 text-emerald-700',
  running: 'bg-brand-100 text-brand-700',
  paused: 'bg-amber-100 text-amber-800',
  ended: 'bg-slate-100 text-slate-600',
};

/** Ending or cancelling a round can't be undone, so it asks first. */
const CONFIRM: Partial<Record<SchemeAction, (name: string) => string>> = {
  start: n => `Start ${n} now? Enrollment closes immediately and the 12-month round begins today. Nobody new can join after this.`,
  end: n => `End ${n}? The round stops for everyone in it and no further draws will run. This can't be undone.`,
};

type Enrollment = import('../../components/luckyDraw/EligibilityTree').TreeEnrollment;

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function AdminLuckyDraw() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', joining_fee: '100', enrollment_closes_at: '' });

  const fetchAll = async () => {
    const [s, e] = await Promise.all([
      api.get('/lucky-draw/admin/schemes', { skipBaseRotation: true }),
      api.get('/lucky-draw/admin/enrollments', { skipBaseRotation: true }),
    ]);
    setSchemes(s.data.schemes || []);
    setEnrollments(e.data.enrollments || []);
  };

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, []);

  const [actingOn, setActingOn] = useState<string | null>(null);

  const act = async (scheme: Scheme, action: SchemeAction) => {
    const confirmText = CONFIRM[action]?.(scheme.name);
    if (confirmText && !window.confirm(confirmText)) return;
    setActingOn(`${scheme.id}-${action}`);
    try {
      await api.post(`/lucky-draw/admin/schemes/${scheme.id}/status`, { action }, { skipBaseRotation: true });
      await fetchAll();
      toast.success(`${scheme.name} is now ${action === 'end' ? 'ended' : action === 'pause' ? 'paused' : 'running'}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || `Couldn't ${action} the scheme`);
    } finally {
      setActingOn(null);
    }
  };

  /* Reopening a lapsed window. Kept next to the card it belongs to rather than
   * in the create form: it is a repair to one scheme, and the admin gets here
   * because that scheme is broken. */
  const [reopening, setReopening] = useState<{ id: number; date: string } | null>(null);

  const reopen = async (scheme: Scheme) => {
    if (!reopening?.date) { toast.error('Pick a new closing date'); return; }
    setActingOn(`${scheme.id}-reopen`);
    try {
      await api.put(`/lucky-draw/admin/schemes/${scheme.id}/enrollment`, {
        enrollment_closes_at: new Date(reopening.date).toISOString(),
      }, { skipBaseRotation: true });
      setReopening(null);
      await fetchAll();
      toast.success(`${scheme.name} is open for enrollment again`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Couldn't reopen enrollment");
    } finally {
      setActingOn(null);
    }
  };

  const openNew = () => {
    const nextNumber = schemes.length + 1;
    setForm({ name: `Scheme ${nextNumber}`, joining_fee: '100', enrollment_closes_at: '' });
    setShowForm(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.enrollment_closes_at) {
      toast.error('Name and enrollment closing date are required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/lucky-draw/admin/schemes', {
        name: form.name.trim(),
        joining_fee: parseFloat(form.joining_fee) || 0,
        enrollment_closes_at: new Date(form.enrollment_closes_at).toISOString(),
      }, { skipBaseRotation: true });
      toast.success(`${form.name.trim()} is live for enrollment`);
      setShowForm(false);
      await fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not create scheme');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <ChakraIcon size={26} className="text-gold-600" />
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{LUCKY_DRAW_NAME}</h2>
            <p className="text-slate-500 text-sm">Create rounds and see who's enrolled, by trader</p>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white rounded-xl text-sm font-semibold transition-colors"
        >
          <Plus size={16} /> New scheme
        </button>
      </div>

      {loading ? (
        <div className="card p-10 flex justify-center"><LiquidLoader size={72} /></div>
      ) : (
        <>
          <DrawSchedulePanel />

          {/* Schemes */}
          {schemes.length === 0 ? (
            <div className="card p-10 text-center mb-8">
              <ChakraIcon size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="font-medium text-lg text-slate-700">No schemes yet</p>
              <p className="text-slate-400 text-sm mt-1 mb-5">Create the first round to open enrollment to consumers.</p>
              <button onClick={openNew} className="btn-primary px-6 py-2">
                <Plus size={16} className="inline mr-1.5" /> Create Scheme 1
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {schemes.map(s => (
                <div key={s.id} className="card p-5 flex flex-col">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="font-bold text-slate-900 truncate">{s.name}</p>
                    {/* A lapsed window leaves the status at 'enrollment_open',
                        so reading the chip off the status alone showed a green
                        "Enrolling" for a round no consumer could join. */}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      s.status === 'enrollment_open' && !s.enrollment_open_now
                        ? 'bg-red-100 text-red-700'
                        : STATUS_STYLE[s.status] || 'bg-slate-100 text-slate-600'
                    }`}>
                      {s.status === 'enrollment_open' && !s.enrollment_open_now
                        ? 'Closed'
                        : STATUS_LABEL[s.status] || s.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 mb-3">
                    {s.status === 'enrollment_open'
                      ? s.enrollment_open_now
                        ? <>Enrollment closes {fmtDate(s.enrollment_closes_at)}</>
                        : <>Enrollment closed {fmtDate(s.enrollment_closes_at)}</>
                      : s.status === 'ended'
                        ? <>Ran until {fmtDate(s.ends_at)}</>
                        : <>Round ends {fmtDate(s.ends_at)}</>}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
                    <span className="flex items-center gap-1"><Users size={13} className="text-slate-400" /> {s.enrolled_count} enrolled</span>
                    {s.status === 'running' && (
                      <span className="flex items-center gap-1" title="Qualified for the month in progress">
                        <Ticket size={13} className="text-slate-400" /> {s.qualified_this_month} in this draw
                      </span>
                    )}
                    {s.won_count > 0 && (
                      <span className="flex items-center gap-1"><Trophy size={13} className="text-slate-400" /> {s.won_count} won</span>
                    )}
                    <span>₹{s.joining_fee} fee</span>
                  </div>

                  {/* The failure that actually reached consumers: the window
                      lapsed, the round was invisible in the shop, and nothing
                      on this page said so or could undo it. */}
                  {s.status === 'enrollment_open' && !s.enrollment_open_now && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                      <p className="text-xs text-red-800 font-semibold flex items-start gap-1.5">
                        <AlertTriangle size={13} className="mt-px flex-shrink-0" />
                        No one can join. The enrollment window has passed, so this round is not shown to consumers.
                      </p>
                      {s.draws_held === 0 && (
                        reopening?.id === s.id ? (
                          <div className="flex flex-wrap items-center gap-2 mt-2.5">
                            <input
                              type="datetime-local"
                              value={reopening.date}
                              onChange={e => setReopening({ id: s.id, date: e.target.value })}
                              className="input text-xs py-1 px-2 flex-1 min-w-[11rem]"
                            />
                            <button
                              onClick={() => reopen(s)}
                              disabled={actingOn !== null}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
                            >
                              {actingOn === `${s.id}-reopen`
                                ? <Loader2 size={12} className="animate-spin" />
                                : <CalendarClock size={12} />}
                              Reopen
                            </button>
                            <button onClick={() => setReopening(null)} className="text-xs text-red-700 hover:underline">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setReopening({ id: s.id, date: '' })}
                            className="mt-2 text-xs font-semibold text-red-700 hover:underline inline-flex items-center gap-1.5"
                          >
                            <CalendarClock size={12} /> Reopen enrollment on a new date
                          </button>
                        )
                      )}
                    </div>
                  )}

                  {s.status === 'paused' && (
                    <p className="text-xs text-amber-700 mt-3">
                      Draws are skipped while paused. Orders still count toward the month.
                    </p>
                  )}

                  {ACTIONS[s.status] && (
                    <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#e8dcc8]">
                      {ACTIONS[s.status].map(({ action, label, icon: Icon, danger }) => (
                        <button
                          key={action}
                          onClick={() => act(s, action)}
                          disabled={actingOn !== null}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 ${
                            danger ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {actingOn === `${s.id}-${action}`
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Icon size={12} />}
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Enrollments by trader */}
          <h3 className="font-bold text-slate-900 mb-3">Enrolled consumers, by trader</h3>
          {enrollments.length === 0 ? (
            <div className="card p-10 text-center">
              <Gift size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="font-medium text-lg text-slate-700">No one&rsquo;s enrolled yet</p>
              <p className="text-slate-400 text-sm mt-1">Consumers will show up here, grouped by their linked trader, as they join.</p>
            </div>
          ) : (
            <EligibilityTree rows={enrollments} />
          )}
        </>
      )}

      {/* New scheme modal — this is the one place a modal earns its keep
          here: a short, one-off creation form, not a navigation dead-end. */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-[#e8dcc8]">
              <h3 className="font-bold text-slate-900">New scheme</h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-parchment-200 text-slate-400">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div>
                <label className="form-label">Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="form-input"
                  placeholder="Scheme 1"
                  required
                />
              </div>
              <div>
                <label className="form-label">Joining fee (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={form.joining_fee}
                  onChange={e => setForm(f => ({ ...f, joining_fee: e.target.value }))}
                  className="form-input"
                  required
                />
              </div>
              <div>
                <label className="form-label">Enrollment closes on</label>
                <input
                  type="date"
                  value={form.enrollment_closes_at}
                  onChange={e => setForm(f => ({ ...f, enrollment_closes_at: e.target.value }))}
                  className="form-input"
                  min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                  required
                />
                <p className="text-xs text-slate-400 mt-1">The round runs for 12 months starting this date.</p>
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-full py-2.5 flex items-center justify-center gap-2">
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? 'Creating…' : 'Create scheme'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
