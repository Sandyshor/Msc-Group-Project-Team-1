import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import proj4 from 'proj4';
import profilesUrl from './district-profiles.json?url';
import crimeAreasUrl from './crime-heatmap.geojson?url';
import { HEAT_STOPS, ICONS, iconFor, safetyLabel, strongColor } from './DistrictMap';
import './DistrictMiniMap.css';

// Small map for one recommendation: only the chosen district, zoomed in, with
// neighbourhood names, safety areas, Luas, famous places and the commute line.
//
// Usage:
// <DistrictMiniMap
//   districtId="D1"
//   university="TU Dublin - Grangegorman"
//   place={{ name: "O'Connell Street Upper", lat: 53.3505, lng: -6.2605 }}
//   minutes={15} km={1.8}
// />

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const BOUNDARIES_URL = '/data/dublin_postcode_boundaries.geojson';
const LUAS_URLS = { red: '/data/luas-red-line.geojson', green: '/data/luas-green-line.geojson' };

// Approximate main entrance of each campus [lng, lat]
const UNIVERSITIES = {
  "DCU - St Patrick's Campus": [-6.2557, 53.3708],
  'Dublin Business School': [-6.2654, 53.3384],
  'Dublin City University - Glasnevin': [-6.2569, 53.3856],
  'Griffith College Dublin': [-6.2786, 53.3317],
  'IADT - Dun Laoghaire': [-6.1530, 53.2810],
  'National College of Art and Design': [-6.2793, 53.3424],
  'National College of Ireland - IFSC': [-6.2433, 53.3491],
  'Royal College of Surgeons Ireland': [-6.2622, 53.3390],
  'TU Dublin - Aungier Street': [-6.2668, 53.3385],
  'TU Dublin - Blanchardstown': [-6.3780, 53.4050],
  'TU Dublin - Bolton Street': [-6.2706, 53.3518],
  'TU Dublin - Grangegorman': [-6.2790, 53.3555],
  'TU Dublin - Tallaght': [-6.3605, 53.2915],
  'Trinity College Dublin': [-6.2546, 53.3438],
  'University College Dublin - Belfield': [-6.2210, 53.3065],
};

