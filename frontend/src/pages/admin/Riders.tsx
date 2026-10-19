import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Bike, Check, CheckCheck, Lock, X, ZoomIn } from 'lucide-react';
import { formatIst, timeAgo } from '../../utils/dateTime';
import LiquidLoader from '../../components/LiquidLoader';

/* Rider applications from the ST Partner app (backend: routes/adminRiders.js).
 * Each item gets "Looks good" or "Problem + reason". Approve needs every item
 * checked and none flagged; "Send back" sends the reasons to the rider, who
 * fixes only those items in the app and resends. */

type Status = 'pending_review' | 'approved' | 'rejected';
type Mark = 'ok' | 'bad';
type ItemKey = 'selfie' | 'licence_front' | 'licence_back' | 'pan' | 'bank' | 'vehicle' | 'emergency' | 'base';
type PhotoKind = 'selfie' | 'licence_front' | 'licence_back' | 'pan_photo';

interface RiderRow {
  id: number;
  name: string;
  phone: string;
  email: string;
  vehicle_type: string | null;
  vehicle_plate: string | null;
  review_status: Status;
  review_submitted_at: string | null;
  reviewed_at: string | null;
  base_label: string | null;
  base_address: string | null;
  resubmitted: boolean;
}

interface RiderDetail {
  id: number;
  name: string;
  phone: string;
  email: string;
  review_status: Status;
  review_issues: { item: ItemKey; reason: string }[];
  review_submitted_at: string | null;
  reviewed_at: string | null;
  vehicle_type: string | null;
  vehicle_plate: string | null;
  licence_number: string | null;
  pan: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_phone: string | null;
  base: { label: string; address: string; latitude: number; longitude: number } | null;
  photos: Record<PhotoKind, boolean>;
}

const TABS: { status: Status; label: string }[] = [
  { status: 'pending_review', label: 'Waiting' },
  { status: 'approved', label: 'Approved' },
  { status: 'rejected', label: 'Sent back' },
];

const VEHICLE: Record<string, string> = { walk: 'Walking', cycle: 'Cycle', scooter: 'Scooter', bike: 'Bike' };
const cap = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const mobile = (p?: string | null) => (p && p.length === 10 ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : p || '');
const shortPlace = (a?: string | null) => (a ? a.split(',').slice(0, 2).join(',').trim() : '');

interface Item {
  key: ItemKey;
  title: string;
  detail: string;
  photo?: PhotoKind;
}

function itemsFor(r: RiderDetail): Item[] {
  const motor = r.vehicle_type === 'scooter' || r.vehicle_type === 'bike';
  const list: Item[] = [{ key: 'selfie', title: 'Selfie', detail: 'Taken live in the app', photo: 'selfie' }];
  if (motor) {
    list.push(
      { key: 'licence_front', title: 'Driving licence · front', detail: r.licence_number || '', photo: 'licence_front' },
      { key: 'licence_back', title: 'Driving licence · back', detail: 'Photo of the back side', photo: 'licence_back' },
    );
  }
  list.push(
    { key: 'pan', title: 'PAN card', detail: r.pan || '', photo: 'pan_photo' },
    {
      key: 'bank',
      title: 'Bank account',
      detail: [r.bank_account_name, r.bank_account_number && `A/c ${r.bank_account_number}`, r.bank_ifsc].filter(Boolean).join(' · '),
    },
    { key: 'vehicle', title: 'Vehicle', detail: [VEHICLE[r.vehicle_type || ''] || '', r.vehicle_plate].filter(Boolean).join(' · ') },
    {
      key: 'emergency',
      title: 'Emergency contact',
      detail: [r.emergency_name, cap(r.emergency_relation), mobile(r.emergency_phone)].filter(Boolean).join(' · '),
    },
    { key: 'base', title: 'Start place', detail: r.base ? `${cap(r.base.label)} · ${r.base.address}` : '' },
  );
  return list;
}

/** KYC photos are admin-only: fetched with the auth header, shown from a blob URL.
 *  Grids load the ~480px thumbnail; the full photo is fetched only when zoomed. */
function useKycPhoto(riderId: number | null, kind: PhotoKind | undefined, present: boolean, size: 'thumb' | 'full' = 'thumb') {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!riderId || !kind || !present) { setUrl(null); return; }
    let objectUrl: string | null = null;
    let cancelled = false;
    api.get(`/admin/riders/${riderId}/kyc/${kind}`, { params: size === 'thumb' ? { size } : {}, responseType: 'blob', skipBaseRotation: true })
      .then((r) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(r.data);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [riderId, kind, present, size]);
  return url;
}

