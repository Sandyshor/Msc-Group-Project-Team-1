import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import proj4 from 'proj4';
import crimeAreasUrl from './crime-heatmap.geojson?url';
import './Safety.css';
import './Bikes.css';


const boundariesUrl = '/data/dublin_postcode_boundaries.geojson';
const luasRedUrl = '/data/luas-red-line.geojson';
const luasGreenUrl = '/data/luas-green-line.geojson';
// Dublin Bikes docks (official GBFS station list, saved in Frontend/public/data); bikes and free stands are
// fetched live from the same feed when a dock is clicked.
const bikesUrl = '/data/dublin-bikes-stations.geojson';
const BIKES_STATUS_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_status.json';
const BIKES_COLOUR = '#1f6fb2';
const BIKES_STATUS_MAX_AGE_MS = 60 * 1000;

maplibregl.setWorkerUrl(maplibreWorkerUrl);


const STADIA_STYLE = 'alidade_smooth';
const STADIA_KEY = import.meta.env.VITE_STADIA_API_KEY;
const MAP_STYLE = `https://tiles.stadiamaps.com/styles/${STADIA_STYLE}.json${STADIA_KEY ? `?api_key=${STADIA_KEY}` : ''}`;

const ALL_DISTRICTS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D6W', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12',
  'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D20', 'D22', 'D24'];

// Districts that have a full profile (shared with App.jsx)
export const ACTIVE_DISTRICTS = ALL_DISTRICTS;


export const HEAT_STOPS = [
  [0, '#b23a2f'], [30, '#c94a35'], [40, '#e0694a'], [50, '#f4cf62'], [57, '#b5cf6c'], [65, '#5fae6b'], [100, '#25704a'],
];
export const SAFETY_BANDS = [
  [57, 'Lower recorded crime', 'Safer than Irish towns'],
  [50, 'Below-benchmark crime', 'A little safer than Irish towns'],
  [40, 'Above-benchmark crime', 'More crime than Irish towns'],
  [0, 'Higher recorded crime', 'Much more crime than Irish towns'],
];
export const safetyLabel = (score) => (SAFETY_BANDS.find(([min]) => score >= min) || SAFETY_BANDS[3])[1];
export const safetyPlain = (score) => (SAFETY_BANDS.find(([min]) => score >= min) || SAFETY_BANDS[3])[2];

export function heatColor(score) {
  const i = Math.max(1, HEAT_STOPS.findIndex(([v]) => v >= score));
  const [[v0, c0], [v1, c1]] = [HEAT_STOPS[i - 1], HEAT_STOPS[i] ?? HEAT_STOPS[i - 1]];
  const t = v1 === v0 ? 0 : (score - v0) / (v1 - v0);
  const rgb = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const [a, b2] = [rgb(c0), rgb(c1)];
  return `rgb(${a.map((x, k) => Math.round(x + (b2[k] - x) * Math.max(0, Math.min(1, t)))).join(',')})`;
}

export const textOnHeat = (score) => (score >= 44 && score < 66 ? '#1f2d24' : '#ffffff');
export { ALL_DISTRICTS };


export const AMENITY_TYPES = [
  ['supermarket', 'Supermarkets', 'cart', '#2f7fd0'],
  ['grocery', 'Groceries', 'basket', '#3aa38a'],
  ['restaurant', 'Restaurants', 'fork', '#e0682e'],
  ['cafe', 'Cafés', 'cup', '#9a6a3c'],
  ['gym', 'Gyms', 'gym', '#7b4fd6'],
  ['park', 'Parks', 'park', '#3e9a3a'],
  ['pharmacy', 'Pharmacies', 'pill', '#d6407a'],
  ['hospital', 'Hospitals', 'hospital', '#d23b3b'],
  ['mall', 'Shopping centres', 'mall', '#c09020'],
];


