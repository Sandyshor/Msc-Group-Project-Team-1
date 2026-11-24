// The district map on Google Maps: the same layers and the same props/ref API as JourneyBaseMap (the Leaflet map,
// still used when there is no Google key or Google refuses it), so the rest of the page doesn't change.
//
// What Google adds: its own places on the map (shops, cafés, salons...) open Google's details in the side panel
// (photo, opening hours, rating and reviews, phone, website), Street View (drag the yellow person), satellite view
// and Google's full-screen and zoom controls. Our own layers (districts, universities, residences, Luas, rail, bus
// stops, Dublin Bikes, safety map, the journey planner's routes) are drawn on top.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ALL_DISTRICTS, heatColor, safetyLabel, strongColor, textOnHeat } from './mapShared';
import crimeAreasUrl from './crime-heatmap1.geojson?url';
import { decodePolyline, formatDistance, formatMinutes, legColor, lineLabel, MODE_STYLE } from './journey';
import { chainInfo } from './shopChains';
import { loadAmenityRecords as loadCsv } from './amenityData';
import { universities as campusList } from './cityPlaces';
import { groupPins, spreadPins } from './spreadPins';
import {
  PLANNER, boundariesUrl, luasRedUrl, luasGreenUrl, busStopsUrl, railLinesUrl, railStationsUrl, BIKES_INFO_URL,
  LUAS_RED, LUAS_GREEN, DART_GREEN, RAIL_PURPLE, BUS_ICON, BIKES_BLUE, AMENITY_CATEGORIES, CHAIN_LOGO, POI_STYLE,
  hasName, PLACE_EMOJI, RING, RESIDENCES_URL, euro, escapeHtml, shortName, brandLogo, metres, districtIdFromPostcode,
  convertCoordinates, brandOf, recordMatchesAmenityLayer, distanceMetres, pinHtml, stopHtml,
} from './mapLayers';
import { GOOGLE_MAP_ID, loadGoogleMaps, onGoogleFailure } from './googleMaps';
import './JourneyPlanner.css';
import './JourneyBaseMap.css';
import './Bikes.css';
import './GoogleBaseMap.css';

const countyAreasUrl = '/data/county-dublin-areas.geojson';
const countySafetyUrl = '/data/county-dublin-safety.geojson';
const DUBLIN = { lat: 53.3498, lng: -6.2603 };
const DUBLIN_BOUNDS = { south: 53.24, west: -6.48, north: 53.46, east: -6.0 };
const CAMPUS_VIEW = { south: 53.285, west: -6.385, north: 53.41, east: -6.13 }; // every university in view
const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// route animation (as on our own map): the legs draw in turn, then a dot travels the whole trip on a loop
const DRAW_MS = 1100;
const TRAVEL_MS = 6500;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Zoom levels where more detail appears
const Z_MID = 12;
const Z_NEAR = 14.5;
const Z_STREET = 16.5;
const Z_STOPS = 12.5;
const Z_BUS = 15; // bus stops appear (when the Bus stops button is on)
const Z_BUS_BIG = 17;
const HOUSING_GROUP_ZOOM = 14;

const inBounds = (b, lat, lng) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;

