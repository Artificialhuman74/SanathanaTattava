import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Clock, Loader2, Phone } from 'lucide-react';
import { consumerApi } from '../../contexts/AuthContext';
import { useOrderUpdates } from '../../hooks/useOrderUpdates';
import { formatIst } from '../../utils/dateTime';
import LiquidLoader from '../../components/LiquidLoader';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Track an order (handoff §4.13, canvas "CustomerTracking" and "CustomerOffHours"): where it
 * is, who is bringing it, a live map while it moves, and the delivery code once it's on its way.
 */

interface Point { lat: number; lng: number }
interface Line { name: string; quantity: number; size: string | null; image_url: string | null; line_type: 'refill' | 'new' | 'standard' }
interface Tracking {
  order_id: number;
  order_number: string;
  state: 'placed' | 'scheduled' | 'packing' | 'packed' | 'rider_coming' | 'on_the_way' | 'delivered' | 'retry' | 'cancelled';
  step: number;
  headline: string;
  note: string | null;
  opens_at: string | null;
  bringer: { kind: 'rider' | 'shop'; first_name: string; vehicle: string | null; plate: string | null; has_photo: boolean; live: Point | null } | null;
  destination: Point | null;
  distance_km: number | null;
  delivery_code: string | null;
  can_call: boolean;
  lines: Line[];
  paid_online: boolean;
}

const STEPS = ['Placed', 'Packed', 'On the way', 'Delivered'];
const POLL_MS = 10_000;
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function StatusPill({ t }: { t: Tracking }) {
  if (t.state === 'scheduled') {
    return <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1 rounded-full text-amber-800 bg-amber-100"><Clock size={13} strokeWidth={2.6} />Scheduled</span>;
  }
  if (t.state === 'on_the_way' || t.state === 'rider_coming') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1 rounded-full text-orange-700 bg-orange-50">
        <span className="ct-live w-[7px] h-[7px] rounded-full bg-orange-600" />{t.state === 'on_the_way' ? 'On the way' : 'Rider coming'}
      </span>
    );
  }
  const label: Record<string, [string, string]> = {
    delivered: ['Delivered', 'text-emerald-700 bg-emerald-50'],
    cancelled: ['Cancelled', 'text-red-700 bg-red-50'],
    retry: ['Tomorrow', 'text-amber-800 bg-amber-100'],
    packed: ['Packed', 'text-purple-700 bg-purple-50'],
    packing: ['Packing', 'text-purple-700 bg-purple-50'],
    placed: ['Placed', 'text-blue-700 bg-blue-50'],
  };
  const [text, cls] = label[t.state] || label.placed;
  return <span className={`text-[13px] font-semibold px-2.5 py-1 rounded-full ${cls}`}>{text}</span>;
}

