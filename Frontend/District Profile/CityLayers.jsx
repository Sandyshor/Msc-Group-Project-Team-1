import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { universities, attractions, mapIconPaths } from './cityPlaces';
import './CityLayers.css';



function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const iconSvg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${(mapIconPaths[name] || mapIconPaths.school).map((d) => `<path d="${d}"/>`).join('')}</svg>`;

function popupFor(place, kind) {
  const box = el('div', 'city-popup');
  if (place.image) {
    const img = el('img');
    img.src = place.image;
    img.alt = place.name;
    img.loading = 'lazy';
    img.onerror = () => img.remove();
    box.append(img);
  }
  box.append(el('span', `city-tag ${kind}`, kind === 'campus' ? 'University / campus' : (place.category || 'Landmark')));
  box.append(el('h3', null, place.name));
  if (place.location) box.append(el('p', 'city-where', place.location));
  if (place.detail) box.append(el('p', 'city-detail', place.detail));
  if (place.url) {
    const a = el('a', 'city-link', kind === 'campus' ? 'Official website ↗' : 'Explore more ↗');
    a.href = place.url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    box.append(a);
  }
  const c = place.imageCredit;
  if (c) {
    const credit = el('p', 'city-credit');
    const link = el('a', null, c.author || c.source);
    link.href = c.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    credit.append(c.author ? 'Photo: ' : 'Photo source: ', link);
    if (c.license) credit.append(` · ${c.license}`);
    box.append(credit);
  }
  return box;
}

export default function CityLayers({ mapApi, showCampuses, showLandmarks, focus, hoverId }) {
  const markers = useRef({ campus: [], landmark: [] });

 
  useEffect(() => {
    let timer;
    const add = () => {
      const map = mapApi.current?.getMap?.();
      if (!map) { timer = setTimeout(add, 300); return; }
      const make = (list, kind) => list.map((place) => {
        const node = el('button', `city-marker ${kind}`);
        node.type = 'button';
        node.setAttribute('aria-label', place.name);
        node.title = place.name;
        node.innerHTML = iconSvg(place.icon);
        node.dataset.id = place.id;
        return new maplibregl.Marker({ element: node })
          .setLngLat([place.coordinates[1], place.coordinates[0]])
          .setPopup(new maplibregl.Popup({ offset: 18, maxWidth: '280px', className: 'city-popup-wrap' }).setDOMContent(popupFor(place, kind)))
          .addTo(map);
      });
      markers.current = { campus: make(universities, 'campus'), landmark: make(attractions, 'landmark') };
      apply();
    };
    add();
    return () => {
      clearTimeout(timer);
      [...markers.current.campus, ...markers.current.landmark].forEach((m) => m.remove());
      markers.current = { campus: [], landmark: [] };
    };
  }, [mapApi]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    markers.current.campus.forEach((m) => { m.getElement().style.display = showCampuses ? '' : 'none'; if (!showCampuses) m.getPopup()?.remove(); });
    markers.current.landmark.forEach((m) => { m.getElement().style.display = showLandmarks ? '' : 'none'; if (!showLandmarks) m.getPopup()?.remove(); });
  };
  useEffect(apply, [showCampuses, showLandmarks]); // eslint-disable-line react-hooks/exhaustive-deps

 
  useEffect(() => {
    if (!focus) return;
    const map = mapApi.current?.getMap?.();
    const marker = markers.current.campus.find((m) => m.getElement().dataset.id === focus.id);
    if (!map || !marker) return;
    [...markers.current.campus, ...markers.current.landmark].forEach((m) => m.getPopup()?.remove());
    map.flyTo({ center: marker.getLngLat(), zoom: 15, pitch: 50, duration: 1100, essential: true });
    map.once('moveend', () => { if (!marker.getPopup().isOpen()) marker.togglePopup(); });
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    markers.current.campus.forEach((m) => m.getElement().classList.toggle('on', m.getElement().dataset.id === hoverId));
  }, [hoverId]);

  return null;
}
