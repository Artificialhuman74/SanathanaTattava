import React, { useEffect, useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { formatIst } from '../../utils/dateTime';
import { CalendarClock, Loader2, Play } from 'lucide-react';
import LiquidLoader from '../../components/LiquidLoader';

interface Schedule {
  enabled: boolean;
  day: number;
  time: string;          // 'HH:MM', 24h IST
  last_run: string | null;
}

interface RunResult {
  ran: { scheme_name: string; entrants: number; winner_display_name: string }[];
  skipped: { scheme_name: string; reason: string }[];
}

/** "12th", "1st", "22nd" — the ordinal reads better than a bare number in prose. */
function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** '17:00' -> '5:00 PM'. The input stays 24h; only the sentence is friendly. */
function friendlyTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * When the monthly draw runs, and a way to run it now.
 *
 * The schedule is a business rule the founder should be able to move without a
 * deploy: the spec fixes it at the 12th at 5PM IST, but a festival week or a
 * delivery backlog is a reason to shift it. Day 28 is the ceiling because a
 * monthly schedule set to the 29th or later would silently skip February.
 */
export default function DrawSchedulePanel() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [maxDay, setMaxDay] = useState(28);
  const [draft, setDraft] = useState<{ day: string; time: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/lucky-draw/admin/draw-schedule', { skipBaseRotation: true });
      setSchedule(data.schedule);
      setMaxDay(data.max_day ?? 28);
      setDraft({ day: String(data.schedule.day), time: data.schedule.time });
    } catch {
      toast.error("Couldn't load the draw schedule");
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (patch: Partial<Schedule>) => {
    setSaving(true);
    try {
      const { data } = await api.put('/lucky-draw/admin/draw-schedule', patch, { skipBaseRotation: true });
      setSchedule(data.schedule);
      setDraft({ day: String(data.schedule.day), time: data.schedule.time });
      toast.success('Draw schedule updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Couldn't save the schedule");
      // Put the inputs back to what the server actually holds, so the form
      // never sits showing a value that was rejected.
      if (schedule) setDraft({ day: String(schedule.day), time: schedule.time });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data } = await api.post<RunResult>('/lucky-draw/admin/run-draw-now', {}, { skipBaseRotation: true });
      if (data.ran.length) {
        toast.success(data.ran.map(r => `${r.scheme_name}: ${r.winner_display_name} won (${r.entrants} entrants)`).join('\n'));
      } else {
        toast(data.skipped[0]?.reason || 'No running schemes to draw');
      }
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Couldn't run the draw");
    } finally {
      setRunning(false);
    }
  };

  if (!schedule || !draft) {
    return <div className="card p-8 flex justify-center"><LiquidLoader size={64} /></div>;
  }

  const dirty = draft.day !== String(schedule.day) || draft.time !== schedule.time;

  return (
    <section className="card p-5 sm:p-6 mb-8" aria-labelledby="draw-schedule-heading">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <div className="flex items-center gap-2.5">
          <CalendarClock size={16} className="text-slate-500" />
          <h3 id="draw-schedule-heading" className="font-bold text-slate-900 text-sm">Draw schedule</h3>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs font-semibold text-slate-600">
            {schedule.enabled ? 'Running automatically' : 'Paused'}
          </span>
          <span className="relative inline-flex">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={schedule.enabled}
              disabled={saving}
              onChange={e => save({ enabled: e.target.checked })}
            />
            <span className="w-9 h-5 rounded-full bg-slate-300 peer-checked:bg-brand-600 transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-brand-600 peer-disabled:opacity-50" />
            <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 peer-checked:translate-x-4" />
          </span>
        </label>
      </div>

      <p className="text-xs text-slate-400 mb-5">
        {schedule.enabled
          ? `Every month on the ${ordinal(schedule.day)} at ${friendlyTime(schedule.time)} IST, one winner is picked per running scheme from everyone who ordered that month.`
          : 'Automatic draws are paused. Nothing will be drawn until this is switched back on, or you run one by hand.'}
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="draw-day" className="block text-xs font-semibold text-slate-600 mb-1.5">Day of month</label>
          <input
            id="draw-day"
            type="number"
            min={1}
            max={maxDay}
            value={draft.day}
            onChange={e => setDraft({ ...draft, day: e.target.value })}
            className="form-input w-24 py-2"
          />
        </div>
        <div>
          <label htmlFor="draw-time" className="block text-xs font-semibold text-slate-600 mb-1.5">Time (IST)</label>
          <input
            id="draw-time"
            type="time"
            value={draft.time}
            onChange={e => setDraft({ ...draft, time: e.target.value })}
            className="form-input w-32 py-2"
          />
        </div>

        {dirty && (
          <button
            onClick={() => save({ day: Number(draft.day), time: draft.time })}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-semibold transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
            style={{ minHeight: 38 }}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save schedule
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-400 mt-4">
        Orders count right up to the moment the draw runs, so this time is the entry deadline too. Day 1 to {maxDay} only, so the draw never lands on a date February doesn&rsquo;t have.
      </p>

      <div className="mt-5 pt-4 border-t border-[#e8dcc8] flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {schedule.last_run
            ? <>Last automatic run: <span className="font-medium text-slate-700">{formatIst(schedule.last_run)}</span></>
            : 'No automatic run yet.'}
        </p>
        <button
          onClick={runNow}
          disabled={running}
          className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
          style={{ minHeight: 38 }}
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {running ? 'Drawing…' : 'Run this month now'}
        </button>
      </div>
    </section>
  );
}
