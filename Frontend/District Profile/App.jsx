import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DistrictMap, { ACTIVE_DISTRICTS, ALL_DISTRICTS, strongColor } from './DistrictMap';
import DistrictProfile from './DistrictProfile';
import CityLayers from './CityLayers';
import { districtProfiles } from './districtProfiles';
import './App.css';

import profilesUrl from './district-profiles.json?url';

const DATA_URL = profilesUrl;
const DEFAULT_UNIVERSITY = 'TU Dublin - Grangegorman';
const TOUR_MS = 4500;


const LANDMARK_LOCATIONS = {
  'Herbert Park': [-6.2352, 53.3261],
  'Aviva Stadium': [-6.2285, 53.3352],
  "St Anne's Park": [-6.1785, 53.3737],
  'North Bull Island': [-6.1500, 53.3680],
  'Rathmines Town Hall': [-6.2650, 53.3225],
  Ranelagh: [-6.2565, 53.3253],
  'Phoenix Park': [-6.3298, 53.3559],
  'National Museum at Collins Barracks': [-6.2860, 53.3480],
  'Kilmainham Gaol': [-6.3095, 53.3419],
  'Guinness Storehouse': [-6.2867, 53.3419],
  'National Botanic Gardens': [-6.2700, 53.3727],
  'Croke Park': [-6.2512, 53.3607],
  Ballyfermot: [-6.3600, 53.3430],
  'Cherry Orchard': [-6.3780, 53.3440],
};


const PLACE_ICONS = {
  'Herbert Park': 'park', 'Aviva Stadium': 'stadium', "St Anne's Park": 'park', 'North Bull Island': 'nature',
  'Rathmines Town Hall': 'tower', Ranelagh: 'village', 'Phoenix Park': 'park', 'National Museum at Collins Barracks': 'museum',
  'Kilmainham Gaol': 'castle', 'Guinness Storehouse': 'landmark', 'National Botanic Gardens': 'garden', 'Croke Park': 'stadium',
  Ballyfermot: 'village', 'Cherry Orchard': 'park',
};

const storage = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};


function districtFromUrl() {
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  // The results page opens this page with navigate('/districts', { state: { district: 'D7' } })
  const fromResults = window.history.state?.usr?.district;
  const raw = [fromResults, params.get('district'), params.get('d'), params.get('code'), params.get('search'), pathname, hash].filter(Boolean).join(' ');
  const m = decodeURIComponent(raw).match(/(?:^|[^A-Za-z0-9])(?:D|Dublin[\s_-]*)0?(\d{1,2})(W?)(?![0-9])/i);
  if (m) {
    const id = `D${Number(m[1])}${m[2].toUpperCase()}`;
    if (ACTIVE_DISTRICTS.includes(id)) return id;
  }
  try {
    
    const saved = JSON.parse(localStorage.getItem('explore-district') || 'null');
    if (saved && Date.now() - saved.t < 120000 && ACTIVE_DISTRICTS.includes(saved.id)) return saved.id;
  } catch { /* ignore */ }
  return 'D1';
}


if (typeof window !== 'undefined' && !window.__districtExploreClicks) {
  window.__districtExploreClicks = true;
  const CODE_RE = /(?:^|[^A-Za-z0-9])D(\d{1,2})(W?)(?![0-9A-Za-z])/i;
  document.addEventListener('click', (e) => {
    const target = e.target.closest?.('a, button');
    if (!target || target.closest('.mini-map, .district-page')) return;
    if (!/district|profile|explore/i.test(target.textContent || '')) return;
    // District code on the button itself, or else on the card around it
    let m = (target.textContent || '').match(CODE_RE);
    for (let node = target.parentElement, level = 0; !m && node && level < 8; node = node.parentElement, level += 1) {
      m = (node.innerText || node.textContent || '').match(CODE_RE);
    }
    if (!m) return;
    const id = `D${Number(m[1])}${m[2].toUpperCase()}`;
    try { localStorage.setItem('explore-district', JSON.stringify({ id, t: Date.now() })); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('explore-district', { detail: id }));
  }, true);
}


function buildPlaces(profileData) {
  const byDistrict = {};
  ACTIVE_DISTRICTS.forEach((code) => {
    const sample = (profileData.profiles[code]?.places || []).map(([name, cat, description, lat, lng]) => ({
      name, cat, description, lngLat: [lng, lat], sample: true,
    }));
    const team = districtProfiles?.[code]?.famousPlaces || [];
    if (!team.length) { byDistrict[code] = sample; return; }
    byDistrict[code] = team.map((p) => {
      const match = sample.find((s) => s.name.toLowerCase() === String(p.name).toLowerCase());
      return {
        ...p,
        cat: p.cat || PLACE_ICONS[p.name] || match?.cat || 'landmark',
        lngLat: p.coordinates || LANDMARK_LOCATIONS[p.name] || match?.lngLat || null,
        sample: false,
      };
    });
  });
  return byDistrict;
}



