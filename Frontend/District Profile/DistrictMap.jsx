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

const bikesUrl = '/data/dublin-bikes-stations.geojson';
const BIKES_STATUS_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_status.json';
const BIKES_COLOUR = '#1f6fb2';
const BIKES_STATUS_MAX_AGE_MS = 60 * 1000;

maplibregl.setWorkerUrl(maplibreWorkerUrl);


const STADIA_STYLE = 'alidade_smooth';
const STADIA_KEY = import.meta.env.VITE_STADIA_API_KEY;
const MAP_STYLE = `https://tiles.stadiamaps.com/styles/${STADIA_STYLE}.json${STADIA_KEY ? `?api_key=${STADIA_KEY}` : ''}`;

import { ACTIVE_DISTRICTS, ALL_DISTRICTS, AMENITY_TYPES, HEAT_STOPS, heatColor, iconFor, pastelColor, safetyLabel, strongColor, textOnHeat } from './mapShared';
export * from './mapShared';

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

  // Live bikes and free stands for every dock; one request serves all clicks for a minute.
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
    if (bounds) mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 14, pitch: 0, bearing: 0, duration: 1300 });
  }
  function openStopPopup(stop) {
    const map = mapRef.current;
    const { profiles, amenities, lines } = profileData;
    const lngLat = [stop.lng, stop.lat];
    const line = lines[stop.line.toLowerCase()] || {};
    const box = el('div', 'stop-popup');
    const badge = el('span', `stop-line ${stop.line.toLowerCase()}`, `${stop.line} Line`);
    box.append(badge, el('h3', null, stop.name));
    const tags = el('div', 'stop-tags');
    tags.append(el('span', null, stop.d ? `${stop.d}${profiles[stop.d] ? ' · ' + profiles[stop.d].name : ''}` : 'Outside Dublin postal districts'));
    if (line.interval) tags.append(el('span', null, `Every ${line.peak || line.interval} min at peak`));
    box.append(tags);

    const counts = {};
    (amenities[stop.d] || []).forEach(([, cat, lat, lng]) => {
      if (distanceMetres(lngLat, [lng, lat]) < 500) counts[cat] = (counts[cat] || 0) + 1;
    });
    const near = AMENITY_TYPES.filter(([k]) => counts[k]);
    if (near.length) {
      box.append(el('p', 'stop-heading', 'Within 500 m'));
      const row = el('div', 'stop-tags');
      near.forEach(([k, label, , colour]) => {
        const t = el('span', null, `${counts[k]} ${label.toLowerCase()}`);
        t.style.borderColor = colour;
        row.append(t);
      });
      box.append(row);
    }

    const places = [];
    ACTIVE_DISTRICTS.forEach((c) => (placesByDistrict[c] || []).forEach((p) => {
      if (p.lngLat) { const m = distanceMetres(lngLat, p.lngLat); if (m < 900) places.push([p.name, m]); }
    }));
    places.sort((a, b) => a[1] - b[1]);
    if (places.length) {
      box.append(el('p', 'stop-heading', 'Famous places nearby'));
      const ul = el('ul');
      places.slice(0, 3).forEach(([n, m]) => ul.append(el('li', null, `${n} · ${Math.round(m / 10) * 10} m`)));
      box.append(ul);
    }

    let popup;
    if (stop.d && ACTIVE_DISTRICTS.includes(stop.d)) {
      const btn = el('button', 'stop-open', `Open ${stop.d} profile`);
      btn.type = 'button';
      btn.style.background = strongColor(profiles[stop.d].hue);
      btn.onclick = () => { popup?.remove(); latest.current.onSelectDistrict(stop.d); };
      box.append(btn);
    }
    store.current.stopPopup?.remove();
    popup = new maplibregl.Popup({ offset: 10, maxWidth: '280px' }).setLngLat(lngLat).setDOMContent(box).addTo(map);
    store.current.stopPopup = popup;
    store.current.stopPopupDistrict = stop.d;
  }

  // ---------- create the map once ----------
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return undefined;
    let cancelled = false;
    let map;

    async function initialiseMap() {
      try {
        proj4.defs('EPSG:2157', '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +units=m +no_defs');
        const response = await fetch(boundariesUrl);
        if (!response.ok) throw new Error(`Boundary file request failed (${response.status})`);
        const rawGeoJSON = await response.json();
        const geoJSON = {
          type: 'FeatureCollection',
          features: rawGeoJSON.features.map((feature) => ({
            ...feature,
            properties: { ...feature.properties, districtId: districtIdFromPostcode(feature.properties?.postcodes) },
            geometry: { ...feature.geometry, coordinates: convertCoordinates(feature.geometry.coordinates) },
          })),
        };
        geoJSON.features.forEach((f) => { if (f.properties.districtId) store.current.features[f.properties.districtId] = f; });
        if (cancelled || !mapContainerRef.current) return;

        map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: MAP_STYLE,
          center: [-6.2603, 53.3498],
          zoom: 10.8,
          pitch: 0,
          bearing: 0,
          maxPitch: 70,
          attributionControl: true,
          canvasContextAttributes: { antialias: true },
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new maplibregl.FullscreenControl(), 'top-right');

        map.on('load', () => {
          if (cancelled) return;
          try {
            addBuildingLayer(map);

            map.addSource('dublin-districts', { type: 'geojson', data: geoJSON });
            map.addLayer({
              id: 'district-fill', type: 'fill', source: 'dublin-districts',
              filter: ['in', ['get', 'districtId'], ['literal', ALL_DISTRICTS]],
              paint: { 'fill-color': '#cfd8cc', 'fill-opacity': 0.3, 'fill-color-transition': { duration: 350 }, 'fill-opacity-transition': { duration: 350 } },
            });
            map.addLayer({
              id: 'district-outline', type: 'line', source: 'dublin-districts',
              filter: ['in', ['get', 'districtId'], ['literal', ALL_DISTRICTS]],
              paint: { 'line-color': '#ffffff', 'line-width': 1.5 },
            });

            // Safety by Census area (shown when zoomed in)
            const heatColour = ['interpolate', ['linear'], ['get', 'score']];
            HEAT_STOPS.forEach(([v, c]) => heatColour.push(v, c));
            map.addSource('dm-crime-areas', { type: 'geojson', data: crimeAreasUrl });
            map.addLayer({
              id: 'dm-crime-areas', type: 'fill', source: 'dm-crime-areas', minzoom: 11.5, layout: { visibility: 'none' },
              paint: { 'fill-color': heatColour, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0, 12.8, 0.62, 16, 0.42] },
            });
            map.addLayer({
              id: 'dm-crime-lines', type: 'line', source: 'dm-crime-areas', minzoom: 12.5, layout: { visibility: 'none' },
              paint: { 'line-color': '#ffffff', 'line-width': 0.6, 'line-opacity': 0.7 },
            });
            const crimeHover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'amenity-hover' });
            map.on('mousemove', 'dm-crime-areas', (e) => {
              const f = e.features?.[0];
              if (!f || map.queryRenderedFeatures(e.point, { layers: ['dm-stops-hit', 'dm-bikes-hit', 'dm-amenities-dots'] }).length) { crimeHover.remove(); return; }
              const p = f.properties;
              const sc = Number(p.score);
              crimeHover.setLngLat(e.lngLat).setHTML(
                `<div class="safe-pop"><span class="safe-pop-score" style="background:${heatColor(sc)};color:${textOnHeat(sc)}">${sc.toFixed(0)}</span>`
                + `<div><b>${p.ed}</b> · ${p.d}<br><small>${safetyLabel(sc)}</small></div></div>`
                + (String(p.check) === 'true' ? '<p class="safe-pop-check">⚠ Check the specific street before choosing</p>' : '')
                + `<p class="safe-pop-facts">Violent crime ${p.viol} · Robbery ${p.rob} · Theft ${p.burg} per 1,000 people a year</p>`,
              ).addTo(map);
            });
            map.on('mouseleave', 'dm-crime-areas', () => crimeHover.remove());

            map.addSource('dm-spokes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'dm-spokes-line', type: 'line', source: 'dm-spokes', paint: { 'line-width': 1.6, 'line-dasharray': [2, 3], 'line-opacity': 0.85 } });

            // Luas route lines from your files
            [['red', '#d71920', 'Luas Red Line', luasRedUrl], ['green', '#008531', 'Luas Green Line', luasGreenUrl]].forEach(([k, colour, ref, url]) => {
              map.addSource(`luas-${k}-route`, { type: 'geojson', data: url });
              map.addLayer({
                id: `luas-${k}-route-line`, type: 'line', source: `luas-${k}-route`,
                filter: ['all', ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']], ['==', ['get', 'ref'], ref]],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': colour, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 12, 4, 15, 6] },
              });
            });

            // Amenity dots
            map.addSource('dm-amenities', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            const amenColour = ['match', ['get', 'cat']];
            AMENITY_TYPES.forEach(([k, , , c]) => amenColour.push(k, c));
            amenColour.push('#888888');
            map.addLayer({
              id: 'dm-amenities-dots', type: 'circle', source: 'dm-amenities', layout: { visibility: 'none' },
              paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 16, 7], 'circle-color': amenColour, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
            });
            const amenPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'amenity-hover' });
            map.on('mouseenter', 'dm-amenities-dots', (e) => {
              map.getCanvas().style.cursor = 'pointer';
              const f = e.features?.[0];
              if (!f) return;
              const type = AMENITY_TYPES.find(([k]) => k === f.properties.cat);
              amenPopup.setLngLat(f.geometry.coordinates).setText(`${f.properties.name} · ${type ? type[1] : ''}`).addTo(map);
            });
            map.on('mouseleave', 'dm-amenities-dots', () => { map.getCanvas().style.cursor = ''; amenPopup.remove(); });

            // Dublin Bikes docks
            map.addSource('dm-bikes', { type: 'geojson', data: bikesUrl });
            map.addLayer({
              id: 'dm-bikes-points', type: 'circle', source: 'dm-bikes',
              paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 16, 7],
                'circle-color': BIKES_COLOUR,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 14, 2],
              },
            });
            map.addLayer({
              id: 'dm-bikes-hit', type: 'circle', source: 'dm-bikes',
              paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 14, 12], 'circle-color': '#000000', 'circle-opacity': 0 },
            });
            const bikeHover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'amenity-hover' });
            map.on('click', 'dm-bikes-hit', (e) => {
              if (latest.current.picking) return;
              const f = e.features?.[0];
              if (f) { bikeHover.remove(); openBikePopup(f.properties, f.geometry.coordinates); }
            });
            map.on('mouseenter', 'dm-bikes-hit', (e) => {
              map.getCanvas().style.cursor = 'pointer';
              const f = e.features?.[0];
              if (f) bikeHover.setLngLat(f.geometry.coordinates).setText(`Dublin Bikes · ${f.properties.name}`).addTo(map);
            });
            map.on('mouseleave', 'dm-bikes-hit', () => { map.getCanvas().style.cursor = ''; bikeHover.remove(); });

            // Luas stops (one point per stop, with the district it is in)
            map.addSource('dm-stops', {
              type: 'geojson',
              data: {
                type: 'FeatureCollection',
                features: profileData.stops.map((s, i) => ({ type: 'Feature', id: i, properties: { i, line: s.line }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })),
              },
            });
            map.addLayer({
              id: 'dm-stops-points', type: 'circle', source: 'dm-stops',
              paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 13, 6, 16, 8],
                'circle-color': '#ffffff',
                'circle-stroke-color': ['match', ['get', 'line'], 'Red', '#d71920', '#008531'],
                'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 3],
              },
            });
            // Invisible larger circle on top of each stop so stops are easy to click
            map.addLayer({
              id: 'dm-stops-hit', type: 'circle', source: 'dm-stops',
              paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 9, 14, 14], 'circle-color': '#000000', 'circle-opacity': 0 },
            });
            const stopHover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'amenity-hover' });
            map.on('click', 'dm-stops-hit', (e) => {
              if (latest.current.picking) return;
              const f = e.features?.[0];
              if (f) { stopHover.remove(); openStopPopup(profileData.stops[f.properties.i]); }
            });
            map.on('mouseenter', 'dm-stops-hit', (e) => {
              map.getCanvas().style.cursor = 'pointer';
              const f = e.features?.[0];
              if (f) stopHover.setLngLat(f.geometry.coordinates).setText(profileData.stops[f.properties.i].name).addTo(map);
            });
            map.on('mouseleave', 'dm-stops-hit', () => { map.getCanvas().style.cursor = ''; stopHover.remove(); });

            // Click a district to select it
            map.on('click', 'district-fill', (event) => {
              if (latest.current.picking) return; // choosing a journey start or end point
              if (map.queryRenderedFeatures(event.point, { layers: ['dm-stops-hit', 'dm-bikes-hit', 'dm-amenities-dots'] }).length) return;
              const id = event.features?.[0]?.properties?.districtId;
              if (ACTIVE_DISTRICTS.includes(id)) latest.current.onSelectDistrict(id);
            });
            map.on('mouseenter', 'district-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'district-fill', () => { map.getCanvas().style.cursor = ''; });

            // District code chips
            ALL_DISTRICTS.forEach((c) => {
              const pos = profileData.labels[c];
              if (!pos) return;
              const active = ACTIVE_DISTRICTS.includes(c);
              const node = el('button', `dm-code ${active ? '' : 'inactive'}`, c);
              node.type = 'button';
              node.title = active ? `${c} · ${profileData.profiles[c].name}` : `${c} · profile coming soon`;
              if (active) node.addEventListener('click', (e) => { e.stopPropagation(); latest.current.onSelectDistrict(c); });
              store.current.codeMarkers[c] = new maplibregl.Marker({ element: node }).setLngLat([pos[1], pos[0]]).addTo(map);
            });

            // Neighbourhood names
            ACTIVE_DISTRICTS.forEach((c) => (profileData.profiles[c].areas || []).forEach(([name, lat, lng]) => {
              store.current.areaMarkers.push(new maplibregl.Marker({ element: el('div', 'dm-area', name) }).setLngLat([lng, lat]).addTo(map));
            }));

            // Famous places
            ACTIVE_DISTRICTS.forEach((c) => {
              store.current.placeMarkers[c] = (placesByDistrict[c] || []).map((place, i) => {
                if (!place.lngLat) return null;
                const node = el('button', 'dm-place');
                node.type = 'button';
                node.dataset.district = c;
                node.dataset.index = i;
                node.style.color = strongColor(profileData.profiles[c].hue);
                const pin = el('span', 'dm-pin');
                pin.innerHTML = iconFor(place.cat);
                node.append(pin, el('span', 'dm-place-name', place.name));
                node.setAttribute('aria-label', place.name);
                node.addEventListener('mouseenter', () => { if (c === latest.current.selectedDistrict) latest.current.onHoverPlace(i); });
                node.addEventListener('mouseleave', () => latest.current.onHoverPlace(null));
                node.addEventListener('click', () => latest.current.onPlaceClick(c, i));
                const popup = new maplibregl.Popup({ offset: 24, maxWidth: '280px' }).setDOMContent(createPlacePopup(place));
                return new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat(place.lngLat).setPopup(popup).addTo(map);
              }).filter(Boolean);
            });

            readyRef.current = true;
            map.on('zoom', applyState);
            applyState();
            flyToDistrict(latest.current.selectedDistrict);
          } catch (error) {
            console.error('Could not initialise district layers:', error);
          }
        });
      } catch (error) {
        console.error('Could not initialise the 3D map:', error);
      }
    }

    initialiseMap();
    return () => {
      cancelled = true;
      readyRef.current = false;
      map?.remove();
      mapRef.current = null;
      store.current = { features: {}, codeMarkers: {}, placeMarkers: {}, areaMarkers: [], lastAmenKey: '', firstSelect: true };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  
  useEffect(() => {
    applyState();
    if (readyRef.current) {
      // close an open stop popup unless it belongs to the newly selected district
      if (store.current.stopPopupDistrict !== props.selectedDistrict) store.current.stopPopup?.remove();
      flyToDistrict(props.selectedDistrict);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedDistrict]);

  useEffect(() => { applyState(); }, [props.filter, props.showLuas, props.showBikes, props.showHeat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.querySelectorAll('.dm-place.on').forEach((n) => n.classList.remove('on'));
    if (props.hoverPlace == null) return;
    document.querySelector(`.dm-place[data-district="${props.selectedDistrict}"][data-index="${props.hoverPlace}"]`)?.classList.add('on');
  }, [props.hoverPlace, props.selectedDistrict]);

  
  useImperativeHandle(ref, () => ({
    getMap() { return mapRef.current; },
    flyToPlace(code, index) {
      const marker = store.current.placeMarkers[code]?.find((m) => Number(m.getElement().dataset.index) === index);
      if (!marker || !mapRef.current) return;
      mapRef.current.flyTo({ center: marker.getLngLat(), zoom: 15.5, pitch: 0, duration: 1200, essential: true });
      mapRef.current.once('moveend', () => { if (!marker.getPopup().isOpen()) marker.togglePopup(); });
    },
    openStop(name) {
      const stop = profileData.stops.find((s) => s.name === name);
      if (!stop || !mapRef.current) return;
      mapRef.current.flyTo({ center: [stop.lng, stop.lat], zoom: 15, duration: 1000, essential: true });
      mapRef.current.once('moveend', () => openStopPopup(stop));
    },
  }));

  return (
    <div className="district-map z-low">
      <div ref={mapContainerRef} className="district-map-canvas" aria-label="Interactive 3D map of Dublin districts" />
    </div>
  );
});

export default DistrictMap;
