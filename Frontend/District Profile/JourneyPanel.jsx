import { useRef } from 'react';
import { universities } from './cityPlaces';
import { TRAVEL_MODES, MODE_STYLE, legColor, lineLabel, formatMinutes, formatDistance, formatTime, fetchRoutes, dublinNowInputValue } from './journey';
import './Journey.css';

const uniPoint = (u) => ({ lng: u.coordinates[1], lat: u.coordinates[0], label: u.name, id: u.id });
export const DEFAULT_DESTINATION = uniPoint(universities.find((u) => u.id === 'tu-grangegorman') || universities[0]);

const placeName = (name) => (name === 'Destination' ? 'your destination' : name === 'Start' ? 'your start point' : name);

function chips(it) {
  const legs = it.legs.filter((l) => l.mode !== 'WALK');
  if (!legs.length) return [<i key="w" className="jr-chip" style={{ '--c': MODE_STYLE.WALK.color }}>Walk</i>];
  return legs.map((l, i) => <i key={i} className="jr-chip" style={{ '--c': legColor(l) }}>{l.mode === 'BICYCLE' ? 'Bike' : (l.line || lineLabel(l))}</i>);
}

function stepText(leg) {
  const to = placeName(leg.to);
  if (leg.mode === 'WALK') return <>Walk {formatDistance(leg.distance_km)} to <b>{to}</b></>;
  if (leg.mode === 'BICYCLE') return <>Cycle {formatDistance(leg.distance_km)} to <b>{to}</b></>;
  return <><b>{lineLabel(leg)}</b> for {formatMinutes(leg.minutes)} to <b>{to}</b></>;
}

function stepDetail(leg) {
  if (leg.mode === 'WALK' || leg.mode === 'BICYCLE') return formatMinutes(leg.minutes);
  return `${leg.headsign ? `towards ${leg.headsign} · ` : ''}from ${placeName(leg.from)} at ${formatTime(leg.departure)}`;
}

export default function JourneyPanel({ code, data, journey, setJourney, from, to, picking, setPicking }) {
  const abort = useRef(null);
  const profile = data.profiles[code];
  const areas = profile?.areas || [];
  const set = (patch) => setJourney((j) => ({ ...j, ...patch }));

  const fromValue = journey.from ? (journey.from.area || 'map') : 'centre';
  const toValue = journey.to ? (journey.to.id || 'map') : DEFAULT_DESTINATION.id;

  const chooseFrom = (v) => {
    if (v === 'pick') { setPicking('from'); return; }
    if (v === 'centre') { set({ from: null, itineraries: [], status: 'idle' }); return; }
    const a = areas.find(([n]) => n === v);
    if (a) set({ from: { lng: a[2], lat: a[1], label: `${a[0]}, ${code}`, area: a[0] }, itineraries: [], status: 'idle' });
  };
  const chooseTo = (v) => {
    if (v === 'pick') { setPicking('to'); return; }
    const u = universities.find((x) => x.id === v);
    if (u) set({ to: uniPoint(u), itineraries: [], status: 'idle' });
  };

  const plan = async () => {
    abort.current?.abort();
    abort.current = new AbortController();
    set({ status: 'loading', error: '', itineraries: [], selected: 0 });
    try {
      const itineraries = await fetchRoutes({ from, to, mode: journey.mode, timeType: journey.timeType, time: journey.time }, abort.current.signal);
      set({ status: 'done', itineraries, selected: 0 });
    } catch (e) {
      if (e.name === 'AbortError') return;
      set({ status: 'error', error: e.message });
    }
  };

  const it = journey.itineraries?.[journey.selected];

  return (
    <>
      <section className="profile-section">
        <div className="section-title-row"><div><p className="section-eyebrow">JOURNEY PLANNER</p><h3>Plan your trip</h3></div></div>

        <label className="jr-label" htmlFor="jr-from">From <span className="jr-pin-mini jr-from">A</span></label>
        <select id="jr-from" className="uni-select" value={picking === 'from' ? 'pick' : fromValue} onChange={(e) => chooseFrom(e.target.value)}>
          <option value="centre">Centre of {code}</option>
          {areas.map(([n]) => <option key={n} value={n}>{n}, {code}</option>)}
          {fromValue === 'map' && <option value="map">Point on the map</option>}
          <option value="pick">📍 Pick a point on the map…</option>
        </select>

        <label className="jr-label" htmlFor="jr-to">To <span className="jr-pin-mini jr-to">B</span></label>
        <select id="jr-to" className="uni-select" value={picking === 'to' ? 'pick' : toValue} onChange={(e) => chooseTo(e.target.value)}>
          {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          {toValue === 'map' && <option value="map">Point on the map</option>}
          <option value="pick">📍 Pick a point on the map…</option>
        </select>

        {picking && (
          <p className="jr-picking">Click on the map to set your {picking === 'from' ? 'start (A)' : 'destination (B)'}. <button type="button" onClick={() => setPicking(null)}>Cancel</button></p>
        )}

        <div className="seg-toggle jr-modes" role="group" aria-label="Travel mode">
          {TRAVEL_MODES.map(([k, l]) => (
            <button type="button" key={k} aria-pressed={journey.mode === k} onClick={() => set({ mode: k, itineraries: [], status: 'idle' })}>{l}</button>
          ))}
        </div>

        <div className="jr-when">
          <select className="uni-select" value={journey.timeType} onChange={(e) => set({ timeType: e.target.value, time: journey.time || dublinNowInputValue() })} aria-label="When">
            <option value="now">Leave now</option>
            <option value="depart">Leave at</option>
            <option value="arrive">Arrive by</option>
          </select>
          {journey.timeType !== 'now' && (
            <input type="datetime-local" className="uni-select" value={journey.time} onChange={(e) => set({ time: e.target.value })} aria-label="Date and time" />
          )}
        </div>

        <button type="button" className="jr-go" onClick={plan} disabled={journey.status === 'loading' || !from || !to}>
          {journey.status === 'loading' ? 'Finding routes…' : 'Show route on the map'}
        </button>
        {journey.status === 'error' && <p className="jr-error">{journey.error}</p>}
      </section>

      {journey.status === 'done' && it && (
        <section className="profile-section">
          <div className="jr-tabs" role="tablist">
            {journey.itineraries.map((x, i) => (
              <button type="button" role="tab" key={i} aria-selected={i === journey.selected} onClick={() => set({ selected: i })}>
                <strong>{formatMinutes(x.total_minutes)}</strong>
                <span>{chips(x)}</span>
              </button>
            ))}
          </div>
          <div className="rent-grid top-gap">
            <div className="rent-tile"><span>Leave</span><strong>{formatTime(it.departure)}</strong><small>arrive {formatTime(it.arrival)}</small></div>
            <div className="rent-tile"><span>Changes</span><strong>{it.transfers}</strong><small>walking {formatDistance(it.walking_km)}</small></div>
          </div>
          <ol className="jr-steps">
            {it.legs.map((leg, i) => (
              <li key={i} style={{ '--c': legColor(leg) }} className={leg.mode === 'WALK' ? 'walk' : ''}>
                <p>{stepText(leg)}</p>
                <small>{stepDetail(leg)}</small>
              </li>
            ))}
          </ol>
          <p className="section-description top-gap">Timetable-based estimate (TFI GTFS via OpenTripPlanner), not live departures. The route is drawn over the safety colours, so you can see which areas it passes through.</p>
        </section>
      )}
    </>
  );
}
