
export const API_BASE = typeof window !== 'undefined' && window.location.port === '5173' ? 'http://127.0.0.1:8000' : '';

export const MODE_STYLE = {
  WALK: { label: 'Walk', color: '#5f6f67' },
  BICYCLE: { label: 'Cycle', color: '#e08a12' },
  BUS: { label: 'Bus', color: '#1d63a8' },
  TRAM: { label: 'Luas', color: '#2f8f46' },
  RAIL: { label: 'Train', color: '#7a3e9d' },
};
const LUAS_RED = '#d0362b';

export const TRAVEL_MODES = [['transit', 'Public transport'], ['walk', 'Walk'], ['bike', 'Cycle']];

export function legColor(leg) {
  if (leg.mode === 'TRAM' && /red/i.test(leg.line || '')) return LUAS_RED;
  return (MODE_STYLE[leg.mode] || MODE_STYLE.BUS).color;
}

export function lineLabel(leg) {
  if (leg.mode === 'RAIL' && /dart/i.test(leg.line || '')) return 'DART';
  const base = (MODE_STYLE[leg.mode] || { label: leg.mode }).label;
  return leg.line ? `${base} ${leg.line}` : base;
}

// Google encoded polyline (precision 5), as returned by OTP. Gives [lng, lat] pairs for MapLibre.
export function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < (encoded || '').length) {
    for (const axis of ['lat', 'lng']) {
      let result = 0, shift = 0, byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta; else lng += delta;
    }
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

export function formatMinutes(minutes) {
  const m = Math.max(1, Math.round(minutes));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatDistance(km) {
  return km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km.toFixed(1)} km`;
}

export function formatTime(iso) {
  return iso ? new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';
}

function errorMessage(status, detail) {
  const code = detail?.code;
  const message = typeof detail === 'string' ? detail : detail?.message;
  if (code === 'OUTSIDE_DUBLIN') return `${message} Pick a point inside the Dublin area.`;
  // OTP says "Origin/Destination is unknown" when a point is off its map (e.g. outside the area it was built for)
  if (code === 'NO_ROUTE' && /(origin|destination) is unknown/i.test(message || '')) {
    const which = /origin/i.test(message) ? 'start' : 'destination';
    return `The journey planner can't reach your ${which} yet: it's outside the area its map covers. Try a ${which} closer to Dublin city, or a nearby town centre or station.`;
  }
  if (code === 'NO_ROUTE') return `No route found. ${message} Try a different time or travel mode.`;
  if (code === 'OTP_UNAVAILABLE') return 'The journey planner is offline: OpenTripPlanner is not running or not reachable. Try again shortly.';
  if (code === 'OTP_ERROR') return message;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg).filter(Boolean).join(', ');
  return message || `The route request failed (${status}).`;
}


export async function fetchRoutes({ from, to, mode, timeType, time }, signal) {
  const params = new URLSearchParams({
    from_lat: from.lat.toFixed(6), from_lon: from.lng.toFixed(6),
    to_lat: to.lat.toFixed(6), to_lon: to.lng.toFixed(6),
    mode,
  });
  if (timeType !== 'now' && time) {
    params.set('when', time);
    params.set('arrive_by', String(timeType === 'arrive'));
  }
  let response;
  try {
    response = await fetch(`${API_BASE}/route?${params}`, { headers: { Accept: 'application/json' }, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`Can't reach the Crib Crew server at ${API_BASE || window.location.origin}. Make sure the backend is running.`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(response.status, payload?.detail));
  if (!payload?.itineraries?.length) throw new Error('No route came back from the journey planner.');
  return payload.itineraries;
}

export function dublinNowInputValue() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