/** Live map: your home, and the rider's dot moving towards it. */
function LiveMap({ home, rider, label }: { home: Point; rider: Point | null; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const riderMarker = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('maplibre-gl').then((ml) => {
      if (cancelled || !box.current) return;
      lib.current = ml;
      const m = new ml.Map({ container: box.current, style: STYLE, center: [home.lng, home.lat], zoom: 14, attributionControl: false, interactive: false });
      m.addControl(new ml.AttributionControl({ compact: true }), 'top-right');
      const pin = document.createElement('div');
      pin.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true"><path d="M13 29s-13-12-13-19a13 13 0 0 1 26 0c0 7-13 19-13 19z" fill="#1a6b2e"/><path d="M7 12l6-5 6 5v6H7z" fill="#fffbf2"/></svg>';
      new ml.Marker({ element: pin, anchor: 'bottom' }).setLngLat([home.lng, home.lat]).addTo(m);
      m.on('load', () => {
        if (cancelled) return;
        m.once('idle', () => box.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
        setReady(true);
      });
      map.current = m;
    }).catch(() => {});
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, [home.lat, home.lng]);

  useEffect(() => {
    const m = map.current;
    const ml = lib.current;
    if (!m || !ml || !ready) return;
    const route = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: rider ? [[rider.lng, rider.lat], [home.lng, home.lat]] : [] } };
    const src = m.getSource('route') as any;
    if (src) src.setData(route);
    else {
      m.addSource('route', { type: 'geojson', data: route });
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#1a6b2e', 'line-width': 4, 'line-dasharray': [0.25, 2.2] }, layout: { 'line-cap': 'round' } });
    }
    if (!rider) { riderMarker.current?.remove(); riderMarker.current = null; return; }
    if (!riderMarker.current) {
      const el = document.createElement('div');
      el.innerHTML = '<div style="width:32px;height:32px;box-sizing:border-box;border-radius:9999px;background:#c8963c;border:3px solid #fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.25);transition:transform .3s"><svg width="16" height="16" viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="47" r="7"/><circle cx="50" cy="47" r="7"/><path d="M8 41Q8 31 18 31H30L34 39H42 M44 17L50 40 M40 16H48"/></svg></div>';
      riderMarker.current = new ml.Marker({ element: el }).setLngLat([rider.lng, rider.lat]).addTo(m);
    } else {
      riderMarker.current.setLngLat([rider.lng, rider.lat]);
    }
    const b = new ml.LngLatBounds([home.lng, home.lat], [home.lng, home.lat]).extend([rider.lng, rider.lat]);
    m.fitBounds(b, { padding: { top: 40, bottom: 50, left: 40, right: 40 }, maxZoom: 15, duration: 600 });
  }, [rider?.lat, rider?.lng, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label="Live map" className="relative h-[180px] rounded-2xl overflow-hidden border border-[#e8dcc8] bg-[#f5ede0]">
      <div ref={box} className="absolute inset-0" role="img" aria-label={label} />
    </section>
  );
}

/** "Tomorrow · from 8:00 AM": the sun rises once (canvas "oh-sun"). */
function Sunrise({ caption }: { caption: string }) {
  return (
    <section aria-label="When it comes" className="relative h-[150px] rounded-2xl overflow-hidden border border-[#e8dcc8] bg-[#f5ede0]">
      <svg width="100%" height="150" viewBox="0 0 358 150" preserveAspectRatio="xMidYMax meet" aria-hidden="true" className="block">
        <g className="oh-sun">
          <circle cx="179" cy="112" r="38" fill="#e2a72e" />
          <g stroke="#e2a72e" strokeWidth="4" strokeLinecap="round">
            <path d="M179 52v-14" /><path d="M131 72l-10-10" /><path d="M227 72l10-10" /><path d="M113 112H99" /><path d="M245 112h14" />
          </g>
        </g>
        <rect x="-200" y="112" width="758" height="38" fill="#ede3d0" />
        <path d="M-200 112H558" stroke="#c8963c" strokeWidth="2" />
      </svg>
      <span className="absolute left-1/2 bottom-2.5 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white border border-[#e8dcc8] text-[13px] font-bold whitespace-nowrap">{caption}</span>
    </section>
  );
}

function CanIcon({ small }: { small?: boolean }) {
  return (
    <svg width={small ? 22 : 24} height={small ? 24 : 26} viewBox="0 0 56 64" aria-hidden="true">
      <path d="M19 12q9-10 18 0" fill="none" stroke="#3d2e1a" strokeWidth="3" strokeLinecap="round" />
      <rect x="8" y="11" width="40" height="50" rx="7" fill="#dfe4e6" stroke="#3d2e1a" strokeWidth="3" />
      <rect x="18" y="27" width="22" height="18" rx="3" fill="#1a6b2e" />
    </svg>
  );
}

const sizeText = (s: string | null) => (s ? s.replace(/^([\d.]+)\s*l$/i, '$1 L') : '');

