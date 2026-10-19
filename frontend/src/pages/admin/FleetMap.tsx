import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * The live fleet map (canvas "AdminFleet"): shops, riders on the move, customers, and a
 * dashed red ring round shops whose order still needs a rider. OpenStreetMap tiles through
 * OpenFreeMap, same as the ST Partner app (handoff §10). MapLibre loads only on this page.
 */

export interface MapPoint { lat: number; lng: number }
export interface FleetMapData {
  shops: { id: number; name: string; pos: MapPoint; needsRider: boolean }[];
  riders: { id: number; name: string; pos: MapPoint; busy: boolean }[];
  customers: { id: number; label: string; pos: MapPoint }[];
}

// Google-Maps-like repaint of OpenFreeMap's tiles (frontend/scripts/build-map-style.mjs).
const STYLE = `${window.location.origin}/map/st-google.json`;
const BENGALURU: [number, number] = [77.5946, 12.9716];

function shopEl(name: string, needsRider: boolean) {
  // MapLibre positions the outer element itself, so the ring sits in an inner box of its own.
  const el = document.createElement('div');
  el.title = name;
  el.innerHTML = `
    <div style="position:relative;width:26px;height:26px">
      ${needsRider ? '<span style="position:absolute;inset:-9px;border-radius:9999px;border:2.5px dashed #dc2626"></span>' : ''}
      <span style="position:relative;display:grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#1a6b2e;box-shadow:0 1px 3px rgba(0,0,0,.3)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9l1.5-5h13L20 9M5 11v9h14v-9"/></svg>
      </span>
    </div>`;
  return el;
}

function riderEl(name: string) {
  const el = document.createElement('div');
  el.title = name;
  el.innerHTML = '<div style="width:18px;height:18px;box-sizing:border-box;border-radius:9999px;background:#c8963c;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>';
  return el;
}

function customerEl(label: string) {
  const el = document.createElement('div');
  el.title = label;
  el.innerHTML = '<svg width="18" height="22" viewBox="0 0 18 20" aria-hidden="true"><path d="M9 19s-9-8-9-14a9 9 0 0 1 18 0c0 6-9 14-9 14z" fill="#1d4ed8"/><circle cx="9" cy="6" r="3" fill="#fff"/></svg>';
  return el;
}

export default function FleetMap({ data }: { data: FleetMapData }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef<Marker[]>([]);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('maplibre-gl')
      .then((ml) => {
        if (cancelled || !box.current) return;
        lib.current = ml;
        const m = new ml.Map({
          container: box.current,
          style: STYLE,
          center: BENGALURU,
          zoom: 11,
          attributionControl: false,
          cooperativeGestures: true,
        });
        m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        // Credit stays (OSM licence) as the small ⓘ, opened on tap rather than covering the map.
        m.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right');
        m.once('load', () => box.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
        m.on('load', () => !cancelled && setReady(true));
        m.on('error', (e) => { if (!m.loaded()) console.warn('[fleet map]', e?.error?.message); });
        map.current = m;
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const ml = lib.current;
    if (!m || !ml || !ready) return;
    markers.current.forEach((mk) => mk.remove());
    const add = (el: HTMLElement, p: MapPoint, anchor: 'center' | 'bottom' = 'center') =>
      new ml.Marker({ element: el, anchor }).setLngLat([p.lng, p.lat]).addTo(m);
    markers.current = [
      ...data.customers.map((c) => add(customerEl(c.label), c.pos, 'bottom')),
      ...data.shops.map((s) => add(shopEl(s.name, s.needsRider), s.pos)),
      ...data.riders.map((r) => add(riderEl(r.name), r.pos)),
    ];
    // Frame everything once; after that the admin's own pan/zoom is kept.
    const all = [...data.shops, ...data.riders, ...data.customers].map((x) => x.pos);
    if (!fitted.current && all.length) {
      fitted.current = true;
      const bounds = new ml.LngLatBounds([all[0].lng, all[0].lat], [all[0].lng, all[0].lat]);
      all.forEach((p) => bounds.extend([p.lng, p.lat]));
      m.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    }
  }, [data, ready]);

  return (
    <div className="relative flex-1 min-h-[330px] bg-parchment-200">
      <div ref={box} className="absolute inset-0" aria-label="Map of shops, riders and customers" role="region" />
      {failed && (
        <p className="absolute inset-0 grid place-items-center text-sm text-slate-500">Map couldn’t load. The list still updates.</p>
      )}
    </div>
  );
}