// Load shared files once, however many mini maps are on the page
const cache = {};
const loadJson = (url) => {
  if (!cache[url]) cache[url] = fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} (${r.status})`); return r.json(); });
  return cache[url];
};
function loadBoundaries() {
  if (!cache.boundaries) {
    proj4.defs('EPSG:2157', '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +units=m +no_defs');
    const convert = (c) => (typeof c[0] === 'number' ? proj4('EPSG:2157', 'EPSG:4326', c) : c.map(convert));
    cache.boundaries = loadJson(BOUNDARIES_URL).then((raw) => {
      const byId = {};
      raw.features.forEach((f) => {
        const m = String(f.properties?.postcodes ?? '').trim().match(/^Dublin\s*(\d{1,2}W?)$/i);
        if (m) byId[`D${m[1].toUpperCase()}`] = { ...f, geometry: { ...f.geometry, coordinates: convert(f.geometry.coordinates) } };
      });
      return byId;
    });
  }
  return cache.boundaries;
}

const outerRings = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((p) => p[0]));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export default function DistrictMiniMap({ districtId, university = 'TU Dublin - Grangegorman', place, minutes, km, height = 360 }) {
  const boxRef = useRef(null);
  const [layers, setLayers] = useState({ safety: true, luas: true, places: true, commute: true });
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);
  const mapRef = useRef(null);
  const markersRef = useRef({ places: [], commute: [] });

  useEffect(() => {
    let cancelled = false;
    let map;
    (async () => {
      try {
        const [data, boundaries] = await Promise.all([loadJson(profilesUrl), loadBoundaries()]);
        const feature = boundaries[districtId];
        const profile = data.profiles[districtId];
        if (!feature || !profile) throw new Error(`No map data for ${districtId}`);
        if (cancelled || !boxRef.current) return;

        const colour = strongColor(profile.hue);
        const safety = data.safety?.[districtId];
        const uniLngLat = UNIVERSITIES[university];
        const commute = data.commute?.[districtId]?.[university];
        const fromName = place?.name || commute?.center?.lm || profile.areas?.[0]?.[0];
        const fromLngLat = place?.lat != null ? [place.lng, place.lat] : (profile.areas?.[0] ? [profile.areas[0][2], profile.areas[0][1]] : null);
        const mins = minutes ?? commute?.center?.min;
        const dist = km ?? commute?.center?.km;
        setInfo({ colour, safety, profile, fromName, mins, dist });

        const bounds = new maplibregl.LngLatBounds();
        outerRings(feature.geometry).forEach((ring) => ring.forEach((c) => bounds.extend(c)));

        map = new maplibregl.Map({
          container: boxRef.current,
          style: MAP_STYLE,
          bounds,
          fitBoundsOptions: { padding: 30 },
          attributionControl: { compact: true },
          cooperativeGestures: true, // page scrolls normally; Ctrl + scroll zooms the map
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        map.on('load', () => {
          if (cancelled) return;
          // Grey out everything outside the district
          const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
          map.addSource('mm-mask', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, ...outerRings(feature.geometry)] } } });
          map.addLayer({ id: 'mm-mask', type: 'fill', source: 'mm-mask', paint: { 'fill-color': '#f1f5ef', 'fill-opacity': 0.72 } });

          // Safety areas inside the district
          const heatColour = ['interpolate', ['linear'], ['get', 'score']];
          HEAT_STOPS.forEach(([v, c]) => heatColour.push(v, c));
          map.addSource('mm-crime', { type: 'geojson', data: crimeAreasUrl });
          map.addLayer({ id: 'mm-crime', type: 'fill', source: 'mm-crime', filter: ['==', ['get', 'd'], districtId], paint: { 'fill-color': heatColour, 'fill-opacity': 0.45 } });
          map.addLayer({ id: 'mm-crime-line', type: 'line', source: 'mm-crime', filter: ['==', ['get', 'd'], districtId], paint: { 'line-color': '#ffffff', 'line-width': 0.8 } });
          const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'amenity-hover' });
          map.on('mousemove', 'mm-crime', (e) => {
            const p = e.features?.[0]?.properties;
            if (!p) return;
            hover.setLngLat(e.lngLat).setHTML(`<b>${p.ed}</b><br>Safety ${Number(p.score).toFixed(0)} / 100 · ${safetyLabel(Number(p.score))}`).addTo(map);
          });
          map.on('mouseleave', 'mm-crime', () => hover.remove());

          // District outline
          map.addSource('mm-district', { type: 'geojson', data: feature });
          map.addLayer({ id: 'mm-district', type: 'line', source: 'mm-district', paint: { 'line-color': colour, 'line-width': 3 } });

          // Luas lines and the stops inside this district
          [['red', '#d71920', 'Luas Red Line'], ['green', '#008531', 'Luas Green Line']].forEach(([k, c, ref]) => {
            map.addSource(`mm-luas-${k}`, { type: 'geojson', data: LUAS_URLS[k] });
            map.addLayer({ id: `mm-luas-${k}`, type: 'line', source: `mm-luas-${k}`, filter: ['==', ['get', 'ref'], ref], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c, 'line-width': 4 } });
          });
          const stops = data.stops.filter((s) => s.d === districtId);
          map.addSource('mm-stops', { type: 'geojson', data: { type: 'FeatureCollection', features: stops.map((s, i) => ({ type: 'Feature', properties: { i, line: s.line }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })) } });
          map.addLayer({ id: 'mm-stops', type: 'circle', source: 'mm-stops', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-width': 3, 'circle-stroke-color': ['match', ['get', 'line'], 'Red', '#d71920', '#008531'] } });
          map.addLayer({ id: 'mm-stops-hit', type: 'circle', source: 'mm-stops', paint: { 'circle-radius': 13, 'circle-opacity': 0 } });
          map.on('click', 'mm-stops-hit', (e) => {
            const s = stops[e.features?.[0]?.properties?.i];
            if (!s) return;
            const ln = data.lines[s.line.toLowerCase()] || {};
            const box = el('div', 'stop-popup');
            box.append(el('span', `stop-line ${s.line.toLowerCase()}`, `${s.line} Line`), el('h3', null, s.name));
            if (ln.interval) box.append(el('p', 'stop-heading', `Every ${ln.peak || ln.interval} min at peak`));
            new maplibregl.Popup({ offset: 10 }).setLngLat([s.lng, s.lat]).setDOMContent(box).addTo(map);
          });
          map.on('mouseenter', 'mm-stops-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', 'mm-stops-hit', () => { map.getCanvas().style.cursor = ''; });

          // Neighbourhood names
          (profile.areas || []).forEach(([name, lat, lng]) => new maplibregl.Marker({ element: el('div', 'dm-area mm-area', name) }).setLngLat([lng, lat]).addTo(map));

          // Famous places
          markersRef.current.places = (profile.places || []).map(([name, cat, desc, lat, lng]) => {
            const node = el('button', 'dm-place small');
            node.type = 'button';
            node.style.color = colour;
            const pin = el('span', 'dm-pin');
            pin.innerHTML = iconFor(cat);
            node.append(pin);
            node.setAttribute('aria-label', name);
            const pop = el('div', 'landmark-popup');
            pop.append(el('h3', null, name), el('p', null, desc));
            return new maplibregl.Marker({ element: node }).setLngLat([lng, lat]).setPopup(new maplibregl.Popup({ offset: 16 }).setDOMContent(pop)).addTo(map);
          });

          // Commute: recommended place → university
          if (fromLngLat && uniLngLat) {
            map.addSource('mm-commute', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [fromLngLat, uniLngLat] } } });
            map.addLayer({ id: 'mm-commute', type: 'line', source: 'mm-commute', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#214b39', 'line-width': 3, 'line-dasharray': [1.5, 1.5] } });
            const home = el('div', 'mm-pin mm-home');
            home.innerHTML = ICONS.village;
            home.title = fromName;
            const uni = el('div', 'mm-pin mm-uni');
            uni.innerHTML = ICONS.university;
            uni.title = university;
            const mid = [(fromLngLat[0] + uniLngLat[0]) / 2, (fromLngLat[1] + uniLngLat[1]) / 2];
            const label = el('div', 'mm-commute-label', `${mins != null ? `${Math.round(mins)} min` : ''}${dist != null ? ` · ${Number(dist).toFixed(1)} km` : ''}`);
            markersRef.current.commute = [
              new maplibregl.Marker({ element: home }).setLngLat(fromLngLat).setPopup(new maplibregl.Popup({ offset: 18 }).setText(`Recommended: ${fromName}`)).addTo(map),
              new maplibregl.Marker({ element: uni }).setLngLat(uniLngLat).setPopup(new maplibregl.Popup({ offset: 18 }).setText(university)).addTo(map),
              ...(mins != null || dist != null ? [new maplibregl.Marker({ element: label, anchor: 'bottom', offset: [0, -10] }).setLngLat(mid).addTo(map)] : []),
            ];
            const all = new maplibregl.LngLatBounds(bounds.getSouthWest(), bounds.getNorthEast());
            all.extend(uniLngLat);
            map.fitBounds(all, { padding: 36, duration: 0 });
          }
        });
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; map?.remove(); mapRef.current = null; };
  }, [districtId, university, place?.lat, place?.lng, place?.name, minutes, km]);

  // Show or hide layers when the buttons are clicked
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const vis = (on) => (on ? 'visible' : 'none');
    ['mm-crime', 'mm-crime-line'].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(layers.safety)));
    ['mm-luas-red', 'mm-luas-green', 'mm-stops', 'mm-stops-hit'].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(layers.luas)));
    if (map.getLayer('mm-commute')) map.setLayoutProperty('mm-commute', 'visibility', vis(layers.commute));
    markersRef.current.places.forEach((m) => { m.getElement().style.display = layers.places ? '' : 'none'; });
    markersRef.current.commute.forEach((m) => { m.getElement().style.display = layers.commute ? '' : 'none'; });
  }, [layers]);

  const toggle = (k) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  if (error) return <p className="empty-note">Map unavailable: {error}</p>;

  return (
    <div className="mini-map">
      <div className="mini-map-toolbar">
        {[['safety', 'Safety'], ['luas', 'Luas'], ['places', 'Places to know'], ['commute', 'Commute']].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={layers[k]} onClick={() => toggle(k)}>{l}</button>
        ))}
      </div>
      <div className="mini-map-box" style={{ height }}>
        <div ref={boxRef} className="mini-map-canvas" />
        {info?.safety && (
          <div className="mini-map-badge">
            <b>{districtId}</b> safety <strong>{Math.round(info.safety.score)}</strong>/100
          </div>
        )}
      </div>
      {info && (
        <div className="mini-map-legend">
          {layers.safety && (
            <span><i className="mini-heat" style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.map(([, c]) => c).join(', ')})` }} />More crime → less crime</span>
          )}
          {layers.luas && <span><i className="legend-line red-line" /><i className="legend-line green-line" />Luas (click a stop)</span>}
          {layers.commute && info.fromName && <span><i className="mini-dash" />{info.fromName} → {university}</span>}
        </div>
      )}
    </div>
  );
}