export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(districtFromUrl);
  const [filter, setFilter] = useState('all');
  const [showLuas, setShowLuas] = useState(true);
  const [showHeat, setShowHeat] = useState(true); // safety colours on by default
  const [showCampuses, setShowCampuses] = useState(true);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [focusCampus, setFocusCampus] = useState(null);
  const [hoverCampus, setHoverCampus] = useState(null);
  const [touring, setTouring] = useState(false);
  const [tab, setTabState] = useState(() => storage.get('district-tab', 'places'));
  const [uni, setUniState] = useState(() => storage.get('district-uni', DEFAULT_UNIVERSITY));
  const [rentMode, setRentMode] = useState('rooms');
  const [hiddenAmenities, setHiddenAmenities] = useState(() => new Set());
  const [hoverPlace, setHoverPlace] = useState(null);
  const mapApi = useRef(null);
  const chipsRef = useRef(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => { if (!r.ok) throw new Error(`${DATA_URL} returned ${r.status}`); return r.json(); })
      .then((d) => { setData(d); if (!d.unis.includes(uni)) setUniState(d.unis[0]); })
      .catch((e) => setError(e.message));
  }, []); 

  
  useEffect(() => { try { localStorage.removeItem('explore-district'); } catch { /* ignore */ } }, []);

  
  useEffect(() => {
    const onExplore = (e) => {
      if (!ACTIVE_DISTRICTS.includes(e.detail)) return;
      setTouring(false);
      setSelectedId(e.detail);
      try { localStorage.removeItem('explore-district'); } catch { /* ignore */ }
    };
    window.addEventListener('explore-district', onExplore);
    return () => window.removeEventListener('explore-district', onExplore);
  }, []);

  
  useEffect(() => {
    let last = window.location.href;
    const id = setInterval(() => {
      if (window.location.href === last) return;
      last = window.location.href;
      setTouring(false);
      setSelectedId(districtFromUrl());
    }, 400);
    return () => clearInterval(id);
  }, []);

  const placesByDistrict = useMemo(() => (data ? buildPlaces(data) : {}), [data]);
  const isVisible = useCallback((c) => filter === 'all' || data?.profiles[c]?.side === filter, [filter, data]);

  const selectDistrict = useCallback((code, fromTour = false) => {
    if (!fromTour) setTouring(false);
    setSelectedId(code);
    setHoverPlace(null);
  }, []);

  const setTab = (t) => { setTabState(t); storage.set('district-tab', t); };
  const setUni = (u) => { setUniState(u); storage.set('district-uni', u); };
  const toggleAmenity = (k) => setHiddenAmenities((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  useEffect(() => {
    chipsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  useEffect(() => {
    if (data && !isVisible(selectedId)) selectDistrict(ACTIVE_DISTRICTS.find(isVisible));
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!touring || !data) return undefined;
    const list = ACTIVE_DISTRICTS.filter(isVisible);
    let k = Math.max(0, list.indexOf(selectedId));
    const step = () => { k = (k + 1) % list.length; selectDistrict(list[k], true); };
    step();
    const id = setInterval(step, TOUR_MS);
    return () => clearInterval(id);
  }, [touring]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="district-page"><p className="empty-note">Could not load district data: {error}</p></div>;
  if (!data) return <div className="district-page"><p className="empty-note">Loading district map…</p></div>;

  const teamName = districtProfiles?.[selectedId]?.name;

  const team = teamName && !/^Dublin\s/i.test(teamName) ? { name: teamName } : null;
  const places = placesByDistrict[selectedId] || [];

  const onPlaceClick = (code, i) => {
    setTouring(false);
    if (code !== selectedId) setSelectedId(code);
    setTab('places');
    setHoverPlace(i);
    mapApi.current?.flyToPlace(code, i);
  };

  return (
    <div className="district-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Explore the city</p>
          <h1>Dublin district profiles</h1>
          <p className="page-description">Pick a district on the map to see its rent, amenities, safety, commute, Luas stops and famous places. Zoom in to see neighbourhoods and amenities.</p>
        </div>
        <div className="header-stamp"><span>D</span><small>DUBLIN<br />D1–D24</small></div>
      </header>

      <div className="district-controls">
        <div className="seg-toggle" role="group" aria-label="Filter by side of the Liffey">
          {[['all', 'All'], ['Northside', 'Northside'], ['Southside', 'Southside']].map(([v, l]) => (
            <button type="button" key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        <button type="button" className="tour-button" aria-pressed={touring} onClick={() => setTouring((t) => !t)}>
          {touring ? '■ Stop tour' : '▶ Take the tour'}
        </button>
        <button type="button" className="luas-toggle" aria-pressed={showLuas} onClick={() => setShowLuas((v) => !v)}>
          <i className="red-line" /><i className="green-line" /> Luas lines
        </button>
        <button type="button" className="luas-toggle layer-toggle" aria-pressed={showCampuses || tab === 'unis'} onClick={() => setShowCampuses((v) => !v)}>
          <i className="dot-campus" /> Campuses
        </button>
        <button type="button" className="luas-toggle layer-toggle" aria-pressed={showLandmarks} onClick={() => setShowLandmarks((v) => !v)}>
          <i className="dot-landmark" /> Landmarks
        </button>
        <button type="button" className="heat-toggle" aria-pressed={showHeat || tab === 'safety'} onClick={() => setShowHeat((v) => !v)}>
          <i /> Safety colours
        </button>
      </div>

      <div className="district-chips" ref={chipsRef} role="toolbar" aria-label="Districts">
        {ALL_DISTRICTS.map((c) => (ACTIVE_DISTRICTS.includes(c) ? (
          <button type="button" key={c} className={isVisible(c) ? '' : 'is-dim'} aria-pressed={c === selectedId}
            style={c === selectedId ? { background: strongColor(data.profiles[c].hue), borderColor: 'transparent' } : undefined}
            onClick={() => selectDistrict(c)}>{c}</button>
        ) : <span key={c} className="chip-soon" title="Profile coming soon">{c}</span>))}
      </div>

      <div className="district-layout">
        <section className="map-card">
          <div className="map-topline">
            <div>
              <p className="eyebrow">Interactive map</p>
              <h2>Choose a district</h2>
              <p className="map-subtitle">Click a district, a famous place, a campus or any Luas stop. Colours show how safe each area is: red = more crime, green = less.</p>
            </div>
            <span className="map-live"><i /> Live street map</span>
          </div>

          <DistrictMap
            ref={mapApi}
            profileData={data}
            placesByDistrict={placesByDistrict}
            selectedDistrict={selectedId}
            onSelectDistrict={(c) => selectDistrict(c)}
            filter={filter}
            showLuas={showLuas}
            showAmenities={tab === 'amen'}
            showHeat={showHeat || tab === 'safety'}
            hiddenAmenities={hiddenAmenities}
            hoverPlace={hoverPlace}
            onHoverPlace={setHoverPlace}
            onPlaceClick={onPlaceClick}
          />
          <CityLayers mapApi={mapApi} showCampuses={showCampuses || tab === 'unis'} showLandmarks={showLandmarks} focus={focusCampus} hoverId={hoverCampus} />

          <div className="map-legend">
            <span><i className="legend-dot district-dot" />District areas</span>
            <span><i className="legend-line red-line" />Luas Red Line</span>
            <span><i className="legend-line green-line" />Luas Green Line</span>
            <span><i className="legend-dot stop-dot" />Luas stops (click for details)</span>
            {(showCampuses || tab === 'unis') && <span><i className="legend-dot campus-dot" />Universities and campuses</span>}
            {showLandmarks && <span><i className="legend-dot landmark-dot" />Landmarks</span>}
          </div>
        </section>

        <DistrictProfile
          key={selectedId}
          selectedId={selectedId}
          data={data}
          team={team}
          places={places}
          tab={tab}
          setTab={setTab}
          rentMode={rentMode}
          setRentMode={setRentMode}
          hiddenAmenities={hiddenAmenities}
          toggleAmenity={toggleAmenity}
          uni={uni}
          setUni={setUni}
          hoverPlace={hoverPlace}
          setHoverPlace={setHoverPlace}
          onPlaceClick={onPlaceClick}
          onStopClick={(n) => { setTouring(false); mapApi.current?.openStop(n); }}
          onSelect={(c) => selectDistrict(c)}
          onCampusClick={(id) => { setTouring(false); setFocusCampus({ id, t: Date.now() }); }}
          onCampusHover={setHoverCampus}
        />
      </div>
    </div>
  );
}
