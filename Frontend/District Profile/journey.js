
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


// The same Google encoding back from [lng, lat] pairs (to join a walk's many short steps into one line)
export function encodePolyline(points) {
  let out = '';
  let lat = 0, lng = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let t = '';
    while (n >= 0x20) { t += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return t + String.fromCharCode(n + 63);
  };
  points.forEach(([x, y]) => {
    const a = Math.round(y * 1e5), b = Math.round(x * 1e5);
    out += enc(a - lat) + enc(b - lng);
    lat = a; lng = b;
  });
  return out;
}

// "2026-11-24T09:00" in Dublin time -> the same moment in UTC, as the Routes API wants
function dublinToIso(local) {
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (shown - guess)).toISOString();
}

// ---------------------------------------------------------------- Google's directions (Routes API)
// Public transport, walking and cycling routes from Google (the same as on Google Maps), turned into the shape the
// journey planner and the maps already draw: legs with their mode, line, stops, times and route line.
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ROUTE_FIELDS = ['routes.duration', 'routes.distanceMeters', 'routes.legs.steps.travelMode', 'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration', 'routes.legs.steps.polyline.encodedPolyline', 'routes.legs.steps.transitDetails'].join(',');
const VEHICLE = { BUS: 'BUS', INTERCITY_BUS: 'BUS', TROLLEYBUS: 'BUS', SHARE_TAXI: 'BUS', TRAM: 'TRAM', LIGHT_RAIL: 'TRAM', MONORAIL: 'TRAM' };
const seconds = (d) => Number(String(d || '0').replace('s', '')) || 0;

function itineraryFrom(route, startIso) {
  const legs = [];
  (route.legs || []).flatMap((l) => l.steps || []).forEach((step) => {
    const t = step.transitDetails;
    const minutes = seconds(step.staticDuration) / 60;
    const km = (step.distanceMeters || 0) / 1000;
    const points = decodePolyline(step.polyline?.encodedPolyline || '');
    if (t) {
      const line = t.transitLine || {};
      const type = line.vehicle?.type || 'BUS';
      const mode = VEHICLE[type] || 'RAIL';
      const name = line.nameShort || line.name || '';
      legs.push({
        mode, line: mode === 'TRAM' ? (name.match(/red|green/i)?.[0] || name).replace(/^./, (c) => c.toUpperCase()) : mode === 'RAIL' && /dart/i.test(`${name} ${line.name}`) ? 'DART' : name,
        headsign: t.headsign || null, from: t.stopDetails?.departureStop?.name || '', to: t.stopDetails?.arrivalStop?.name || '',
        departure: t.stopDetails?.departureTime || null, arrival: t.stopDetails?.arrivalTime || null, minutes, distance_km: km, points,
      });
      return;
    }
    const mode = step.travelMode === 'BICYCLE' ? 'BICYCLE' : 'WALK';
    const last = legs[legs.length - 1];
    if (last && last.mode === mode) { // one walk, not a line of short steps
      last.minutes += minutes; last.distance_km += km; last.points = last.points.concat(points.slice(1));
    } else legs.push({ mode, line: null, headsign: null, from: '', to: '', departure: null, arrival: null, minutes, distance_km: km, points });
  });
  // walks: from the stop before to the stop after, and their times from the rides around them
  legs.forEach((leg, i) => {
    if (leg.mode !== 'WALK' && leg.mode !== 'BICYCLE') return;
    leg.from = i === 0 ? 'Start' : legs[i - 1].to;
    leg.to = i === legs.length - 1 ? 'Destination' : legs[i + 1].from;
  });
  let clock = new Date(startIso).getTime();
  const firstRide = legs.find((l) => l.departure);
  if (firstRide) clock = new Date(firstRide.departure).getTime() - legs.slice(0, legs.indexOf(firstRide)).reduce((sum, l) => sum + l.minutes * 60000, 0);
  legs.forEach((leg) => {
    if (leg.departure) clock = new Date(leg.departure).getTime();
    leg.departure ||= new Date(clock).toISOString();
    clock = leg.arrival ? new Date(leg.arrival).getTime() : clock + leg.minutes * 60000;
    leg.arrival ||= new Date(clock).toISOString();
    leg.geometry = encodePolyline(leg.points);
    delete leg.points;
  });
  const rides = legs.filter((l) => l.mode !== 'WALK' && l.mode !== 'BICYCLE');
  return {
    total_minutes: seconds(route.duration) / 60,
    total_distance_km: (route.distanceMeters || 0) / 1000,
    walking_km: legs.filter((l) => l.mode === 'WALK').reduce((sum, l) => sum + l.distance_km, 0),
    transfers: Math.max(0, rides.length - 1),
    departure: legs[0]?.departure || startIso,
    arrival: legs[legs.length - 1]?.arrival || startIso,
    walk_only: !rides.length && legs.every((l) => l.mode === 'WALK'),
    legs,
    source: 'Google',
  };
}

export async function googleRoutes({ from, to, mode, timeType, time }, signal) {
  if (!GOOGLE_KEY || typeof window === 'undefined' || !window.google?.maps) return null; // Google isn't in use on this page
  const travelMode = { transit: 'TRANSIT', bus: 'TRANSIT', walk: 'WALK', bike: 'BICYCLE' }[mode] || 'TRANSIT';
  const body = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode, computeAlternativeRoutes: travelMode === 'TRANSIT', languageCode: 'en', regionCode: 'IE', units: 'METRIC',
  };
  if (mode === 'bus') body.transitPreferences = { allowedTravelModes: ['BUS'] }; // a trip by bus only
  let startIso = new Date().toISOString();
  if (timeType !== 'now' && time) {
    const iso = dublinToIso(time);
    if (timeType === 'arrive' && travelMode === 'TRANSIT') body.arrivalTime = iso;
    else if (travelMode === 'TRANSIT') body.departureTime = iso;
    startIso = iso;
  }
  const response = await fetch(ROUTES_URL, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': ROUTE_FIELDS },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null; // not allowed, quota reached...: our own journey planner is asked instead
  const payload = await response.json().catch(() => null);
  const routes = payload?.routes || [];
  if (!routes.length) throw new Error(travelMode === 'BICYCLE' ? 'Google has no cycling route between these two places.' : 'No route found. Try a different time or travel mode.');
  return routes.map((r) => itineraryFrom(r, startIso)).sort((x, y) => x.total_minutes - y.total_minutes);
}

export async function fetchRoutes({ from, to, mode, timeType, time }, signal) {
  // Google's directions when the Google map is in use (the same routes as on Google Maps)
  try {
    const fromGoogle = await googleRoutes({ from, to, mode, timeType, time }, signal);
    if (fromGoogle) return fromGoogle;
  } catch (e) {
    if (e.name === 'AbortError' || /No route found|no cycling route/.test(e.message)) throw e;
  }
  // otherwise our own journey planner (OpenTripPlanner on the server)
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
