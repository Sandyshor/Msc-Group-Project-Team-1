import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { decodePolyline, legColor } from './journey';


const EMPTY = { type: 'FeatureCollection', features: [] };

function pin(label, cls) {
  const node = document.createElement('div');
  node.className = 'jr-pin-wrap';
  const shape = document.createElement('div');
  shape.className = `jr-pin ${cls}`;
  const text = document.createElement('span');
  text.textContent = label;
  shape.append(text);
  node.append(shape);
  return node;
}

export default function JourneyLayer({ mapApi, active, from, to, itineraries, selected, picking, onPick }) {
  const pins = useRef({ from: null, to: null });
  const ready = useRef(false);
  const pickRef = useRef({ picking, onPick });
  pickRef.current = { picking, onPick };

  useEffect(() => {
    let timer;
    let mapRef;
    const onClick = (e) => {
      const { picking: which, onPick: cb } = pickRef.current;
      if (which) cb(which, { lng: e.lngLat.lng, lat: e.lngLat.lat, label: 'Point on the map' });
    };
    const setup = () => {
      const map = mapApi.current?.getMap?.();
      if (!map || !map.isStyleLoaded() || !map.getLayer('district-fill')) { timer = setTimeout(setup, 300); return; }
      mapRef = map;
      if (!map.getSource('jr-alt')) {
        map.addSource('jr-alt', { type: 'geojson', data: EMPTY });
        map.addSource('jr-route', { type: 'geojson', data: EMPTY });
        map.addLayer({ id: 'jr-alt-line', type: 'line', source: 'jr-alt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8d9a93', 'line-width': 5, 'line-opacity': 0.6 } });
        map.addLayer({ id: 'jr-route-casing', type: 'line', source: 'jr-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['case', ['get', 'walk'], 8, 11] } });
        map.addLayer({ id: 'jr-route-line', type: 'line', source: 'jr-route', filter: ['!', ['get', 'walk']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
        map.addLayer({ id: 'jr-route-walk', type: 'line', source: 'jr-route', filter: ['get', 'walk'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': [0.1, 2] } });
      }
      map.on('click', onClick);
      ready.current = true;
      draw();
    };
    setup();
    return () => { clearTimeout(timer); mapRef?.off('click', onClick); };
  }, [mapApi]); // eslint-disable-line react-hooks/exhaustive-deps

  function draw() {
    const map = mapApi.current?.getMap?.();
    if (!map || !ready.current || !map.getSource('jr-route')) return;
    const show = active;
    
    [['from', 'A', 'jr-from', from], ['to', 'B', 'jr-to', to]].forEach(([k, label, cls, p]) => {
      if (show && p) {
        if (!pins.current[k]) pins.current[k] = new maplibregl.Marker({ element: pin(label, cls), anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map);
        pins.current[k].setLngLat([p.lng, p.lat]);
        pins.current[k].getElement().title = p.label || '';
      } else if (pins.current[k]) { pins.current[k].remove(); pins.current[k] = null; }
    });
    // Routes
    const list = show ? itineraries || [] : [];
    const chosen = list[selected];
    const legs = chosen ? chosen.legs.map((leg) => ({ leg, pts: decodePolyline(leg.geometry) })).filter((x) => x.pts.length > 1) : [];
    map.getSource('jr-route').setData({
      type: 'FeatureCollection',
      features: legs.map(({ leg, pts }) => ({ type: 'Feature', properties: { color: legColor(leg), walk: leg.mode === 'WALK' }, geometry: { type: 'LineString', coordinates: pts } })),
    });
    map.getSource('jr-alt').setData({
      type: 'FeatureCollection',
      features: list.filter((_, i) => i !== selected).flatMap((it) => it.legs.map((leg) => decodePolyline(leg.geometry)).filter((p) => p.length > 1)
        .map((pts) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }))),
    });
    
    ['jr-alt-line', 'jr-route-casing', 'jr-route-line', 'jr-route-walk'].forEach((id) => map.getLayer(id) && map.moveLayer(id));
    if (legs.length) {
      const b = new maplibregl.LngLatBounds();
      legs.forEach(({ pts }) => pts.forEach((p) => b.extend(p)));
      map.fitBounds(b, { padding: 70, maxZoom: 15, duration: 900 });
    }
  }

  useEffect(draw, [active, from?.lng, from?.lat, to?.lng, to?.lat, itineraries, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  
  useEffect(() => {
    const map = mapApi.current?.getMap?.();
    if (map) map.getCanvas().style.cursor = picking ? 'crosshair' : '';
  }, [picking]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { Object.values(pins.current).forEach((m) => m?.remove()); }, []);

  return null;
}