function Zoomed({ riderId, kind, title, onClose }: { riderId: number; kind: PhotoKind; title: string; onClose: () => void }) {
  const full = useKycPhoto(riderId, kind, true, 'full');
  return (
    <div role="dialog" aria-label={title} className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-6" onClick={onClose}>
      <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
        {full
          ? <img src={full} alt={title} className="w-full max-h-[80vh] object-contain rounded-2xl bg-black" />
          : <div className="h-[60vh] grid place-items-center rounded-2xl bg-black/40"><LiquidLoader size={56} /></div>}
        <div className="mt-3 flex items-center justify-between text-white">
          <p className="font-semibold">{title}</p>
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25">
            <X className="w-4 h-4" /> Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemCard({
  item, riderId, present, mark, reason, readOnly, onMark, onReason, onZoom,
}: {
  item: Item;
  riderId: number;
  present: boolean;
  mark: Mark | undefined;
  reason: string;
  readOnly: boolean;
  onMark: (m: Mark) => void;
  onReason: (r: string) => void;
  onZoom: (kind: PhotoKind, title: string) => void;
}) {
  const photoUrl = useKycPhoto(riderId, item.photo, present);
  const border = mark === 'bad' ? 'border-red-300' : mark === 'ok' ? 'border-green-300' : 'border-[#e8dcc8]';
  return (
    <div className={`rounded-[18px] bg-white border-[1.5px] ${border} p-3 flex flex-col gap-2.5`}>
      <div className="flex gap-3 items-start">
        {item.photo ? (
          <button
            type="button"
            disabled={!photoUrl}
            onClick={() => photoUrl && item.photo && onZoom(item.photo, item.title)}
            className="relative w-[88px] h-[66px] flex-none rounded-[10px] bg-[#f5ede0] overflow-hidden group"
            aria-label={`Open ${item.title} photo`}
          >
            {photoUrl
              ? <img src={photoUrl} alt="" className="w-full h-full object-cover" />
              : <span className="text-[11px] text-slate-500">{present ? 'Loading…' : 'No photo'}</span>}
            {photoUrl && (
              <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 grid place-items-center transition-colors">
                <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100" />
              </span>
            )}
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">{item.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600 break-words">{item.detail || '—'}</p>
        </div>
      </div>
      {!readOnly && (
        <>
          <div role="radiogroup" aria-label={`${item.title} check`} className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              role="radio"
              aria-checked={mark === 'ok'}
              onClick={() => onMark('ok')}
              className={`h-[34px] rounded-[10px] border-[1.5px] text-[13px] font-semibold transition-colors ${
                mark === 'ok' ? 'border-brand-600 bg-brand-600 text-white' : 'border-[#e8dcc8] bg-[#fffbf2] text-slate-700 hover:bg-[#fdf8f0]'
              }`}
            >
              Looks good
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mark === 'bad'}
              onClick={() => onMark('bad')}
              className={`h-[34px] rounded-[10px] border-[1.5px] text-[13px] font-semibold transition-colors ${
                mark === 'bad' ? 'border-red-600 bg-red-50 text-red-700' : 'border-[#e8dcc8] bg-[#fffbf2] text-slate-700 hover:bg-[#fdf8f0]'
              }`}
            >
              Problem
            </button>
          </div>
          {mark === 'bad' && (
            <label className="flex flex-col gap-1 text-xs font-medium text-[#5c3d1a]">
              Reason the rider will see
              <input
                value={reason}
                onChange={(e) => onReason(e.target.value)}
                maxLength={200}
                placeholder="e.g. Too blurry to read. Take it again in good light."
                className="h-9 rounded-[10px] border border-[#e8dcc8] bg-[#fffbf2] px-2.5 text-[13px] text-[#1c1a14] outline-none focus:ring-2 focus:ring-brand-600"
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminRiders() {
  const [status, setStatus] = useState<Status>('pending_review');
  const [rows, setRows] = useState<RiderRow[]>([]);
  const [counts, setCounts] = useState<Record<Status, number>>({ pending_review: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RiderDetail | null>(null);
  const [marks, setMarks] = useState<Partial<Record<ItemKey, Mark>>>({});
  const [reasons, setReasons] = useState<Partial<Record<ItemKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState<{ kind: PhotoKind; title: string } | null>(null);

  const loadList = useCallback((keepSelection = true) => {
    setLoading(true);
    api.get('/admin/riders', { params: { status }, skipBaseRotation: true })
      .then((r) => {
        setRows(r.data.riders);
        setCounts(r.data.counts);
        setSelectedId((cur) => {
          if (keepSelection && cur && r.data.riders.some((x: RiderRow) => x.id === cur)) return cur;
          return r.data.riders[0]?.id ?? null;
        });
      })
      .catch(() => toast.error('Could not load rider applications'))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { loadList(false); }, [loadList]);

  useEffect(() => {
    setMarks({});
    setReasons({});
    if (!selectedId) { setDetail(null); return; }
    api.get(`/admin/riders/${selectedId}`, { skipBaseRotation: true })
      .then((r) => setDetail(r.data.rider))
      .catch(() => toast.error('Could not open this application'));
  }, [selectedId]);

  const items = useMemo(() => (detail ? itemsFor(detail) : []), [detail]);
  const readOnly = detail?.review_status !== 'pending_review';
  const flagged = items.filter((i) => marks[i.key] === 'bad');
  const okCount = items.filter((i) => marks[i.key] === 'ok').length;
  const unchecked = items.length - flagged.length - okCount;
  const missingReason = flagged.some((i) => !(reasons[i.key] || '').trim());
  const firstName = detail?.name.split(' ')[0] || 'The rider';

  const summary = flagged.length > 0
    ? `${flagged.length} problem${flagged.length === 1 ? '' : 's'} marked. ${firstName} will see each reason and fix only those items.`
    : unchecked > 0
      ? `${unchecked} item${unchecked === 1 ? '' : 's'} not checked yet.`
      : 'Everything checked. Ready to approve.';

  const decide = async (decision: 'approve' | 'reject') => {
    if (!detail) return;
    setSaving(true);
    try {
      const body = decision === 'approve'
        ? { decision }
        : { decision, issues: flagged.map((i) => ({ item: i.key, reason: (reasons[i.key] || '').trim() })) };
      await api.post(`/admin/riders/${detail.id}/review`, body, { skipBaseRotation: true });
      toast.success(decision === 'approve' ? `${firstName} is approved` : `Sent back to ${firstName} with ${flagged.length} reason${flagged.length === 1 ? '' : 's'}`);
      loadList(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not save the decision');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Rider applications</h2>
        <p className="mt-0.5 text-sm text-slate-500">Check each item. Approve when everything looks right, or send it back with reasons.</p>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        {[
          { label: 'Waiting for review', value: counts.pending_review, color: 'text-amber-700' },
          { label: 'Approved riders', value: counts.approved, color: 'text-emerald-700' },
          { label: 'Sent back', value: counts.rejected, color: 'text-red-700' },
        ].map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <p className={`text-2xl font-extrabold ${s.color}`}>{s.value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 items-start">
        <section aria-label="Applications" className="card flex-[1_1_300px] max-w-[380px] min-w-0">
          <div className="px-4 py-3.5 border-b border-[#e8dcc8] flex gap-1.5 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.status}
                type="button"
                onClick={() => setStatus(t.status)}
                aria-pressed={status === t.status}
                className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                  status === t.status
                    ? 'bg-brand-600 border-brand-600 text-white shadow-sm'
                    : 'bg-[#f5ede0] border-[#e8dcc8] text-slate-700 hover:bg-[#ede3d0]'
                }`}
              >
                {t.label} · {counts[t.status]}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="py-10 grid place-items-center"><LiquidLoader size={56} /></div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              {status === 'pending_review' ? 'No applications waiting. New ones from the app show up here.' : 'Nothing here yet.'}
            </p>
          ) : (
            <ul>
              {rows.map((r) => {
                const active = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-current={active}
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-[#f5ede0] ${
                        active ? 'bg-[#fdf8f0] shadow-[inset_0_0_0_2px_#1a6b2e]' : 'hover:bg-[#fdf8f0]'
                      }`}
                    >
                      <span className="w-9 h-9 rounded-full bg-brand-600 text-white grid place-items-center font-bold text-sm flex-none">
                        {r.name?.[0]?.toUpperCase()}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-sm text-slate-900 truncate">{r.name}</span>
                        <span className="block text-xs text-slate-500 truncate">
                          {[VEHICLE[r.vehicle_type || ''], shortPlace(r.base_address), r.review_submitted_at && timeAgo(r.review_submitted_at)].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {r.review_status === 'pending_review' && (
                        r.resubmitted
                          ? <span className="badge bg-blue-100 text-blue-700">Fixed &amp; resent</span>
                          : <span className="badge bg-amber-100 text-amber-700">New</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Application" className="card flex-[999_1_520px] min-w-0">
          {!detail ? (
            <p className="px-5 py-16 text-center text-sm text-slate-500">Pick an application on the left.</p>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-[#e8dcc8] flex flex-wrap gap-4 items-center">
                <span className="w-12 h-12 rounded-full bg-[#e7efdf] grid place-items-center text-brand-700"><Bike className="w-6 h-6" /></span>
                <div className="flex-1 min-w-[220px]">
                  <p className="text-lg font-bold text-slate-900">{detail.name}</p>
                  <p className="mt-0.5 text-[13px] text-slate-500">
                    {mobile(detail.phone)} · {detail.email}
                    {detail.review_submitted_at && ` · sent ${formatIst(detail.review_submitted_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-slate-700">
                    {VEHICLE[detail.vehicle_type || ''] || 'Vehicle not set'}
                    {detail.vehicle_plate && (
                      <span className="px-2 py-0.5 rounded border-[1.5px] border-[#1c1a14] bg-white font-bold tracking-[.06em]">{detail.vehicle_plate}</span>
                    )}
                    {detail.base && <span>· Starts from {shortPlace(detail.base.address)}</span>}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] bg-[#f5ede0] text-xs text-[#5c3d1a]">
                  <Lock className="w-3.5 h-3.5" />Documents are private · admins only
                </span>
              </div>

              {detail.review_status === 'rejected' && (
                <div className="mx-5 mt-4 rounded-[14px] bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-800">
                  <p className="font-semibold">Sent back. Waiting for {firstName} to fix:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {detail.review_issues.map((i) => <li key={i.item}><span className="font-medium">{items.find((x) => x.key === i.item)?.title || i.item}:</span> {i.reason}</li>)}
                  </ul>
                </div>
              )}
              {detail.review_status === 'approved' && (
                <div className="mx-5 mt-4 rounded-[14px] bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] text-emerald-800 flex items-center gap-2">
                  <Check className="w-4 h-4" /> Approved{detail.reviewed_at && ` on ${formatIst(detail.reviewed_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}. {firstName} can take deliveries.
                </div>
              )}

              {!readOnly && (
                <div className="px-5 pt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMarks(Object.fromEntries(items.map((i) => [i.key, 'ok'])) as Partial<Record<ItemKey, Mark>>);
                      setReasons({});
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-[14px] border border-brand-600 bg-[#eef5ea] text-brand-700 text-sm font-semibold hover:bg-[#e3efe0]"
                  >
                    <CheckCheck className="w-4 h-4" /> Everything looks good
                  </button>
                  {(okCount > 0 || flagged.length > 0) && (
                    <button type="button" onClick={() => { setMarks({}); setReasons({}); }} className="btn-ghost">
                      Clear checks
                    </button>
                  )}
                </div>
              )}
              <div className="px-5 py-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(250px,100%),1fr))]">
                {items.map((item) => (
                  <ItemCard
                    key={item.key}
                    item={item}
                    riderId={detail.id}
                    present={item.photo ? !!detail.photos[item.photo] : false}
                    mark={marks[item.key]}
                    reason={reasons[item.key] || ''}
                    readOnly={readOnly}
                    onMark={(m) => setMarks((cur) => ({ ...cur, [item.key]: m }))}
                    onReason={(v) => setReasons((cur) => ({ ...cur, [item.key]: v }))}
                    onZoom={(kind, title) => setZoom({ kind, title })}
                  />
                ))}
              </div>

              {!readOnly && (
                <div className="px-5 py-3.5 border-t border-[#e8dcc8] bg-[#fdf8f0] flex flex-wrap items-center gap-3">
                  <p className="flex-1 min-w-[220px] text-[13px] text-slate-600">
                    {summary}{flagged.length > 0 && missingReason ? ' Add a reason for each problem.' : ''}
                  </p>
                  <button
                    type="button"
                    disabled={saving || flagged.length === 0 || missingReason}
                    onClick={() => decide('reject')}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-[18px] border border-[#e8dcc8] text-sm font-semibold disabled:cursor-not-allowed ${
                      flagged.length > 0 ? 'bg-red-50 text-red-700' : 'bg-[#fffbf2] text-slate-400'
                    }`}
                  >
                    Send back with {flagged.length} reason{flagged.length === 1 ? '' : 's'}
                  </button>
                  <button
                    type="button"
                    disabled={saving || flagged.length > 0 || unchecked > 0}
                    onClick={() => decide('approve')}
                    className="btn-primary"
                  >
                    <Check className="w-4 h-4" /> Approve rider
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {zoom && detail && <Zoomed riderId={detail.id} kind={zoom.kind} title={zoom.title} onClose={() => setZoom(null)} />}
    </div>
  );
}
