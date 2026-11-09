// The journey planner's side panel (public/journey-planner/route.html), shown in the profile's Journey tab.
// The route itself is drawn on the main map by JourneyBaseMap.
import { MODE_STYLE, TRAVEL_MODES, dublinNowInputValue, formatDistance, formatMinutes, formatTime, legColor, lineLabel } from './journey';
import PlaceSearch from './PlaceSearch';
import './JourneyPlanner.css';
import './JourneyBaseMap.css';

// OTP calls the two ends "Start" and "Destination": use the names of the places the user picked instead
const placeName = (name, trip) => (name === 'Destination' ? (trip?.to?.label || 'your destination') : name === 'Start' ? (trip?.from?.label || 'your start point') : name);

export function routeTabLabel(itinerary, queryMode) {
  if (queryMode === 'walk') return 'Walk';
  if (queryMode === 'bike') return 'Bike';
  if (itinerary.walk_only) return 'Walk only';
  return itinerary.legs.filter((leg) => leg.mode !== 'WALK').map(lineLabel).join(' → ');
}

function TabChips({ itinerary }) {
  const legs = itinerary.legs.filter((leg) => leg.mode !== 'WALK');
  if (!legs.length) return <i className="jp-chip jp-chip-walk" style={{ '--c': MODE_STYLE.WALK.color }}>Walk</i>;
  return legs.map((leg, i) => (
    <i key={i} className="jp-chip" style={{ '--c': legColor(leg) }}>{leg.mode === 'BICYCLE' ? 'Bike' : (leg.line || lineLabel(leg))}</i>
  ));
}

function stepText(leg, trip) {
  const to = placeName(leg.to, trip);
  if (leg.mode === 'WALK') return <>Walk {formatDistance(leg.distance_km)} to <strong>{to}</strong></>;
  if (leg.mode === 'BICYCLE') return <>Cycle {formatDistance(leg.distance_km)} to <strong>{to}</strong></>;
  return <><strong>{lineLabel(leg)}</strong> for {formatMinutes(leg.minutes)} to <strong>{to}</strong></>;
}

function stepDetail(leg, trip) {
  if (leg.mode === 'WALK' || leg.mode === 'BICYCLE') return formatMinutes(leg.minutes);
  const towards = leg.headsign ? ` towards ${leg.headsign}` : '';
  return `Board at ${placeName(leg.from, trip)} at ${formatTime(leg.departure)}${towards} · ${formatDistance(leg.distance_km)}`;
}

const pointLabel = (p) => p?.label || (p ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : '');