export const strongColor = (hue) => `hsl(${hue} 55% 38%)`;
export const pastelColor = (hue) => `hsl(${hue} 60% 80%)`;
export const bannerColor = (hue) => `hsl(${hue} 42% 26%)`;

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" ${S}>${d}</svg>`;
export const ICONS = {
  park: svg('<path d="M12 3 6 12h3l-4 6h14l-4-6h3z"/><path d="M12 18v3"/>'),
  garden: svg('<path d="M4 21h16M6 21V11a6 6 0 0 1 12 0v10M12 5v16M6 14h12"/>'),
  university: svg('<path d="M2 9 12 4l10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v5"/>'),
  museum: svg('<path d="M3 9 12 4l9 5M4 20h16M6 10v8M10 10v8M14 10v8M18 10v8"/>'),
  stadium: svg('<ellipse cx="12" cy="10" rx="9" ry="4"/><path d="M3 10v4c0 2.2 4 4 9 4s9-1.8 9-4v-4"/>'),
  tower: svg('<path d="M9 21V9l3-5 3 5v12M7 21h10M9 13h6M9 17h6"/>'),
  lighthouse: svg('<path d="M9 21l1-12h4l1 12M8 21h8M10 9V6h4v3M12 3v1"/>'),
  beach: svg('<path d="M3 20c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M12 17 15 6"/><path d="M8 7a7 7 0 0 1 13 3z"/>'),
  water: svg('<path d="M3 9c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M3 14c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0"/>'),
  castle: svg('<path d="M4 21V8h3v2h2V8h2v2h2V8h2v2h2V8h3v13zM10 21v-4a2 2 0 0 1 4 0v4"/>'),
  church: svg('<path d="M12 2v5M10 4h4M7 21v-9l5-4 5 4v9M4 21h16"/>'),
  landmark: svg('<path d="M4 21h16M5 21V10h14v11M3 10l9-6 9 6M9 21v-6h6v6"/>'),
  monument: svg('<path d="M12 2 10 18h4zM7 21h10M9 18h6"/>'),
  market: svg('<path d="M3 9l2-5h14l2 5M3 9h18v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 12v9h14v-9"/>'),
  shop: svg('<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>'),
  cinema: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14"/>'),
  venue: svg('<path d="M3 20 12 4l9 16zM12 4v16"/>'),
  village: svg('<path d="M2 21h20M4 21v-8l4-3 4 3v8M12 21v-11l4-4 4 4v11"/>'),
  nature: svg('<path d="M4 20c6 0 14-4 16-16C10 4 4 10 4 20zM4 20 14 10"/>'),
  hospital: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>'),
  cart: svg('<path d="M3 4h2l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>'),
  basket: svg('<path d="M4 10h16l-1.5 10h-13zM8 10l3-6M16 10l-3-6"/>'),
  fork: svg('<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>'),
  cup: svg('<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17"/>'),
  gym: svg('<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>'),
  pill: svg('<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="m9 9 6 6"/>'),
  mall: svg('<path d="M3 21V9l9-5 9 5v12M3 21h18M8 21v-6h8v6"/>'),
};
export const iconFor = (name) => ICONS[name] || ICONS.landmark;

const ZOOM_AREAS = 12.5; // neighbourhood names appear
const ZOOM_ALL_PLACES = 14; // famous places of every district appear

function districtIdFromPostcode(value) {
  const match = String(value ?? '').trim().match(/^Dublin\s*(\d{1,2}W?)$/i);
  return match ? `D${match[1].toUpperCase()}` : '';
}

function convertCoordinates(coordinates) {
  if (Array.isArray(coordinates) && typeof coordinates[0] === 'number') {
    return proj4('EPSG:2157', 'EPSG:4326', coordinates);
  }
  return coordinates.map(convertCoordinates);
}

