import { useEffect, useMemo, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { allChainShops, chainInfo } from './shopChains';
import './Chains.css';


const LOGO_DIR = '/images/brands/';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function badge(chainKey) {
  const [key, label, colour] = chainInfo(chainKey);
  const node = el('div', 'chain-marker');
  node.style.background = colour;
  const img = el('img');
  img.src = `${LOGO_DIR}${key}.png`;
  img.alt = '';
  const text = el('span', null, label.replace(/ \(.*\)$/, '').replace('Dunnes Stores', 'Dunnes').replace('Asian markets', 'Asian'));
  img.onload = () => { node.classList.add('has-logo'); };
  img.onerror = () => img.remove();
  node.append(img, text);
  return node;
}

export default function ChainLayer({ mapApi, amenities, chain, district }) {
  const markers = useRef([]);
  const shops = useMemo(() => allChainShops(amenities), [amenities]);

  useEffect(() => {
    let timer;
    const draw = () => {
      const map = mapApi.current?.getMap?.();
      if (!map) { timer = setTimeout(draw, 300); return; }
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      if (!chain) return;
      const list = shops.filter((s) => s.chain === chain);
      markers.current = list.map((s) => {
        const pop = el('div', 'chain-popup');
        pop.append(el('b', null, s.name), el('span', null, `${s.district} · ${chainInfo(chain)[1]}`));
        return new maplibregl.Marker({ element: badge(chain), anchor: 'bottom' })
          .setLngLat([s.lng, s.lat])
          .setPopup(new maplibregl.Popup({ offset: 22, closeButton: false }).setDOMContent(pop))
          .addTo(map);
      });
      // Zoom to this chain's shops in the selected district, or to all of them
      const here = list.filter((s) => s.district === district);
      const focus = here.length ? here : list;
      if (focus.length) {
        const b = new maplibregl.LngLatBounds();
        focus.forEach((s) => b.extend([s.lng, s.lat]));
        map.fitBounds(b, { padding: 70, maxZoom: 14.5, duration: 900 });
      }
    };
    draw();
    return () => { clearTimeout(timer); markers.current.forEach((m) => m.remove()); markers.current = []; };
  }, [chain, shops]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
