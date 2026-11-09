// Search box with suggestions (universities, places, districts, stations, shops; streets and addresses on
// Enter). Used above the district map and for the journey planner's A and B.
import { useEffect, useId, useRef, useState } from 'react';
import { KINDS, loadPlaceIndex, searchAddresses, searchPlaces } from './placeIndex';
import './PlaceSearch.css';

const KIND_ICON = { district: '🗺️', uni: '🎓', place: '⭐', area: '🏘️', station: '🚉', amenity: '📍', address: '🏠' };

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

  // show the chosen place's name when the box isn't being typed in
  useEffect(() => { if (document.activeElement !== input.current) setText(value); }, [value]);

  const load = () => { if (!index) loadPlaceIndex().then(setIndex, () => setFailed(true)); };

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) { setOpen(false); setText(value); } };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, value]);

  const typed = text.trim();
  const local = index && typed && typed !== value ? searchPlaces(index, typed) : [];
  const canLookUp = typed.length >= 3 && typed !== value && addresses === null;
  const options = [...local, ...(addresses || [])];
  const total = options.length + (canLookUp ? 1 : 0);

  async function lookUp() {
    setLooking(true);
    const found = await searchAddresses(typed);
    setLooking(false);
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
    } else if (e.key === 'Escape') { setOpen(false); setText(value); input.current?.blur(); }
  }

  const listId = `${id}-list`;
  const showList = open && typed && typed !== value;

  return (
    <div ref={box} className={`ps ${className}${showList ? ' is-open' : ''}`}>
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
      {showList && (
        <ul id={listId} role="listbox" className="ps-list" aria-label={`${label} suggestions`}>
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
        </ul>
      )}
    </div>
  );
}