export default function JourneyPlannerPanel({ trip, setTrip, onReset, quickStarts = [] }) {
  const itinerary = trip.itineraries[trip.selected];
  const set = (patch) => setTrip((t) => ({ ...t, ...patch }));

  return (
    <div className="jp-scope jp-panel">
      <div className="jp-route-controls">
        <div className="jp-segmented" role="radiogroup" aria-label="Travel mode">
          {TRAVEL_MODES.map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="jp-mode" value={value} checked={trip.mode === value} onChange={() => set({ mode: value })} />
              <span>{value === 'bike' ? 'Bike' : label}</span>
            </label>
          ))}
        </div>
        <div className="jp-time-row">
          <select aria-label="Departure or arrival" value={trip.timeType}
            onChange={(e) => set({ timeType: e.target.value, time: e.target.value !== 'now' && !trip.time ? dublinNowInputValue() : trip.time })}>
            <option value="now">Leave now</option>
            <option value="depart">Leave at</option>
            <option value="arrive">Arrive by</option>
          </select>
          {trip.timeType !== 'now' && (
            <input type="datetime-local" aria-label="Time (Dublin)" value={trip.time} onChange={(e) => set({ time: e.target.value })} />
          )}
          <button type="button" className="jp-reset-button jp-route-reset" title="Clear start and end points" onClick={onReset}>↻ <span>Reset</span></button>
        </div>
        {/* A and B: type a place, street or university, or click the map */}
        <div className="jp-ends" role="group" aria-label="Your journey">
          <PlaceSearch
            className="is-a"
            badge="A"
            label="Start point"
            placeholder="From: type a place, or click the map"
            value={trip.from ? pointLabel(trip.from) : ''}
            onPick={(p) => set({ from: { lat: p.lat, lng: p.lng, label: p.label } })}
            onClear={() => set({ from: null, status: 'idle', itineraries: [] })}
          />
          <PlaceSearch
            className="is-b"
            badge="B"
            label="Destination"
            placeholder="To: type a place, or click the map"
            value={trip.to ? pointLabel(trip.to) : ''}
            onPick={(p) => set({ to: { lat: p.lat, lng: p.lng, label: p.label } })}
            onClear={() => set({ to: null, status: 'idle', itineraries: [] })}
          />
          <button type="button" className="jp-swap" title="Swap start and destination" aria-label="Swap start and destination"
            disabled={!trip.from && !trip.to} onClick={() => set({ from: trip.to, to: trip.from })}>⇅</button>
        </div>
      </div>

      {trip.status === 'loading' && (
        <div className="jp-route-status" role="status">
          <div className="jp-skeleton-tabs"><span /><span /><span /></div>
          <div className="jp-skeleton-grid">{Array.from({ length: 6 }, (_, i) => <span key={i} />)}</div>
          <div className="jp-skeleton-line" /><div className="jp-skeleton-line jp-short" /><div className="jp-skeleton-line" />
        </div>
      )}
      {trip.status === 'error' && <div className="jp-error-box" role="alert">{trip.error}</div>}

      {trip.status === 'done' && itinerary && (
        <div className="jp-route-result">
          <div className="jp-route-tabs" role="tablist" aria-label="Route options">
            {trip.itineraries.map((it, i) => (
              <button type="button" role="tab" key={i} className="jp-route-tab" aria-selected={i === trip.selected} style={{ '--i': i }}
                title={routeTabLabel(it, trip.queryMode)} onClick={() => set({ selected: i })}>
                <strong>{formatMinutes(it.total_minutes)}</strong>
                <span className="jp-tab-chips"><TabChips itinerary={it} /></span>
                <span className="jp-tab-label">{routeTabLabel(it, trip.queryMode)}</span>
              </button>
            ))}
          </div>
          <dl className="jp-route-summary">
            {[
              ['Total time', formatMinutes(itinerary.total_minutes)],
              ['Distance', formatDistance(itinerary.total_distance_km)],
              ['Walking', formatDistance(itinerary.walking_km)],
              ['Transfers', String(itinerary.transfers)],
              ['Leave', formatTime(itinerary.departure)],
              ['Arrive', formatTime(itinerary.arrival)],
            ].map(([label, value], i) => <div key={label} style={{ '--i': i }}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <ol className="jp-route-steps">
            {itinerary.legs.map((leg, i) => (
              <li key={i} className={`jp-route-step${leg.mode === 'WALK' ? ' jp-is-walk' : ''}`} style={{ '--leg-color': legColor(leg), '--i': i }}>
                <span className="jp-step-dot" aria-hidden="true" />
                <div><p>{stepText(leg, trip)}</p><small>{stepDetail(leg, trip)}</small></div>
                <time>{formatTime(leg.departure)}</time>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!trip.from && !trip.to && trip.status !== 'loading' && (
        <div className="jp-route-empty">
          <svg className="jp-empty-art" viewBox="0 0 240 110" aria-hidden="true">
            <path className="jp-empty-road" d="M30 82 C 70 82, 70 30, 120 34 S 170 86, 210 30" />
            <path className="jp-empty-route" pathLength="1" d="M30 82 C 70 82, 70 30, 120 34 S 170 86, 210 30" />
            <circle className="jp-empty-stop" cx="120" cy="34" r="5" />
            <g className="jp-empty-pin jp-empty-pin-a" transform="translate(30 82)"><path d="M0 0 C -9 -12 -11 -16 -11 -21 a11 11 0 0 1 22 0 c0 5 -2 9 -11 21z" /><text y="-17">A</text></g>
            <g className="jp-empty-pin jp-empty-pin-b" transform="translate(210 30)"><path d="M0 0 C -9 -12 -11 -16 -11 -21 a11 11 0 0 1 22 0 c0 5 -2 9 -11 21z" /><text y="-17">B</text></g>
          </svg>
          <strong>Where are you going?</strong>
          <p>Type a university, place or street in the A and B boxes, or click the map. Drag either pin to adjust the route.</p>
          {quickStarts.length > 0 && (
            <div className="jp-quick">
              {quickStarts.map(([label, point]) => <button type="button" key={label} onClick={() => set({ from: point })}>{label}</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