const GoogleBaseMap = forwardRef(function GoogleBaseMap(props, ref) {
  const boxRef = useRef(null);
  const containerRef = useRef(null);
  const hintRef = useRef(null);
  const statusRef = useRef(null);
  const legendRef = useRef(null);
  const tipRef = useRef(null);
  const latest = useRef(props);
  latest.current = props;
  const s = useRef(null);
  const [ready, setReady] = useState(false);
  const st0 = useRef(true); // the first draw after the map is made
  const [explore, setExplore] = useState({ open: false, uni: true, places: false, names: false, amen: {} });
  const exploreRef = useRef(explore);
  exploreRef.current = explore;
  const [uniList, setUniList] = useState([]); // every campus, for the Universities chip

  const { profileData, placesByDistrict } = props;

  // ------------------------------------------------------------ small helpers
  const setStatus = (message = '') => {
    const node = statusRef.current;
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  };

  // Hover label (the Leaflet map's tooltips): one box over the map, placed above whatever the pointer is on
  function showTip(html, rect, below = false) {
    const tip = tipRef.current;
    const box = boxRef.current;
    if (!tip || !box) return;
    const b = box.getBoundingClientRect();
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth;
    const x = Math.min(Math.max(8, rect.left - b.left + rect.width / 2 - w / 2), b.width - w - 8);
    const above = rect.top - b.top - tip.offsetHeight - 8;
    const y = below || above < 60 ? rect.bottom - b.top + 8 : above;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }
  const hideTip = () => { if (tipRef.current) tipRef.current.hidden = true; };

  // A marker made of our own HTML (pins, stops, badges). `centre`: the HTML is centred on the point (pins, stops);
  // otherwise its bottom middle sits on the point (route pins).
  function htmlMarker(position, html, { title = '', zIndex = 0, onClick, tip, centre = true, size } = {}) {
    const st = s.current;
    const el = document.createElement('div');
    el.className = centre ? 'gm-anchor' : 'gm-bottom';
    if (size) { el.style.width = `${size[0]}px`; el.style.height = `${size[1]}px`; }
    el.innerHTML = html;
    if (tip) {
      el.addEventListener('mouseenter', () => showTip(typeof tip === 'function' ? tip() : tip, (el.firstElementChild || el).getBoundingClientRect()));
      el.addEventListener('mouseleave', hideTip);
    }
    const marker = new st.AdvancedMarkerElement({ position, content: el, title, zIndex, gmpClickable: Boolean(onClick) });
    if (onClick) marker.addEventListener('gmp-click', () => { hideTip(); onClick(); });
    return marker;
  }

  const show = (items, on) => items.forEach((m) => { m.map = on ? s.current.map : null; });
  const showLines = (items, on) => items.forEach((l) => l.setMap(on ? s.current.map : null));
  const clear = (items) => { items.forEach((m) => { if ('setMap' in m) m.setMap(null); else m.map = null; }); items.length = 0; };

  // A rail/tram line like a transit map: white casing with the coloured line on top
  function transitLines(geojson, colour, filter, weight, target) {
    const g = s.current.g;
    geojson.features.filter(filter).forEach((f) => {
      const parts = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
      parts.forEach((coords) => {
        const path = coords.map(([lng, lat]) => ({ lat, lng }));
        target.push(new g.Polyline({ path, strokeColor: '#ffffff', strokeWeight: weight + 4, strokeOpacity: 1, clickable: false, zIndex: 2 }));
        target.push(new g.Polyline({ path, strokeColor: colour, strokeWeight: weight, strokeOpacity: 1, clickable: false, zIndex: 3 }));
      });
    });
  }

  // screen position of a point (for spreading pins that would overlap), and back
  const toPoint = (lat, lng) => s.current?.proj.getProjection()?.fromLatLngToContainerPixel(new s.current.g.LatLng(lat, lng));
  const toLatLng = (x, y) => { const ll = s.current.proj.getProjection().fromContainerPixelToLatLng(new s.current.g.Point(x, y)); return { lat: ll.lat(), lng: ll.lng() }; };

  // ------------------------------------------------------------ create the map once
  useEffect(() => {
    let cancelled = false;
    const offFailure = onGoogleFailure(() => latest.current.onUnavailable?.());
    loadGoogleMaps().then(async (maps) => {
      if (cancelled || !containerRef.current) return;
      const g = maps;
      const [{ Map }, { AdvancedMarkerElement, PinElement }, core] = await Promise.all([g.importLibrary('maps'), g.importLibrary('marker'), g.importLibrary('core')]);
      if (cancelled) return;
      const map = new Map(containerRef.current, {
        center: DUBLIN, zoom: 11, mapId: GOOGLE_MAP_ID,
        // Map / Satellite / Dark is our own switch (Google's dropdown opened under its logo)
        mapTypeControl: false, cameraControl: false, rotateControl: false, tiltControl: false,
        streetViewControl: true, fullscreenControl: true, zoomControl: true, scaleControl: true,
        mapTypeId: latest.current.mapType === 'hybrid' ? 'hybrid' : 'roadmap',
        colorScheme: latest.current.scheme === 'dark' ? core.ColorScheme?.DARK : core.ColorScheme?.LIGHT,
        clickableIcons: true, keyboardShortcuts: false,
        // computers: the mouse wheel zooms the map, as on Google Maps; phones: two fingers move it, one finger scrolls the page
        gestureHandling: window.innerWidth > 1100 ? 'greedy' : 'cooperative',
      });
      // gives screen positions (to spread pins that would overlap); it is ready once Google adds it to the map
      // Street View (the yellow person): our buttons on the map would cover Google's back arrow, so they hide
      map.getStreetView().setOptions({ keyboardShortcuts: false, fullscreenControl: false }); // (the map's own full-screen button stays)
      map.getStreetView().addListener('visible_changed', () => {
        const on = map.getStreetView().getVisible();
        boxRef.current?.classList.toggle('is-streetview', on);
        hideTip();
        if (on) setExplore((x) => ({ ...x, open: false }));
      });
      class Projection extends g.OverlayView { onAdd() { setTimeout(() => this.ready?.(), 0); } draw() {} onRemove() {} }
      const proj = new Projection();
      proj.setMap(map);

      const st = {
        g, map, proj, AdvancedMarkerElement, PinElement,
        unis: [], uniLines: [], cityPlaces: [], landmarks: [], districtPlaces: [], placeMarkers: [], cityPlacePoints: [],
        housing: [], housingData: null, codes: [], codeMarkers: {}, areas: [], amen: {}, chains: [],
        luas: [], luasStops: [], rail: [], railStations: [], railList: [], bus: [], busStops: null, bikes: [], bikesLoad: null,
        safety: null, safetyLoad: null, outline: [], route: [], alt: [], pins: { from: null, to: null }, placePin: null,
        features: {}, named: { landmarks: [], stations: [], areas: [] }, amenityRecords: null,
      };
      s.current = st;
      // the browser checks reach the map (to open Street View, move to a spot) only with ?maptest in the address
      if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('maptest')) window.__fmdGoogleMap = map;

      // compass button: back to the starting view (the chosen district, or all universities)
      const home = document.createElement('button');
      home.type = 'button';
      home.className = 'gm-home';
      home.title = 'Back to the starting view';
      home.setAttribute('aria-label', home.title);
      home.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/><g class="gm-needle"><path d="M12 4.5 14.6 12h-5.2z" fill="#d94351"/><path d="M12 19.5 9.4 12h5.2z" fill="currentColor" opacity=".55"/></g></svg>';
      home.addEventListener('click', () => {
        home.classList.remove('is-spinning');
        void home.offsetWidth; // restart the spin
        home.classList.add('is-spinning');
        resetView();
      });
      map.controls[g.ControlPosition.RIGHT_BOTTOM].push(home);

      // ---------------- clicks: a Google place opens Google's details; any other spot opens its address and what's near
      map.addListener('click', (e) => {
        hideTip();
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        if (e.placeId) {
          e.stop(); // no Google info window: the details open in our side panel
          openPlace({ kind: 'google', placeId: e.placeId, lat, lng, name: nameFor(lat, lng, true) || 'Place' });
          return;
        }
        openPlace({ kind: 'point', lat, lng, name: nameFor(lat, lng) });
      });

      // ---------------- universities, famous places, landmarks
      const pickLandmark = (lat, lng, label, extra = {}) => openPlace({ kind: 'landmark', name: label, lat, lng, ...extra });
      const addLandmarks = (list, target, kind) => {
        const groups = [];
        list.forEach((item) => {
          if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
          const group = groups.find((x) => metres([x.lat, x.lng], [item.lat, item.lon]) < 60);
          if (group) group.items.push(item); else groups.push({ lat: item.lat, lng: item.lon, items: [item] });
        });
        if (kind !== 'landmark') list.forEach((i) => { if (Number.isFinite(i.lat)) st.named.landmarks.push({ name: i.name, lat: i.lat, lng: i.lon }); });
        groups.forEach(({ lat, lng, items }) => {
          const tip = items.map((item) => escapeHtml(item.name) + (item.category && !item.name.includes(item.category) ? `<small>${escapeHtml(item.category)}</small>` : '')).join('<br>');
          const label = items.length > 1 ? `${shortName(items[0].name)} +${items.length - 1}` : shortName(items[0].name);
          const m = htmlMarker({ lat, lng }, pinHtml({ emoji: items[0].icon || '🎓', ring: RING[kind], kind, label }), {
            title: items.map((i) => i.name).join(' / '), zIndex: kind === 'uni' ? 60 : 40, tip,
            onClick: () => pickLandmark(lat, lng, items.map((i) => i.name).join(' / '), { kind: kind === 'uni' ? 'campus' : 'landmark', category: items[0].category, names: items.map((i) => i.name) }),
          });
          m.trueLatLng = { lat, lng };
          target.push(m);
        });
      };
      const loadLandmarks = (file, target, kind) => fetch(PLANNER + file).then((r) => r.json()).then((list) => {
        if (cancelled) return;
        addLandmarks(list, target, kind);
        if (kind === 'uni') {
          show(st.unis, exploreRef.current.uni); spreadUnis(); renderHousing();
          setUniList(list.filter((u) => Number.isFinite(u.lat)).sort((a, b) => shortName(a.name).localeCompare(shortName(b.name))));
        }
        if (kind === 'place') {
          st.cityPlacePoints = list.map((i) => [i.lon, i.lat]);
          addLandmarks(list.filter((i) => !['Airport', 'Rail station'].includes(i.category)), st.landmarks, 'landmark');
          show(st.cityPlaces, exploreRef.current.places);
          drawDistrictMarkers();
        }
      }).catch((e) => console.error(`Could not load ${file}`, e));
      loadLandmarks('universities.json', st.unis, 'uni');
      loadLandmarks('places.json', st.cityPlaces, 'place');

      // ---------------- student residences (zoomed out, residences that would touch become one count badge)
      const residenceTip = (r) => {
        const who = [r.operator, r.address].filter(Boolean).map(escapeHtml).join(' · ');
        return `<b>${escapeHtml(r.name)}</b><small>Student residence · ${escapeHtml(r.district)}${who ? ` · ${who}` : ''}</small>`
          + `${r.from ? `<small>From <b>${euro(r.from)}</b> a month</small>` : ''}<small class="gm-tip-hint">Click for details and directions</small>`;
      };
      st.renderHousing = renderHousing;
      proj.ready = () => { if (!cancelled) { spreadUnis(); renderHousing(); } };
      function spreadUnis() {
        if (!s.current?.proj.getProjection() || !st.unis.length) return;
        clear(st.uniLines);
        const z = map.getZoom();
        const size = (z < Z_MID ? 20 : z >= Z_STREET ? 38 : z >= Z_NEAR ? 34 : 30) + 4;
        const spots = st.unis.map((m) => { const p = toPoint(m.trueLatLng.lat, m.trueLatLng.lng); return { x: p.x, y: p.y, r: size / 2, from: p }; });
        spreadPins(spots, [], 3);
        st.unis.forEach((m, i) => {
          const at = toLatLng(spots[i].x, spots[i].y);
          m.position = at;
          if (Math.hypot(spots[i].x - spots[i].from.x, spots[i].y - spots[i].from.y) > 6) {
            st.uniLines.push(new g.Polyline({ path: [m.trueLatLng, at], strokeColor: RING.uni, strokeOpacity: 0, clickable: false, zIndex: 4,
              icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, strokeWeight: 1.5, scale: 2 }, offset: '0', repeat: '6px' }] }));
          }
        });
        showLines(st.uniLines, exploreRef.current.uni);
        st.unisZoom = z; // done for this zoom
        declutterSoon(); // names that now overlap are tidied after the pins have moved
      }
      st.spreadUnis = spreadUnis;
      function renderHousing() {
        if (!s.current?.proj.getProjection()) return;
        clear(st.housing);
        if (!st.housingData || !latest.current.showHousing) return;
        const z = map.getZoom();
        const size = (z < Z_MID ? 20 : z >= Z_STREET ? 38 : z >= Z_NEAR ? 34 : 30) + 4;
        const items = st.housingData.map((r) => ({ r, point: toPoint(r.lat, r.lon) })).filter((x) => x.point);
        const fixed = [];
        if (exploreRef.current.uni) st.unis.forEach((m) => { const p = toPoint(m.trueLatLng.lat, m.trueLatLng.lng); if (p) fixed.push({ x: p.x, y: p.y, r: size / 2 }); });
        const groups = z < HOUSING_GROUP_ZOOM ? groupPins(items, size + 8) : items.map((item) => ({ items: [item], cx: item.point.x, cy: item.point.y }));
        const spots = groups.map((x) => ({ x: x.cx, y: x.cy, r: x.items.length > 1 ? 25 : size / 2 }));
        spreadPins(spots, fixed, 3);
        groups.forEach((grp, i) => {
          const at = toLatLng(spots[i].x, spots[i].y);
          if (grp.items.length > 1) {
            const names = grp.items.map((x) => escapeHtml(x.r.name));
            st.housing.push(htmlMarker(at, `<div class="sh-cluster" style="--ring:${RING.housing}"><span>🏠</span><b>${grp.items.length}</b></div>`, {
              title: `${grp.items.length} student residences`, zIndex: 30,
              tip: `<b>${grp.items.length} student residences</b><small>${names.slice(0, 6).join('<br>')}${names.length > 6 ? `<br>and ${names.length - 6} more` : ''}</small><small class="gm-tip-hint">Click to zoom in</small>`,
              onClick: () => fitTo(grp.items.map((x) => [x.r.lat, x.r.lon]), 60, 17),
            }));
            return;
          }
          const { r, point } = grp.items[0];
          if (Math.hypot(spots[i].x - point.x, spots[i].y - point.y) > 6) {
            st.housing.push(new g.Polyline({ path: [{ lat: r.lat, lng: r.lon }, at], strokeColor: RING.housing, strokeOpacity: 0, clickable: false, zIndex: 4,
              icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeWeight: 1.5, scale: 2 }, offset: '0', repeat: '6px' }] }));
          }
          st.housing.push(htmlMarker(at, pinHtml({ emoji: '🏠', ring: RING.housing, kind: 'housing', label: r.name }), {
            title: `${r.name} (student residence)`, zIndex: 30, tip: () => residenceTip(r),
            onClick: () => openPlace({ kind: 'residence', name: r.name, lat: r.lat, lng: r.lon, district: r.district, residence: r }),
          }));
        });
        show(st.housing.filter((x) => !('setMap' in x)), true);
        showLines(st.housing.filter((x) => 'setMap' in x), true);
        declutterSoon();
      }
      fetch(RESIDENCES_URL).then((r) => (r.ok ? r.json() : null)).then((d) => {
        st.housingData = d?.residences || [];
        st.housingData.forEach((r) => st.named.landmarks.push({ name: r.name, lat: r.lat, lng: r.lon }));
        renderHousing();
      }).catch((e) => console.error('Could not load student residences', e));

      // ---------------- shops and places chosen in "Explore" (from zoom 12, inside the view)
      loadCsv().then((records) => { st.amenityRecords = records; }).catch(() => {});
      st.renderAmenities = () => {
        Object.values(st.amen).forEach(clear);
        const keys = Object.keys(exploreRef.current.amen).filter((k) => exploreRef.current.amen[k] && AMENITY_CATEGORIES[k].csv);
        if (!keys.length) { updateStatus(); return; }
        if (map.getZoom() < Z_MID) { updateStatus(); return; }
        if (!st.amenityRecords) { loadCsv().then((r) => { st.amenityRecords = r; st.renderAmenities(); }).catch(() => setStatus('Could not load the shops and places.')); return; }
        const b = map.getBounds().toJSON();
        const seen = new Set();
        st.amenityRecords.forEach((record) => {
          const key = keys.find((k) => recordMatchesAmenityLayer(record, k));
          if (!key || !hasName(record) || !inBounds(DUBLIN_BOUNDS, record.latitude, record.longitude) || !inBounds(b, record.latitude, record.longitude)) return;
          const id = `${key}|${record.name}|${record.latitude}|${record.longitude}`;
          if (seen.has(id)) return;
          seen.add(id);
          const c = AMENITY_CATEGORIES[key];
          const name = record.name.trim();
          const brand = c.logo ? key : brandOf(record);
          (st.amen[key] ||= []).push(htmlMarker({ lat: record.latitude, lng: record.longitude }, pinHtml({ emoji: c.icon, ring: c.ring, kind: 'amenity', label: name, brand }), {
            title: `${name} · ${c.label} · ${record.area}`, zIndex: 20, tip: `${escapeHtml(name)}<small>${escapeHtml(c.label)} · ${escapeHtml(record.area)}</small>`,
            onClick: () => pickLandmark(record.latitude, record.longitude, name, { kind: 'amenity', category: POI_STYLE[record.category]?.[1] || c.label, area: record.area }),
          }));
        });
        Object.values(st.amen).forEach((list) => show(list, true));
        updateStatus();
        declutterSoon();
      };
      const updateStatus = () => {
        const z = map.getZoom();
        const keys = Object.keys(exploreRef.current.amen).filter((k) => exploreRef.current.amen[k] && AMENITY_CATEGORIES[k].csv);
        if (keys.length && z < Z_MID) setStatus('Zoom in to see the places you chose.');
        else if (latest.current.showBus && z < Z_BUS) setStatus('Zoom in to see bus stops.');
        else setStatus();
      };
      st.updateStatus = updateStatus;

      // ---------------- bus stops (button above the map): from zoom 15, inside the view
      st.renderBusStops = () => {
        clear(st.bus);
        if (!latest.current.showBus || map.getZoom() < Z_BUS) { updateStatus(); return; }
        if (!st.busStops) {
          fetch(busStopsUrl).then((r) => r.json()).then((gj) => { st.busStops = gj.features; st.renderBusStops(); })
            .catch(() => setStatus('Could not load bus stops.'));
          return;
        }
        const b = map.getBounds().toJSON();
        const big = map.getZoom() >= Z_BUS_BIG;
        const size = big ? 30 : 24;
        const groups = [];
        st.busStops.forEach((f) => {
          const [lng, lat] = f.geometry.coordinates;
          if (!inBounds(b, lat, lng)) return;
          const pt = toPoint(lat, lng);
          if (!pt) return;
          const grp = groups.find((x) => Math.hypot(x.pt.x - pt.x, x.pt.y - pt.y) < size * 0.9);
          if (grp) grp.stops.push(f); else groups.push({ pt, lat, lng, stops: [f] });
        });
        groups.forEach(({ lat, lng, stops }) => {
          const refs = stops.map((f) => f.properties.ref).filter(Boolean);
          const routes = [...new Set(stops.flatMap((f) => (f.properties.routes || '').split(';').map((r) => r.trim()).filter(Boolean)))]
            .sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
          const names = [...new Set(stops.map((f) => f.properties.name))].map(escapeHtml).join(' / ');
          const label = big && refs.length ? (refs.length > 2 ? `${refs[0]} +${refs.length - 1}` : refs.join(' · ')) : '';
          st.bus.push(htmlMarker({ lat, lng }, `<div class="jp-bus-stop gm-centre-box"><span class="jp-bus-badge${big ? ' is-big' : ''}">${BUS_ICON}${stops.length > 1 ? `<i>${stops.length}</i>` : ''}</span>${label ? `<small>${escapeHtml(label)}</small>` : ''}</div>`, {
            title: `${stops[0].properties.name} bus stop`, zIndex: 25,
            tip: `🚌 ${names}${refs.length ? ` · stop${refs.length > 1 ? 's' : ''} ${refs.map(escapeHtml).join(', ')}` : ''}${routes.length ? `<small>Routes ${escapeHtml(routes.join(', '))}</small>` : ''}`,
            onClick: () => pickLandmark(lat, lng, stops[0].properties.name, { kind: 'bus', stops: stops.map((x) => x.properties) }),
          }));
        });
        show(st.bus, true);
        updateStatus();
      };

      // ---------------- names for clicked points: famous places, Luas stops, neighbourhoods
      Object.values(placesByDistrict).flat().forEach((p) => { if (p.lngLat) st.named.landmarks.push({ name: p.name, lat: p.lngLat[1], lng: p.lngLat[0] }); });
      profileData.stops.forEach((x) => st.named.stations.push({ name: `${x.name} (Luas)`, lat: x.lat, lng: x.lng }));
      Object.entries(profileData.profiles).forEach(([d, pr]) => (pr.areas || []).forEach(([name, lat, lng]) => st.named.areas.push({ name, d, lat, lng })));

      // ---------------- district outlines
      fetch(boundariesUrl).then((r) => r.json()).then((raw) => {
        raw.features.forEach((f) => {
          const id = districtIdFromPostcode(f.properties?.postcodes);
          if (id) st.features[id] = { ...f, geometry: { ...f.geometry, coordinates: convertCoordinates(f.geometry.coordinates) } };
        });
        return fetch(countyAreasUrl).then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] }));
      }).then((county) => {
        (county?.features || []).forEach((f) => { st.features[f.properties.key] = f; });
        drawOutline();
        if (!latest.current.initialView) fitDistrict(latest.current.selectedDistrict);
      }).catch((e) => console.error('Could not load district boundaries', e));
      if (latest.current.initialView) { map.setCenter(latest.current.initialView.center); map.setZoom(latest.current.initialView.zoom); }
      else if (!latest.current.selectedDistrict) map.fitBounds(CAMPUS_VIEW, 20);

      // ---------------- Luas (button above the map)
      [[LUAS_RED, 'Luas Red Line', luasRedUrl], [LUAS_GREEN, 'Luas Green Line', luasGreenUrl]].forEach(([colour, refName, url]) => {
        fetch(url).then((r) => r.json()).then((gj) => {
          transitLines(gj, colour, (f) => /LineString/.test(f.geometry?.type) && f.properties?.ref === refName, 5, st.luas);
          showLines(st.luas, latest.current.showLuas);
        }).catch((e) => console.error(`Could not load ${url}`, e));
      });
      profileData.stops.forEach((stop) => {
        st.luasStops.push(htmlMarker({ lat: stop.lat, lng: stop.lng }, stopHtml(stop.line === 'Red' ? LUAS_RED : LUAS_GREEN, stop.name, 'luas'), {
          title: `${stop.name} Luas stop`, zIndex: 35, tip: `${escapeHtml(stop.name)}<small>Luas ${escapeHtml(stop.line)} Line</small>`,
          onClick: () => openPlace({ kind: 'luas', name: stop.name, lat: stop.lat, lng: stop.lng, line: stop.line, district: stop.d || undefined }),
        }));
      });

      // ---------------- DART and commuter rail (button above the map)
      fetch(railLinesUrl).then((r) => r.json()).then((gj) => {
        transitLines(gj, RAIL_PURPLE, (f) => f.properties.line === 'rail', 4, st.rail);
        transitLines(gj, DART_GREEN, (f) => f.properties.line === 'dart', 5, st.rail);
        showLines(st.rail, latest.current.showRail);
      }).catch((e) => console.error('Could not load rail lines', e));
      fetch(railStationsUrl).then((r) => r.json()).then((gj) => {
        gj.features.forEach((f) => {
          const [lng, lat] = f.geometry.coordinates;
          const { name, dart } = f.properties;
          st.railStations.push(htmlMarker({ lat, lng }, stopHtml(dart ? DART_GREEN : RAIL_PURPLE, name, 'rail'), {
            title: `${name} station`, zIndex: 35, tip: `🚆 ${escapeHtml(name)}<small>${dart ? 'DART and rail station' : 'Rail station'}</small>`,
            onClick: () => pickLandmark(lat, lng, `${name} station`, { kind: 'rail', dart: Boolean(dart) }),
          }));
          st.named.stations.push({ name: `${name} station`, lat, lng });
          st.railList.push({ name, dart: Boolean(dart), lat, lng });
        });
        applyZoom();
      }).catch(() => {});

      // ---------------- Dublin Bikes (button above the map): live stations
      st.loadBikes = () => {
        if (st.bikesLoad) return st.bikesLoad;
        st.bikesLoad = fetch(BIKES_INFO_URL).then((r) => r.json()).then((json) => {
          (json.data?.stations || []).forEach((dock) => {
            st.bikes.push(htmlMarker({ lat: dock.lat, lng: dock.lon }, pinHtml({ emoji: '🚲', ring: BIKES_BLUE, kind: 'bike', label: dock.name }), {
              title: `Dublin Bikes: ${dock.name}`, zIndex: 30, tip: `Dublin Bikes · ${escapeHtml(dock.name)}`,
              onClick: () => openPlace({ kind: 'bike', name: dock.name, lat: dock.lat, lng: dock.lon, dock: { id: dock.station_id, address: dock.address, capacity: dock.capacity } }),
            }));
          });
          show(st.bikes, latest.current.showBikes);
          declutterSoon();
        }).catch(() => { st.bikesLoad = null; setStatus('Could not load Dublin Bikes stations.'); });
        return st.bikesLoad;
      };

      // ---------------- Safety map (button above the map): every Census area coloured by its safety score
      st.loadSafety = () => {
        if (st.safetyLoad) return st.safetyLoad;
        st.safetyLoad = Promise.all([
          fetch(crimeAreasUrl).then((r) => r.json()),
          fetch(countySafetyUrl).then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] })),
        ]).then(([city, county]) => {
          const layer = new g.Data();
          layer.addGeoJson({ type: 'FeatureCollection', features: [...city.features, ...(county.features || [])] });
          layer.setStyle((f) => ({ fillColor: heatColor(Number(f.getProperty('score'))), fillOpacity: 0.42, strokeColor: '#ffffff', strokeWeight: 0.8, zIndex: 1 }));
          layer.addListener('mouseover', (e) => {
            layer.overrideStyle(e.feature, { strokeWeight: 2.5, strokeColor: '#173f37', fillOpacity: 0.55 });
            const p = (k) => e.feature.getProperty(k);
            const sc = Number(p('score'));
            const ev = e.domEvent;
            showTip(`<div class="safe-pop"><span class="safe-pop-score" style="background:${heatColor(sc)};color:${textOnHeat(sc)}">${sc.toFixed(0)}</span>`
              + `<div><b>${escapeHtml(p('ed'))}</b> · ${escapeHtml(p('d'))}<br><small>${escapeHtml(safetyLabel(sc))}</small></div></div>`
              + (String(p('check')) === 'true' ? '<p class="safe-pop-check">⚠ Check the specific street before choosing</p>' : '')
              + `<p class="safe-pop-facts">Violent crime ${p('viol')} · Robbery ${p('rob')} · Theft ${p('burg')} per 1,000 people a year</p>`,
            { left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY, width: 0 });
          });
          layer.addListener('mouseout', (e) => { layer.revertStyle(e.feature); hideTip(); });
          layer.addListener('click', (e) => openPlace({ kind: 'point', lat: e.latLng.lat(), lng: e.latLng.lng(), name: nameFor(e.latLng.lat(), e.latLng.lng()) }));
          st.safety = layer;
          if (latest.current.showSafety) layer.setMap(map);
        }).catch(() => { st.safetyLoad = null; setStatus('Could not load the safety map.'); });
        return st.safetyLoad;
      };

      // ---------------- district code chips ("District names" in Explore)
      ALL_DISTRICTS.forEach((c) => {
        const pos = profileData.labels[c];
        if (!pos || !profileData.profiles[c]) return;
        const m = htmlMarker({ lat: pos[0], lng: pos[1] }, `<button type="button" class="dm-code gm-centre-box">${c}</button>`, {
          title: `${c} · ${profileData.profiles[c].name}`, zIndex: 50, onClick: () => latest.current.onSelectDistrict(c),
        });
        st.codeMarkers[c] = m;
        st.codes.push(m);
      });

      // ---------------- detail by zoom level, and what's drawn inside the view
      function applyZoom() {
        const z = map.getZoom();
        const box = boxRef.current;
        if (box) {
          box.classList.toggle('z-far', z < Z_MID);
          box.classList.toggle('z-mid', z >= Z_MID && z < Z_NEAR);
          box.classList.toggle('z-near', z >= Z_NEAR);
          box.classList.toggle('z-street', z >= Z_STREET);
          box.classList.toggle('z-low', z < Z_NEAR);
        }
        show(st.luasStops, latest.current.showLuas && z >= Z_STOPS);
        show(st.railStations, latest.current.showRail && z >= Z_STOPS);
      }
      st.applyZoom = applyZoom;
      let lastZoom = null;
      map.addListener('idle', () => {
        if (cancelled) return;
        const z = map.getZoom();
        if (z !== lastZoom || st.unisZoom !== z) { lastZoom = z; applyZoom(); spreadUnis(); renderHousing(); }
        st.renderAmenities();
        st.renderBusStops();
        declutterSoon();
      });
      map.addListener('dragstart', hideTip);
      map.addListener('zoom_changed', hideTip);

      setReady(true);
    }).catch((e) => {
      console.error('Google Maps could not load', e);
      latest.current.onUnavailable?.();
    });
    return () => {
      cancelled = true;
      offFailure();
      if (s.current) { s.current.routeToken = null; cancelAnimationFrame(s.current.routeFrame); clearTimeout(s.current.travelTimer); cancelAnimationFrame(s.current.travelFrame); }
      clearTimeout(s.current?.declutterTimer);
      s.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When two names would overlap, only the first (universities first) is shown
  function declutterSoon() {
    const st = s.current;
    if (!st) return;
    clearTimeout(st.declutterTimer);
    clearTimeout(st.declutterAgain);
    const declutter = () => {
      const box = boxRef.current;
      if (!box) return;
      const labels = [...box.querySelectorAll('.pm-label')];
      labels.forEach((n) => n.classList.remove('pm-label-hidden'));
      const rank = (n) => (n.closest('.pm-uni') ? 0 : n.closest('.pm-place, .pm-landmark') ? 1 : n.closest('.tr-stop') ? 2 : 3);
      const shown = (n) => n.getClientRects().length > 0; // (offsetParent is empty inside Google's marker layer)
      const placed = [...box.querySelectorAll('.pm-dot, .tr-stop-dot')].filter(shown).map((n) => n.getBoundingClientRect());
      labels.filter(shown).sort((x, y) => rank(x) - rank(y)).forEach((n) => {
        const r = n.getBoundingClientRect();
        const hit = (q) => r.left < q.right + 2 && r.right > q.left - 2 && r.top < q.bottom + 1 && r.bottom > q.top - 1;
        if (placed.some(hit)) { n.classList.add('pm-label-hidden'); return; }
        placed.push(r);
      });
    };
    // Google draws new or moved markers a moment later: tidy now, and again once they're on screen
    st.declutterTimer = setTimeout(declutter, 120);
    st.declutterAgain = setTimeout(declutter, 700);
  }

  // ------------------------------------------------------------ views
  function fitTo(points, padding = 50, maxZoom = 16) {
    const st = s.current;
    if (!st || !points.length) return;
    const b = new st.g.LatLngBounds();
    points.forEach(([lat, lng]) => b.extend({ lat, lng }));
    st.map.fitBounds(b, padding);
    st.g.event.addListenerOnce(st.map, 'idle', () => { if (st.map.getZoom() > maxZoom) st.map.setZoom(maxZoom); });
  }

  function resetView() {
    const st = s.current;
    if (!st) return;
    const sel = latest.current.selectedDistrict;
    if (sel && st.features[sel]) fitDistrict(sel);
    else st.map.fitBounds(CAMPUS_VIEW, 20);
  }

  function ringsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((p) => p[0]);
    return [];
  }

  function fitDistrict(code) {
    const st = s.current;
    const f = code && st?.features[code];
    if (!f) return;
    fitTo(ringsOf(f.geometry).flat().map(([lng, lat]) => [lat, lng]), 50, 14);
  }

  function drawOutline() {
    const st = s.current;
    if (!st) return;
    clear(st.outline);
    const sel = latest.current.selectedDistrict;
    const f = sel && st.features[sel];
    if (!f) return;
    const colour = strongColor(profileData.profiles[sel].hue);
    ringsOf(f.geometry).forEach((ring) => {
      const path = ring.map(([lng, lat]) => ({ lat, lng }));
      st.outline.push(new st.g.Polyline({ path, strokeColor: '#ffffff', strokeWeight: 7, strokeOpacity: 0.8, clickable: false, zIndex: 5 }));
      st.outline.push(new st.g.Polyline({ path, strokeColor: colour, strokeOpacity: 0, clickable: false, zIndex: 6,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.95, strokeWeight: 3, scale: 4 }, offset: '0', repeat: '14px' }] }));
    });
    showLines(st.outline, true);
  }

  function drawDistrictMarkers() {
    const st = s.current;
    if (!st) return;
    const { selectedDistrict: sel, filter } = latest.current;
    const profiles = profileData.profiles;
    Object.entries(st.codeMarkers).forEach(([c, m]) => {
      const node = m.content?.querySelector('.dm-code');
      if (!node || !profiles[c]) return;
      node.style.background = strongColor(profiles[c].hue);
      node.style.opacity = filter === 'all' || profiles[c].side === filter ? 1 : 0.35;
      node.classList.toggle('selected', c === sel);
      m.zIndex = c === sel ? 900 : 50;
    });
    clear(st.areas);
    clear(st.districtPlaces);
    st.placeMarkers = [];
    if (sel) {
      (profiles[sel]?.areas || []).forEach(([name, lat, lng]) => {
        st.areas.push(htmlMarker({ lat, lng }, `<div class="dm-area gm-centre-box">${escapeHtml(name)}</div>`, { zIndex: 1 }));
      });
      show(st.areas, true);
      st.placeMarkers = (placesByDistrict[sel] || []).map((place, i) => {
        if (!place.lngLat) return null;
        const duplicate = st.cityPlacePoints.some((p) => distanceMetres(p, place.lngLat) < 150);
        const el = htmlMarker({ lat: place.lngLat[1], lng: place.lngLat[0] }, pinHtml({ emoji: PLACE_EMOJI[place.cat] || '📍', ring: RING.place, kind: 'place', label: place.name }), {
          title: place.name, zIndex: 45, onClick: () => latest.current.onPlaceClick(sel, i),
        });
        el.content.addEventListener('mouseenter', () => latest.current.onHoverPlace(i));
        el.content.addEventListener('mouseleave', () => latest.current.onHoverPlace(null));
        if (!duplicate) st.districtPlaces.push(el);
        return el;
      });
      show(st.districtPlaces, true);
    }
    declutterSoon();
  }

  // Name for a clicked point: the nearest landmark, station, shop or café, else the nearest neighbourhood
  function nameFor(lat, lng, placeOnly = false) {
    const st = s.current;
    if (!st) return 'Dropped pin';
    const nearest = (list, radius) => {
      let best = null;
      let bestD = radius;
      list.forEach((p) => { const d = metres([lat, lng], [p.lat, p.lng]); if (d < bestD) { bestD = d; best = p; } });
      return best;
    };
    const hit = nearest(st.named.landmarks, placeOnly ? 40 : 150) || nearest(st.named.stations, placeOnly ? 40 : 120);
    if (hit) return hit.name;
    if (placeOnly) return '';
    if (st.amenityRecords) {
      const shop = nearest(st.amenityRecords.filter((r) => r.name && r.name.trim() && Math.abs(r.latitude - lat) < 0.001 && Math.abs(r.longitude - lng) < 0.0015)
        .map((r) => ({ name: r.name.trim(), lat: r.latitude, lng: r.longitude })), 70);
      if (shop) return shop.name;
    }
    const area = nearest(st.named.areas, 2500);
    return area ? `Near ${area.name}` : 'Dropped pin';
  }

  // Which district or County Dublin area a point is in
  function districtAt(lat, lng) {
    const st = s.current;
    if (!st) return null;
    const inRing = (ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const inPolygon = (rings) => inRing(rings[0]) && !rings.slice(1).some(inRing);
    for (const [code, f] of Object.entries(st.features)) {
      const geo = f.geometry;
      if (!geo || !profileData.profiles[code]) continue;
      if (geo.type === 'Polygon' ? inPolygon(geo.coordinates) : geo.type === 'MultiPolygon' && geo.coordinates.some(inPolygon)) return code;
    }
    return null;
  }

  function openPlace(place) {
    latest.current.onPlace?.({ ...place, district: place.district ?? districtAt(place.lat, place.lng) });
  }

  // What's around a point (for the place panel): nearest Luas stop, train station and bus stop, places within 500 m
  async function nearby(lat, lng) {
    const st = s.current;
    if (!st) return null;
    if (!st.busStops) { try { st.busStops = (await (await fetch(busStopsUrl)).json()).features; } catch { st.busStops = null; } }
    if (!st.amenityRecords) { try { st.amenityRecords = await loadCsv(); } catch { /* counts left out */ } }
    const here = [lat, lng];
    const nearest = (list, at) => list.reduce((best, item) => { const m = metres(here, at(item)); return !best || m < best.m ? { ...item, m } : best; }, null);
    const luas = nearest(profileData.stops, (x) => [x.lat, x.lng]);
    const rail = nearest(st.railList, (x) => [x.lat, x.lng]);
    const busFeature = st.busStops && nearest(st.busStops, (f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
    const bus = busFeature && { ...busFeature.properties, m: busFeature.m };
    const GROUPS = [['Supermarkets & shops', ['Supermarkets', 'Groceries']], ['Cafés', ['Cafes']], ['Restaurants', ['Restaurants', 'Asian_Restaurants']],
      ['Pharmacies', ['Pharmacies']], ['Gyms', ['Gyms']], ['Parks', ['Parks']], ['Hospitals', ['Hospitals']]];
    const counts = st.amenityRecords ? GROUPS.map(([label, cats]) => {
      const seen = new Set();
      st.amenityRecords.forEach((r) => {
        if (!cats.includes(r.category) || Math.abs(r.latitude - lat) > 0.006 || Math.abs(r.longitude - lng) > 0.009) return;
        if (metres(here, [r.latitude, r.longitude]) <= 500) seen.add(`${(r.name || '').trim()}|${r.latitude.toFixed(4)}|${r.longitude.toFixed(4)}`);
      });
      return [label, seen.size];
    }).filter(([, n]) => n) : null;
    return { luas, rail, bus, counts };
  }

  // ------------------------------------------------------------ journey (A/B pins and the route)
  const journeyShown = () => latest.current.planning !== false;

  function syncPins() {
    const st = s.current;
    if (!st) return;
    const { trip } = latest.current;
    [['from', 'A', 'jp-pin-start'], ['to', 'B', 'jp-pin-end']].forEach(([k, label, cls]) => {
      const p = journeyShown() ? trip[k] : null;
      const existing = st.pins[k];
      if (!p) { if (existing) existing.map = null; st.pins[k] = null; return; }
      if (existing) {
        const at = existing.position;
        const lat = typeof at?.lat === 'function' ? at.lat() : at?.lat;
        const lng = typeof at?.lng === 'function' ? at.lng() : at?.lng;
        if (lat !== p.lat || lng !== p.lng) { existing.position = { lat: p.lat, lng: p.lng }; ripple(p.lat, p.lng); }
        return;
      }
      ripple(p.lat, p.lng);
      const m = htmlMarker({ lat: p.lat, lng: p.lng }, `<div class="jp-route-pin ${cls}"><i class="jp-pin-pulse"></i><span></span><b>${label}</b></div>`, {
        centre: false, size: [34, 42], zIndex: 1200, title: `${k === 'from' ? 'Start' : 'Destination'}: ${p.label || ''}`,
        onClick: () => openPlace({ kind: 'point', lat: p.lat, lng: p.lng, name: p.label || nameFor(p.lat, p.lng) }),
      });
      m.map = st.map;
      st.pins[k] = m;
    });
  }

  // a ripple where a pin lands (A, B or the place in the side panel)
  function ripple(lat, lng) {
    const st = s.current;
    if (REDUCED_MOTION || !st) return;
    const m = htmlMarker({ lat, lng }, '<span class="jp-click-ripple"></span>', { zIndex: 1300 });
    m.map = st.map;
    setTimeout(() => { m.map = null; }, 700);
  }

  // grow lines along their path over `duration` ms, starting after `delay` (all share the same path)
  function growLines(lines, path, delay, duration, token) {
    const st = s.current;
    if (REDUCED_MOTION || path.length < 2) { lines.forEach((l) => l.setPath(path)); return; }
    lines.forEach((l) => l.setPath([]));
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + metres([path[i - 1].lat, path[i - 1].lng], [path[i].lat, path[i].lng]));
    const total = cum[cum.length - 1] || 1;
    const start = performance.now() + delay;
    const step = (now) => {
      if (!s.current || st.routeToken !== token) return; // redrawn or removed meanwhile
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      if (t > 0) {
        const target = easeInOut(t) * total;
        let k = 1;
        while (k < path.length - 1 && cum[k] < target) k++;
        const a = path[k - 1], b = path[k];
        const f = cum[k] > cum[k - 1] ? Math.min(1, (target - cum[k - 1]) / (cum[k] - cum[k - 1])) : 1;
        const partial = path.slice(0, k);
        partial.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
        lines.forEach((l) => l.setPath(partial));
      }
      if (t < 1) st.routeFrame = requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // fade a line in (the other route options)
  function fadeIn(line, opacity, duration, token) {
    const st = s.current;
    if (REDUCED_MOTION) return;
    line.setOptions({ strokeOpacity: 0 });
    const start = performance.now();
    const step = (now) => {
      if (!s.current || st.routeToken !== token) return;
      const t = Math.min(1, (now - start) / duration);
      line.setOptions({ strokeOpacity: opacity * t });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function stopTraveller() {
    const st = s.current;
    if (!st) return;
    clearTimeout(st.travelTimer);
    cancelAnimationFrame(st.travelFrame);
    if (st.traveller) st.traveller.map = null;
    st.traveller = null;
  }

  // a pulsing dot that travels the whole trip on a loop, taking each leg's colour
  function startTraveller(itinerary, pathsByLeg, token) {
    const st = s.current;
    if (REDUCED_MOTION || !st || st.routeToken !== token) return;
    const track = [];
    let distance = 0;
    pathsByLeg.forEach((path, i) => {
      const color = legColor(itinerary.legs[i]);
      path.forEach((p) => {
        if (track.length) { const q = track[track.length - 1].p; distance += metres([q.lat, q.lng], [p.lat, p.lng]); }
        track.push({ p, d: distance, color });
      });
    });
    if (track.length < 2 || distance === 0) return;
    const m = htmlMarker(track[0].p, '<span class="jp-traveller gm-centre-box"><i></i></span>', { zIndex: 1150 });
    m.map = st.map;
    st.traveller = m;
    const node = m.content.querySelector('.jp-traveller');
    const startedAt = performance.now();
    let k = 0;
    const step = (now) => {
      if (!s.current || st.routeToken !== token) return;
      const t = ((now - startedAt) % (TRAVEL_MS + 900)) / TRAVEL_MS;
      const target = (t >= 1 ? 1 : easeInOut(t)) * distance;
      if (target < track[k].d) k = 0;
      while (k < track.length - 2 && track[k + 1].d < target) k++;
      const a = track[k], b = track[k + 1];
      const f = b.d > a.d ? (target - a.d) / (b.d - a.d) : 0;
      m.position = { lat: a.p.lat + (b.p.lat - a.p.lat) * f, lng: a.p.lng + (b.p.lng - a.p.lng) * f };
      node?.style.setProperty('--c', b.color);
      st.travelFrame = requestAnimationFrame(step);
    };
    st.travelFrame = requestAnimationFrame(step);
  }

  function updateHint() {
    const node = hintRef.current;
    if (!node) return;
    const { trip } = latest.current;
    const loading = trip.status === 'loading';
    let html;
    if (loading) html = 'Finding the best routes…';
    else if (!trip.from && !trip.to) html = 'Click any place on the map, then choose <strong>Directions</strong>';
    else if (!trip.from) html = 'Choose a <strong>start</strong>: type it, use your location, or click a place and pick <strong>Start here</strong>';
    else if (!trip.to) html = 'Choose a <strong>destination</strong>: type it, or click a place and pick <strong>Directions</strong>';
    else html = '';
    node.hidden = !html || latest.current.planning === false;
    node.innerHTML = `${loading ? '<span class="jp-spinner" aria-hidden="true"></span>' : ''}<span class="jp-hint-text">${html}</span>`;
  }

  function drawRoute() {
    const st = s.current;
    if (!st) return;
    const { trip, routeTabLabel } = latest.current;
    const token = {};
    st.routeToken = token; // stops the previous route's animations
    cancelAnimationFrame(st.routeFrame);
    stopTraveller();
    clear(st.route);
    clear(st.alt);
    if (!journeyShown()) { if (legendRef.current) legendRef.current.hidden = true; return; }
    const itineraries = trip.itineraries || [];
    const itinerary = itineraries[trip.selected];
    if (legendRef.current) legendRef.current.hidden = !itinerary;
    if (!itinerary || !trip.from || !trip.to) return;
    const g = st.g;
    const pointsOf = (it) => (it._gpoints ||= it.legs.map((leg) => (leg.geometry ? decodePolyline(leg.geometry).map(([lng, lat]) => ({ lat, lng })) : [])));

    // the other options: grey, click one to choose it
    itineraries.forEach((it, i) => {
      if (i === trip.selected) return;
      const path = pointsOf(it).flat();
      if (!path.length) return;
      st.alt.push(new g.Polyline({ path, strokeColor: '#ffffff', strokeWeight: 10, strokeOpacity: 0.9, clickable: false, zIndex: 7 }));
      const line = new g.Polyline({ path, strokeColor: '#8d9a93', strokeWeight: 6, strokeOpacity: 0.8, zIndex: 8 });
      fadeIn(st.alt[st.alt.length - 1], 0.9, 500, token);
      fadeIn(line, 0.8, 500, token);
      line.addListener('click', () => latest.current.onSelectItinerary?.(i));
      line.addListener('mouseover', (e) => showTip(`${formatMinutes(it.total_minutes)} · ${escapeHtml(routeTabLabel(it))}<small>Click to choose this route</small>`,
        { left: e.domEvent.clientX, right: e.domEvent.clientX, top: e.domEvent.clientY, bottom: e.domEvent.clientY, width: 0 }));
      line.addListener('mouseout', hideTip);
      st.alt.push(line);
    });

    const points = [[trip.from.lat, trip.from.lng], [trip.to.lat, trip.to.lng]];
    const pathsByLeg = pointsOf(itinerary);
    const lengths = pathsByLeg.map((pts) => pts.slice(1).reduce((sum, p, k) => sum + metres([pts[k].lat, pts[k].lng], [p.lat, p.lng]), 0));
    const totalLength = lengths.reduce((x, y) => x + y, 0) || 1;
    let delay = 0;
    itinerary.legs.forEach((leg, i) => {
      const path = pathsByLeg[i];
      if (!path.length) return;
      const duration = Math.max(160, (lengths[i] / totalLength) * DRAW_MS);
      const color = legColor(leg);
      const label = leg.mode === 'WALK' ? `Walk ${formatDistance(leg.distance_km)} · ${formatMinutes(leg.minutes)}` : `${lineLabel(leg)} · ${formatMinutes(leg.minutes)}`;
      const tipOn = (line) => {
        line.addListener('mouseover', (e) => showTip(escapeHtml(label), { left: e.domEvent.clientX, right: e.domEvent.clientX, top: e.domEvent.clientY, bottom: e.domEvent.clientY, width: 0 }));
        line.addListener('mouseout', hideTip);
        return line;
      };
      if (leg.mode === 'WALK') {
        const dots = tipOn(new g.Polyline({ path, strokeColor: color, strokeOpacity: 0, zIndex: 11,
          icons: [{ icon: { path: g.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 1, strokeWeight: 0, scale: 3 }, offset: '0', repeat: '10px' }] }));
        st.route.push(dots);
        growLines([dots], path, delay, duration, token);
      } else {
        const casing = new g.Polyline({ path, strokeColor: '#ffffff', strokeWeight: 12, strokeOpacity: 1, clickable: false, zIndex: 9 });
        const glow = new g.Polyline({ path, strokeColor: color, strokeWeight: 17, strokeOpacity: 0.16, clickable: false, zIndex: 8 });
        const line = tipOn(new g.Polyline({ path, strokeColor: color, strokeWeight: 7, strokeOpacity: 1, zIndex: 10 }));
        st.route.push(casing, glow, line);
        growLines([casing, glow, line], path, delay, duration, token);
        if (leg.mode !== 'BICYCLE') {
          // where you get on and off: rings that pop in as the line reaches them
          [[path[0], leg.from, delay], [path[path.length - 1], leg.to, delay + duration]].forEach(([at, name, when]) => {
            const m = htmlMarker(at, `<span class="jp-stop-dot" style="--c:${color}; --d:${REDUCED_MOTION ? 0 : Math.round(when)}ms"></span>`, { zIndex: 1100, tip: escapeHtml(name) });
            m.map = st.map;
            st.route.push(m);
          });
        }
      }
      path.forEach((p) => points.push([p.lat, p.lng]));
      delay += duration;
    });
    showLines(st.route.filter((x) => 'setMap' in x), true);
    showLines(st.alt, true);
    fitTo(points, 60, 16);
    st.travelTimer = setTimeout(() => startTraveller(itinerary, pathsByLeg, token), REDUCED_MOTION ? 0 : delay + 300);
  }

  // ------------------------------------------------------------ chains (Amenities tab)
  function drawChains() {
    const st = s.current;
    if (!st) return;
    clear(st.chains);
    const { chain, selectedDistrict, chainShops = [] } = latest.current;
    if (!chain) return;
    const list = chainShops.filter((x) => x.chain === chain && x.district === selectedDistrict);
    const [, label, colour] = chainInfo(chain);
    list.forEach((shop) => {
      st.chains.push(htmlMarker({ lat: shop.lat, lng: shop.lng }, pinHtml({ emoji: '🛒', ring: colour, kind: 'amenity', label: shop.name, brand: CHAIN_LOGO[chain] }), {
        title: shop.name, zIndex: 500, onClick: () => openPlace({ kind: 'amenity', name: shop.name, category: label, lat: shop.lat, lng: shop.lng, district: shop.district }),
      }));
    });
    show(st.chains, true);
    if (list.length) fitTo(list.map((x) => [x.lat, x.lng]), 70, 15.5);
  }

  // ------------------------------------------------------------ react to props and the Explore list
  useEffect(() => {
    if (!ready) return;
    drawOutline();
    drawDistrictMarkers();
    if (st0.current) { st0.current = false; if (props.initialView) return; } // drawn again in the other style: keep the view
    if (!props.selectedDistrict) resetView();
    else fitDistrict(props.selectedDistrict);
  }, [props.selectedDistrict, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) drawDistrictMarkers(); }, [props.filter, placesByDistrict, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) drawChains(); }, [props.chain, props.selectedDistrict, props.chainShops, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const st = s.current; if (!ready || !st) return; showLines(st.luas, props.showLuas); st.applyZoom(); }, [props.showLuas, ready]);
  useEffect(() => { const st = s.current; if (!ready || !st) return; showLines(st.rail, props.showRail); st.applyZoom(); }, [props.showRail, ready]);
  useEffect(() => { const st = s.current; if (ready && st) st.renderHousing(); }, [props.showHousing, ready]);
  useEffect(() => {
    const st = s.current;
    if (!ready || !st) return;
    if (props.showBikes) st.loadBikes()?.then(() => show(st.bikes, latest.current.showBikes));
    show(st.bikes, props.showBikes);
  }, [props.showBikes, ready]);
  useEffect(() => {
    const st = s.current;
    if (!ready || !st) return;
    if (props.showSafety) st.loadSafety()?.then(() => st.safety?.setMap(latest.current.showSafety ? st.map : null));
    st.safety?.setMap(props.showSafety ? st.map : null);
  }, [props.showSafety, ready]);
  useEffect(() => {
    const st = s.current;
    if (!ready || !st) return;
    if (props.showBus && st.busWasOn === false && st.map.getZoom() < Z_BUS) st.map.setZoom(Z_BUS + 0.5);
    st.busWasOn = props.showBus;
    st.renderBusStops();
  }, [props.showBus, ready]);

  useEffect(() => {
    const st = s.current;
    if (!ready || !st) return;
    show(st.unis, explore.uni);
    showLines(st.uniLines, explore.uni);
    show(st.cityPlaces, explore.places);
    show(st.codes, explore.names);
    show(st.landmarks, Boolean(explore.amen.landmarks));
    st.renderHousing();
    st.renderAmenities();
  }, [explore, ready]);

  useEffect(() => {
    const box = boxRef.current;
    box?.querySelectorAll('.pm.on').forEach((n) => n.classList.remove('on'));
    if (props.hoverPlace == null) return;
    s.current?.placeMarkers[props.hoverPlace]?.content?.querySelector('.pm')?.classList.add('on');
  }, [props.hoverPlace, props.selectedDistrict]);

  const { trip } = props;
  useEffect(() => { if (ready) { syncPins(); updateHint(); } }, [trip.from, trip.to, trip.status, trip.from?.label, trip.to?.label, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) drawRoute(); }, [trip.itineraries, trip.selected, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) { syncPins(); drawRoute(); updateHint(); } }, [props.planning]); // eslint-disable-line react-hooks/exhaustive-deps

  // The place shown in the side panel gets Google's red pin; a searched place is zoomed to
  const sel = props.selectedPlace;
  useEffect(() => {
    const st = s.current;
    if (!ready || !st) return;
    if (st.placePin) st.placePin.map = null;
    st.placePin = null;
    if (!sel) return;
    const at = { lat: sel.lat, lng: sel.lng };
    st.placePin = new st.AdvancedMarkerElement({ position: at, content: new st.PinElement().element, zIndex: 1400, map: st.map });
    ripple(sel.lat, sel.lng);
    if (sel.zoom) { st.map.panTo(at); if (st.map.getZoom() < 16) st.map.setZoom(16); }
    else if (!st.map.getBounds()?.contains(at)) st.map.panTo(at);
  }, [sel?.lat, sel?.lng, sel?.name, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    getMap() { return s.current?.map; },
    flyToPlace(code, index) {
      const st = s.current;
      const marker = st?.placeMarkers[index];
      if (!marker) return;
      marker.map = st.map;
      st.map.panTo(marker.position);
      if (st.map.getZoom() < 15.5) st.map.setZoom(15.5);
    },
    districtAt,
    nearby,
    reveal(lat, lng) {
      const st = s.current;
      if (!st || st.map.getBounds()?.contains({ lat, lng })) return;
      st.map.panTo({ lat, lng });
      if (st.map.getZoom() < 14) st.map.setZoom(14);
    },
    clearSearchPin() {},
    focusCampus(id) {
      const st = s.current;
      const campus = campusList.find((u) => u.id === id);
      if (!st || !campus) return;
      st.map.panTo({ lat: campus.coordinates[0], lng: campus.coordinates[1] });
      st.map.setZoom(16);
    },
  }));

  const toggleAmen = (key) => {
    const on = !explore.amen[key];
    setExplore((x) => ({ ...x, amen: { ...x.amen, [key]: on } }));
    // shops are shown from street-ish zoom: zoom in a little when they'd be too small to see
    const st = s.current;
    if (on && AMENITY_CATEGORIES[key].csv && st && st.map.getZoom() < Z_MID + 1) st.map.setZoom(Z_MID + 1);
  };

  // a campus picked from the list: go there and open its details, like tapping a result in Google Maps
  const goToUni = (u) => {
    setExplore((x) => ({ ...x, open: false }));
    const st = s.current;
    if (!st) return;
    if (!explore.uni) setExplore((x) => ({ ...x, uni: true }));
    st.map.panTo({ lat: u.lat, lng: u.lon });
    if (st.map.getZoom() < 15) st.map.setZoom(15);
    openPlace({ kind: 'campus', name: u.name, lat: u.lat, lng: u.lon, names: [u.name] });
  };
  const amenCount = Object.values(explore.amen).filter(Boolean).length;

  return (
    <div ref={boxRef} className={`district-map jp-scope gm-scope z-far z-low${props.planning === false ? ' is-browsing' : ''}${props.scheme === 'dark' ? ' is-dark' : ''}`}>
      <div ref={containerRef} className="jp-route-map" style={{ position: 'absolute', inset: 0 }} role="region" aria-label="Google map of Dublin: click any place for its details and directions" />
      <div ref={tipRef} className="gm-tip" role="tooltip" hidden />
      <div ref={hintRef} className="jp-map-hint" aria-live="polite" hidden={props.planning === false} />
      <div ref={statusRef} className="jp-amenity-status" role="status" aria-live="polite" hidden />
      <div className="gm-mode" role="group" aria-label="Map style">
        {[['map', '🗺️', 'Map'], ['satellite', '🛰️', 'Satellite'], ['dark', '🌙', 'Dark']].map(([id, icon, label]) => {
          const current = props.mapType === 'hybrid' ? 'satellite' : props.scheme === 'dark' ? 'dark' : 'map';
          return (
            <button type="button" key={id} aria-pressed={current === id} onClick={() => {
              if (id === current) return;
              const st = s.current;
              if (id === 'satellite') { st?.map.setMapTypeId('hybrid'); props.onMapStyle?.({ mapType: 'hybrid', scheme: props.scheme }); return; }
              const scheme = id === 'dark' ? 'dark' : 'light';
              if (scheme === props.scheme) { st?.map.setMapTypeId('roadmap'); props.onMapStyle?.({ mapType: 'roadmap', scheme }); return; }
              // a light or dark map is set when the map is made: the page draws it again in the other style
              props.onMapStyle?.({ mapType: 'roadmap', scheme, center: st?.map.getCenter()?.toJSON(), zoom: st?.map.getZoom() });
            }}><span aria-hidden="true">{icon}</span>{label}</button>
          );
        })}
      </div>
      <div className="gm-explore">
        <button type="button" className="gm-explore-button" aria-expanded={explore.open} onClick={() => setExplore((x) => ({ ...x, open: !x.open }))}
          title="Show student housing, universities, famous places and supermarkets on the map">
          Explore{amenCount > 0 && <span className="gm-explore-count">{amenCount}</span>} <span aria-hidden="true">▾</span>
        </button>
        {explore.open && (
          <div className="gm-explore-menu" role="group" aria-label="Find a university, or show places on the map">
            <p className="gm-explore-title">Find a university</p>
            <div className="gm-uni-pick">
              {uniList.map((u) => (
                <button type="button" key={u.name} onClick={() => goToUni(u)}><span aria-hidden="true">🎓</span><span>{shortName(u.name)}</span></button>
              ))}
            </div>
            <hr />
            <p className="gm-explore-title">Show on the map</p>
            <label><input type="checkbox" checked={explore.uni} onChange={() => setExplore((x) => ({ ...x, uni: !x.uni }))} /><span className="pm-row"><span className="pm-row-dot" style={{ '--ring': RING.uni }}>🎓</span>Universities</span></label>
            <label><input type="checkbox" checked={Boolean(props.showHousing)} onChange={() => props.onHousingChange?.(!props.showHousing)} /><span className="pm-row"><span className="pm-row-dot" style={{ '--ring': RING.housing }}>🏠</span>Student housing</span></label>
            <label><input type="checkbox" checked={explore.places} onChange={() => setExplore((x) => ({ ...x, places: !x.places }))} /><span className="pm-row"><span className="pm-row-dot" style={{ '--ring': RING.place }}>📍</span>Famous places</span></label>
            <label><input type="checkbox" checked={explore.names} onChange={() => setExplore((x) => ({ ...x, names: !x.names }))} /><span className="pm-row"><span className="pm-row-dot" style={{ '--ring': '#7a8a7e' }}>🏷️</span>District names</span></label>
            <hr />
            {Object.entries(AMENITY_CATEGORIES).map(([key, c]) => (
              <label key={key}>
                <input type="checkbox" checked={Boolean(explore.amen[key])} onChange={() => toggleAmen(key)} />
                {c.logo
                  ? <span className="jp-layer-subcategory" dangerouslySetInnerHTML={{ __html: `${brandLogo(key)}<span>${escapeHtml(c.label)}</span>` }} />
                  : <span className="pm-row"><span className="pm-row-dot" style={{ '--ring': c.ring }}>{c.icon}</span>{c.label}</span>}
              </label>
            ))}
          </div>
        )}
      </div>
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

export default GoogleBaseMap;