function getGeometryBounds(geometry) {
  const bounds = new maplibregl.LngLatBounds();
  const walk = (c) => {
    if (Array.isArray(c) && typeof c[0] === 'number') bounds.extend(c);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  if (geometry?.coordinates) walk(geometry.coordinates);
  return bounds.isEmpty() ? null : bounds;
}

function distanceMetres(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function addBuildingLayer(map) {
  const buildingLayer = map.getStyle().layers?.find(
    (layer) => layer['source-layer'] === 'building' && layer.source && layer.type === 'fill'
  );
  if (!buildingLayer || map.getLayer('district-3d-buildings')) return;
  const labelLayer = map.getStyle().layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field']);
  map.addLayer({
    id: 'district-3d-buildings',
    source: buildingLayer.source,
    'source-layer': buildingLayer['source-layer'],
    type: 'fill-extrusion',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': '#b9d8ca',
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15,
        ['coalesce', ['get', 'render_height'], ['get', 'height'], 8]],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
      'fill-extrusion-opacity': 0.9,
    },
  }, labelLayer?.id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function createPlacePopup(place) {
  const container = el('div', 'landmark-popup');
  if (place.image) {
    const image = el('img', 'landmark-popup-image');
    image.src = place.image;
    image.alt = place.name;
    image.onerror = () => { image.style.display = 'none'; };
    container.append(image);
  }
  container.append(el('h3', null, place.name), el('p', null, place.description || ''));
  if (place.sourceUrl) {
    const link = el('a', null, 'View photo source');
    link.href = place.sourceUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    container.append(link);
  }
  return container;
}

function liveCount(status, type) {
  return status.vehicle_types_available?.find((v) => v.vehicle_type_id === type)?.count ?? 0;
}

const DistrictMap = forwardRef(function DistrictMap(props, ref) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const store = useRef({ features: {}, codeMarkers: {}, placeMarkers: {}, areaMarkers: [], lastAmenKey: '', firstSelect: true });

  const { profileData, placesByDistrict } = props;

  // ---------- apply the current React state to the map ----------
  function applyState() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const { selectedDistrict: sel, filter, showLuas, showBikes, showHeat } = latest.current;
    const profiles = profileData.profiles;
    const visible = ACTIVE_DISTRICTS.filter((c) => filter === 'all' || profiles[c]?.side === filter);
    const zoom = map.getZoom();

    // district colours
    const colorMatch = ['match', ['get', 'districtId']];
    const safety = profileData.safety || {};
    ACTIVE_DISTRICTS.forEach((c) => colorMatch.push(c, showHeat && safety[c]
      ? heatColor(safety[c].score)
      : (c === sel ? strongColor(profiles[c].hue) : pastelColor(profiles[c].hue))));
    colorMatch.push('#cfd8cc');
    const isSel = ['==', ['get', 'districtId'], sel];
    const isVisible = ['in', ['get', 'districtId'], ['literal', visible]];
    map.setPaintProperty('district-fill', 'fill-color', colorMatch);
    // Safety view: whole districts in their safety colour, fading as the Census areas appear when zoomed in
    map.setPaintProperty('district-fill', 'fill-opacity', showHeat
      ? ['interpolate', ['linear'], ['zoom'],
        11, ['case', isVisible, 0.72, 0.15],
        12.3, ['case', isVisible, 0.5, 0.1],
        13.2, ['case', isSel, 0.06, 0.03]]
      : ['interpolate', ['linear'], ['zoom'],
        11, ['case', isSel, 0.5, isVisible, 0.55, 0.12],
        14.5, ['case', isSel, 0.18, isVisible, 0.12, 0.03]]);
    ['dm-crime-areas', 'dm-crime-lines'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showHeat ? 'visible' : 'none');
    });
    map.setPaintProperty('district-outline', 'line-color', ['case', isSel, showHeat ? '#173f32' : strongColor(profiles[sel].hue), '#ffffff']);
    map.setPaintProperty('district-outline', 'line-width', ['case', isSel, 4, 1.5]);

    // district code chips
    Object.entries(store.current.codeMarkers).forEach(([c, m]) => {
      const node = m.getElement();
      if (!ACTIVE_DISTRICTS.includes(c)) return;
      const sc = profileData.safety?.[c]?.score;
      if (showHeat && sc != null) {
        node.style.background = heatColor(sc);
        node.style.color = textOnHeat(sc);
        node.innerHTML = `${c}<b>${sc.toFixed(0)}</b>`;
        node.title = `${c} · ${profiles[c].name}: safety ${sc.toFixed(1)} / 100, ${safetyLabel(sc).toLowerCase()}`;
      } else {
        node.style.background = strongColor(profiles[c].hue);
        node.style.color = '';
        node.textContent = c;
        node.title = `${c} · ${profiles[c].name}`;
      }
      node.style.opacity = visible.includes(c) ? 1 : 0.35;
      node.classList.toggle('selected', c === sel);
    });

    // famous places: selected district always, all districts when zoomed in
    Object.entries(store.current.placeMarkers).forEach(([c, markers]) => {
      markers.forEach((m) => {
        const show = c === sel || zoom >= ZOOM_ALL_PLACES;
        m.getElement().style.display = show ? '' : 'none';
        m.getElement().classList.toggle('small', c !== sel);
      });
    });

    // dashed spokes from the district centre to its places
    const centre = profileData.labels[sel];
    const spokeFeatures = (placesByDistrict[sel] || []).filter((p) => p.lngLat).map((p) => ({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[centre[1], centre[0]], p.lngLat] },
    }));
    map.getSource('dm-spokes')?.setData({ type: 'FeatureCollection', features: spokeFeatures });
    map.setPaintProperty('dm-spokes-line', 'line-color', strongColor(profiles[sel].hue));

    // amenity dots for the selected district
    if (store.current.lastAmenKey !== sel) {
      store.current.lastAmenKey = sel;
      const pts = profileData.amenities[sel] || [];
      map.getSource('dm-amenities')?.setData({
        type: 'FeatureCollection',
        features: pts.map(([name, cat, lat, lng]) => ({ type: 'Feature', properties: { name, cat }, geometry: { type: 'Point', coordinates: [lng, lat] } })),
      });
    }
    // Amenity dots are not shown any more: supermarket chains are picked in the Amenities tab instead
    map.setLayoutProperty('dm-amenities-dots', 'visibility', 'none');

    // Luas
    ['luas-red-route-line', 'luas-green-route-line', 'dm-stops-points', 'dm-stops-hit'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showLuas ? 'visible' : 'none');
    });

    // Dublin Bikes
    ['dm-bikes-points', 'dm-bikes-hit'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showBikes ? 'visible' : 'none');
    });
    if (!showBikes) store.current.bikePopup?.remove();

    // zoom classes for neighbourhood labels
    const box = mapContainerRef.current?.parentElement;
    if (box) {
      box.classList.toggle('z-low', zoom < ZOOM_AREAS);
      box.classList.toggle('z-high', zoom >= ZOOM_ALL_PLACES);
    }
  }

  
  async function bikeStatus() {
    const cached = store.current.bikeStatus;
    if (cached && Date.now() - cached.at < BIKES_STATUS_MAX_AGE_MS) return cached.byId;
    const response = await fetch(BIKES_STATUS_URL);
    if (!response.ok) throw new Error(`Dublin Bikes status returned ${response.status}`);
    const stations = (await response.json()).data?.stations || [];
    const byId = Object.fromEntries(stations.map((st) => [String(st.station_id), st]));
    store.current.bikeStatus = { at: Date.now(), byId };
    return byId;
  }

  function openBikePopup(dock, lngLat) {
    const map = mapRef.current;
    const box = el('div', 'stop-popup');
    box.append(el('span', 'stop-line bikes', 'Dublin Bikes'), el('h3', null, dock.name));
    if (dock.address && dock.address.toLowerCase() !== dock.name.toLowerCase()) box.append(el('p', 'bike-address', dock.address));
    const tags = el('div', 'stop-tags');
    tags.append(el('span', null, `${dock.capacity} stands`));
    box.append(tags);
    const live = el('p', 'bike-live', 'Checking live availability…');
    box.append(live);

    store.current.bikePopup?.remove();
    const popup = new maplibregl.Popup({ offset: 10, maxWidth: '280px' }).setLngLat(lngLat).setDOMContent(box).addTo(map);
    store.current.bikePopup = popup;

    bikeStatus().then((byId) => {
      const st = byId[String(dock.id)];
      if (!st) { live.textContent = 'No live data for this dock right now.'; return; }
      if (!st.is_installed || !st.is_renting) { live.textContent = 'This dock is closed at the moment.'; return; }
      const ebikes = liveCount(st, 'electrical');
      live.replaceChildren();
      const row = el('div', 'bike-counts');
      row.append(
        el('span', null, `${st.num_bikes_available} bike${st.num_bikes_available === 1 ? '' : 's'}${ebikes ? ` (${ebikes} electric)` : ''}`),
        el('span', null, `${st.num_docks_available} free stand${st.num_docks_available === 1 ? '' : 's'}`),
      );
      const when = st.last_reported ? new Date(st.last_reported * 1000).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' }) : null;
      live.append(row, el('small', null, `Live data: JCDecaux (dublinbikes), Open Licence${when ? `, updated ${when}` : ''}`));
    }).catch(() => { live.textContent = 'Live availability could not be loaded.'; });
  }

  function flyToDistrict(code) {
    const feature = store.current.features[code];
    const bounds = feature && getGeometryBounds(feature.geometry);
    if (bounds) mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 14, pitch: 45, bearing: -12, duration: 1300 });
  }
  
  
