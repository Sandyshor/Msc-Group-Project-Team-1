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
import './leafletNoTitle';
import { ALL_DISTRICTS, heatColor, safetyLabel, strongColor, textOnHeat } from './mapShared';
// Safety score per Census area (crime-heatmap.geojson is cut off, so the complete copy is used)
import crimeAreasUrl from './crime-heatmap1.geojson?url';
const countyAreasUrl = '/data/county-dublin-areas.geojson'; // approximate A/K routing areas
const countySafetyUrl = '/data/county-dublin-safety.geojson';
import { PLANNER, boundariesUrl, luasRedUrl, luasGreenUrl, busStopsUrl, railLinesUrl, railStationsUrl, BIKES_INFO_URL, LUAS_RED, LUAS_GREEN, DART_GREEN, RAIL_PURPLE, BUS_YELLOW, BUS_ICON, BIKES_BLUE, AMENITY_CATEGORIES, BRAND_KEYS, CHAIN_LOGO, POI_STYLE, hasName, PLACE_EMOJI, RING, RESIDENCES_URL, euro, escapeHtml, shortName, brandLogo, metres, districtIdFromPostcode, convertCoordinates, isBrandName, brandOf, recordMatchesAmenityLayer, distanceMetres, pinHtml, stopHtml } from './mapLayers';
import { decodePolyline, formatDistance, formatMinutes, legColor, lineLabel, MODE_STYLE } from './journey';
import { chainInfo } from './shopChains';
import { loadAmenityRecords as loadCsv } from './amenityData';
import { universities as campusList } from './cityPlaces';
import { groupPins, spreadPins } from './spreadPins';
import { fitCard } from './placeCard';
import './JourneyPlanner.css';
import './JourneyBaseMap.css';
import './Bikes.css';


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


