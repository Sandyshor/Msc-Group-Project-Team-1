// District Profile map, built on the journey planner map (public/journey-planner/route.js).
// Base: the planner's Stadia "alidade_smooth" tiles, universities, the OSM amenity layers from
// amenities_osm.csv and A-to-B routing. On top: the selected district's outline, and (when switched on)
// famous places, district names, Luas, bus stops, Dublin Bikes, DART/rail and supermarket chains.
//
// Opens as a plain map with only the universities and no district selected.
// Like Google Maps, detail grows with zoom: small dots when zoomed out, full pins in the middle, names
// when zoomed in, and nearby shops, cafés and other places appear on their own at street level.
// The map is always flat and north-up (Leaflet has no tilt or rotation).
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import proj4 from 'proj4';
import { ACTIVE_DISTRICTS, ALL_DISTRICTS, AMENITY_TYPES, heatColor, safetyLabel, strongColor, textOnHeat } from './mapShared';
// Safety score per Census area (crime-heatmap.geojson is cut off, so the complete copy is used)
import crimeAreasUrl from './crime-heatmap1.geojson?url';
const countyAreasUrl = '/data/county-dublin-areas.geojson'; // approximate A/K routing areas
const countySafetyUrl = '/data/county-dublin-safety.geojson';
import { decodePolyline, formatDistance, formatMinutes, legColor, lineLabel, MODE_STYLE } from './journey';
import { chainInfo } from './shopChains';
import { loadAmenityRecords as loadCsv } from './amenityData';
import { universities as campusList } from './cityPlaces';
import './JourneyPlanner.css';
import './JourneyBaseMap.css';
import './Bikes.css';

const PLANNER = '/journey-planner/';
const boundariesUrl = '/data/dublin_postcode_boundaries.geojson';
const luasRedUrl = '/data/luas-red-line.geojson';
const luasGreenUrl = '/data/luas-green-line.geojson';
const busStopsUrl = '/data/dublin-bus-stops.geojson';
const railLinesUrl = '/data/dublin-rail-lines.geojson';
const railStationsUrl = '/data/dublin-rail-stations.geojson';
const BIKES_INFO_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_information.json';
const BIKES_STATUS_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_status.json';
const BIKES_STATUS_MAX_AGE_MS = 60 * 1000;

const DUBLIN_CENTRE = [53.3498, -6.2603];
const DUBLIN_BOUNDS = L.latLngBounds([53.24, -6.48], [53.46, -6.0]);
const CAMPUS_VIEW = L.latLngBounds([53.285, -6.385], [53.41, -6.13]); // every university in view
const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DRAW_MS = 1100;
const TRAVEL_MS = 6500;

// Zoom levels where more detail appears (Google Maps style)
const Z_MID = 12; // full-size pins; chosen amenity layers load
const Z_NEAR = 14.5; // bigger pins + names of universities, famous places, stations
const Z_BUS = 14; // bus stops appear as dots (when the Bus stops button is on)
const Z_BUS_ICON = 15.5; // ...and as bus-stop badges with a bus icon
const Z_POI = 15.5; // nearby shops, cafés, restaurants... appear by themselves
const Z_STREET = 16.5; // names under every shop and place
const Z_STOPS = 12.5; // Luas stops and rail stations appear

const LUAS_RED = '#e0312b';
const LUAS_GREEN = '#00a651';
const DART_GREEN = '#7ac143';
const RAIL_PURPLE = '#6f3f98';
const BUS_YELLOW = '#f5b400';
// small bus (front view) for the bus-stop badges
const BUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a2 2 0 0 1 2 2V16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16V5.5a2 2 0 0 1 2-2Z" fill="#173f37"/><path d="M6 6h12v5.5H6z" fill="#fff"/><circle cx="8" cy="14.5" r="1.3" fill="#ffd34d"/><circle cx="16" cy="14.5" r="1.3" fill="#ffd34d"/><path d="M6.5 17.5v2M17.5 17.5v2" stroke="#173f37" stroke-width="2.2" stroke-linecap="round"/></svg>';
const BIKES_BLUE = '#1f6fb2';

// Basemap: identical to the journey planner (Stadia, OpenStreetMap if Stadia refuses the tiles).
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const STADIA_ATTRIBUTION = '&copy; <a href="https://stadiamaps.com/attribution/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> ' + OSM_ATTRIBUTION;
const BASEMAP = { url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', maxZoom: 20, attribution: STADIA_ATTRIBUTION };
const FALLBACK_BASEMAP = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: OSM_ATTRIBUTION, className: 'jp-tiles-osm' };

// Layer list categories (as in the journey planner). Brands keep the planner's word logos (TESCO, SPAR...).
const AMENITY_CATEGORIES = {
  supermarkets: { label: 'Supermarkets', icon: '🛒', ring: '#2f7b50', csv: ['Supermarkets'] },
  tesco: { label: 'Tesco stores', logo: 'TESCO', brandNames: ['tesco'], csv: ['Supermarkets'] },
  spar: { label: 'Spar stores', logo: 'SPAR', brandNames: ['spar'], csv: ['Groceries'] },
  dunnes: { label: 'Dunnes Stores', logo: 'DUNNES', brandNames: ['dunnes'], csv: ['Supermarkets'] },
  aldi: { label: 'Aldi stores', logo: 'ALDI', brandNames: ['aldi'], csv: ['Supermarkets'] },
  centra: { label: 'Centra stores', logo: 'CENTRA', brandNames: ['centra'], csv: ['Groceries'] },
  lidl: { label: 'Lidl stores', logo: 'LIDL', brandNames: ['lidl'], csv: ['Supermarkets'] },
  supervalu: { label: 'SuperValu stores', logo: 'SUPERVALU', brandNames: ['supervalu'], csv: ['Groceries'] },
  circlek: { label: 'Circle K stores', logo: 'CIRCLE K', brandNames: ['circle k'], csv: ['Groceries'] },
  mace: { label: 'Mace stores', logo: 'MACE', brandNames: ['mace'], csv: ['Groceries'] },
  daybreak: { label: 'Daybreak stores', logo: 'DAYBREAK', brandNames: ['daybreak'], csv: ['Groceries'] },
  londis: { label: 'Londis stores', logo: 'LONDIS', brandNames: ['londis'], csv: ['Groceries'] },
  eurospar: { label: 'Eurospar stores', logo: 'EUROSPAR', brandNames: ['eurospar'], csv: ['Groceries'] },
  polonez: { label: 'Polonez stores', logo: 'POLONEZ', brandNames: ['polonez'], csv: ['Groceries'] },
  gala: { label: 'Gala stores', logo: 'GALA', brandNames: ['gala'], csv: ['Groceries'] },
  costcutter: { label: 'Costcutter stores', logo: 'COSTCUTTER', brandNames: ['costcutter'], csv: ['Groceries'] },
  daytoday: { label: 'Day-Today stores', logo: 'DAY-TODAY', brandNames: ['day-today'], csv: ['Groceries'] },
  groceries: { label: 'Groceries & convenience', icon: '🧺', ring: '#58835a', csv: ['Groceries'] },
  restaurants: { label: 'Restaurants', icon: '🍽️', ring: '#d0602b', csv: ['Restaurants', 'Asian_Restaurants'] },
  cafes: { label: 'Cafés', icon: '☕', ring: '#8a5a33', csv: ['Cafes'] },
  gyms: { label: 'Gyms', icon: '🏋️', ring: '#6a4fc4', csv: ['Gyms'] },
  pharmacies: { label: 'Pharmacies', icon: '💊', ring: '#7054a0', csv: ['Pharmacies'] },
  hospitals: { label: 'Hospitals', icon: '🏥', ring: '#bd4138', csv: ['Hospitals'] },
  shopping: { label: 'Shopping centres', icon: '🛍️', ring: '#bd7627', csv: ['Shopping_Malls'] },
  parks: { label: 'Parks', icon: '🌳', ring: '#4b8550', csv: ['Parks'] },
  landmarks: { label: 'Monuments & landmarks', icon: '🏛️', ring: '#a65c3b' },
};
const BRAND_KEYS = Object.keys(AMENITY_CATEGORIES).filter((k) => AMENITY_CATEGORIES[k].logo);
// shopChains.js keys (Amenities tab) that have a word logo
const CHAIN_LOGO = { tesco: 'tesco', lidl: 'lidl', aldi: 'aldi', dunnes: 'dunnes', supervalu: 'supervalu', spar: 'spar', centra: 'centra', mace: 'mace', londis: 'londis', costcutter: 'costcutter', daybreak: 'daybreak', circlek: 'circlek', polonez: 'polonez' };

