#!/usr/bin/env node
/**
 * Builds the Google-Maps-like map style used by every live map (customer tracking, admin
 * fleet, the ST Partner app). It starts from OpenFreeMap's free "liberty" style (same tiles,
 * fonts and icons, no key) and repaints it: light grey land, soft green parks, blue water,
 * white streets, yellow main roads, quiet grey labels, flat buildings, no hill shading.
 *
 *   node scripts/build-map-style.mjs             (fetches liberty)
 *   node scripts/build-map-style.mjs liberty.json (or start from a downloaded copy)
 *
 * Writes public/map/st-google.json. Copy the same file to the app:
 *   st-partner/app/src/main/assets/map/st-google.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://tiles.openfreemap.org/styles/liberty';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'map', 'st-google.json');

const C = {
  land: '#f5f5f3',
  urban: '#efefec',
  park: '#cfe9d4',
  wood: '#cbe6cf',
  grass: '#d7eedb',
  sand: '#f4efe1',
  hospital: '#f9e3e3',
  school: '#f2ecdf',
  water: '#a8d4f5',
  waterLabel: '#3b78b4',
  building: '#e9e8e4',
  buildingLine: '#dcdad5',
  street: '#ffffff',
  streetCase: '#dadce0',
  arterialCase: '#d2d5d9',
  main: '#fde49c',
  mainCase: '#efc568',
  motorway: '#fcd27a',
  motorwayCase: '#e3a63c',
  path: '#dfe2e6',
  rail: '#c7cbd0',
  boundary: '#9aa0a6',
  label: '#5f6368',
  place: '#3c4043',
  halo: '#ffffff',
  aero: '#e8eaed',
};

/** Paint overrides by layer id. Anything not listed keeps liberty's paint. */
function paintFor(id, type) {
  const has = (...k) => k.some((x) => id.includes(x));
  if (type === 'background') return { 'background-color': C.land };
  if (id === 'park') return { 'fill-color': C.park, 'fill-opacity': 1 };
  if (id === 'park_outline') return { 'line-color': C.park, 'line-opacity': 0 };
  if (id === 'landuse_residential') return { 'fill-color': C.urban, 'fill-opacity': 1 };
  if (id === 'landcover_wood') return { 'fill-color': C.wood, 'fill-opacity': 1 };
  if (id === 'landcover_grass' || id === 'landuse_pitch' || id === 'landuse_track' || id === 'landuse_cemetery') return { 'fill-color': C.grass, 'fill-opacity': 1 };
  if (id === 'landcover_wetland') return { 'fill-color': C.grass, 'fill-opacity': 0.8 };
  if (id === 'landcover_sand') return { 'fill-color': C.sand, 'fill-opacity': 1 };
  if (id === 'landuse_hospital') return { 'fill-color': C.hospital, 'fill-opacity': 1 };
  if (id === 'landuse_school') return { 'fill-color': C.school, 'fill-opacity': 1 };
  if (id === 'water') return { 'fill-color': C.water };
  if (id.startsWith('waterway') && type === 'line') return { 'line-color': C.water };
  if (id === 'aeroway_fill') return { 'fill-color': C.aero, 'fill-opacity': 1 };
  if (id.startsWith('aeroway') && type === 'line') return { 'line-color': '#ffffff' };
  if (id === 'building') return { 'fill-color': C.building, 'fill-outline-color': C.buildingLine };
  if (id.startsWith('boundary')) return { 'line-color': C.boundary };
  if (has('rail')) return type === 'line' ? { 'line-color': C.rail } : null;

  if (type === 'line' && /^(road|bridge|tunnel)_/.test(id)) {
    const casing = id.endsWith('_casing');
    if (has('motorway')) return { 'line-color': casing ? C.motorwayCase : C.motorway };
    if (has('trunk_primary')) return { 'line-color': casing ? C.mainCase : C.main };
    if (has('secondary_tertiary')) return { 'line-color': casing ? C.arterialCase : C.street };
    if (has('path_pedestrian')) return casing ? { 'line-color': C.land } : { 'line-color': C.path };
    if (has('minor', 'street', 'link', 'service_track')) return { 'line-color': casing ? C.streetCase : C.street };
  }
  if (id === 'road_area_pattern') return { 'fill-opacity': 0 };

  if (type === 'symbol') {
    if (id.startsWith('water') || id === 'waterway_line_label') return { 'text-color': C.waterLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.4 };
    if (id.startsWith('label_') || id === 'airport') return { 'text-color': C.place, 'text-halo-color': C.halo, 'text-halo-width': 1.6 };
    if (id.startsWith('highway-name') || id.startsWith('poi')) return { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.5 };
  }
  return null;
}

async function load() {
  if (process.argv[2]) return JSON.parse(await readFile(process.argv[2], 'utf8'));
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Couldn't fetch ${SOURCE}: ${res.status}`);
  return res.json();
}
const style = await load();

// Flat and quiet, like Google: no shaded relief, no 3-D buildings.
style.layers = style.layers.filter((l) => l.id !== 'natural_earth' && l.id !== 'building-3d');
delete style.sources.ne2_shaded;
style.name = 'ST Google-like';

for (const layer of style.layers) {
  const paint = paintFor(layer.id, layer.type);
  if (paint) layer.paint = { ...(layer.paint || {}), ...paint };
  // Google writes neighbourhood names in plain grey sentence case, not italic capitals.
  if (layer.type === 'symbol' && layer.layout && (layer.id.startsWith('label_') || layer.id.startsWith('poi'))) {
    layer.layout['text-transform'] = 'none';
    if (layer.layout['text-font']) layer.layout['text-font'] = ['Noto Sans Regular'];
  }
  // Buildings fade in only when you're close, so streets read first.
  if (layer.id === 'building') {
    layer.paint['fill-opacity'] = ['interpolate', ['linear'], ['zoom'], 14.5, 0, 16, 1];
  }
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(style));
console.log(`Wrote ${OUT} (${style.layers.length} layers)`);
