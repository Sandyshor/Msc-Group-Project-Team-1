// Map layers shared by the district map (Google Maps) and its fallback (Leaflet): data files, colours, layer
// categories, pin markup and small geometry helpers.
import proj4 from 'proj4';

proj4.defs('EPSG:2157', '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +units=m +no_defs');

export const PLANNER = '/journey-planner/';
export const boundariesUrl = '/data/dublin_postcode_boundaries.geojson';
export const luasRedUrl = '/data/luas-red-line.geojson';
export const luasGreenUrl = '/data/luas-green-line.geojson';
export const busStopsUrl = '/data/dublin-bus-stops.geojson';
export const railLinesUrl = '/data/dublin-rail-lines.geojson';
export const railStationsUrl = '/data/dublin-rail-stations.geojson';
export const BIKES_INFO_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_information.json';

export const LUAS_RED = '#e0312b';
export const LUAS_GREEN = '#00a651';
export const DART_GREEN = '#7ac143';
export const RAIL_PURPLE = '#6f3f98';
export const BUS_YELLOW = '#f5b400';
// small bus (front view) for the bus-stop badges
export const BUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a2 2 0 0 1 2 2V16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16V5.5a2 2 0 0 1 2-2Z" fill="#173f37"/><path d="M6 6h12v5.5H6z" fill="#fff"/><circle cx="8" cy="14.5" r="1.3" fill="#ffd34d"/><circle cx="16" cy="14.5" r="1.3" fill="#ffd34d"/><path d="M6.5 17.5v2M17.5 17.5v2" stroke="#173f37" stroke-width="2.2" stroke-linecap="round"/></svg>';
export const BIKES_BLUE = '#1f6fb2';

// Layer list categories (as in the journey planner). Brands keep the planner's word logos (TESCO, SPAR...).
export const AMENITY_CATEGORIES = {
  supermarkets: { label: 'Supermarkets', icon: '🛒', ring: '#2f7b50', csv: ['Supermarkets'] },
  tesco: { label: 'Tesco stores', logo: 'TESCO', brandNames: ['tesco'], csv: ['Supermarkets'] },
  spar: { label: 'Spar stores', logo: 'SPAR', brandNames: ['spar'], csv: ['Groceries'] },
  dunnes: { label: 'Dunnes Stores', logo: 'DUNNES', brandNames: ['dunnes'], csv: ['Supermarkets'] },
  aldi: { label: 'Aldi stores', logo: 'ALDI', brandNames: ['aldi'], csv: ['Supermarkets'] },
  centra: { label: 'Centra stores', logo: 'CENTRA', brandNames: ['centra'], csv: ['Groceries'] },
  lidl: { label: 'Lidl stores', logo: 'LIDL', brandNames: ['lidl'], csv: ['Supermarkets'] },
  supervalu: { label: 'SuperValu stores', logo: 'SUPERVALU', brandNames: ['supervalu'], csv: ['Groceries'] },
  circlek: { label: 'Circle K stores', logo: 'CIRCLE K', brandNames: ['circle k'], csv: ['Groceries'] },
  mace: { label: 'Mace stores', logo: 'MACE', brandNames: ['mace'], csv: ['Groceries'] },
  daybreak: { label: 'Daybreak stores', logo: 'DAYBREAK', brandNames: ['daybreak'], csv: ['Groceries'] },
  londis: { label: 'Londis stores', logo: 'LONDIS', brandNames: ['londis'], csv: ['Groceries'] },
  eurospar: { label: 'Eurospar stores', logo: 'EUROSPAR', brandNames: ['eurospar'], csv: ['Groceries'] },
  polonez: { label: 'Polonez stores', logo: 'POLONEZ', brandNames: ['polonez'], csv: ['Groceries'] },
  gala: { label: 'Gala stores', logo: 'GALA', brandNames: ['gala'], csv: ['Groceries'] },
  costcutter: { label: 'Costcutter stores', logo: 'COSTCUTTER', brandNames: ['costcutter'], csv: ['Groceries'] },
  daytoday: { label: 'Day-Today stores', logo: 'DAY-TODAY', brandNames: ['day-today'], csv: ['Groceries'] },
  groceries: { label: 'Groceries & convenience', icon: '🧺', ring: '#58835a', csv: ['Groceries'] },
  restaurants: { label: 'Restaurants', icon: '🍽️', ring: '#d0602b', csv: ['Restaurants', 'Asian_Restaurants'] },
  cafes: { label: 'Cafés', icon: '☕', ring: '#8a5a33', csv: ['Cafes'] },
  gyms: { label: 'Gyms', icon: '🏋️', ring: '#6a4fc4', csv: ['Gyms'] },
  salons: { label: 'Hair & beauty salons', icon: '💇', ring: '#b5487a', csv: ['Salons'] },
  pharmacies: { label: 'Pharmacies', icon: '💊', ring: '#7054a0', csv: ['Pharmacies'] },
  hospitals: { label: 'Hospitals', icon: '🏥', ring: '#bd4138', csv: ['Hospitals'] },
  shopping: { label: 'Shopping centres', icon: '🛍️', ring: '#bd7627', csv: ['Shopping_Malls'] },
  parks: { label: 'Parks', icon: '🌳', ring: '#4b8550', csv: ['Parks'] },
  landmarks: { label: 'Monuments & landmarks', icon: '🏛️', ring: '#a65c3b' },
};
export const BRAND_KEYS = Object.keys(AMENITY_CATEGORIES).filter((k) => AMENITY_CATEGORIES[k].logo);
// shopChains.js keys (Amenities tab) that have a word logo
export const CHAIN_LOGO = { tesco: 'tesco', lidl: 'lidl', aldi: 'aldi', dunnes: 'dunnes', supervalu: 'supervalu', spar: 'spar', centra: 'centra', mace: 'mace', londis: 'londis', costcutter: 'costcutter', daybreak: 'daybreak', circlek: 'circlek', polonez: 'polonez' };

