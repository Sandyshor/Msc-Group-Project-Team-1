import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JourneyBaseMap from './JourneyBaseMap';
import { ACTIVE_DISTRICTS, COUNTY_AREAS, DUBLIN_DISTRICTS, strongColor } from './mapShared';
import DistrictProfile, { TABS } from './DistrictProfile';
import JourneyPlannerPanel, { routeTabLabel } from './JourneyPlannerPanel';
import { fetchRoutes } from './journey';
import { chainShops as buildChainShops, loadAmenityRecords, loadVerifiedAmenityCounts, loadVerifiedChainShops } from './amenityData';
import { streetName } from './placeNames';
import { districtProfiles } from './districtProfiles';
import DistrictTour from './DistrictTour';
import './App.css';
import './Safety.css';
import './Chains.css';
// Bundled with the page, so it always loads with the right path
import profilesUrl from './district-profiles.json?url';

const DATA_URL = profilesUrl;


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
  
  const fromResults = window.history.state?.usr?.district;
  const raw = [fromResults, params.get('district'), params.get('d'), params.get('code'), params.get('search'), pathname, hash].filter(Boolean).join(' ');
  const m = decodeURIComponent(raw).match(/(?:^|[^A-Za-z0-9])(?:D|Dublin[\s_-]*)0?(\d{1,2})(W?)(?![0-9])/i);
  if (m) {
    const id = `D${Number(m[1])}${m[2].toUpperCase()}`;
    if (ACTIVE_DISTRICTS.includes(id)) return id;
  }
  const county = decodeURIComponent(raw).match(/(?:^|[^A-Za-z0-9])([AK]\d{2})(?![0-9])/i); // e.g. ?district=K67
  if (county && ACTIVE_DISTRICTS.includes(county[1].toUpperCase())) return county[1].toUpperCase();
  try {
    // Set when an "Explore district profile" button is clicked on the results page
    const saved = JSON.parse(localStorage.getItem('explore-district') || 'null');
    if (saved && Date.now() - saved.t < 120000 && ACTIVE_DISTRICTS.includes(saved.id)) return saved.id;
  } catch { /* ignore */ }
  return null; // no district until the user picks one
}