export default function OrderTracking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [t, setT] = useState<Tracking | null>(null);
  const [placedAt, setPlacedAt] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await consumerApi.get(`/consumer/orders/${id}/tracking`);
      setT(data);
    } catch (err: any) {
      if (err.response?.status === 404) setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    load();
    consumerApi.get(`/consumer/orders/${id}`).then((r) => setPlacedAt(r.data.order?.created_at || null)).catch(() => {});
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [id, load]);
  useOrderUpdates(() => { load(); }, Number(id));

  // The rider's photo comes through the account (it is private), so fetch it as a blob.
  const showPhoto = t?.bringer?.kind === 'rider' && t.bringer.has_photo;
  useEffect(() => {
    if (!showPhoto) { setPhoto(null); return; }
    let url: string | null = null;
    consumerApi.get(`/consumer/orders/${id}/rider-photo`, { responseType: 'blob' })
      .then((r) => { url = URL.createObjectURL(r.data); setPhoto(url); })
      .catch(() => setPhoto(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [showPhoto, id]);

  const call = async () => {
    setCalling(true);
    try {
      const { data } = await consumerApi.get(`/consumer/orders/${id}/call`);
      window.location.href = `tel:${data.phone}`;
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Couldn’t start the call. Try again.');
    } finally {
      setCalling(false);
    }
  };

  if (missing) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="font-semibold text-gray-800">We couldn’t find this order.</p>
        <button onClick={() => navigate('/shop/orders')} className="mt-4 px-6 py-2.5 bg-brand-600 text-white rounded-full text-sm font-semibold">Back to orders</button>
      </div>
    );
  }
  if (!t) return <div className="flex items-center justify-center h-64"><LiquidLoader size={76} /></div>;

  const who = t.bringer;
  const moving = t.state === 'on_the_way' || t.state === 'rider_coming';
  const opensCaption = (() => {
    if (!t.opens_at) return '';
    const d = new Date(t.opens_at);
    const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toUpperCase();
    const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return `${day === today ? 'Today' : 'Tomorrow'} · from ${time}`;
  })();

  return (
    <div className="max-w-md mx-auto px-4 pt-5 pb-8 flex flex-col gap-3 text-gray-900">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate('/shop/orders')} aria-label="Back to orders" className="w-10 h-10 rounded-full grid place-items-center text-gray-700 hover:bg-parchment-200">
          <ArrowLeft size={20} strokeWidth={2.2} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base">{t.order_number}</p>
          {placedAt && <p className="text-xs text-gray-500">{formatIst(placedAt)}</p>}
        </div>
        <StatusPill t={t} />
      </div>

      <section aria-label="Order status" className="bg-white border border-[#e8dcc8] rounded-2xl shadow-sm p-4">
        <h1 className="text-xl leading-snug font-extrabold">{t.headline}</h1>
        {t.note && <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{t.note}</p>}
        {t.state !== 'cancelled' && (
          <ol className="mt-3.5 grid grid-cols-4 gap-1.5">
            {STEPS.map((label, i) => (
              <li key={label} aria-current={i === t.step ? 'step' : undefined} className="flex flex-col gap-1.5">
                <span className={`h-[5px] rounded-full transition-colors duration-500 ${i <= t.step ? 'bg-brand-600' : 'bg-parchment-300'}`} />
                <span className={`text-xs ${i === t.step ? 'font-bold text-gray-900' : i < t.step ? 'font-semibold text-brand-700' : 'font-medium text-gray-500'}`}>{label}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {t.state === 'scheduled' && opensCaption && <Sunrise caption={opensCaption} />}

      {moving && t.destination && (
        <div className="relative">
          <LiveMap
            home={t.destination}
            rider={who?.live || null}
            label={who?.live && t.distance_km != null ? `Map: ${who.first_name} is ${t.distance_km} km from your home` : 'Map of your delivery address'}
          />
          {t.distance_km != null && (
            <span className="absolute left-2.5 bottom-2.5 px-2.5 py-1.5 rounded-full bg-white border border-[#e8dcc8] text-xs font-bold">
              {t.distance_km < 0.1 ? 'Almost there' : `${t.distance_km} km away`}
            </span>
          )}
        </div>
      )}

      {moving && who && (
        <section aria-label="Your delivery partner" className="bg-white border border-[#e8dcc8] rounded-2xl shadow-sm px-4 py-3.5 flex items-center gap-3">
          {photo ? (
            <img src={photo} alt={`${who.first_name}’s photo`} className="w-[52px] h-[52px] rounded-full object-cover flex-none" />
          ) : (
            <svg width="52" height="52" viewBox="0 0 72 72" role="img" aria-label={`${who.first_name}`} className="flex-none rounded-full">
              <rect width="72" height="72" fill="#d9ece0" /><circle cx="36" cy="28" r="13" fill="#4e9874" /><path d="M12 72c2-16 12-24 24-24s22 8 24 24z" fill="#4e9874" />
            </svg>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500">{who.kind === 'rider' ? 'Your delivery partner' : 'Delivering from your shop'}</p>
            <p className="mt-0.5 text-base font-bold truncate">{who.first_name}</p>
            {(who.vehicle || who.plate) && (
              <p className="mt-0.5 text-xs text-gray-700">
                {who.vehicle}{who.vehicle && who.plate ? ' · ' : ''}{who.plate && <span className="font-bold tracking-wider">{who.plate}</span>}
              </p>
            )}
          </div>
          {t.can_call && (
            <button onClick={call} disabled={calling} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-70 flex-none">
              {calling ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} strokeWidth={2.2} />}
              Call
            </button>
          )}
        </section>
      )}

      {t.state !== 'delivered' && t.state !== 'cancelled' && (
        t.delivery_code ? (
          <section aria-label="Delivery code" className="rounded-2xl px-4 py-3.5 bg-[#fdf8ee] border border-[#f0d898] text-[#6a4219]">
            <p className="text-xs font-semibold uppercase tracking-[0.06em]">Your delivery code</p>
            <p role="text" aria-label={t.delivery_code.split('').join(' ')} className="mt-1.5 text-[32px] font-extrabold tracking-[0.3em] text-[#3a2208] tabular-nums">{t.delivery_code}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed">
              Share it only when {who?.kind === 'rider' ? who.first_name : 'the delivery agent'} is at your door with your order in hand.
            </p>
          </section>
        ) : (
          <section aria-label="Delivery code" className="rounded-2xl px-4 py-3.5 bg-white border-[1.5px] border-dashed border-[#e8dcc8] text-gray-700">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-gray-500">Your delivery code</p>
            <p className="mt-1.5 text-sm leading-relaxed">Shows up here once your order is on the way.</p>
          </section>
        )
      )}

      <section aria-label="Items" className="bg-white border border-[#e8dcc8] rounded-2xl shadow-sm px-4 py-3.5">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-gray-500">Items</p>
        <div className="flex flex-col gap-2">
          {t.lines.map((l, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-parchment-100 rounded-xl">
              <span aria-hidden="true" className="w-11 h-11 flex-none rounded-[10px] bg-white border border-[#e8dcc8] grid place-items-center overflow-hidden">
                {l.image_url ? <img src={l.image_url} alt="" className="w-full h-full object-cover" /> : <CanIcon small={i > 0} />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{l.name} {sizeText(l.size)} × {l.quantity}</p>
                {l.line_type === 'refill' && (
                  <p className="mt-0.5 text-xs font-semibold text-amber-700">Refill · keep your {l.quantity} empty can{l.quantity === 1 ? '' : 's'} ready</p>
                )}
                {l.line_type === 'new' && <p className="mt-0.5 text-xs text-gray-500">New can</p>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {t.paid_online && <div className="px-4 py-3 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700">Payment: Paid online</div>}
    </div>
  );
}