// Nearby places that appear by themselves when zoomed in: names only (no emoji), coloured by type
// like Google Maps. Emoji pins are kept for the layers the user switches on.
export const POI_STYLE = {
  Restaurants: ['#c2571a', 'Restaurant'],
  Asian_Restaurants: ['#c2571a', 'Asian restaurant'],
  Cafes: ['#c2571a', 'Café'],
  Groceries: ['#2f6db5', 'Grocery'],
  Supermarkets: ['#2f6db5', 'Supermarket'],
  Shopping_Malls: ['#2f6db5', 'Shopping centre'],
  Pharmacies: ['#c0392b', 'Pharmacy'],
  Hospitals: ['#c0392b', 'Hospital'],
  Gyms: ['#6a4fc4', 'Gym'],
  Salons: ['#b5487a', 'Salon'],
  Parks: ['#2e7d4f', 'Park'],
};
export const hasName = (record) => Boolean(record.name && record.name.trim());

export const PLACE_EMOJI = {
  park: '🌳', garden: '🌷', university: '🎓', museum: '🏛️', stadium: '🏟️', tower: '🗼', lighthouse: '🗼',
  beach: '🏖️', water: '🌊', castle: '🏰', church: '⛪', landmark: '📍', monument: '🗿', market: '🏪',
  shop: '🛍️', cinema: '🎬', venue: '🎭', village: '🏘️', nature: '🌿', hospital: '🏥',
};
export const RING = { uni: '#173f37', place: '#b8862f', landmark: '#a65c3b', housing: '#7a3fa0' };
export const RESIDENCES_URL = '/data/student-residences.json';
export const euro = (v) => `€${Math.round(v).toLocaleString('en-IE')}`;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export const shortName = (name) => String(name)
  .replace('Technological University Dublin', 'TU Dublin')
  .replace('Dublin City University', 'DCU')
  .replace('University College Dublin', 'UCD')
  .replace(/ Campus$/, '');

export const brandLogo = (key) => `<span class="jp-brand-logo jp-brand-logo-${key}">${escapeHtml(AMENITY_CATEGORIES[key].logo)}</span>`;

export function metres(a, b) {
  const dy = (b[0] - a[0]) * 110540;
  const dx = (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

export function districtIdFromPostcode(value) {
  const match = String(value ?? '').trim().match(/^Dublin\s*(\d{1,2}W?)$/i);
  return match ? `D${match[1].toUpperCase()}` : '';
}

export function convertCoordinates(coordinates) {
  if (Array.isArray(coordinates) && typeof coordinates[0] === 'number') return proj4('EPSG:2157', 'EPSG:4326', coordinates);
  return coordinates.map(convertCoordinates);
}

export function isBrandName(name, brand) {
  const n = name.trim().toLocaleLowerCase();
  return n === brand || n.startsWith(`${brand} `);
}

export function brandOf(record) {
  if (!['Supermarkets', 'Groceries'].includes(record.category)) return null;
  return BRAND_KEYS.find((k) => AMENITY_CATEGORIES[k].brandNames.some((b) => isBrandName(record.name, b))) || null;
}

export function recordMatchesAmenityLayer(record, key) {
  const category = AMENITY_CATEGORIES[key];
  if (!category.csv) return false;
  if (category.brandNames) return brandOf(record) === key;
  if (!category.csv.includes(record.category)) return false;
  if (key === 'supermarkets' || key === 'groceries') return !brandOf(record);
  return true;
}

export function distanceMetres(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// One pin: a white circle with an emoji (or a store's word logo), a coloured ring, and a name that shows when zoomed in
export function pinHtml({ emoji, ring = '#5f6f67', kind, label, brand }) {
  const dot = brand ? `<span class="pm-dot pm-brand">${brandLogo(brand)}</span>` : `<span class="pm-dot">${escapeHtml(emoji)}</span>`;
  return `<div class="pm pm-${kind}" style="--ring:${ring}">${dot}${label ? `<span class="pm-label">${escapeHtml(label)}</span>` : ''}</div>`;
}

// A transit stop: a white disc with a coloured ring and a name when zoomed in
export function stopHtml(colour, label, kind = 'stop') {
  return `<div class="tr-stop tr-${kind}" style="--ring:${colour}"><span class="tr-stop-dot"></span>${label ? `<span class="pm-label">${escapeHtml(label)}</span>` : ''}</div>`;
}