// Nearby places that appear by themselves when zoomed in: names only (no emoji), coloured by type
// like Google Maps. Emoji pins are kept for the layers the user switches on.
const POI_STYLE = {
  Restaurants: ['#c2571a', 'Restaurant'],
  Asian_Restaurants: ['#c2571a', 'Asian restaurant'],
  Cafes: ['#c2571a', 'Café'],
  Groceries: ['#2f6db5', 'Grocery'],
  Supermarkets: ['#2f6db5', 'Supermarket'],
  Shopping_Malls: ['#2f6db5', 'Shopping centre'],
  Pharmacies: ['#c0392b', 'Pharmacy'],
  Hospitals: ['#c0392b', 'Hospital'],
  Gyms: ['#6a4fc4', 'Gym'],
  Parks: ['#2e7d4f', 'Park'],
};
const hasName = (record) => Boolean(record.name && record.name.trim());

const PLACE_EMOJI = {
  park: '🌳', garden: '🌷', university: '🎓', museum: '🏛️', stadium: '🏟️', tower: '🗼', lighthouse: '🗼',
  beach: '🏖️', water: '🌊', castle: '🏰', church: '⛪', landmark: '📍', monument: '🗿', market: '🏪',
  shop: '🛍️', cinema: '🎬', venue: '🎭', village: '🏘️', nature: '🌿', hospital: '🏥',
};
const RING = { uni: '#173f37', place: '#b8862f', landmark: '#a65c3b' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const shortName = (name) => String(name)
  .replace('Technological University Dublin', 'TU Dublin')
  .replace('Dublin City University', 'DCU')
  .replace('University College Dublin', 'UCD')
  .replace(/ Campus$/, '');

const brandLogo = (key) => `<span class="jp-brand-logo jp-brand-logo-${key}">${escapeHtml(AMENITY_CATEGORIES[key].logo)}</span>`;

// One marker style: a white circle with an emoji (or a store's word logo), a coloured ring, and a
// name label that only shows when zoomed in.
function pinIcon({ emoji, ring = '#5f6f67', kind, label, brand }) {
  const dot = brand
    ? `<span class="pm-dot pm-brand">${brandLogo(brand)}</span>`
    : `<span class="pm-dot">${escapeHtml(emoji)}</span>`;
  return L.divIcon({
    className: 'pm-icon',
    html: `<div class="pm pm-${kind}" style="--ring:${ring}">${dot}${label ? `<span class="pm-label">${escapeHtml(label)}</span>` : ''}</div>`,
    iconSize: [0, 0],
  });
}

// Transit stop: a white disc with a coloured ring and a name label when zoomed in
function stopIcon(colour, label, kind = 'stop') {
  return L.divIcon({
    className: 'pm-icon',
    html: `<div class="tr-stop tr-${kind}" style="--ring:${colour}"><span class="tr-stop-dot"></span>${label ? `<span class="pm-label">${escapeHtml(label)}</span>` : ''}</div>`,
    iconSize: [0, 0],
  });
}

const latLngPoints = (encoded) => decodePolyline(encoded).map(([lng, lat]) => [lat, lng]);

function metres(a, b) {
  const dy = (b[0] - a[0]) * 110540;
  const dx = (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

function districtIdFromPostcode(value) {
  const match = String(value ?? '').trim().match(/^Dublin\s*(\d{1,2}W?)$/i);
  return match ? `D${match[1].toUpperCase()}` : '';
}

function convertCoordinates(coordinates) {
  if (Array.isArray(coordinates) && typeof coordinates[0] === 'number') return proj4('EPSG:2157', 'EPSG:4326', coordinates);
  return coordinates.map(convertCoordinates);
}

function isBrandName(name, brand) {
  const n = name.trim().toLocaleLowerCase();
  return n === brand || n.startsWith(`${brand} `);
}

function brandOf(record) {
  if (!['Supermarkets', 'Groceries'].includes(record.category)) return null;
  return BRAND_KEYS.find((k) => AMENITY_CATEGORIES[k].brandNames.some((b) => isBrandName(record.name, b))) || null;
}

function recordMatchesAmenityLayer(record, key) {
  const category = AMENITY_CATEGORIES[key];
  if (!category.csv) return false;
  if (category.brandNames) return brandOf(record) === key;
  if (!category.csv.includes(record.category)) return false;
  if (key === 'supermarkets' || key === 'groceries') return !brandOf(record);
  return true;
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

function distanceMetres(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const centredIcon = (html, className = '') => L.divIcon({ className: `dp-icon ${className}`, html: `<div class="dp-anchor">${html}</div>`, iconSize: [0, 0] });

// A rail/tram line drawn like a transit map: soft glow, white casing and the coloured line on top.
function transitLine(geojson, colour, pane, filter, weight = 5) {
  const group = L.layerGroup();
  const opts = (style) => ({ pane, interactive: false, filter, style: { lineCap: 'round', lineJoin: 'round', ...style } });
  L.geoJSON(geojson, opts({ color: colour, weight: weight + 10, opacity: 0.14 })).addTo(group);
  L.geoJSON(geojson, opts({ color: '#ffffff', weight: weight + 4, opacity: 1 })).addTo(group);
  L.geoJSON(geojson, opts({ color: colour, weight, opacity: 1 })).addTo(group);
  return group;
}

const JourneyBaseMap = forwardRef(function JourneyBaseMap(props, ref) {
  const boxRef = useRef(null);
  const containerRef = useRef(null);
  const hintRef = useRef(null);
  const statusRef = useRef(null);
  const legendRef = useRef(null);
  const latest = useRef(props);
  latest.current = props;
  const s = useRef(null);

  const { profileData, placesByDistrict } = props;

  // ------------------------------------------------------------ create the map once
  useEffect(() => {
    if (!containerRef.current || s.current) return undefined;
    proj4.defs('EPSG:2157', '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +units=m +no_defs');

    // Credits live behind the (i) button instead of the usual strip along the bottom edge
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false, zoomSnap: 0.25 }).setView(DUBLIN_CENTRE, 11);
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 110 }).addTo(map);
    // Compass button above the zoom buttons: back to the starting view (the chosen district, or all universities)
    const HomeControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        const bar = L.DomUtil.create('div', 'leaflet-bar dp-home-control');
        const btn = L.DomUtil.create('a', 'dp-home', bar);
        btn.href = '#';
        btn.title = 'Back to the starting view';
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', 'Back to the starting view');
        btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/>'
          + '<g class="dp-needle"><path d="M12 4.5 14.6 12h-5.2z" fill="#d94351"/><path d="M12 19.5 9.4 12h5.2z" fill="currentColor" opacity=".55"/></g>'
          + '<circle cx="12" cy="12" r="1.4" fill="#fff" stroke="currentColor" stroke-width=".8"/></svg>';
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(btn, 'click', (e) => {
          L.DomEvent.preventDefault(e);
          btn.classList.remove('is-spinning');
          void btn.offsetWidth;
          btn.classList.add('is-spinning');
          resetView();
        });
        return bar;
      },
    });
    new HomeControl().addTo(map); // added after zoom, so Leaflet stacks it above the zoom buttons

    // Full-screen button (above the compass)
    let unsyncFullscreen = null;
    const FullscreenControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        const bar = L.DomUtil.create('div', 'leaflet-bar dp-full-control');
        const btn = L.DomUtil.create('a', 'dp-full', bar);
        btn.href = '#';
        btn.setAttribute('role', 'button');
        const ICON_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const sync = () => {
          const on = document.fullscreenElement === boxRef.current || document.webkitFullscreenElement === boxRef.current;
          btn.innerHTML = on ? ICON_CLOSE : ICON_OPEN;
          btn.title = on ? 'Exit full screen' : 'View the map full screen';
          btn.setAttribute('aria-label', btn.title);
          boxRef.current?.classList.toggle('is-fullscreen', on);
        };
        sync();
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(btn, 'click', (e) => {
          L.DomEvent.preventDefault(e);
          const box = boxRef.current;
          const on = document.fullscreenElement || document.webkitFullscreenElement;
          if (on) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
          else (box.requestFullscreen || box.webkitRequestFullscreen)?.call(box);
        });
        document.addEventListener('fullscreenchange', sync);
        document.addEventListener('webkitfullscreenchange', sync);
        unsyncFullscreen = () => { document.removeEventListener('fullscreenchange', sync); document.removeEventListener('webkitfullscreenchange', sync); };
        return bar;
      },
    });

    // (i) button: map credits and data sources
    const InfoControl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd() {
        const wrap = L.DomUtil.create('div', 'dp-info-control');
        const btn = L.DomUtil.create('button', 'dp-info', wrap);
        btn.type = 'button';
        btn.textContent = 'i';
        btn.title = 'Map credits and data sources';
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-expanded', 'false');
        const card = L.DomUtil.create('div', 'dp-info-card', wrap);
        card.hidden = true;
        const fill = () => {
          card.innerHTML = '<b>Map credits</b>'
            + `<p>${st.usingFallback ? FALLBACK_BASEMAP.attribution : BASEMAP.attribution}</p>`
            + '<p>Map library: <a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a></p>'
            + '<b>Data</b><p>Shops, amenities, bus stops and rail: OpenStreetMap contributors (ODbL). Census 2022 and RTB rents: CSO. '
            + 'Live Dublin Bikes: JCDecaux. Addresses: OpenStreetMap Nominatim. County Dublin areas (A/K Eircodes) are approximate, built from CSO electoral divisions.</p>';
        };
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.disableScrollPropagation(wrap);
        L.DomEvent.on(btn, 'click', () => {
          fill();
          card.hidden = !card.hidden;
          btn.setAttribute('aria-expanded', String(!card.hidden));
          btn.classList.toggle('is-open', !card.hidden);
        });
        map.on('click', () => { card.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('is-open'); });
        return wrap;
      },
    });
    new FullscreenControl().addTo(map);
    new InfoControl().addTo(map);
    map.createPane('dpSafety').style.zIndex = 380;
    map.createPane('dpOutline').style.zIndex = 390;
    map.createPane('dpRail').style.zIndex = 392;
    map.createPane('dpLuas').style.zIndex = 395;
    const busRenderer = L.canvas({ padding: 0.3 });

    const st = {
      map,
      baseLayer: null,
      usingFallback: false,
      outline: L.layerGroup().addTo(map),
      luas: L.layerGroup(),
      luasStops: L.layerGroup(),
      rail: L.layerGroup(),
      railStations: L.layerGroup(),
      bus: L.layerGroup(),
      busStops: null,
      bikes: L.layerGroup(),
      bikesLoad: null,
      safety: L.layerGroup(),
      safetyLoad: null,
      pois: L.layerGroup().addTo(map),
      names: L.layerGroup(),
      codes: L.layerGroup(),
      areas: L.layerGroup(),
      cityPlaces: L.layerGroup(),
      districtPlaces: L.layerGroup(),
      chains: L.layerGroup().addTo(map),
      alt: L.layerGroup().addTo(map),
      route: L.layerGroup().addTo(map),
      pins: { from: null, to: null },
      codeMarkers: {},
      placeMarkers: [],
      cityPlacePoints: [],
      features: {},
      named: { landmarks: [], stations: [], areas: [] }, // to name a clicked point (journey A and B)
      amenityRecords: null,
      amenityLoad: null,
      bikeStatus: null,
    };
    st.names.addLayer(st.codes).addLayer(st.areas);
    st.placeLayer = L.layerGroup([st.cityPlaces, st.districtPlaces]);
    s.current = st;

    const setBasemap = () => {
      st.baseLayer?.remove();
      const cfg = st.usingFallback ? FALLBACK_BASEMAP : BASEMAP;
      st.baseLayer = L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom, attribution: cfg.attribution, className: cfg.className || '' });
      if (!st.usingFallback) {
        let loaded = 0, failed = 0;
        st.baseLayer.on('tileload', () => { loaded++; });
        st.baseLayer.on('tileerror', () => {
          if (++failed >= 4 && loaded === 0 && !st.usingFallback) {
            st.usingFallback = true;
            console.warn('Stadia Maps refused the map tiles; using OpenStreetMap instead.');
            setBasemap();
          }
        });
      }
      st.baseLayer.addTo(map).bringToBack();
    };
    setBasemap();

    const setStatus = (message = '') => {
      const node = statusRef.current;
      if (!node) return;
      node.textContent = message;
      node.hidden = !message;
      node.classList.toggle('jp-is-error', message.startsWith('Could not load'));
    };

    // ---------------- universities (on at start), famous places, landmarks
    const universityLayer = L.layerGroup().addTo(map);
    const cityLandmarkLayer = L.layerGroup();
    const pickLandmark = (latlng, label) => latest.current.onLandmarkPoint?.({ lat: latlng.lat, lng: latlng.lng, label });

    const addLandmarks = (list, layer, kind) => {
      const groups = [];
      list.forEach((item) => {
        if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
        const latlng = L.latLng(item.lat, item.lon);
        const group = groups.find((g) => map.distance(g.latlng, latlng) < 60);
        if (group) group.items.push(item); else groups.push({ latlng, items: [item] });
      });
      if (kind !== 'landmark') list.forEach((i) => { if (Number.isFinite(i.lat)) st.named.landmarks.push({ name: i.name, lat: i.lat, lng: i.lon }); });
      groups.forEach(({ latlng, items }) => {
        const tooltip = items.map((item) => escapeHtml(item.name)
          + (item.category && !item.name.includes(item.category) ? ` <span class="jp-landmark-category">${escapeHtml(item.category)}</span>` : '')).join('<br>');
        const label = items.length > 1 ? `${shortName(items[0].name)} +${items.length - 1}` : shortName(items[0].name);
        L.marker(latlng, { icon: pinIcon({ emoji: items[0].icon || '🎓', ring: RING[kind], kind, label }), title: items.map((i) => i.name).join(' / '), riseOnHover: true })
          .bindTooltip(tooltip, { direction: 'top', offset: [0, -16], className: 'jp-landmark-tooltip' })
          .on('click', () => pickLandmark(latlng, items.map((i) => i.name).join(' / ')))
          .addTo(layer);
      });
    };

    const loadLandmarks = (file, layer, kind) => fetch(PLANNER + file, { headers: { Accept: 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error(`${file} returned ${r.status}`); return r.json(); })
      .then((list) => {
        addLandmarks(list, layer, kind);
        if (kind === 'place') {
          st.cityPlacePoints = list.map((i) => [i.lon, i.lat]);
          addLandmarks(list.filter((i) => !['Airport', 'Rail station'].includes(i.category)), cityLandmarkLayer, 'landmark');
          drawDistrictMarkers();
        }
      })
      .catch((e) => console.error(`Could not load ${file}`, e));
    loadLandmarks('universities.json', universityLayer, 'uni');
    loadLandmarks('places.json', st.cityPlaces, 'place');

    // ---------------- layer list
    const amenityLayers = Object.fromEntries(Object.keys(AMENITY_CATEGORIES).map((k) => [k, L.layerGroup()]));
    amenityLayers.landmarks = cityLandmarkLayer;
    const row = (emoji, label, ring) => `<span class="pm-row"><span class="pm-row-dot" style="--ring:${ring}">${emoji}</span>${label}</span>`;
    const overlays = {
      [row('🎓', 'Universities', RING.uni)]: universityLayer,
      [row('📍', 'Famous places', RING.place)]: st.placeLayer,
      [row('🏷️', 'District names', '#7a8a7e')]: st.names,
      ...Object.fromEntries(Object.entries(AMENITY_CATEGORIES).map(([key, c]) => [
        c.logo
          ? `<span class="jp-layer-subcategory">${brandLogo(key)}<span>${c.label}</span></span>`
          : row(c.icon, c.label, c.ring),
        amenityLayers[key],
      ])),
    };
    const layersControl = L.control.layers(null, overlays, { position: 'topright', collapsed: true }).addTo(map);
    // A labelled "Layers" button instead of the bare icon
    const toggle = layersControl.getContainer().querySelector('.leaflet-control-layers-toggle');
    if (toggle) { toggle.innerHTML = '<span>Layers</span>'; toggle.title = 'Show more on the map'; }

    const loadAmenityRecords = () => loadCsv().then((records) => { st.amenityRecords = records; return records; });
    loadAmenityRecords().catch(() => { /* reported when a layer needs it */ }); // also names clicked points

    const amenityMarker = (record, { key, emoji, ring, typeLabel, kind }) => {
      const name = record.name.trim();
      const latlng = L.latLng(record.latitude, record.longitude);
      const brand = key && AMENITY_CATEGORIES[key]?.logo ? key : brandOf(record);
      return L.marker(latlng, {
        icon: pinIcon({ emoji, ring, kind, label: name, brand }),
        title: `${name} · ${typeLabel} · ${record.area}`,
        riseOnHover: true,
      })
        .bindTooltip(`${escapeHtml(name)}<small>${escapeHtml(typeLabel)} · ${escapeHtml(record.area)}</small>`, { direction: 'top', offset: [0, -16], className: 'jp-landmark-tooltip jp-amenity-tooltip' })
        .on('click', () => pickLandmark(latlng, name));
    };

    const activeAmenityKeys = () => Object.keys(AMENITY_CATEGORIES).filter((k) => map.hasLayer(amenityLayers[k]));

    // Chosen layers: shown from zoom 12, only inside the current view
    const renderAmenities = (keys) => {
      keys.forEach((k) => amenityLayers[k].clearLayers());
      const bounds = map.getBounds().pad(0.15);
      const seen = new Set();
      st.amenityRecords.forEach((record) => {
        const key = keys.find((k) => recordMatchesAmenityLayer(record, k));
        const at = [record.latitude, record.longitude];
        if (!key || !hasName(record) || !DUBLIN_BOUNDS.contains(at) || !bounds.contains(at)) return;
        const id = `${key}|${record.name}|${record.latitude}|${record.longitude}`;
        if (seen.has(id)) return;
        seen.add(id);
        const c = AMENITY_CATEGORIES[key];
        amenityMarker(record, { key, emoji: c.icon, ring: c.ring, typeLabel: c.label, kind: 'amenity' }).addTo(amenityLayers[key]);
      });
    };

    // Google Maps style: at street level the nearby places appear without choosing a layer
    const renderPois = () => {
      st.pois.clearLayers();
      if (map.getZoom() < Z_POI || !st.amenityRecords) return;
      const bounds = map.getBounds().pad(0.1);
      const chosen = activeAmenityKeys();
      const seen = new Set();
      st.amenityRecords.forEach((record) => {
        const style = POI_STYLE[record.category];
        const at = [record.latitude, record.longitude];
        if (!style || !hasName(record) || !bounds.contains(at)) return; // unnamed places are left out
        if (chosen.some((k) => recordMatchesAmenityLayer(record, k))) return; // already on a chosen layer
        const name = record.name.trim();
        const id = `${name}|${record.latitude.toFixed(5)}|${record.longitude.toFixed(5)}`;
        if (seen.has(id)) return;
        seen.add(id);
        const latlng = L.latLng(at);
        L.marker(latlng, {
          icon: L.divIcon({ className: 'pm-icon', html: `<div class="poi-text" style="--c:${style[0]}">${escapeHtml(name)}</div>`, iconSize: [0, 0] }),
          title: `${name} · ${style[1]} · ${record.area}`,
        })
          .bindTooltip(`${escapeHtml(name)}<small>${escapeHtml(style[1])} · ${escapeHtml(record.area)}</small>`, { direction: 'top', offset: [0, -8], className: 'jp-landmark-tooltip jp-amenity-tooltip' })
          .on('click', () => pickLandmark(latlng, name))
          .addTo(st.pois);
      });
    };

    const updateStatus = () => {
      const z = map.getZoom();
      const keys = activeAmenityKeys().filter((k) => AMENITY_CATEGORIES[k].csv);
      const { showBus } = latest.current;
      if (keys.length && z < Z_MID) setStatus('Zoom in to see the places you chose.');
      else if (showBus && z < Z_BUS) setStatus('Zoom in to see bus stops.');
      else setStatus();
    };

    const updateAmenities = async () => {
      const keys = activeAmenityKeys().filter((k) => AMENITY_CATEGORIES[k].csv);
      const needCsv = keys.length || map.getZoom() >= Z_POI;
      if (!needCsv) { st.pois.clearLayers(); updateStatus(); return; }
      try {
        if (!st.amenityRecords) await loadAmenityRecords();
      } catch (e) {
        console.error('Could not load amenities_osm.csv', e);
        setStatus('Could not load amenities_osm.csv. Check the planner data file and reload.');
        return;
      }
      if (map.getZoom() < Z_MID) keys.forEach((k) => amenityLayers[k].clearLayers());
      else renderAmenities(keys);
      renderPois();
      updateStatus();
      st.declutter?.();
    };

    // ---------------- bus stops (button above the map): drawn from zoom 15, inside the view only
    const renderBusStops = () => {
      st.bus.clearLayers();
      if (!latest.current.showBus || map.getZoom() < Z_BUS) { updateStatus(); return; }
      if (!st.busStops) {
        fetch(busStopsUrl).then((r) => r.json()).then((gj) => { st.busStops = gj.features; renderBusStops(); })
          .catch((e) => { console.error('Could not load bus stops', e); setStatus('Could not load bus stops.'); });
        return;
      }
      const bounds = map.getBounds().pad(0.1);
      const z = map.getZoom();
      const badge = z >= Z_BUS_ICON;
      const big = z >= 17;
      const tip = (stops) => {
        const names = [...new Set(stops.map((f) => f.properties.name))].map(escapeHtml).join(' / ');
        const refs = stops.map((f) => f.properties.ref).filter(Boolean);
        const routes = [...new Set(stops.flatMap((f) => (f.properties.routes || '').split(';').map((r) => r.trim()).filter(Boolean)))]
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
        return `🚌 ${names}${refs.length ? ` · stop${refs.length > 1 ? 's' : ''} ${refs.map(escapeHtml).join(', ')}` : ''}`
          + `${routes.length ? `<small>Routes ${escapeHtml(routes.join(', '))}</small>` : ''}`;
      };
      const inView = st.busStops.filter((f) => bounds.contains([f.geometry.coordinates[1], f.geometry.coordinates[0]]));

      if (!badge) {
        // zoomed out: yellow dots with a dark ring, which stand out on the pale map
        inView.forEach((f) => {
          const [lng, lat] = f.geometry.coordinates;
          L.circleMarker([lat, lng], { renderer: busRenderer, radius: 6, color: '#173f37', weight: 2.5, fillColor: BUS_YELLOW, fillOpacity: 1, bubblingMouseEvents: false })
            .bindTooltip(tip([f]), { direction: 'top', offset: [0, -6], className: 'jp-landmark-tooltip jp-amenity-tooltip' })
            .on('click', () => pickLandmark(L.latLng(lat, lng), `${f.properties.name} (bus stop)`))
            .addTo(st.bus);
        });
        updateStatus();
        return;
      }

      // closer: Dublin Bus style yellow badges with a bus. Poles that would sit on top of each other on
      // screen (both sides of a street, a row of poles at one stop) share one badge listing all their stops.
      const size = big ? 30 : 24;
      const groups = [];
      inView.forEach((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const pt = map.latLngToContainerPoint([lat, lng]);
        const g = groups.find((x) => x.pt.distanceTo(pt) < size * 0.9);
        if (g) g.stops.push(f); else groups.push({ pt, lat, lng, stops: [f] });
      });
      groups.forEach(({ lat, lng, stops }) => {
        const refs = stops.map((f) => f.properties.ref).filter(Boolean);
        const label = big && refs.length ? (refs.length > 2 ? `${refs[0]} +${refs.length - 1}` : refs.join(' · ')) : '';
        L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'jp-bus-stop',
            html: `<span class="jp-bus-badge${big ? ' is-big' : ''}">${BUS_ICON}${stops.length > 1 ? `<i>${stops.length}</i>` : ''}</span>${label ? `<small>${escapeHtml(label)}</small>` : ''}`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          }),
          title: `${stops[0].properties.name} bus stop`,
          keyboard: false,
        })
          .bindTooltip(tip(stops), { direction: 'top', offset: [0, -size / 2], className: 'jp-landmark-tooltip jp-amenity-tooltip' })
          .on('click', () => pickLandmark(L.latLng(lat, lng), `${stops[0].properties.name} (bus stop)`))
          .addTo(st.bus);
      });
      updateStatus();
    };
    st.renderBusStops = renderBusStops;

    map.on('overlayadd overlayremove', (e) => { if (Object.values(amenityLayers).includes(e.layer)) updateAmenities(); });
    map.on('moveend', () => { updateAmenities(); renderBusStops(); });

    // ---------------- click the map to set A then B (journey planner)
    // District famous places, Luas stops and neighbourhoods also give names to clicked points
    Object.values(placesByDistrict).flat().forEach((p) => { if (p.lngLat) st.named.landmarks.push({ name: p.name, lat: p.lngLat[1], lng: p.lngLat[0] }); });
    profileData.stops.forEach((x) => st.named.stations.push({ name: `${x.name} (Luas)`, lat: x.lat, lng: x.lng }));
    Object.entries(profileData.profiles).forEach(([d, pr]) => (pr.areas || []).forEach(([name, lat, lng]) => st.named.areas.push({ name, d, lat, lng })));
    map.on('click', (e) => latest.current.onMapPoint?.({ lat: e.latlng.lat, lng: e.latlng.lng, label: nameFor(e.latlng.lat, e.latlng.lng), lookup: true }));

    // ---------------- district outlines
    fetch(boundariesUrl)
      .then((r) => { if (!r.ok) throw new Error(`Boundary file request failed (${r.status})`); return r.json(); })
      .then((raw) => {
        raw.features.forEach((f) => {
          const id = districtIdFromPostcode(f.properties?.postcodes);
          if (id) st.features[id] = { ...f, geometry: { ...f.geometry, coordinates: convertCoordinates(f.geometry.coordinates) } };
        });
        return fetch(countyAreasUrl).then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] }));
      })
      .then((county) => {
        (county?.features || []).forEach((f) => { st.features[f.properties.key] = f; }); // already in lat/lng
        drawOutline();
        fitDistrict(latest.current.selectedDistrict, false);
      })
      .catch((e) => console.error('Could not load district boundaries', e));
    if (!latest.current.selectedDistrict) map.fitBounds(CAMPUS_VIEW, { padding: [20, 20] });

    // ---------------- Luas (button above the map)
    [[LUAS_RED, 'Luas Red Line', luasRedUrl], [LUAS_GREEN, 'Luas Green Line', luasGreenUrl]].forEach(([colour, refName, url]) => {
      fetch(url).then((r) => r.json()).then((gj) => {
        transitLine(gj, colour, 'dpLuas', (f) => /LineString/.test(f.geometry?.type) && f.properties?.ref === refName).addTo(st.luas);
      }).catch((e) => console.error(`Could not load ${url}`, e));
    });
    profileData.stops.forEach((stop) => {
      L.marker([stop.lat, stop.lng], { icon: stopIcon(stop.line === 'Red' ? LUAS_RED : LUAS_GREEN, stop.name, 'luas'), riseOnHover: true })
        .bindTooltip(`${escapeHtml(stop.name)}<small>Luas ${escapeHtml(stop.line)} Line</small>`, { direction: 'top', offset: [0, -10], className: 'jp-landmark-tooltip jp-amenity-tooltip' })
        .on('click', () => openStopPopup(stop))
        .addTo(st.luasStops);
    });

    // ---------------- DART and commuter rail (button above the map)
    fetch(railLinesUrl).then((r) => r.json()).then((gj) => {
      transitLine(gj, RAIL_PURPLE, 'dpRail', (f) => f.properties.line === 'rail', 4).addTo(st.rail);
      transitLine(gj, DART_GREEN, 'dpRail', (f) => f.properties.line === 'dart', 5).addTo(st.rail);
    }).catch((e) => console.error('Could not load rail lines', e));
    fetch(railStationsUrl).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((gj) => {
      gj.features.forEach((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const { name, dart } = f.properties;
        L.marker([lat, lng], { icon: stopIcon(dart ? DART_GREEN : RAIL_PURPLE, name, 'rail'), riseOnHover: true })
          .bindTooltip(`🚆 ${escapeHtml(name)}<small>${dart ? 'DART and rail station' : 'Rail station'}</small>`, { direction: 'top', offset: [0, -10], className: 'jp-landmark-tooltip jp-amenity-tooltip' })
          .on('click', () => pickLandmark(L.latLng(lat, lng), `${name} station`))
          .addTo(st.railStations);
        st.named.stations.push({ name: `${name} station`, lat, lng });
      });
    }).catch(() => { /* stations file is optional */ });

    // ---------------- Dublin Bikes (button above the map): live stations from JCDecaux
    st.loadBikes = () => {
      if (st.bikesLoad) return st.bikesLoad;
      st.bikesLoad = fetch(BIKES_INFO_URL).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then((json) => {
          (json.data?.stations || []).forEach((dock) => {
            L.marker([dock.lat, dock.lon], { icon: pinIcon({ emoji: '🚲', ring: BIKES_BLUE, kind: 'bike', label: dock.name }), riseOnHover: true })
              .bindTooltip(`Dublin Bikes · ${escapeHtml(dock.name)}`, { direction: 'top', offset: [0, -16], className: 'jp-landmark-tooltip' })
              .on('click', () => openBikePopup({ id: dock.station_id, name: dock.name, address: dock.address, capacity: dock.capacity }, [dock.lat, dock.lon]))
              .addTo(st.bikes);
          });
          st.declutter?.();
        })
        .catch((e) => { st.bikesLoad = null; console.error('Could not load Dublin Bikes', e); setStatus('Could not load Dublin Bikes stations.'); });
      return st.bikesLoad;
    };

    // ---------------- Safety map (button above the map): every Census area coloured by its safety score
    st.loadSafety = () => {
      if (st.safetyLoad) return st.safetyLoad;
      st.safetyLoad = Promise.all([
        fetch(crimeAreasUrl).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
        fetch(countySafetyUrl).then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] })),
      ])
        .then(([city, county]) => ({ type: 'FeatureCollection', features: [...city.features, ...(county.features || [])] }))
        .then((gj) => {
          const base = { color: '#ffffff', weight: 0.8, opacity: 0.9, fillOpacity: 0.42 };
          L.geoJSON(gj, {
            pane: 'dpSafety',
            style: (f) => ({ ...base, fillColor: heatColor(Number(f.properties.score)) }),
            onEachFeature: (f, layer) => {
              const p = f.properties;
              const sc = Number(p.score);
              layer.bindTooltip(
                `<div class="safe-pop"><span class="safe-pop-score" style="background:${heatColor(sc)};color:${textOnHeat(sc)}">${sc.toFixed(0)}</span>`
                + `<div><b>${escapeHtml(p.ed)}</b> · ${escapeHtml(p.d)}<br><small>${escapeHtml(safetyLabel(sc))}</small></div></div>`
                + (String(p.check) === 'true' ? '<p class="safe-pop-check">⚠ Check the specific street before choosing</p>' : '')
                + `<p class="safe-pop-facts">Violent crime ${p.viol} · Robbery ${p.rob} · Theft ${p.burg} per 1,000 people a year</p>`,
                { sticky: true, direction: 'top', offset: [0, -10], className: 'jp-landmark-tooltip safe-tooltip' },
              );
              layer.on('mouseover', () => layer.setStyle({ weight: 2.5, color: '#173f37', fillOpacity: 0.55 }));
              layer.on('mouseout', () => layer.setStyle({ ...base, fillColor: heatColor(sc) }));
            },
          }).addTo(st.safety); // clicks still reach the map, so the journey planner keeps working
        })
        .catch((e) => { st.safetyLoad = null; console.error('Could not load the safety map', e); setStatus('Could not load the safety map.'); });
      return st.safetyLoad;
    };

    // ---------------- district code chips (in "District names")
    ALL_DISTRICTS.forEach((c) => {
      const pos = profileData.labels[c];
      if (!pos || !profileData.profiles[c]) return;
      st.codeMarkers[c] = L.marker(pos, { icon: centredIcon(`<button type="button" class="dm-code">${c}</button>`, 'dp-code'), keyboard: false, riseOnHover: true })
        .on('click', () => latest.current.onSelectDistrict(c))
        .addTo(st.codes);
    });

    // ---------------- detail by zoom level
    const applyZoom = () => {
      const z = map.getZoom();
      const box = boxRef.current;
      if (box) {
        box.classList.toggle('z-far', z < Z_MID);
        box.classList.toggle('z-mid', z >= Z_MID && z < Z_NEAR);
        box.classList.toggle('z-near', z >= Z_NEAR);
        box.classList.toggle('z-street', z >= Z_STREET);
        box.classList.toggle('z-low', z < Z_NEAR);
      }
      if (z >= Z_STOPS) { st.luas.addLayer(st.luasStops); st.rail.addLayer(st.railStations); }
      else { st.luas.removeLayer(st.luasStops); st.rail.removeLayer(st.railStations); }
    };
    map.on('zoomend', applyZoom);
    applyZoom();

    // The map's box changes size with the window and the toolbar above it: keep Leaflet in step
    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resizeObserver.observe(containerRef.current);
    st.resizeObserver = resizeObserver;

    // When two names would overlap, only the first (universities first) is shown
    let declutterTimer;
    const declutter = () => {
      const box = boxRef.current;
      if (!box) return;
      const labels = [...box.querySelectorAll('.pm-label, .poi-text')];
      labels.forEach((n) => n.classList.remove('pm-label-hidden'));
      const rank = (n) => (n.closest('.pm-uni') ? 0 : n.closest('.pm-place, .pm-landmark') ? 1 : n.closest('.tr-stop') ? 2 : 3);
      // Pins and stops come first, so a name never covers a pin
      const placed = [...box.querySelectorAll('.pm-dot, .tr-stop-dot')].filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect());
      labels.filter((n) => n.offsetParent).sort((x, y) => rank(x) - rank(y)).forEach((n) => {
        const r = n.getBoundingClientRect();
        const hit = (q) => r.left < q.right + 2 && r.right > q.left - 2 && r.top < q.bottom + 1 && r.bottom > q.top - 1;
        if (placed.some(hit)) { n.classList.add('pm-label-hidden'); return; }
        placed.push(r);
      });
    };
    st.declutter = () => { clearTimeout(declutterTimer); declutterTimer = setTimeout(declutter, 80); };
    map.on('zoomend moveend overlayadd overlayremove layeradd', st.declutter);

    return () => {
      unsyncFullscreen?.();
      st.resizeObserver?.disconnect();
      clearTimeout(st.travelTimer);
      cancelAnimationFrame(st.travelFrame);
      map.remove();
      s.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ district helpers
  function resetView() {
    const st = s.current;
    if (!st) return;
    st.map.closePopup();
    const sel = latest.current.selectedDistrict;
    if (sel && st.features[sel]) fitDistrict(sel);
    else st.map.fitBounds(CAMPUS_VIEW, { padding: [20, 20], animate: !REDUCED_MOTION });
  }

  function fitDistrict(code, animate = true) {
    const st = s.current;
    if (!st) return;
    const f = code && st.features[code];
    if (!f) return;
    st.map.fitBounds(L.geoJSON(f).getBounds(), { padding: [50, 50], maxZoom: 14, animate: animate && !REDUCED_MOTION });
  }

  function drawOutline() {
    const st = s.current;
    if (!st) return;
    const { selectedDistrict: sel } = latest.current;
    st.outline.clearLayers();
    const f = sel && st.features[sel];
    if (!f) return;
    const colour = strongColor(profileData.profiles[sel].hue);
    L.geoJSON(f, { pane: 'dpOutline', interactive: false, style: { color: '#ffffff', weight: 7, opacity: 0.8, fill: false } }).addTo(st.outline);
    L.geoJSON(f, { pane: 'dpOutline', interactive: false, style: { color: colour, weight: 3, opacity: 0.95, dashArray: '8 6', fill: false, className: 'dp-outline-line' } }).addTo(st.outline);
  }

  function drawDistrictMarkers() {
    const st = s.current;
    if (!st) return;
    const { selectedDistrict: sel, filter } = latest.current;
    const profiles = profileData.profiles;

    Object.entries(st.codeMarkers).forEach(([c, m]) => {
      const node = m.getElement()?.querySelector('.dm-code');
      if (!node || !profiles[c]) return;
      const visible = filter === 'all' || profiles[c]?.side === filter;
      node.style.background = strongColor(profiles[c].hue);
      node.style.opacity = visible ? 1 : 0.35;
      node.title = `${c} · ${profiles[c].name}`;
      node.classList.toggle('selected', c === sel);
      m.setZIndexOffset(c === sel ? 900 : 0);
    });

    st.areas.clearLayers();
    st.districtPlaces.clearLayers();
    st.placeMarkers = [];
    if (!sel) return;
    (profiles[sel]?.areas || []).forEach(([name, lat, lng]) => {
      L.marker([lat, lng], { icon: centredIcon(`<div class="dm-area">${escapeHtml(name)}</div>`), interactive: false, keyboard: false }).addTo(st.areas);
    });
    st.placeMarkers = (placesByDistrict[sel] || []).map((place, i) => {
      if (!place.lngLat) return null;
      const duplicate = st.cityPlacePoints.some((p) => distanceMetres(p, place.lngLat) < 150);
      const marker = L.marker([place.lngLat[1], place.lngLat[0]], {
        icon: pinIcon({ emoji: PLACE_EMOJI[place.cat] || '📍', ring: RING.place, kind: 'place', label: place.name }),
        riseOnHover: true,
        title: place.name,
      })
        .bindPopup(createPlacePopup(place), { maxWidth: 280, offset: [0, -14] })
        .on('mouseover', () => latest.current.onHoverPlace(i))
        .on('mouseout', () => latest.current.onHoverPlace(null))
        .on('click', () => latest.current.onPlaceClick(sel, i));
      if (!duplicate) marker.addTo(st.districtPlaces);
      return marker;
    });
  }

  // Name for a clicked or dragged point: the nearest landmark, station or stop, shop or café,
  // otherwise the nearest neighbourhood ("Near Raheny, D5").
  function nameFor(lat, lng) {
    const st = s.current;
    if (!st) return 'Dropped pin';
    const nearest = (list, radius) => {
      let best = null;
      let bestD = radius;
      list.forEach((p) => { const d = metres([lat, lng], [p.lat, p.lng]); if (d < bestD) { bestD = d; best = p; } });
      return best;
    };
    const hit = nearest(st.named.landmarks, 150) || nearest(st.named.stations, 120);
    if (hit) return hit.name;
    if (st.amenityRecords) {
      const shop = nearest(st.amenityRecords.filter((r) => r.name && r.name.trim() && Math.abs(r.latitude - lat) < 0.001 && Math.abs(r.longitude - lng) < 0.0015)
        .map((r) => ({ name: r.name.trim(), lat: r.latitude, lng: r.longitude })), 70);
      if (shop) return shop.name;
    }
    const area = nearest(st.named.areas, 2500);
    return area ? `Near ${area.name}` : 'Dropped pin';
  }

  // ------------------------------------------------------------ popups
  function openStopPopup(stop) {
    const st = s.current;
    const { profiles, amenities, lines } = profileData;
    const lngLat = [stop.lng, stop.lat];
    const line = lines[stop.line.toLowerCase()] || {};
    const box = el('div', 'stop-popup');
    box.append(el('span', `stop-line ${stop.line.toLowerCase()}`, `${stop.line} Line`), el('h3', null, stop.name));
    const tags = el('div', 'stop-tags');
    tags.append(el('span', null, stop.d ? `${stop.d}${profiles[stop.d] ? ` · ${profiles[stop.d].name}` : ''}` : 'Outside Dublin postal districts'));
    if (line.interval) tags.append(el('span', null, `Every ${line.peak || line.interval} min at peak`));
    box.append(tags);
    const counts = {};
    (amenities[stop.d] || []).forEach(([, cat, lat, lng]) => { if (distanceMetres(lngLat, [lng, lat]) < 500) counts[cat] = (counts[cat] || 0) + 1; });
    const near = AMENITY_TYPES.filter(([k]) => counts[k]);
    if (near.length) {
      box.append(el('p', 'stop-heading', 'Within 500 m'));
      const tagRow = el('div', 'stop-tags');
      near.forEach(([k, label, , colour]) => { const t = el('span', null, `${counts[k]} ${label.toLowerCase()}`); t.style.borderColor = colour; tagRow.append(t); });
      box.append(tagRow);
    }
    const actions = el('div', 'dp-popup-actions');
    if (stop.d && ACTIVE_DISTRICTS.includes(stop.d)) {
      const btn = el('button', 'stop-open', `Open ${stop.d} profile`);
      btn.type = 'button';
      btn.style.background = strongColor(profiles[stop.d].hue);
      btn.onclick = () => { st.map.closePopup(); latest.current.onSelectDistrict(stop.d); };
      actions.append(btn);
    }
    const go = el('button', 'stop-open dp-route-here', 'Route to this stop');
    go.type = 'button';
    go.onclick = () => { st.map.closePopup(); latest.current.onLandmarkPoint?.({ lat: stop.lat, lng: stop.lng, label: `${stop.name} (Luas ${stop.line})` }); };
    actions.append(go);
    box.append(actions);
    L.popup({ maxWidth: 280, offset: [0, -6] }).setLatLng([stop.lat, stop.lng]).setContent(box).openOn(st.map);
  }

  async function bikeStatus() {
    const st = s.current;
    if (st.bikeStatus && Date.now() - st.bikeStatus.at < BIKES_STATUS_MAX_AGE_MS) return st.bikeStatus.byId;
    const response = await fetch(BIKES_STATUS_URL);
    if (!response.ok) throw new Error(`Dublin Bikes status returned ${response.status}`);
    const stations = (await response.json()).data?.stations || [];
    const byId = Object.fromEntries(stations.map((x) => [String(x.station_id), x]));
    st.bikeStatus = { at: Date.now(), byId };
    return byId;
  }

  function openBikePopup(dock, latlng) {
    const st = s.current;
    const box = el('div', 'stop-popup');
    box.append(el('span', 'stop-line bikes', 'Dublin Bikes'), el('h3', null, dock.name));
    if (dock.address && dock.address.toLowerCase() !== dock.name.toLowerCase()) box.append(el('p', 'bike-address', dock.address));
    const tags = el('div', 'stop-tags');
    tags.append(el('span', null, `${dock.capacity} stands`));
    box.append(tags);
    const live = el('p', 'bike-live', 'Checking live availability…');
    box.append(live);
    L.popup({ maxWidth: 280, offset: [0, -12] }).setLatLng(latlng).setContent(box).openOn(st.map);
    bikeStatus().then((byId) => {
      const x = byId[String(dock.id)];
      if (!x) { live.textContent = 'No live data for this dock right now.'; return; }
      if (!x.is_installed || !x.is_renting) { live.textContent = 'This dock is closed at the moment.'; return; }
      const ebikes = x.vehicle_types_available?.find((v) => v.vehicle_type_id === 'electrical')?.count ?? 0;
      live.textContent = `${x.num_bikes_available} bikes${ebikes ? ` (${ebikes} electric)` : ''} · ${x.num_docks_available} free stands`;
    }).catch(() => { live.textContent = 'Live availability could not be loaded.'; });
  }

  // ------------------------------------------------------------ journey drawing
  function routePinIcon(label, cls) {
    return L.divIcon({ className: '', html: `<div class="jp-route-pin ${cls}"><i class="jp-pin-pulse"></i><span></span><b>${label}</b></div>`, iconSize: [34, 42], iconAnchor: [17, 40] });
  }

  function ripple(latlng) {
    const st = s.current;
    if (REDUCED_MOTION || !st) return;
    const m = L.marker(latlng, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', html: '<span class="jp-click-ripple"></span>', iconSize: [0, 0] }) }).addTo(st.map);
    setTimeout(() => m.remove(), 700);
  }

  function syncPins() {
    const st = s.current;
    if (!st) return;
    const { trip } = latest.current;
    [['from', 'A', 'jp-pin-start'], ['to', 'B', 'jp-pin-end']].forEach(([k, label, cls]) => {
      const p = trip[k];
      const existing = st.pins[k];
      if (!p) { existing?.remove(); st.pins[k] = null; return; }
      if (existing) {
        const ll = existing.getLatLng();
        if (ll.lat !== p.lat || ll.lng !== p.lng) { existing.setLatLng([p.lat, p.lng]); ripple([p.lat, p.lng]); }
        return;
      }
      ripple([p.lat, p.lng]);
      const marker = L.marker([p.lat, p.lng], { draggable: true, autoPan: true, riseOnHover: true, zIndexOffset: 1200, icon: routePinIcon(label, cls), title: k === 'from' ? 'Start' : 'Destination' }).addTo(st.map);
      marker.on('dragstart', () => marker.getElement()?.classList.add('jp-is-dragging'));
      marker.on('dragend', () => {
        marker.getElement()?.classList.remove('jp-is-dragging');
        const ll = marker.getLatLng();
        ripple(ll);
        latest.current.onDragPoint?.(k, { lat: ll.lat, lng: ll.lng, label: nameFor(ll.lat, ll.lng), lookup: true });
      });
      st.pins[k] = marker;
    });
  }

  function updateHint() {
    const node = hintRef.current;
    if (!node) return;
    const { trip } = latest.current;
    const loading = trip.status === 'loading';
    let html;
    if (loading) html = 'Finding the best routes…';
    else if (!trip.from) html = 'Click the map to drop your <strong>start (A)</strong>, or type a place in box A';
    else if (!trip.to) html = 'Now click the map to drop your <strong>destination (B)</strong>';
    else html = '<strong>Drag the A or B pin</strong> on the map to change your route';
    if (node.dataset.html === html) return;
    node.dataset.html = html;
    node.classList.toggle('jp-is-loading', loading);
    node.innerHTML = `${loading ? '<span class="jp-spinner" aria-hidden="true"></span>' : ''}<span class="jp-hint-text">${html}</span>`;
    node.classList.remove('jp-hint-swap');
    void node.offsetWidth;
    node.classList.add('jp-hint-swap');
  }

  function animateDraw(layer, delay, duration) {
    const node = layer.getElement();
    if (!node || REDUCED_MOTION) return;
    node.setAttribute('pathLength', '1');
    node.style.strokeDasharray = '1';
    node.style.strokeDashoffset = '1';
    node.style.animation = `jp-route-draw ${duration}ms cubic-bezier(.45,.05,.35,1) ${delay}ms forwards`;
  }

  function animateFade(layer, delay, duration) {
    const node = layer.getElement();
    if (!node || REDUCED_MOTION) return;
    node.style.opacity = '0';
    node.style.animation = `jp-route-fade ${duration}ms ease ${delay}ms forwards`;
  }

  function stopTraveller() {
    const st = s.current;
    if (!st) return;
    clearTimeout(st.travelTimer);
    cancelAnimationFrame(st.travelFrame);
    st.traveller?.remove();
    st.traveller = null;
  }

  function startTraveller(itinerary, pointsByLeg) {
    const st = s.current;
    if (REDUCED_MOTION || !st) return;
    const track = [];
    let distance = 0;
    pointsByLeg.forEach((points, i) => {
      const color = legColor(itinerary.legs[i]);
      points.forEach((p) => { if (track.length) distance += metres(track[track.length - 1].p, p); track.push({ p, d: distance, color }); });
    });
    if (track.length < 2 || distance === 0) return;
    st.traveller = L.marker(track[0].p, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: '', html: '<span class="jp-traveller"><i></i></span>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(st.route);
    const node = st.traveller.getElement()?.querySelector('.jp-traveller');
    const startedAt = performance.now();
    let k = 0;
    const step = (now) => {
      const t = ((now - startedAt) % (TRAVEL_MS + 900)) / TRAVEL_MS;
      const eased = t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const target = eased * distance;
      if (target < track[k].d) k = 0;
      while (k < track.length - 2 && track[k + 1].d < target) k++;
      const a = track[k], b = track[k + 1];
      const f = b.d > a.d ? (target - a.d) / (b.d - a.d) : 0;
      st.traveller.setLatLng([a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f]);
      node?.style.setProperty('--c', b.color);
      st.travelFrame = requestAnimationFrame(step);
    };
    st.travelFrame = requestAnimationFrame(step);
  }

  function legPoints(itinerary) {
    if (!itinerary._points) itinerary._points = itinerary.legs.map((leg) => (leg.geometry ? latLngPoints(leg.geometry) : []));
    return itinerary._points;
  }

  function drawRoute() {
    const st = s.current;
    if (!st) return;
    const { trip, routeTabLabel } = latest.current;
    stopTraveller();
    st.route.clearLayers();
    st.alt.clearLayers();
    const itineraries = trip.itineraries || [];
    const itinerary = itineraries[trip.selected];
    if (legendRef.current) legendRef.current.hidden = !itinerary;
    if (!itinerary || !trip.from || !trip.to) return;

    itineraries.forEach((it, i) => {
      if (i === trip.selected) return;
      const points = legPoints(it).flat();
      if (!points.length) return;
      L.polyline(points, { color: '#ffffff', weight: 10, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(st.alt);
      L.polyline(points, { color: '#8d9a93', weight: 6, opacity: 0.75, lineCap: 'round', lineJoin: 'round', className: 'jp-route-alt', bubblingMouseEvents: false })
        .bindTooltip(`${formatMinutes(it.total_minutes)} · ${escapeHtml(routeTabLabel(it))} — click to choose`, { sticky: true, className: 'jp-route-tooltip' })
        .on('click', () => latest.current.onSelectItinerary?.(i))
        .addTo(st.alt);
    });

    const pointsByLeg = legPoints(itinerary);
    const lengths = pointsByLeg.map((pts) => pts.slice(1).reduce((sum, p, k) => sum + metres(pts[k], p), 0));
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    const bounds = L.latLngBounds([[trip.from.lat, trip.from.lng], [trip.to.lat, trip.to.lng]]);
    let delay = 0;
    itinerary.legs.forEach((leg, i) => {
      const points = pointsByLeg[i];
      if (!points.length) return;
      const color = legColor(leg);
      const weight = leg.mode === 'WALK' ? 5 : 7;
      const duration = Math.max(160, (lengths[i] / total) * DRAW_MS);
      const tooltip = leg.mode === 'WALK' ? `Walk ${formatDistance(leg.distance_km)} · ${formatMinutes(leg.minutes)}` : `${lineLabel(leg)} · ${formatMinutes(leg.minutes)}`;
      if (leg.mode === 'WALK') {
        const dots = L.polyline(points, { color, weight, opacity: 0.95, dashArray: '0.1 10', lineCap: 'round', lineJoin: 'round', bubblingMouseEvents: false })
          .bindTooltip(tooltip, { sticky: true, className: 'jp-route-tooltip' }).addTo(st.route);
        animateFade(dots, delay, duration);
      } else {
        const casing = L.polyline(points, { color: '#ffffff', weight: weight + 5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(st.route);
        const glow = L.polyline(points, { color, weight: weight + 10, opacity: 0.16, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(st.route);
        const line = L.polyline(points, { color, weight, opacity: 1, lineCap: 'round', lineJoin: 'round', bubblingMouseEvents: false })
          .bindTooltip(tooltip, { sticky: true, className: 'jp-route-tooltip' }).addTo(st.route);
        [casing, glow, line].forEach((layer) => animateDraw(layer, delay, duration));
        if (leg.mode !== 'BICYCLE') {
          [[points[0], leg.from, delay], [points[points.length - 1], leg.to, delay + duration]].forEach(([point, name, at]) => {
            L.marker(point, { keyboard: false, icon: L.divIcon({ className: '', html: `<span class="jp-stop-dot" style="--c:${color}; --d:${Math.round(at)}ms"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] }) })
              .bindTooltip(escapeHtml(name), { className: 'jp-route-tooltip', direction: 'top', offset: [0, -8] }).addTo(st.route);
          });
        }
      }
      points.forEach((p) => bounds.extend(p));
      delay += duration;
    });
    st.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: !REDUCED_MOTION });
    st.travelTimer = setTimeout(() => startTraveller(itinerary, pointsByLeg), REDUCED_MOTION ? 0 : delay + 300);
  }

  // ------------------------------------------------------------ chains (Amenities tab)
  function drawChains() {
    const st = s.current;
    if (!st) return;
    st.chains.clearLayers();
    const { chain, selectedDistrict, chainShops = [] } = latest.current;
    if (!chain) return;
    // Only this district's shops (Amenities tab of the selected district)
    const list = chainShops.filter((x) => x.chain === chain && x.district === selectedDistrict);
    const [, label, colour] = chainInfo(chain);
    list.forEach((shop) => {
      L.marker([shop.lat, shop.lng], { icon: pinIcon({ emoji: '🛒', ring: colour, kind: 'amenity', label: shop.name, brand: CHAIN_LOGO[chain] }), riseOnHover: true, zIndexOffset: 500 })
        .bindPopup(`<div class="chain-popup"><b>${escapeHtml(shop.name)}</b><span>${escapeHtml(shop.district)} · ${escapeHtml(label)}</span></div>`, { offset: [0, -16], closeButton: false })
        .addTo(st.chains);
    });
    if (list.length) st.map.fitBounds(L.latLngBounds(list.map((x) => [x.lat, x.lng])), { padding: [70, 70], maxZoom: 15.5 });
  }

  // ------------------------------------------------------------ react to props
  useEffect(() => {
    drawOutline();
    drawDistrictMarkers();
    const st = s.current;
    if (!st) return;
    if (!props.selectedDistrict) { resetView(); return; } // district cleared: back to the universities view
    if (Object.keys(st.features).length) fitDistrict(props.selectedDistrict);
  }, [props.selectedDistrict]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { drawDistrictMarkers(); }, [props.filter, placesByDistrict]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { drawChains(); }, [props.chain, props.selectedDistrict, props.chainShops]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transport buttons above the map
  useEffect(() => {
    const st = s.current;
    if (!st) return;
    if (props.showLuas) st.luas.addTo(st.map); else st.luas.remove();
    st.declutter();
  }, [props.showLuas]);
  useEffect(() => {
    const st = s.current;
    if (!st) return;
    if (props.showRail) st.rail.addTo(st.map); else st.rail.remove();
    st.declutter();
  }, [props.showRail]);
  useEffect(() => {
    const st = s.current;
    if (!st) return;
    if (props.showBikes) { st.loadBikes(); st.bikes.addTo(st.map); } else st.bikes.remove();
    st.declutter();
  }, [props.showBikes]);
  useEffect(() => {
    const st = s.current;
    if (!st) return;
    if (props.showSafety) { st.loadSafety(); st.safety.addTo(st.map); } else st.safety.remove();
  }, [props.showSafety]);
  useEffect(() => {
    const st = s.current;
    if (!st) return;
    if (props.showBus) st.bus.addTo(st.map); else st.bus.remove();
    // turned on while zoomed out: zoom in so the stops appear straight away (not on the first load)
    if (props.showBus && st.busReady && st.map.getZoom() < Z_BUS) st.map.setZoom(Z_BUS_ICON, { animate: !REDUCED_MOTION });
    st.busReady = true;
    st.renderBusStops();
  }, [props.showBus]);

  useEffect(() => {
    const box = boxRef.current;
    box?.querySelectorAll('.pm.on').forEach((n) => n.classList.remove('on'));
    if (props.hoverPlace == null) return;
    s.current?.placeMarkers[props.hoverPlace]?.getElement()?.querySelector('.pm')?.classList.add('on');
  }, [props.hoverPlace, props.selectedDistrict]);

  const { trip } = props;
  useEffect(() => { syncPins(); updateHint(); }, [trip.from, trip.to, trip.status, trip.from?.label, trip.to?.label]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { drawRoute(); }, [trip.itineraries, trip.selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    getMap() { return s.current?.map; },
    flyToPlace(code, index) {
      const st = s.current;
      const marker = st?.placeMarkers[index];
      if (!marker) return;
      if (!st.map.hasLayer(st.placeLayer)) st.placeLayer.addTo(st.map);
      if (!st.districtPlaces.hasLayer(marker)) marker.addTo(st.districtPlaces);
      st.map.setView(marker.getLatLng(), 15.5, { animate: !REDUCED_MOTION });
      st.map.once('moveend', () => marker.openPopup());
    },
    // A place picked in the search box: a pin with its name and "Directions from / to here"
    showSearchResult(place) {
      const st = s.current;
      if (!st) return;
      st.searchPin?.remove();
      const ll = L.latLng(place.lat, place.lng);
      const html = `<div class="jp-search-pop"><strong>${escapeHtml(place.label)}</strong>${place.sub ? `<small>${escapeHtml(place.sub)}</small>` : ''}`
        + '<div class="jp-search-actions"><button type="button" data-end="from">Directions from here</button><button type="button" data-end="to">Directions to here</button></div></div>';
      const marker = L.marker(ll, {
        icon: L.divIcon({ className: 'jp-search-pin', html: '<span></span>', iconSize: [30, 40], iconAnchor: [15, 38] }),
        zIndexOffset: 1000,
        title: place.label,
      }).bindPopup(html, { offset: [0, -32], className: 'jp-search-popup', maxWidth: 280 }).addTo(st.map);
      marker.on('popupclose', () => boxRef.current?.classList.remove('has-search-pop'));
      marker.on('popupopen', (e) => {
        boxRef.current?.classList.add('has-search-pop'); // the "click the map" hint would cover it
        e.popup.getElement()?.querySelectorAll('[data-end]').forEach((btn) => L.DomEvent.on(btn, 'click', (ev) => {
          L.DomEvent.stop(ev);
          marker.closePopup();
          latest.current.onSearchDirections?.(btn.dataset.end, place);
        }));
      });
      st.searchPin = marker;
      let opened = false;
      const open = () => { if (!opened && st.searchPin === marker) { opened = true; marker.openPopup(); } };
      st.map.once('moveend', open);
      setTimeout(open, 700); // the map may already be there, so no move happens
      st.map.setView(ll, Math.max(st.map.getZoom(), 16), { animate: !REDUCED_MOTION });
    },
    // A typed A or B: bring it into view if it's off the map
    reveal(lat, lng) {
      const st = s.current;
      if (st && !st.map.getBounds().pad(-0.1).contains([lat, lng])) st.map.setView([lat, lng], Math.max(st.map.getZoom(), 14), { animate: !REDUCED_MOTION });
    },
    clearSearchPin() { s.current?.searchPin?.remove(); if (s.current) s.current.searchPin = null; },
    focusCampus(id) {
      const st = s.current;
      const campus = campusList.find((u) => u.id === id);
      if (!st || !campus) return;
      st.map.setView(campus.coordinates, 16, { animate: !REDUCED_MOTION });
    },
  }));

  return (
    <div ref={boxRef} className={`district-map jp-scope z-far z-low${props.planning === false ? ' is-browsing' : ''}`}>
      <div ref={containerRef} className="jp-route-map" aria-label={props.planning === false ? 'Map of Dublin districts' : 'Map: click to set start and end points'} />
      <div className="jp-map-vignette" aria-hidden="true" />
      <div ref={hintRef} className="jp-map-hint" aria-live="polite" hidden={props.planning === false} />
      <div ref={statusRef} className="jp-amenity-status" role="status" aria-live="polite" hidden />
      <div ref={legendRef} className="jp-map-legend" hidden>
        <span><i className="jp-legend-walk" />Walk</span>
        <span><i style={{ '--c': MODE_STYLE.BUS.color }} />Bus</span>
        <span><i style={{ '--c': MODE_STYLE.TRAM.color }} />Luas</span>
        <span><i style={{ '--c': MODE_STYLE.RAIL.color }} />Train</span>
        <span><i style={{ '--c': MODE_STYLE.BICYCLE.color }} />Bike</span>
        <span><i className="jp-legend-alt" />Other options</span>
      </div>
    </div>
  );
});

export default JourneyBaseMap;
