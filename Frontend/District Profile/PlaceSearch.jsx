// Search box with suggestions (universities, places, districts, stations, shops; streets and addresses on
// Enter). Used above the district map and for the journey planner's A and B.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KINDS, loadPlaceIndex, searchAddresses, searchPlaces } from './placeIndex';
import './PlaceSearch.css';

const KIND_ICON = { district: '🗺️', uni: '🎓', place: '⭐', housing: '🏠', area: '🏘️', station: '🚉', amenity: '📍', address: '🏠' };

export default function PlaceSearch({ value = '', onPick, onClear, placeholder, label, badge, className = '' }) {
  const id = useId();
  const box = useRef(null);
  const input = useRef(null);
  const [index, setIndex] = useState(null);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [addresses, setAddresses] = useState(null); // null: not searched; [] searched, nothing found
  const [looking, setLooking] = useState(false);
  const [failed, setFailed] = useState(false);

  const query = useRef(value); // what is in the box right now, for the address search that answers later
  query.current = text;
  // A/B boxes go back to the chosen place when you leave them half-typed; the map search keeps your text
  const leave = () => { setOpen(false); if (value) setText(value); };

  // show the chosen place's name when the box isn't being typed in
  useEffect(() => { if (document.activeElement !== input.current) setText(value); }, [value]);

  const load = () => { if (!index) loadPlaceIndex().then(setIndex, () => setFailed(true)); };

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target) && !listRef.current?.contains(e.target)) leave(); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, value]);

  const typed = text.trim();
  const local = index && typed && typed !== value ? searchPlaces(index, typed) : [];
  const canLookUp = typed.length >= 3 && typed !== value && addresses === null;
  const options = [...local, ...(addresses || [])];
  const total = options.length + (canLookUp ? 1 : 0);

  async function lookUp() {
    const asked = typed;
    setLooking(true);
    const found = await searchAddresses(asked);
    setLooking(false);
    if (query.current.trim() !== asked) return; // typed something else meanwhile: these results are stale
    setAddresses(found);
    setActive(local.length);
  }

  function pick(place) {
    setText(place.label);
    setOpen(false);
    setActive(-1);
    setAddresses(null);
    onPick?.(place);
  }

  function choose(i) {
    if (i < options.length) pick(options[i]);
    else if (canLookUp) lookUp();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, total - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && active < total) choose(active);
      else if (local.length) pick(local[0]);
      else if (canLookUp) lookUp();
    } else if (e.key === 'Escape') { leave(); input.current?.blur(); }
  }

  const listId = `${id}-list`;
  const showList = open && typed && typed !== value;

  // The list is drawn on <body>, placed under the box (or above it when there's no room below), so the panel
  // around the box (journey planner, profile card) can't cut it off. It follows the box when the page scrolls.
  const listRef = useRef(null);
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    if (!showList) { setPlace(null); return undefined; }
    const measure = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 10;
      const above = r.top - 10;
      const up = below < 240 && above > below;
      setPlace({ left: r.left, width: r.width, up, top: r.bottom + 4, bottom: window.innerHeight - r.top + 4, max: Math.max(150, Math.min(360, up ? above : below)) });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [showList]);

  return (
    <div ref={box} className={`ps ${className}${showList ? ' is-open' : ''}${place?.up ? ' is-up' : ''}`}
      onBlur={(e) => { if (!box.current?.contains(e.relatedTarget)) leave(); }}>
      {badge ? <b className="ps-badge" aria-hidden="true">{badge}</b> : (
        <svg className="ps-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      )}
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={!!showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-o${active}` : undefined}
        placeholder={placeholder}
        value={text}
        autoComplete="off"
        enterKeyHint="search"
        onFocus={(e) => { load(); setOpen(true); e.target.select(); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); setAddresses(null); }}
        onKeyDown={onKeyDown}
      />
      {(text || value) && (
        <button type="button" className="ps-clear" aria-label={`Clear ${label}`} title="Clear"
          onClick={() => { setText(''); setAddresses(null); setActive(-1); onClear?.(); input.current?.focus(); }}>×</button>
      )}
      {showList && place && createPortal(
        <ul id={listId} ref={listRef} role="listbox" className={`ps-list ps-floating${place.up ? ' is-up' : ''}`} aria-label={`${label} suggestions`}
          style={{ left: place.left, width: place.width, maxHeight: place.max, ...(place.up ? { top: 'auto', bottom: place.bottom } : { top: place.top, bottom: 'auto' }) }}>
          {!index && !failed && <li className="ps-note">Loading places…</li>}
          {failed && <li className="ps-note">Couldn&rsquo;t load the place list. Press Enter to search addresses.</li>}
          {options.map((p, i) => (
            <li
              key={`${p.kind}-${p.label}-${p.lat}-${p.lng}`}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              onPointerEnter={() => setActive(i)}
            >
              <span className="ps-kind" aria-hidden="true">{KIND_ICON[p.kind]}</span>
              <span className="ps-text"><strong>{p.label}</strong><small>{p.sub || KINDS[p.kind][1]}</small></span>
              <em>{KINDS[p.kind][1]}</em>
            </li>
          ))}
          {index && !local.length && addresses?.length === 0 && <li className="ps-note">No streets or places found for &ldquo;{typed}&rdquo;.</li>}
          {canLookUp && (
            <li
              id={`${id}-o${options.length}`}
              role="option"
              aria-selected={active === options.length}
              className={`ps-more${active === options.length ? ' is-active' : ''}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={lookUp}
              onPointerEnter={() => setActive(options.length)}
            >
              <span className="ps-kind" aria-hidden="true">{looking ? '⏳' : '🔎'}</span>
              <span className="ps-text"><strong>{looking ? 'Searching streets and addresses…' : `Search streets and addresses for “${typed}”`}</strong><small>{local.length ? 'From OpenStreetMap' : 'From OpenStreetMap · press Enter'}</small></span>
            </li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}
