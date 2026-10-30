import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import proj4 from 'proj4';
import profilesUrl from './district-profiles.json?url';
import crimeAreasUrl from './crime-heatmap.geojson?url';
import { ALL_DISTRICTS, HEAT_STOPS, ICONS, iconFor, safetyLabel, strongColor } from './DistrictMap';
import './DistrictMiniMap.css';
if (typeof window !== 'undefined' && !window.__districtExploreClicks) {
  window.__districtExploreClicks = true;
  document.addEventListener('click', (e) => {
    const target = e.target.closest?.('a, button');
    if (!target) return;
    const text = target.textContent || '';
    const m = text.match(/(?:^|[^A-Za-z0-9])D(\d{1,2})(W?)(?![0-9A-Za-z])/i);
    if (!m || !/district|profile|explore/i.test(text)) return;
    try { sessionStorage.setItem('explore-district', `D${Number(m[1])}${m[2].toUpperCase()}`); } catch { /* ignore */ }
  }, true);
}

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const EXPLORER_URL = '/districts'; // full district explorer page
const BOUNDARIES_URL = '/data/dublin_postcode_boundaries.geojson';
const LUAS_URLS = { red: '/data/luas-red-line.geojson', green: '/data/luas-green-line.geojson' };


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

// Reads the recommendation card the map sits in (e.g. "#3 D3 · Clontarf ... 22 min ... 4.1 km"),
// so each card shows its own district even if every card passes the same districtId.
function readCard(root) {
  const textOf = (node) => {
    let t = '';
    node.childNodes.forEach((c) => {
      if (c === root) return;
      if (c.nodeType === 3) t += `${c.textContent} `;
      else if (c.nodeType === 1 && !['SCRIPT', 'STYLE', 'SELECT', 'OPTION'].includes(c.tagName)) t += `${textOf(c)} `;
    });
    return t;
  };
  const placeOf = (node) => {
    // A short line like "#3 D3 · Clontarf" (the card title)
    for (const e of [node, ...node.querySelectorAll('*')]) {
      if (e === root || root.contains(e) || e.contains(root)) continue;
      const t = e.textContent.replace(/\s+/g, ' ').trim();
      if (t.length > 90) continue;
      const m = t.match(/D\d{1,2}W?\s*[·•|–-]\s*([^·•|]{2,60}?)$/);
      if (m) return m[1].trim();
    }
    return null;
  };
  let node = root.parentElement;
  for (let level = 0; node && level < 8; level += 1, node = node.parentElement) {
    const text = textOf(node).replace(/\s+/g, ' ');
    const m = text.match(/(?:^|[^A-Za-z0-9])D(\d{1,2})(W?)(?![0-9A-Za-z])/);
    if (!m) continue;
    const id = `D${Number(m[1])}${m[2].toUpperCase()}`;
    if (!ALL_DISTRICTS.includes(id)) continue;
    const mins = text.match(/(\d+(?:\.\d+)?)\s*min\b/i);
    const km = text.match(/(\d+(?:\.\d+)?)\s*km\b/i);
    return { id, mins: mins ? Number(mins[1]) : null, km: km ? Number(km[1]) : null, placeName: placeOf(node) };
  }
  return null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export default function DistrictMiniMap({ districtId: districtProp, university = 'TU Dublin - Grangegorman', place: placeProp, minutes: minutesProp, km: kmProp, height = 360, detectFromCard = true }) {
  const rootRef = useRef(null);
  const boxRef = useRef(null);
  const [card, setCard] = useState(null);
  const [ready, setReady] = useState(!detectFromCard);

  // Find the card's own district before drawing the map
  useLayoutEffect(() => {
    if (detectFromCard && rootRef.current) setCard(readCard(rootRef.current));
    setReady(true);
  }, [detectFromCard, districtProp]);

  // The card's district wins; the place and times passed in are only used when they belong to it
  const districtId = card?.id || districtProp;
  const fromProps = districtId === districtProp;
  const place = fromProps ? placeProp : (card?.placeName ? { name: card.placeName } : undefined);
  const minutes = fromProps ? (minutesProp ?? card?.mins ?? undefined) : (card?.mins ?? undefined);
  const km = fromProps ? (kmProp ?? card?.km ?? undefined) : (card?.km ?? undefined);
  const [layers, setLayers] = useState({ safety: true, luas: true, places: true, commute: true });
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);
  const mapRef = useRef(null);
  const markersRef = useRef({ places: [], commute: [] });
  // Which district is on the map: the recommended one first, others if the user picks them
  const [picked, setPicked] = useState(null); // a district the user chose from the dropdown
  const shownId = picked || districtId;
  const [names, setNames] = useState({});
  const isRecommended = shownId === districtId;

  useEffect(() => { setPicked(null); }, [districtId]);
  useEffect(() => {
    loadJson(profilesUrl).then((d) => setNames(Object.fromEntries(Object.entries(d.profiles).map(([k, v]) => [k, v.name])))).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let map;
    markersRef.current = { places: [], commute: [] };
    if (!ready || !shownId) return undefined;
    (async () => {
      try {
        const [data, boundaries] = await Promise.all([loadJson(profilesUrl), loadBoundaries()]);
        const id = shownId;
        const feature = boundaries[id];
        const profile = data.profiles[id];
        if (!feature || !profile) throw new Error(`No map data for ${id}`);
        // The recommended place and its times only belong to the recommended district
        const own = id === districtId;
        if (cancelled || !boxRef.current) return;

        const colour = strongColor(profile.hue);
        const safety = data.safety?.[id];
        const uniLngLat = UNIVERSITIES[university];
        const commute = data.commute?.[id]?.[university];
        const fromName = (own && place?.name) || commute?.center?.lm || profile.areas?.[0]?.[0];
        const namedArea = own && place?.name ? (profile.areas || []).find(([n]) => place.name.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(place.name.toLowerCase())) : null;
        const homeArea = namedArea || profile.areas?.[0];
        const fromLngLat = own && place?.lat != null ? [place.lng, place.lat] : (homeArea ? [homeArea[2], homeArea[1]] : null);
        const mins = (own ? minutes : null) ?? commute?.center?.min;
        const dist = (own ? km : null) ?? commute?.center?.km;
        setInfo({ colour, safety, profile, fromName, mins, dist });

        const bounds = new maplibregl.LngLatBounds();
        outerRings(feature.geometry).forEach((ring) => ring.forEach((c) => bounds.extend(c)));

        map = new maplibregl.Map({
          container: boxRef.current,
          style: MAP_STYLE,
          bounds,
          fitBoundsOptions: { padding: 20 },
          attributionControl: { compact: true },
          cooperativeGestures: true, // page scrolls normally; Ctrl + scroll zooms the map
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        map.on('load', () => {
          if (cancelled) return;
          // Hide everything outside the district
          const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
          map.addSource('mm-mask', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, ...outerRings(feature.geometry)] } } });
          map.addLayer({ id: 'mm-mask', type: 'fill', source: 'mm-mask', paint: { 'fill-color': '#e9efe4', 'fill-opacity': 1 } });

          // Lock the view to this district: no zooming out, no panning away
          map.fitBounds(bounds, { padding: 20, duration: 0 });
          map.setMinZoom(map.getZoom());
          // Allowed area = the starting view plus a little room, so the whole district always fits
          const view = map.getBounds();
          const sw = view.getSouthWest();
          const ne = view.getNorthEast();
          const padLng = (ne.lng - sw.lng) * 0.1;
          const padLat = (ne.lat - sw.lat) * 0.1;
          map.setMaxBounds([[sw.lng - padLng, sw.lat - padLat], [ne.lng + padLng, ne.lat + padLat]]);

          // Safety areas inside the district
          const heatColour = ['interpolate', ['linear'], ['get', 'score']];
          HEAT_STOPS.forEach(([v, c]) => heatColour.push(v, c));
          map.addSource('mm-crime', { type: 'geojson', data: crimeAreasUrl });
          map.addLayer({ id: 'mm-crime', type: 'fill', source: 'mm-crime', filter: ['==', ['get', 'd'], id], paint: { 'fill-color': heatColour, 'fill-opacity': 0.45 } });
          map.addLayer({ id: 'mm-crime-line', type: 'line', source: 'mm-crime', filter: ['==', ['get', 'd'], id], paint: { 'line-color': '#ffffff', 'line-width': 0.8 } });
          const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'amenity-hover' });
          map.on('mousemove', 'mm-crime', (e) => {
            const p = e.features?.[0]?.properties;
            if (!p) return;
            hover.setLngLat(e.lngLat).setHTML(`<b>${p.ed}</b><br>Safety ${Number(p.score).toFixed(0)} / 100 · ${safetyLabel(Number(p.score))}`).addTo(map);
          });
          map.on('mouseleave', 'mm-crime', () => hover.remove());

          
          map.addSource('mm-district', { type: 'geojson', data: feature });
          map.addLayer({ id: 'mm-district', type: 'line', source: 'mm-district', paint: { 'line-color': colour, 'line-width': 3 } });

          
          [['red', '#d71920', 'Luas Red Line'], ['green', '#008531', 'Luas Green Line']].forEach(([k, c, ref]) => {
            map.addSource(`mm-luas-${k}`, { type: 'geojson', data: LUAS_URLS[k] });
            map.addLayer({ id: `mm-luas-${k}`, type: 'line', source: `mm-luas-${k}`, filter: ['==', ['get', 'ref'], ref], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c, 'line-width': 4 } });
          });
          // Cover the Luas lines outside the district, then put the outline back on top
          map.addLayer({ id: 'mm-mask-top', type: 'fill', source: 'mm-mask', paint: { 'fill-color': '#e9efe4', 'fill-opacity': 1 } });
          map.moveLayer('mm-district');
          const stops = data.stops.filter((s) => s.d === id);
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

         
          if (fromLngLat) {
            const timeText = `${mins != null ? `${Math.round(mins)} min` : ''}${dist != null ? `${mins != null ? ' · ' : ''}${Number(dist).toFixed(1)} km` : ''}`;
            const home = el('div', 'mm-pin mm-home');
            home.innerHTML = ICONS.village;
            home.title = fromName;
            const markers = [
              new maplibregl.Marker({ element: home }).setLngLat(fromLngLat).setPopup(new maplibregl.Popup({ offset: 18 }).setText(own ? `Recommended: ${fromName}` : fromName)).addTo(map),
            ];
            const uniInside = uniLngLat && bounds.contains(uniLngLat);
            if (uniInside) {
              // Campus is in this district: draw the line to it
              map.addSource('mm-commute', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [fromLngLat, uniLngLat] } } });
              map.addLayer({ id: 'mm-commute', type: 'line', source: 'mm-commute', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#214b39', 'line-width': 3, 'line-dasharray': [1.5, 1.5] } });
              const uni = el('div', 'mm-pin mm-uni');
              uni.innerHTML = ICONS.university;
              uni.title = university;
              markers.push(new maplibregl.Marker({ element: uni }).setLngLat(uniLngLat).setPopup(new maplibregl.Popup({ offset: 18 }).setText(university)).addTo(map));
              if (timeText) {
                const mid = [(fromLngLat[0] + uniLngLat[0]) / 2, (fromLngLat[1] + uniLngLat[1]) / 2];
                markers.push(new maplibregl.Marker({ element: el('div', 'mm-commute-label', timeText), anchor: 'bottom', offset: [0, -10] }).setLngLat(mid).addTo(map));
              }
            } else if (timeText) {
              // Campus is outside this district: show the time next to the home pin
              markers.push(new maplibregl.Marker({ element: el('div', 'mm-commute-label', `${timeText} to campus`), anchor: 'left', offset: [20, 0] }).setLngLat(fromLngLat).addTo(map));
            }
            markersRef.current.commute = markers;
          }
          applyLayers();
        });
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; map?.remove(); mapRef.current = null; };
  }, [ready, shownId, districtId, university, place?.lat, place?.lng, place?.name, minutes, km]); // eslint-disable-line react-hooks/exhaustive-deps

  
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const applyLayers = () => {
    const map = mapRef.current;
    if (!map) return;
    const l = layersRef.current;
    const vis = (on) => (on ? 'visible' : 'none');
    ['mm-crime', 'mm-crime-line'].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(l.safety)));
    ['mm-luas-red', 'mm-luas-green', 'mm-stops', 'mm-stops-hit'].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(l.luas)));
    if (map.getLayer('mm-commute')) map.setLayoutProperty('mm-commute', 'visibility', vis(l.commute));
    markersRef.current.places.forEach((m) => { m.getElement().style.display = l.places ? '' : 'none'; });
    markersRef.current.commute.forEach((m) => { m.getElement().style.display = l.commute ? '' : 'none'; });
  };
  useEffect(applyLayers, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  const pick = (code) => { setError(''); setInfo(null); setPicked(code === districtId ? null : code); };

  return (
    <div className="mini-map" ref={rootRef}>
      <div className="mini-map-explore">
        <label>
          <span>{isRecommended ? 'Recommended district' : 'Exploring'}</span>
          <select value={shownId} onChange={(e) => pick(e.target.value)}>
            {ALL_DISTRICTS.map((c) => (
              <option key={c} value={c}>{c}{names[c] ? ` · ${names[c]}` : ''}{c === districtId ? ' (recommended)' : ''}</option>
            ))}
          </select>
        </label>
        {!isRecommended && (
          <button type="button" className="mini-map-back" onClick={() => pick(districtId)}>← Back to {districtId}</button>
        )}
        <a className="mini-map-full" href={`${EXPLORER_URL}?district=${encodeURIComponent(shownId)}`}>Full {shownId} profile ↗</a>
      </div>
      <div className="mini-map-toolbar">
        {[['safety', 'Safety'], ['luas', 'Luas'], ['places', 'Places to know'], ['commute', 'Commute']].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={layers[k]} onClick={() => toggle(k)}>{l}</button>
        ))}
      </div>
      <div className="mini-map-box" style={{ height }}>
        <div key={shownId} ref={boxRef} className="mini-map-canvas" />
        {error && <p className="mini-map-error">Map unavailable: {error}</p>}
        {info?.safety && (
          <div className="mini-map-badge">
            {isRecommended && <span className="mini-map-tag">Recommended</span>}
            <b>{shownId}</b> safety <strong>{Math.round(info.safety.score)}</strong>/100
          </div>
        )}
      </div>
      {info && (
        <div className="mini-map-legend">
          {layers.safety && (
            <span><i className="mini-heat" style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.map(([, c]) => c).join(', ')})` }} />More crime → less crime</span>
          )}
          {layers.luas && <span><i className="legend-line red-line" /><i className="legend-line green-line" />Luas (click a stop)</span>}
          {layers.commute && info.fromName && <span><i className="mm-legend-home" />{info.fromName} → {university}{info.mins != null ? ` · ${Math.round(info.mins)} min` : ''}{info.dist != null ? ` · ${Number(info.dist).toFixed(1)} km` : ''}</span>}
        </div>
      )}
    </div>
  );
}