if (typeof window !== 'undefined' && !window.__districtExploreClicks) {
  window.__districtExploreClicks = true;
  const CODE_RE = /(?:^|[^A-Za-z0-9])D(\d{1,2})(W?)(?![0-9A-Za-z])/i;
  document.addEventListener('click', (e) => {
    const target = e.target.closest?.('a, button');
    if (!target || target.closest('.mini-map, .district-page')) return;
    if (!/district|profile|explore/i.test(target.textContent || '')) return;
    
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


// Checked photo for each place (public/data/place-images.json). A place listed with null has no trustworthy
// photo: it shows its icon rather than a guessed picture. Places not in the file keep their own image.
function withPhoto(place, photos) {
  if (!photos || !(place.name in photos)) return place;
  const photo = photos[place.name];
  return { ...place, image: photo?.src || null, sourceUrl: photo?.page, imageCredit: photo?.credit, photoChecked: true };
}

function buildPlaces(profileData, photos) {
  const byDistrict = {};
  ACTIVE_DISTRICTS.forEach((code) => {
    const sample = (profileData.profiles[code]?.places || []).map(([name, cat, description, lat, lng]) => ({
      name, cat, description, lngLat: [lng, lat], sample: true,
    }));
    const team = districtProfiles?.[code]?.famousPlaces || [];
    if (!team.length) { byDistrict[code] = sample.map((p) => withPhoto(p, photos)); return; }
    byDistrict[code] = team.map((p) => {
      const match = sample.find((s) => s.name.toLowerCase() === String(p.name).toLowerCase());
      return {
        ...p,
        cat: p.cat || PLACE_ICONS[p.name] || match?.cat || 'landmark',
        lngLat: p.coordinates || LANDMARK_LOCATIONS[p.name] || match?.lngLat || null,
        sample: false,
      };
    }).map((p) => withPhoto(p, photos));
  });
  return byDistrict;
}

/* ---------------- page ---------------- */

const EMPTY_TRIP = { from: null, to: null, mode: 'transit', timeType: 'now', time: '', status: 'idle', error: '', itineraries: [], selected: 0, queryMode: 'transit' };

export default function App() {
  const [data, setData] = useState(null);
  const [placePhotos, setPlacePhotos] = useState(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(districtFromUrl);
  const [filter, setFilter] = useState('all');
  const [touring, setTouring] = useState(false);
  // Transport layers: all off until switched on with the buttons above the map
  const [showLuas, setShowLuas] = useState(false);
  const [showBus, setShowBus] = useState(false);
  const [showBikes, setShowBikes] = useState(false);
  const [showRail, setShowRail] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [countyOpen, setCountyOpen] = useState(false); // County Dublin areas row, opened with its button
  // A saved tab that no longer exists (Commute, Universities) falls back to Places
  const [tab, setTabState] = useState(() => { const t = storage.get('district-tab', 'places'); return TABS.some(([k]) => k === t) ? t : 'places'; });
  const [rentMode, setRentMode] = useState('rooms');
  const [chain, setChain] = useState(null); // supermarket chain shown on the map (Tesco, Lidl...)
  const [hoverPlace, setHoverPlace] = useState(null);
  // Journey planner trip: A and B are set by clicking the map, like the journey planner page
  const [trip, setTrip] = useState(EMPTY_TRIP);
  const [csvRecords, setCsvRecords] = useState(null); // amenities_osm.csv: shops in every district
  const [verifiedShops, setVerifiedShops] = useState(null); // chain shops checked against the district boundaries
  const [amenityCounts, setAmenityCounts] = useState(null);
  const mapApi = useRef(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => { if (!r.ok) throw new Error(`${DATA_URL} returned ${r.status}`); return r.json(); })
      // County Dublin areas (A/K keys) are kept in their own file and merged in; the page still works without it
      .then((d) => fetch('/data/county-dublin-profiles.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((county) => {
          if (county) ['profiles', 'labels', 'census', 'safety', 'rtb'].forEach((k) => { d[k] = { ...(d[k] || {}), ...(county[k] || {}) }; });
          if (county?.roomReport) d.roomReport = county.roomReport; // Daft report room rents for County Dublin
          setData(d);
        }))
      .catch((e) => setError(e.message));
  }, []);

  // The saved "Explore" choice is used once
  useEffect(() => { try { localStorage.removeItem('explore-district'); } catch { /* ignore */ } }, []);

  // An "Explore D7 district profile" button clicked while this page is already open
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

  // If the address changes while this page is open, show that district
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

  // Ask the journey planner backend (/route) whenever A, B, the mode or the time changes
  useEffect(() => {
    if (!trip.from || !trip.to) return undefined;
    if (trip.timeType !== 'now' && !trip.time) return undefined;
    const ctrl = new AbortController();
    const mode = trip.mode;
    setTrip((t) => ({ ...t, status: 'loading', error: '', itineraries: [], selected: 0 }));
    fetchRoutes({ from: trip.from, to: trip.to, mode, timeType: trip.timeType, time: trip.time }, ctrl.signal)
      .then((itineraries) => { if (!ctrl.signal.aborted) setTrip((t) => ({ ...t, status: 'done', itineraries, selected: 0, queryMode: mode })); })
      .catch((e) => { if (e.name !== 'AbortError' && !ctrl.signal.aborted) setTrip((t) => ({ ...t, status: 'error', error: e.message })); });
    return () => ctrl.abort();
  }, [trip.from?.lat, trip.from?.lng, trip.to?.lat, trip.to?.lng, trip.mode, trip.timeType, trip.time]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAmenityRecords().then(setCsvRecords).catch((e) => console.error('Could not load amenities_osm.csv', e));
    loadVerifiedChainShops().then(setVerifiedShops).catch((e) => console.error('Could not load dublin-chain-shops.json', e));
    loadVerifiedAmenityCounts().then(setAmenityCounts).catch((e) => console.error('Could not load dublin-amenity-counts.json', e));
  }, []);

  useEffect(() => {
    fetch('/data/place-images.json').then((r) => (r.ok ? r.json() : null)).then((d) => setPlacePhotos(d?.images || {})).catch(() => setPlacePhotos({}));
  }, []);
  const placesByDistrict = useMemo(() => (data && placePhotos ? buildPlaces(data, placePhotos) : {}), [data, placePhotos]);
  // Verified list first; the older CSV + profile list only if that file cannot load
  const chainShops = useMemo(() => verifiedShops || (data ? buildChainShops(csvRecords, data.amenities) : []), [verifiedShops, csvRecords, data]);
  const isVisible = useCallback((c) => filter === 'all' || data?.profiles[c]?.side === filter, [filter, data]);

  // Clicking the chosen district again clears it: back to the plain map with the universities
  const clearDistrict = useCallback(() => {
    setTouring(false);
    setSelectedId(null);
    setHoverPlace(null);
    setChain(null);
  }, []);
  const toggleDistrict = useCallback((code) => {
    if (code === selectedId) clearDistrict(); else { setTouring(false); setSelectedId(code); setHoverPlace(null); }
  }, [selectedId, clearDistrict]);

  const selectDistrict = useCallback((code, fromTour = false) => {
    if (!fromTour) setTouring(false);
    setSelectedId(code);
    setHoverPlace(null);
  }, []);

  const setTab = (t) => { setTabState(t); storage.set('district-tab', t); };

  // Leaving the Amenities tab (to Rent, Journey...) clears the chosen chain, so its shops leave the map
  useEffect(() => { if (tab !== 'amen') setChain(null); }, [tab]);

  useEffect(() => {
    if (data && selectedId && !isVisible(selectedId)) selectDistrict(ACTIVE_DISTRICTS.find(isVisible));
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // The guided tour visits D1 to D24 in order (only one side of the Liffey when a side filter is on)
  const tourCodes = useMemo(() => (data ? DUBLIN_DISTRICTS.filter((c) => data.profiles[c] && isVisible(c)) : []), [data, isVisible]);
  const showTourStop = useCallback((code) => selectDistrict(code, true), [selectDistrict]);
  const endTour = useCallback(() => setTouring(false), []);

  if (error) return <div className="district-page"><p className="empty-note">Could not load district data: {error}</p></div>;
  if (!data) return <div className="district-page"><p className="empty-note">Loading district map…</p></div>;

  const teamName = districtProfiles?.[selectedId]?.name;
  // Use the team's name unless it is just "Dublin N"
  const team = teamName && !/^Dublin\s/i.test(teamName) ? { name: teamName } : null;
  const places = placesByDistrict[selectedId] || [];

  const onPlaceClick = (code, i) => {
    setTouring(false);
    if (code !== selectedId) setSelectedId(code);
    setTab('places');
    setHoverPlace(i);
    mapApi.current?.flyToPlace(code, i);
  };

  // Journey planner behaviour: first click sets A, second sets B; after that a landmark moves B.
  // A plain map click or a dragged pin gets its exact street / shop name from the address lookup;
  // the nearby-place name shows until the answer arrives (and stays if the lookup fails).
  const nameExactly = (which, p) => {
    if (!p.lookup) return;
    streetName(p.lat, p.lng).then((label) => {
      if (!label) return;
      setTrip((t) => (t[which] && t[which].lat === p.lat && t[which].lng === p.lng ? { ...t, [which]: { ...t[which], label } } : t));
    });
  };
  // Map clicks only set A and B while the journey planner is on screen (the Journey tab, or the
  // "Plan a journey" panel before a district is picked). On Places, Rent, Amenities etc. they do nothing.
  const planning = !selectedId || tab === 'journey';
  const onMapPoint = (p) => {
    if (!planning || (trip.from && trip.to)) return;
    const which = trip.from ? 'to' : 'from';
    setTouring(false);
    setTrip((t) => ({ ...t, [which]: p }));
    nameExactly(which, p);
    if (tab !== 'journey') setTab('journey');
  };
  const onDragPoint = (which, p) => {
    setTrip((t) => ({ ...t, [which]: p }));
    nameExactly(which, p);
  };
  const onLandmarkPoint = (p) => {
    if (!planning) return;
    if (trip.from && trip.to) { setTrip((t) => ({ ...t, to: p })); if (tab !== 'journey') setTab('journey'); return; }
    onMapPoint(p);
  };

  const hasCounty = COUNTY_AREAS.some((c) => data.profiles[c]);
  const countyIsSelected = COUNTY_AREAS.includes(selectedId);
  const showCountyRow = hasCounty && (countyOpen || countyIsSelected);
  const centre = data.labels[selectedId];
  const journeyQuickStarts = [
    ...(centre ? [[`Start from the centre of ${selectedId}`, { lat: centre[0], lng: centre[1], label: `Centre of ${selectedId}` }]] : []),
    ...(data.profiles[selectedId]?.areas || []).slice(0, 3).map(([name, lat, lng]) => [`Start from ${name}`, { lat, lng, label: `${name}, ${selectedId}` }]),
  ];

  return (
    <div className="district-page">
      <header className="page-header page-header-compact">
        <div>
          <h1>Dublin district profiles</h1>
          <p className="page-description">Pick a Dublin district (D1–D24) or a County Dublin area to see its rent, amenities, safety and famous places, or click the map to plan a journey.</p>
        </div>
      </header>

      <div className="district-layout">
        <section className="map-card">
          {/* Everything that controls the map sits on top of it, so the district list and the map are always on screen together */}
          <div className="map-toolbar">
            <div className="district-controls">
              <div className="seg-toggle" role="group" aria-label="Filter by side of the Liffey">
                {[['all', 'All'], ['Northside', 'Northside'], ['Southside', 'Southside']].map(([v, l]) => (
                  <button type="button" key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
                ))}
              </div>
              <button type="button" className="tour-button" aria-pressed={touring} onClick={() => setTouring((t) => !t)}>
                {touring ? '■ Stop tour' : '▶ Take the tour'}
              </button>
              <span className="toolbar-divider" aria-hidden="true" />
              <button type="button" className="luas-toggle tr-toggle" aria-pressed={showLuas} onClick={() => setShowLuas((v) => !v)}><i className="tr-luas" /> Luas lines</button>
              <button type="button" className="luas-toggle tr-toggle" aria-pressed={showBus} onClick={() => setShowBus((v) => !v)}><i className="tr-bus" /> Bus stops</button>
              <button type="button" className="luas-toggle tr-toggle" aria-pressed={showBikes} onClick={() => setShowBikes((v) => !v)}><i className="tr-bikes" /> Dublin Bikes</button>
              <button type="button" className="luas-toggle tr-toggle" aria-pressed={showRail} onClick={() => setShowRail((v) => !v)}><i className="tr-rail" /> DART &amp; rail</button>
              <button type="button" className="luas-toggle tr-toggle" aria-pressed={showSafety} onClick={() => setShowSafety((v) => !v)}><i className="tr-safety" /> Safety map</button>
            </div>
            {[['Districts', DUBLIN_DISTRICTS, ''], ['County Dublin', COUNTY_AREAS, ' county-chips']].map(([group, codes, cls]) => ((!cls || showCountyRow) && (
              <div key={group} id={cls ? 'county-areas' : undefined} className={`district-chips${cls}${filter !== 'all' ? ' is-filtered' : ''}`} role="toolbar" aria-label={group}>
                {cls && <span className="chips-label">County Dublin</span>}
                {codes.filter((c) => data.profiles[c]).map((c) => (
                  <button type="button" key={c} className={isVisible(c) ? '' : 'is-dim'} aria-pressed={c === selectedId}
                    style={c === selectedId ? { background: strongColor(data.profiles[c].hue), borderColor: 'transparent' } : undefined}
                    title={c === selectedId ? `${data.profiles[c].name} (click again to clear)` : data.profiles[c].name}
                    aria-label={c === selectedId ? `${c} selected, click to clear` : `${c} · ${data.profiles[c].name}`}
                    onClick={() => toggleDistrict(c)}>{c}{cls && <small>{data.profiles[c].name.split(' & ')[0]}</small>}{c === selectedId && <span className="chip-clear" aria-hidden="true">×</span>}</button>
                ))}
                {!cls && hasCounty && (
                  <button type="button" className={`county-toggle${countyIsSelected ? ' has-selection' : ''}`} aria-expanded={showCountyRow} aria-controls="county-areas"
                    title="Areas in County Dublin outside D1–D24 (A and K Eircodes)" onClick={() => setCountyOpen((v) => !v)}>
                    County Dublin <span aria-hidden="true">{showCountyRow ? '▴' : '▾'}</span>
                  </button>
                )}
              </div>
            )))}
            <p className="district-hint">
              <span aria-hidden="true">💡</span>
              <span><b>D1 &amp; D2</b> are the city centre. <span className="dh-n">Odd numbers</span> are north of the River Liffey, <span className="dh-s">even numbers</span> are south.</span>
            </p>
          </div>

          <div className={`map-stage${touring ? ' is-touring' : ''}`}>
          <JourneyBaseMap
            ref={mapApi}
            profileData={data}
            placesByDistrict={placesByDistrict}
            selectedDistrict={selectedId}
            onSelectDistrict={(c) => toggleDistrict(c)}
            filter={filter}
            chain={chain}
            chainShops={chainShops}
            showLuas={showLuas}
            showBus={showBus}
            showBikes={showBikes}
            showRail={showRail}
            showSafety={showSafety}
            hoverPlace={hoverPlace}
            onHoverPlace={setHoverPlace}
            onPlaceClick={onPlaceClick}
            trip={trip}
            planning={planning}
            onMapPoint={onMapPoint}
            onLandmarkPoint={onLandmarkPoint}
            onDragPoint={onDragPoint}
            onSelectItinerary={(i) => setTrip((t) => ({ ...t, selected: i }))}
            routeTabLabel={(it) => routeTabLabel(it, trip.queryMode)}
          />
          {touring && <DistrictTour data={data} codes={tourCodes} onShow={showTourStop} onEnd={endTour} />}
          </div>

          <div className="map-legend">
            {selectedId && <span><i className="legend-line district-outline-line" style={{ borderColor: strongColor(data.profiles[selectedId].hue) }} />{selectedId} boundary</span>}
            <span className="legend-pin"><i>🎓</i>Universities</span>
            {showLuas && <span><i className="legend-line" style={{ background: '#e0312b' }} />Luas Red</span>}
            {showLuas && <span><i className="legend-line" style={{ background: '#00a651' }} />Luas Green</span>}
            {showRail && <span><i className="legend-line" style={{ background: '#7ac143' }} />DART</span>}
            {showRail && <span><i className="legend-line" style={{ background: '#6f3f98' }} />Commuter rail</span>}
            {showBus && <span><i className="legend-dot" style={{ background: '#f5b400' }} />Bus stops (zoom in)</span>}
            {showSafety && <span className="legend-safety">More crime <i /> Less crime</span>}
            {showBikes && <span><i className="legend-dot" style={{ background: '#1f6fb2' }} />Dublin Bikes (live)</span>}
            <span className="legend-more">Zoom in to see names and nearby shops. More layers (famous places, supermarkets…) are in the layers button on the map.</span>
          </div>
        </section>

        {!selectedId && (
          <aside className="profile-card welcome-card">
            <p className="eyebrow">District profiles</p>
            <h2>Choose a district</h2>
            <p>Pick a Dublin district (D1–D24) or a County Dublin area (A and K Eircodes) above to see its rent, amenities, safety and famous places.</p>
            <h3>Plan a journey</h3>
            <JourneyPlannerPanel trip={trip} setTrip={setTrip} onReset={() => setTrip((t) => ({ ...EMPTY_TRIP, mode: t.mode, timeType: t.timeType, time: t.time }))} />
          </aside>
        )}
        {selectedId && <DistrictProfile
          key={selectedId}
          selectedId={selectedId}
          data={data}
          team={team}
          places={places}
          tab={tab}
          setTab={setTab}
          rentMode={rentMode}
          setRentMode={setRentMode}
          chain={chain}
          setChain={setChain}
          hoverPlace={hoverPlace}
          setHoverPlace={setHoverPlace}
          onPlaceClick={onPlaceClick}
          onSelect={(c) => selectDistrict(c)}
          trip={trip}
          setTrip={setTrip}
          onTripReset={() => setTrip((t) => ({ ...EMPTY_TRIP, mode: t.mode, timeType: t.timeType, time: t.time }))}
          journeyQuickStarts={journeyQuickStarts}
          chainShops={chainShops}
          amenityCounts={amenityCounts}
        />}
      </div>
    </div>
  );
}
