// The journey planner's amenities_osm.csv (OpenStreetMap shops and places for every district),
// loaded once and shared by the map and the profile panel.
import { chainOf } from './shopChains.js';

const CSV_URL = '/journey-planner/amenities_osm.csv';
let load = null;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n' || character === '\r') {
      row.push(field);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      field = '';
      if (character === '\r' && text[index + 1] === '\n') index++;
    } else field += character;
  }
  if (field.length || row.length) { row.push(field); if (row.some((value) => value.length)) rows.push(row); }
  if (rows.length < 2) throw new Error('Amenities CSV contains no place records');
  const headers = rows[0].map((header) => header.trim().replace(/^﻿/, ''));
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
  for (const required of ['Area', 'name', 'category', 'latitude', 'longitude']) {
    if (indexes[required] === undefined) throw new Error(`Amenities CSV is missing the ${required} column`);
  }
  return rows.slice(1).map((values) => ({
    area: values[indexes.Area],
    name: values[indexes.name],
    category: values[indexes.category],
    latitude: Number(values[indexes.latitude]),
    longitude: Number(values[indexes.longitude]),
  })).filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
}

export function loadAmenityRecords() {
  if (!load) {
    load = fetch(CSV_URL, { headers: { Accept: 'text/csv' } })
      .then((r) => { if (!r.ok) throw new Error(`Amenities CSV request failed (${r.status})`); return r.text(); })
      .then(parseCsv)
      // The CSV covers D1-D24; County Dublin (A/K areas) places come from a small extra file
      .then((records) => fetch('/data/county-dublin-places.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((extra) => (extra?.records ? [...records, ...extra.records] : records)))
      .catch((e) => { load = null; throw e; });
  }
  return load;
}

const near = (a, b) => Math.abs(a.lat - b.lat) < 0.0004 && Math.abs(a.lng - b.lng) < 0.0006; // ~40 m

// Every supermarket-chain shop: the CSV (all districts) plus the profile file, without duplicates.
export function chainShops(records, profileAmenities) {
  const out = [];
  const add = (shop) => { if (!out.some((x) => x.chain === shop.chain && near(x, shop))) out.push(shop); };
  (records || []).forEach((r) => {
    if (r.category !== 'Supermarkets' && r.category !== 'Groceries') return;
    const chain = chainOf(r.name);
    if (chain) add({ chain, name: r.name.trim(), district: r.area, lat: r.latitude, lng: r.longitude });
  });
  Object.entries(profileAmenities || {}).forEach(([district, pts]) => (pts || []).forEach(([name, cat, lat, lng]) => {
    if (cat !== 'supermarket' && cat !== 'grocery') return;
    const chain = chainOf(name);
    if (chain) add({ chain, name, district, lat, lng });
  }));
  return out;
}

// Verified data, rebuilt from OpenStreetMap with each place assigned to the district it is actually in
// (public/data, see "source" and "fetched" inside each file).
let verifiedShops = null;
let verifiedCounts = null;
export function loadVerifiedChainShops() {
  if (!verifiedShops) verifiedShops = fetch('/data/dublin-chain-shops.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((d) => d.shops).catch((e) => { verifiedShops = null; throw e; });
  return verifiedShops;
}
export function loadVerifiedAmenityCounts() {
  if (!verifiedCounts) verifiedCounts = fetch('/data/dublin-amenity-counts.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((d) => d.counts).catch((e) => { verifiedCounts = null; throw e; });
  return verifiedCounts;
}
