// Street-level name for a point the user clicked on the map (journey start / destination), from
// OpenStreetMap's Nominatim reverse geocoder: a shop or building name with its street, or the house
// number, street and area. Results are cached, and requests are spaced at least 1 s apart as the
// Nominatim usage policy asks. Returns null if the lookup fails, so the caller keeps its own name.
const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const cache = new Map();
let lastRequest = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function format(result) {
  const a = result?.address || {};
  const road = a.road || a.pedestrian || a.footway || a.path || a.square;
  // Electoral divisions come back as e.g. "Kilmainham C ED", "Blanchardstown-Coolmine DED 1986" or "Arran Quay D Ward 1986": keep the name
  const area = (a.neighbourhood || a.suburb || a.quarter || a.city_district || '').replace(/\s+(?:[A-Z]\s+)?(?:D?ED|Ward)(?:\s+\d{4})?$/, '') || null;
  const name = result?.name && result.name !== road ? result.name : '';
  if (name && road) return `${name}, ${road}`;
  if (name) return area ? `${name}, ${area}` : name;
  if (road) return `${a.house_number ? `${a.house_number} ` : ''}${road}${area ? `, ${area}` : ''}`;
  return result?.display_name ? result.display_name.split(',').slice(0, 2).join(',').trim() : null;
}

// Nominatim allows one request a second: every lookup (street names and the place search) waits its turn
let queue = Promise.resolve();
export function nominatimTurn() {
  const turn = queue.then(async () => {
    const gap = Date.now() - lastRequest;
    if (gap < 1100) await wait(1100 - gap);
    lastRequest = Date.now();
  });
  queue = turn;
  return turn;
}

export async function streetName(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`; // ~10 m
  if (cache.has(key)) return cache.get(key);
  await nominatimTurn();
  try {
    const params = new URLSearchParams({ format: 'jsonv2', lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: '18', addressdetails: '1', 'accept-language': 'en' });
    const response = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const label = format(await response.json());
    if (label) cache.set(key, label);
    return label;
  } catch {
    return null;
  }
}