// Basemap: identical to the journey planner (Stadia, OpenStreetMap if Stadia refuses the tiles).
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const STADIA_ATTRIBUTION = '&copy; <a href="https://stadiamaps.com/attribution/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> ' + OSM_ATTRIBUTION;
const BASEMAP = { url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', maxZoom: 20, attribution: STADIA_ATTRIBUTION };
const FALLBACK_BASEMAP = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: OSM_ATTRIBUTION, className: 'jp-tiles-osm' };


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
      housing: L.layerGroup(), // student residences (button above the map)
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
    };
    st.names.addLayer(st.codes).addLayer(st.areas);
    st.placeLayer = L.layerGroup([st.cityPlaces, st.districtPlaces]);
    s.current = st;
    if (import.meta.env.DEV) window.__fmdMap = map; // lets the local browser tests move the map (never in the live build)

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
    // Every click on the map (a pin or any spot) opens that place's details in the side panel, like Google Maps
    const pickLandmark = (latlng, label, extra = {}) => openPlace({ kind: 'landmark', name: label, lat: latlng.lat, lng: latlng.lng, ...extra });

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
          .on('click', () => pickLandmark(latlng, items.map((i) => i.name).join(' / '), {
            kind: kind === 'uni' ? 'campus' : 'landmark', category: items[0].category, names: items.map((i) => i.name),
          }))
          .addTo(layer);
      });
    };

    const loadLandmarks = (file, layer, kind) => fetch(PLANNER + file, { headers: { Accept: 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error(`${file} returned ${r.status}`); return r.json(); })
      .then((list) => {
        if (st.gone) return; // the map was removed while the file loaded
        addLandmarks(list, layer, kind);
        if (kind === 'uni') st.renderHousing?.(); // residences step aside from the campus pins
        if (kind === 'place') {
          st.cityPlacePoints = list.map((i) => [i.lon, i.lat]);
          addLandmarks(list.filter((i) => !['Airport', 'Rail station'].includes(i.category)), cityLandmarkLayer, 'landmark');
          drawDistrictMarkers();
        }
      })
      .catch((e) => console.error(`Could not load ${file}`, e));
    loadLandmarks('universities.json', universityLayer, 'uni');
    loadLandmarks('places.json', st.cityPlaces, 'place');

    // ---------------- student residences: every purpose-built residence at its own address
    // One residence pin. Hover: a card with its details and website link (it stays open while the pointer is on the
    // card, so the link can be clicked). Click: the residence becomes the journey's start (A) or destination (B), and
    // the journey planner works out the distance and route. Drawn at `at` (moved aside if it would cover another pin);
    // the trip uses the residence's true location.
    const card = L.popup({ closeButton: false, autoPan: false, offset: [0, -16], maxWidth: 280, minWidth: 240, className: 'sh-popup sh-hover' });
    let cardTimer = 0;
    const hideCard = () => { clearTimeout(cardTimer); cardTimer = setTimeout(() => map.closePopup(card), 220); };
    const keepCard = () => clearTimeout(cardTimer);
    card.on('add', () => {
      const node = card.getElement();
      node?.addEventListener('mouseenter', keepCard);
      node?.addEventListener('mouseleave', hideCard);
      boxRef.current?.classList.add('has-search-pop'); // the "click the map" hint would sit on the card
    });
    card.on('remove', () => boxRef.current?.classList.remove('has-search-pop'));
    const residenceCard = (r) => {
      const who = [r.operator, r.address].filter(Boolean).map(escapeHtml).join(' · ');
      return `<div class="sh-pop"><span class="sh-kicker">Student residence · ${escapeHtml(r.district)}</span><strong>${escapeHtml(r.name)}</strong>`
        + `${who ? `<span class="sh-addr">${who}</span>` : ''}`
        + `${r.from || r.rooms ? `<span class="sh-price">${r.from ? `From <b>${euro(r.from)}</b> a month` : ''}${r.from && r.rooms ? ' · ' : ''}${r.rooms ? `<span class="sh-rooms">${escapeHtml(r.rooms)}</span>` : ''}</span>` : ''}`
        + `<span class="sh-actions">${r.website ? `<a class="sh-web" href="${escapeHtml(r.website)}" target="_blank" rel="noopener noreferrer">Visit website ↗</a>` : ''}</span>`
        + '<span class="sh-hint">Click the pin for details and directions</span></div>';
    };
    const residenceMarker = (r, at) => {
      const marker = L.marker(at, { icon: pinIcon({ emoji: '🏠', ring: RING.housing, kind: 'housing', label: r.name }), title: `${r.name} (student residence)`, riseOnHover: true });
      marker.on('mouseover', () => {
        keepCard();
        card.setLatLng(marker.getLatLng()).setContent(residenceCard(r)).openOn(map);
        fitCard(card, map, { top: 64 }); // below the pin when the map's top controls leave no room above
      });
      marker.on('mouseout', hideCard);
      marker.on('click', () => {
        map.closePopup(card);
        openPlace({ kind: 'residence', name: r.name, lat: r.lat, lng: r.lon, district: r.district, residence: r });
      });
      return marker;
    };
    // Zoomed out, residences that would touch become one count badge (click to zoom in to them); zoomed in, any that
    // still overlap each other or a campus pin are pushed apart, with a dotted line back to the true spot.
    const HOUSING_GROUP_ZOOM = 14;
    st.uniLines = L.layerGroup().addTo(universityLayer); // dotted lines back to a campus that had to step aside
    const renderHousing = () => {
      const z0 = map.getZoom();
      const pinSize = (z0 < Z_MID ? 20 : z0 >= Z_STREET ? 38 : z0 >= Z_NEAR ? 34 : 30) + 4;
      // campus pins first: spread any that would touch (TU Aungier Street, DBS and RCSI are a block apart)
      const unis = [];
      universityLayer.eachLayer((m) => { if (m instanceof L.Marker) { m.trueLatLng ??= m.getLatLng(); unis.push(m); } });
      const uniSpots = unis.map((m) => { const p = map.latLngToContainerPoint(m.trueLatLng); return { x: p.x, y: p.y, r: pinSize / 2, from: p }; });
      spreadPins(uniSpots, [], 3);
      st.uniLines.clearLayers();
      unis.forEach((m, i) => {
        const at = map.containerPointToLatLng([uniSpots[i].x, uniSpots[i].y]);
        m.setLatLng(at);
        if (Math.hypot(uniSpots[i].x - uniSpots[i].from.x, uniSpots[i].y - uniSpots[i].from.y) > 6) {
          L.polyline([m.trueLatLng, at], { color: RING.uni, weight: 1.5, opacity: 0.7, dashArray: '2 4', interactive: false }).addTo(st.uniLines);
          L.circleMarker(m.trueLatLng, { radius: 3, color: '#fff', weight: 1.5, fillColor: RING.uni, fillOpacity: 1, interactive: false }).addTo(st.uniLines);
        }
      });
      if (!st.housingData || !map.hasLayer(st.housing)) return;
      st.housing.clearLayers();
      const z = map.getZoom();
      // a pin's width on screen at this zoom: CSS --size plus its 2 px ring on each side; count badges are wider pills
      const size = (z < Z_MID ? 20 : z >= Z_STREET ? 38 : z >= Z_NEAR ? 34 : 30) + 4;
      const badgeR = z < Z_MID ? 22 : 25;
      const items = st.housingData.map((r) => ({ r, point: map.latLngToContainerPoint([r.lat, r.lon]) }));
      const fixed = [];
      const fixedPoint = (latlng, r) => { const p = map.latLngToContainerPoint(latlng); return { x: p.x, y: p.y, r }; };
      // pins residences must not cover: campuses, famous places (city-wide and the district's) when they're shown
      if (map.hasLayer(universityLayer)) uniSpots.forEach((p) => fixed.push({ x: p.x, y: p.y, r: size / 2 }));
      [st.cityPlaces, st.districtPlaces, cityLandmarkLayer].filter((layer) => map.hasLayer(layer) || layer === st.districtPlaces)
        .forEach((layer) => layer.eachLayer((m) => { if (m instanceof L.Marker) fixed.push(fixedPoint(m.getLatLng(), size / 2)); }));
      if (st.placePin) fixed.push(fixedPoint(st.placePin.getLatLng(), 18));
      const groups = z < HOUSING_GROUP_ZOOM ? groupPins(items, size + 8) : items.map((item) => ({ items: [item], cx: item.point.x, cy: item.point.y }));
      const spots = groups.map((g) => ({ x: g.cx, y: g.cy, r: g.items.length > 1 ? badgeR : size / 2 }));
      spreadPins(spots, fixed, 3);
      groups.forEach((g, i) => {
        const at = map.containerPointToLatLng([spots[i].x, spots[i].y]);
        if (g.items.length > 1) {
          const names = g.items.map((x) => escapeHtml(x.r.name));
          L.marker(at, {
            icon: L.divIcon({ className: 'pm-icon', html: `<div class="sh-cluster" style="--ring:${RING.housing}"><span>🏠</span><b>${g.items.length}</b></div>`, iconSize: [0, 0] }),
            title: `${g.items.length} student residences`, riseOnHover: true,
          })
            .bindTooltip(`<b>${g.items.length} student residences</b><small>${names.slice(0, 6).join('<br>')}${names.length > 6 ? `<br>and ${names.length - 6} more` : ''}</small><small class="sh-tip-hint">Click to zoom in</small>`,
              { direction: 'top', offset: [0, -16], className: 'jp-landmark-tooltip sh-tip' })
            .on('tooltipopen', (e) => roomyTooltip(map, e.tooltip, 22))
            .on('click', () => map.fitBounds(L.latLngBounds(g.items.map((x) => [x.r.lat, x.r.lon])).pad(0.4), { maxZoom: 17, animate: !REDUCED_MOTION }))
            .addTo(st.housing);
          return;
        }
        const { r, point } = g.items[0];
        if (Math.hypot(spots[i].x - point.x, spots[i].y - point.y) > 6) {
          // moved aside: a thin line and a dot show where it really is
          L.polyline([[r.lat, r.lon], at], { color: RING.housing, weight: 1.5, opacity: 0.8, dashArray: '2 4', interactive: false }).addTo(st.housing);
          L.circleMarker([r.lat, r.lon], { radius: 3, color: '#fff', weight: 1.5, fillColor: RING.housing, fillOpacity: 1, interactive: false }).addTo(st.housing);
        }
        residenceMarker(r, at).addTo(st.housing);
      });
      st.declutter?.();
    };
    st.renderHousing = renderHousing;
    map.on('zoomend overlayadd overlayremove', renderHousing);
    fetch(RESIDENCES_URL, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      st.housingData = d?.residences || [];
      st.housingData.forEach((r) => st.named.landmarks.push({ name: r.name, lat: r.lat, lng: r.lon }));
      renderHousing();
    }).catch((e) => console.error('Could not load student residences', e));

    // ---------------- layer list
    const amenityLayers = Object.fromEntries(Object.keys(AMENITY_CATEGORIES).map((k) => [k, L.layerGroup()]));
    amenityLayers.landmarks = cityLandmarkLayer;
    const row = (emoji, label, ring) => `<span class="pm-row"><span class="pm-row-dot" style="--ring:${ring}">${emoji}</span>${label}</span>`;
    const overlays = {
      [row('🎓', 'Universities', RING.uni)]: universityLayer,
      [row('🏠', 'Student housing', RING.housing)]: st.housing,
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
    if (toggle) { toggle.innerHTML = '<span>Explore</span>'; toggle.title = 'Show student housing, universities, famous places and supermarkets on the map'; }
    // Student housing is ticked here, so tell the page (its legend) when it is turned on or off
    map.on('overlayadd overlayremove', (e) => { if (e.layer === st.housing) latest.current.onHousingChange?.(e.type === 'overlayadd'); });
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
        .on('click', () => pickLandmark(latlng, name, { kind: 'amenity', category: POI_STYLE[record.category]?.[1] || typeLabel, area: record.area }));
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
          .on('click', () => pickLandmark(latlng, name, { kind: 'amenity', category: style[1], area: record.area }))
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
            .on('click', () => pickLandmark(L.latLng(lat, lng), f.properties.name, { kind: 'bus', stops: [f.properties] }))
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
          .on('click', () => pickLandmark(L.latLng(lat, lng), stops[0].properties.name, { kind: 'bus', stops: stops.map((x) => x.properties) }))
          .addTo(st.bus);
      });
      updateStatus();
    };
    st.renderBusStops = renderBusStops;

    map.on('overlayadd overlayremove', (e) => { if (Object.values(amenityLayers).includes(e.layer)) updateAmenities(); });
    map.on('moveend', () => { updateAmenities(); renderBusStops(); });

    // ---------------- click any spot on the map: its details (address, district, what's nearby) in the side panel
    // District famous places, Luas stops and neighbourhoods also give names to clicked points
    Object.values(placesByDistrict).flat().forEach((p) => { if (p.lngLat) st.named.landmarks.push({ name: p.name, lat: p.lngLat[1], lng: p.lngLat[0] }); });
    profileData.stops.forEach((x) => st.named.stations.push({ name: `${x.name} (Luas)`, lat: x.lat, lng: x.lng }));
    Object.entries(profileData.profiles).forEach(([d, pr]) => (pr.areas || []).forEach(([name, lat, lng]) => st.named.areas.push({ name, d, lat, lng })));
    map.on('click', (e) => openPlace({ kind: 'point', lat: e.latlng.lat, lng: e.latlng.lng, name: nameFor(e.latlng.lat, e.latlng.lng) }));

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
        .on('click', () => openPlace({ kind: 'luas', name: stop.name, lat: stop.lat, lng: stop.lng, line: stop.line, district: stop.d || undefined }))
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
          .on('click', () => pickLandmark(L.latLng(lat, lng), `${name} station`, { kind: 'rail', dart: Boolean(dart) }))
          .addTo(st.railStations);
        st.named.stations.push({ name: `${name} station`, lat, lng });
        st.railStations.list = [...(st.railStations.list || []), { name, dart: Boolean(dart), lat, lng }];
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
              .on('click', () => openPlace({ kind: 'bike', name: dock.name, lat: dock.lat, lng: dock.lon, dock: { id: dock.station_id, address: dock.address, capacity: dock.capacity } }))
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
          }).addTo(st.safety); // clicks still reach the map, so the spot's details open as usual
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
      st.gone = true;
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
    // A planned journey to this district is on the map (e.g. from the airport, opened from the results page): keep
    // all of it in view rather than zooming in on the district
    const to = latest.current.trip?.to;
    if (st.routeBounds && journeyShown() && to && L.geoJSON(f).getBounds().contains([to.lat, to.lng])) {
      st.map.fitBounds(st.routeBounds, { padding: [60, 60], maxZoom: 16, animate: animate && !REDUCED_MOTION });
      return;
    }
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
        .on('mouseover', () => latest.current.onHoverPlace(i))
        .on('mouseout', () => latest.current.onHoverPlace(null))
        .on('click', () => latest.current.onPlaceClick(sel, i));
      if (!duplicate) marker.addTo(st.districtPlaces);
      return marker;
    });
    st.renderHousing?.(); // residences step aside from this district's place pins
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

  // ------------------------------------------------------------ places
  // Which district or County Dublin area a point is in (district outlines, checked by point-in-polygon)
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
      const g = f.geometry;
      if (!g || !profileData.profiles[code]) continue;
      if (g.type === 'Polygon' ? inPolygon(g.coordinates) : g.type === 'MultiPolygon' && g.coordinates.some(inPolygon)) return code;
    }
    return null;
  }

  function openPlace(place) {
    latest.current.onPlace?.({ ...place, district: place.district ?? districtAt(place.lat, place.lng) });
  }

  // What's around a point, for the place panel: the nearest Luas stop, train station and bus stop, and how many
  // shops, cafés and other places are within 500 m
  async function nearby(lat, lng) {
    const st = s.current;
    if (!st) return null;
    if (!st.busStops) {
      try { st.busStops = (await (await fetch(busStopsUrl)).json()).features; } catch { st.busStops = null; }
    }
    if (!st.amenityRecords) {
      try { st.amenityRecords = await loadCsv(); } catch { /* counts left out */ }
    }
    const here = [lat, lng];
    const nearest = (list, at) => list.reduce((best, item) => {
      const m = metres(here, at(item));
      return !best || m < best.m ? { ...item, m } : best;
    }, null);
    const luas = nearest(profileData.stops, (x) => [x.lat, x.lng]);
    const rail = nearest(st.railStations.list || [], (x) => [x.lat, x.lng]);
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

  // The journey (A/B pins, route lines, the moving dot, the route key) is only on the map while the journey
  // planner is on screen: switching to Places, Rent, Amenities... takes it off; back on Journey it returns.
  const journeyShown = () => latest.current.planning !== false;

  function syncPins() {
    const st = s.current;
    if (!st) return;
    if (!journeyShown()) { ['from', 'to'].forEach((k) => { st.pins[k]?.remove(); st.pins[k] = null; }); return; }
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
      const marker = L.marker([p.lat, p.lng], { riseOnHover: true, zIndexOffset: 1200, icon: routePinIcon(label, cls), title: `${k === 'from' ? 'Start' : 'Destination'}: ${p.label || ''}` }).addTo(st.map);
      marker.on('click', () => openPlace({ kind: 'point', lat: p.lat, lng: p.lng, name: p.label || nameFor(p.lat, p.lng) }));
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
    else if (!trip.from && !trip.to) html = 'Click any place on the map, then choose <strong>Directions</strong>';
    else if (!trip.from) html = 'Choose a <strong>start</strong>: type it, use your location, or click a place and pick <strong>Start here</strong>';
    else if (!trip.to) html = 'Choose a <strong>destination</strong>: type it, or click a place and pick <strong>Directions</strong>';
    else html = '';
    node.hidden = !html || latest.current.planning === false;
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
    st.routeBounds = null;
    if (!journeyShown()) { if (legendRef.current) legendRef.current.hidden = true; return; }
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
    st.routeBounds = bounds;
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
        .on('click', () => openPlace({ kind: 'amenity', name: shop.name, category: label, lat: shop.lat, lng: shop.lng, district: shop.district }))
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
    if (props.showHousing) { st.housing.addTo(st.map); st.renderHousing?.(); } else st.housing.remove();
    st.declutter();
  }, [props.showHousing]);
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
    if (props.showBus && st.busWasOn === false && st.map.getZoom() < Z_BUS) st.map.setZoom(Z_BUS_ICON, { animate: !REDUCED_MOTION });
    st.busWasOn = props.showBus;
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
  // leaving / returning to the journey planner: take the journey off the map or put it back (the trip itself is kept)
  useEffect(() => { syncPins(); drawRoute(); }, [props.planning]); // eslint-disable-line react-hooks/exhaustive-deps

  // The place shown in the side panel gets a red pin (like Google Maps); a searched place is zoomed to
  const sel = props.selectedPlace;
  useEffect(() => {
    const st = s.current;
    if (!st) return;
    st.placePin?.remove();
    st.placePin = null;
    if (!sel) { st.renderHousing?.(); return; }
    const ll = L.latLng(sel.lat, sel.lng);
    st.placePin = L.marker(ll, {
      icon: L.divIcon({ className: 'jp-search-pin', html: '<span></span>', iconSize: [30, 40], iconAnchor: [15, 38] }),
      zIndexOffset: 1400, interactive: false, keyboard: false,
    }).addTo(st.map);
    ripple(ll);
    if (sel.zoom) st.map.setView(ll, Math.max(st.map.getZoom(), 16), { animate: !REDUCED_MOTION });
    else if (!st.map.getBounds().pad(-0.12).contains(ll)) st.map.panTo(ll, { animate: !REDUCED_MOTION });
    st.renderHousing?.();
  }, [sel?.lat, sel?.lng, sel?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    getMap() { return s.current?.map; },
    flyToPlace(code, index) {
      const st = s.current;
      const marker = st?.placeMarkers[index];
      if (!marker) return;
      if (!st.map.hasLayer(st.placeLayer)) st.placeLayer.addTo(st.map);
      if (!st.districtPlaces.hasLayer(marker)) marker.addTo(st.districtPlaces);
      st.map.setView(marker.getLatLng(), Math.max(st.map.getZoom(), 15.5), { animate: !REDUCED_MOTION });
    },
    districtAt,
    nearby,
    // A typed A or B: bring it into view if it's off the map
    reveal(lat, lng) {
      const st = s.current;
      if (st && !st.map.getBounds().pad(-0.1).contains([lat, lng])) st.map.setView([lat, lng], Math.max(st.map.getZoom(), 14), { animate: !REDUCED_MOTION });
    },
    clearSearchPin() { /* the selected-place pin is removed when the panel closes */ },
    focusCampus(id) {
      const st = s.current;
      const campus = campusList.find((u) => u.id === id);
      if (!st || !campus) return;
      st.map.setView(campus.coordinates, 16, { animate: !REDUCED_MOTION });
    },
  }));

  return (
    <div ref={boxRef} className={`district-map jp-scope z-far z-low${props.planning === false ? ' is-browsing' : ''}`}>
      {/* position is set here, not only in the CSS: if Leaflet starts before the stylesheet applies (it can on
          Safari), it sees no position, forces "relative" and the map collapses to 0 px high */}
      <div ref={containerRef} className="jp-route-map" style={{ position: 'absolute', inset: 0 }} aria-label="Map of Dublin: click any place for its details and directions" />
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

// Open a tooltip on the side of the pin that has room (below near the top edge, to the left near the right edge),
// so it is never cut off by the map frame or hidden under the hint at the top
function roomyTooltip(map, tooltip, gap) {
  const p = map.latLngToContainerPoint(tooltip.getLatLng());
  const size = map.getSize();
  const el = tooltip.getElement();
  const w = el?.offsetWidth || 200;
  const h = el?.offsetHeight || 120;
  let dir = 'top';
  if (p.y - gap - h < 70) dir = p.y + gap + h < size.y - 10 ? 'bottom' : (p.x > size.x / 2 ? 'left' : 'right');
  else if (p.x + w / 2 > size.x - 10) dir = 'left';
  else if (p.x - w / 2 < 10) dir = 'right';
  if (dir === 'top' && p.x + w / 2 <= size.x - 10 && p.x - w / 2 >= 10 && tooltip.options.direction === 'top') return;
  tooltip.options.direction = dir;
  tooltip.options.offset = { top: [0, -gap], bottom: [0, gap], left: [-gap, 0], right: [gap, 0] }[dir];
  tooltip.update();
}

export default JourneyBaseMap;
