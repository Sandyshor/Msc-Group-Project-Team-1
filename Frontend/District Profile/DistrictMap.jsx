import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import proj4 from 'proj4';
import boundariesUrl from './data/dublin_postcode_boundaries.geojson?url';
import luasRedUrl from './data/luas-red-line.geojson?url';
import luasGreenUrl from './data/luas-green-line.geojson?url';
import crimeAreasUrl from './data/crime-heatmap.geojson?url';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const ALL_DISTRICTS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D6W', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12',
  'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D20', 'D22', 'D24'];


export const ACTIVE_DISTRICTS = ALL_DISTRICTS;


export const HEAT_STOPS = [
  [20, '#7f0000'],
  [32, '#d7301f'],
  [45, '#fc8d59'],
  [58, '#fdd49e'],
  [75, '#fff7ec'],
];
export const safetyLabel = (score) => {
  if (score >= 65) return 'Safer than most of Dublin';
  if (score >= 55) return 'Safer than average';
  if (score >= 45) return 'About the Dublin average';
  if (score >= 35) return 'Below the Dublin average';
  return 'Well below the Dublin average';
};
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
const ZOOM_AMENITIES = 14.5; // amenity dots appear without opening the Amenities tab

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

const DistrictMap = forwardRef(function DistrictMap(props, ref) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const store = useRef({ features: {}, codeMarkers: {}, placeMarkers: {}, areaMarkers: [], lastAmenKey: '', firstSelect: true });

  const { profileData, placesByDistrict } = props;

  
  function applyState() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const { selectedDistrict: sel, filter, showLuas, showAmenities, hiddenAmenities, showHeat } = latest.current;
    const profiles = profileData.profiles;
    const visible = ACTIVE_DISTRICTS.filter((c) => filter === 'all' || profiles[c]?.side === filter);
    const zoom = map.getZoom();

    
    const colorMatch = ['match', ['get', 'districtId']];
    ACTIVE_DISTRICTS.forEach((c) => colorMatch.push(c, c === sel ? strongColor(profiles[c].hue) : pastelColor(profiles[c].hue)));
    colorMatch.push('#cfd8cc');
    const isSel = ['==', ['get', 'districtId'], sel];
    const isVisible = ['in', ['get', 'districtId'], ['literal', visible]];
    map.setPaintProperty('district-fill', 'fill-color', colorMatch);
    
    map.setPaintProperty('district-fill', 'fill-opacity', showHeat
      ? ['case', isSel, 0.12, 0]
      : ['interpolate', ['linear'], ['zoom'],
        11, ['case', isSel, 0.5, isVisible, 0.55, 0.12],
        14.5, ['case', isSel, 0.18, isVisible, 0.12, 0.03]]);
    ['dm-crime-heat', 'dm-crime-areas', 'dm-crime-lines'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showHeat ? 'visible' : 'none');
    });
    map.setPaintProperty('district-outline', 'line-color', ['case', isSel, strongColor(profiles[sel].hue), '#ffffff']);
    map.setPaintProperty('district-outline', 'line-width', ['case', isSel, 4, 1.5]);

    
    Object.entries(store.current.codeMarkers).forEach(([c, m]) => {
      const node = m.getElement();
      if (!ACTIVE_DISTRICTS.includes(c)) return;
      node.style.background = strongColor(profiles[c].hue);
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

    
    const centre = profileData.labels[sel];
    const spokeFeatures = (placesByDistrict[sel] || []).filter((p) => p.lngLat).map((p) => ({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[centre[1], centre[0]], p.lngLat] },
    }));
    map.getSource('dm-spokes')?.setData({ type: 'FeatureCollection', features: spokeFeatures });
    map.setPaintProperty('dm-spokes-line', 'line-color', strongColor(profiles[sel].hue));

    
    if (store.current.lastAmenKey !== sel) {
      store.current.lastAmenKey = sel;
      const pts = profileData.amenities[sel] || [];
      map.getSource('dm-amenities')?.setData({
        type: 'FeatureCollection',
        features: pts.map(([name, cat, lat, lng]) => ({ type: 'Feature', properties: { name, cat }, geometry: { type: 'Point', coordinates: [lng, lat] } })),
      });
    }
    map.setFilter('dm-amenities-dots', ['!', ['in', ['get', 'cat'], ['literal', [...hiddenAmenities]]]]);
    map.setLayoutProperty('dm-amenities-dots', 'visibility', showAmenities || zoom >= ZOOM_AMENITIES ? 'visible' : 'none');

   
    ['luas-red-route-line', 'luas-green-route-line', 'dm-stops-points', 'dm-stops-hit'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showLuas ? 'visible' : 'none');
    });

   
    const box = mapContainerRef.current?.parentElement;
    if (box) {
      box.classList.toggle('z-low', zoom < ZOOM_AREAS);
      box.classList.toggle('z-high', zoom >= ZOOM_ALL_PLACES);
    }
  }

  function flyToDistrict(code) {
    const feature = store.current.features[code];
    const bounds = feature && getGeometryBounds(feature.geometry);
    if (bounds) mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 14, pitch: 45, bearing: -12, duration: 1300 });
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

 
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return undefined;
    let cancelled = false;
    let map;

    async function initialiseMap() {
      try {
        proj4.defs('EPSG:2157', '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +units=m +no_defs');
        const response = await fetch('/data/dublin_postcode_boundaries.geojson');
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
          pitch: 45,
          bearing: -12,
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

            
            const heatColour = ['interpolate', ['linear'], ['get', 'score']];
            HEAT_STOPS.forEach(([v, c]) => heatColour.push(v, c));
            map.addSource('dm-crime-points', {
              type: 'geojson',
              data: {
                type: 'FeatureCollection',
                features: (profileData.heatPoints || []).map(([lng, lat, score]) => ({
                  type: 'Feature', properties: { w: Math.max(0, Math.min(1, (80 - score) / 60)) }, geometry: { type: 'Point', coordinates: [lng, lat] },
                })),
              },
            });
            map.addLayer({
              id: 'dm-crime-heat', type: 'heatmap', source: 'dm-crime-points', maxzoom: 13.5, layout: { visibility: 'none' },
              paint: {
                'heatmap-weight': ['get', 'w'],
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 13, 1.6],
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 18, 11, 34, 13, 60],
                'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(255,247,236,0)', 0.15, 'rgba(253,212,158,0.55)', 0.35, '#fdbb84', 0.55, '#fc8d59', 0.75, '#d7301f', 1, '#7f0000'],
                'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.85, 13.5, 0],
              },
            });
            map.addSource('dm-crime-areas', { type: 'geojson', data: '/data/crime-heatmap.geojson' });
            map.addLayer({
              id: 'dm-crime-areas', type: 'fill', source: 'dm-crime-areas', minzoom: 11.5, layout: { visibility: 'none' },
              paint: { 'fill-color': heatColour, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0, 13, 0.6, 16, 0.4] },
            });
            map.addLayer({
              id: 'dm-crime-lines', type: 'line', source: 'dm-crime-areas', minzoom: 12.5, layout: { visibility: 'none' },
              paint: { 'line-color': '#ffffff', 'line-width': 0.6, 'line-opacity': 0.7 },
            });
            const crimeHover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'amenity-hover' });
            map.on('mousemove', 'dm-crime-areas', (e) => {
              const f = e.features?.[0];
              if (!f || map.queryRenderedFeatures(e.point, { layers: ['dm-stops-hit', 'dm-amenities-dots'] }).length) { crimeHover.remove(); return; }
              const p = f.properties;
              crimeHover.setLngLat(e.lngLat).setHTML(`<b>${p.ed}</b> · ${p.d}<br>Safety score ${Number(p.score).toFixed(0)} / 100<br><small>${safetyLabel(Number(p.score))}</small>`).addTo(map);
            });
            map.on('mouseleave', 'dm-crime-areas', () => crimeHover.remove());

            map.addSource('dm-spokes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'dm-spokes-line', type: 'line', source: 'dm-spokes', paint: { 'line-width': 1.6, 'line-dasharray': [2, 3], 'line-opacity': 0.85 } });

            
            [['red', '#d71920', 'Luas Red Line'], ['green', '#008531', 'Luas Green Line']].forEach(([k, colour, ref]) => {
              map.addSource(`luas-${k}-route`, { type: 'geojson', data: `/data/luas-${k}-line.geojson` });
              map.addLayer({
                id: `luas-${k}-route-line`, type: 'line', source: `luas-${k}-route`,
                filter: ['all', ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']], ['==', ['get', 'ref'], ref]],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': colour, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 12, 4, 15, 6] },
              });
            });

           
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
            
            map.addLayer({
              id: 'dm-stops-hit', type: 'circle', source: 'dm-stops',
              paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 9, 14, 14], 'circle-color': '#000000', 'circle-opacity': 0 },
            });
            const stopHover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'amenity-hover' });
            map.on('click', 'dm-stops-hit', (e) => {
              const f = e.features?.[0];
              if (f) { stopHover.remove(); openStopPopup(profileData.stops[f.properties.i]); }
            });
            map.on('mouseenter', 'dm-stops-hit', (e) => {
              map.getCanvas().style.cursor = 'pointer';
              const f = e.features?.[0];
              if (f) stopHover.setLngLat(f.geometry.coordinates).setText(profileData.stops[f.properties.i].name).addTo(map);
            });
            map.on('mouseleave', 'dm-stops-hit', () => { map.getCanvas().style.cursor = ''; stopHover.remove(); });

           
            map.on('click', 'district-fill', (event) => {
              if (map.queryRenderedFeatures(event.point, { layers: ['dm-stops-hit', 'dm-amenities-dots'] }).length) return;
              const id = event.features?.[0]?.properties?.districtId;
              if (ACTIVE_DISTRICTS.includes(id)) latest.current.onSelectDistrict(id);
            });
            map.on('mouseenter', 'district-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'district-fill', () => { map.getCanvas().style.cursor = ''; });

            
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

  // ---------- react to state changes ----------
  useEffect(() => {
    applyState();
    if (readyRef.current) {
      // close an open stop popup unless it belongs to the newly selected district
      if (store.current.stopPopupDistrict !== props.selectedDistrict) store.current.stopPopup?.remove();
      flyToDistrict(props.selectedDistrict);
    }
  
  }, [props.selectedDistrict]);

  useEffect(() => { applyState(); }, [props.filter, props.showLuas, props.showAmenities, props.hiddenAmenities, props.showHeat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.querySelectorAll('.dm-place.on').forEach((n) => n.classList.remove('on'));
    if (props.hoverPlace == null) return;
    document.querySelector(`.dm-place[data-district="${props.selectedDistrict}"][data-index="${props.hoverPlace}"]`)?.classList.add('on');
  }, [props.hoverPlace, props.selectedDistrict]);


  useImperativeHandle(ref, () => ({
    flyToPlace(code, index) {
      const marker = store.current.placeMarkers[code]?.find((m) => Number(m.getElement().dataset.index) === index);
      if (!marker || !mapRef.current) return;
      mapRef.current.flyTo({ center: marker.getLngLat(), zoom: 15.5, pitch: 55, duration: 1200, essential: true });
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
      {props.showHeat && (
        <div className="heat-legend" aria-label="Crime heat map legend">
          <b>Crime heat map</b>
          <span className="heat-bar" style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.map(([, c]) => c).join(', ')})` }} />
          <span className="heat-scale"><span>More crime</span><span>Less crime</span></span>
          <small>Robbery and public order offences, 2023–2025. Zoom in for neighbourhood areas.</small>
        </div>
      )}
    </div>
  );
});

export default DistrictMap;
