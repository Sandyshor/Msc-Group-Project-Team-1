// District list, icons, colours and safety bands shared by the map and the profile panel.

export const DUBLIN_DISTRICTS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D6W', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12',
  'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D20', 'D22', 'D24'];
// County Dublin Eircode routing areas outside D1-D24 (approximate areas, see public/data/county-dublin-areas.geojson)
export const COUNTY_AREAS = ['A41', 'A42', 'A45', 'A94', 'A96', 'K32', 'K34', 'K36', 'K45', 'K56', 'K67', 'K78'];
const ALL_DISTRICTS = [...DUBLIN_DISTRICTS, ...COUNTY_AREAS];

export const ACTIVE_DISTRICTS = ALL_DISTRICTS;


export const HEAT_STOPS = [
  [0, '#b23a2f'], [30, '#c94a35'], [40, '#e0694a'], [50, '#f4cf62'], [57, '#b5cf6c'], [65, '#5fae6b'], [100, '#25704a'],
];
export const SAFETY_BANDS = [
  [57, 'Lower recorded crime', 'Safer than Irish towns'],
  [50, 'Below-benchmark crime', 'A little safer than Irish towns'],
  [40, 'Above-benchmark crime', 'More crime than Irish towns'],
  [0, 'Higher recorded crime', 'Much more crime than Irish towns'],
];
export const safetyLabel = (score) => (SAFETY_BANDS.find(([min]) => score >= min) || SAFETY_BANDS[3])[1];
export const safetyPlain = (score) => (SAFETY_BANDS.find(([min]) => score >= min) || SAFETY_BANDS[3])[2];
// The colour for a score, blended between the stops
export function heatColor(score) {
  const i = Math.max(1, HEAT_STOPS.findIndex(([v]) => v >= score));
  const [[v0, c0], [v1, c1]] = [HEAT_STOPS[i - 1], HEAT_STOPS[i] ?? HEAT_STOPS[i - 1]];
  const t = v1 === v0 ? 0 : (score - v0) / (v1 - v0);
  const rgb = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const [a, b2] = [rgb(c0), rgb(c1)];
  return `rgb(${a.map((x, k) => Math.round(x + (b2[k] - x) * Math.max(0, Math.min(1, t)))).join(',')})`;
}

export const textOnHeat = (score) => (score >= 44 && score < 66 ? '#1f2d24' : '#ffffff');
export { ALL_DISTRICTS };


export const AMENITY_TYPES = [
  ['supermarket', 'Supermarkets', 'cart', '#2f7fd0'],
  ['grocery', 'Groceries', 'basket', '#3aa38a'],
  ['restaurant', 'Restaurants', 'fork', '#e0682e'],
  ['cafe', 'Cafés', 'cup', '#9a6a3c'],
  ['gym', 'Gyms', 'gym', '#7b4fd6'],
  ['park', 'Parks', 'park', '#3e9a3a'],
  ['pharmacy', 'Pharmacies', 'pill', '#d6407a'],
  ['hospital', 'Hospitals', 'hospital', '#d23b3b'],
  ['mall', 'Shopping centres', 'mall', '#c09020'],
];


export const strongColor = (hue) => `hsl(${hue} 55% 38%)`;
export const pastelColor = (hue) => `hsl(${hue} 60% 80%)`;
export const bannerColor = (hue) => `hsl(${hue} 42% 26%)`;

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" ${S}>${d}</svg>`;
export const ICONS = {
  park: svg('<path d="M12 3 6 12h3l-4 6h14l-4-6h3z"/><path d="M12 18v3"/>'),
  garden: svg('<path d="M4 21h16M6 21V11a6 6 0 0 1 12 0v10M12 5v16M6 14h12"/>'),
  university: svg('<path d="M2 9 12 4l10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v5"/>'),
  museum: svg('<path d="M3 9 12 4l9 5M4 20h16M6 10v8M10 10v8M14 10v8M18 10v8"/>'),
  stadium: svg('<ellipse cx="12" cy="10" rx="9" ry="4"/><path d="M3 10v4c0 2.2 4 4 9 4s9-1.8 9-4v-4"/>'),
  tower: svg('<path d="M9 21V9l3-5 3 5v12M7 21h10M9 13h6M9 17h6"/>'),
  lighthouse: svg('<path d="M9 21l1-12h4l1 12M8 21h8M10 9V6h4v3M12 3v1"/>'),
  beach: svg('<path d="M3 20c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M12 17 15 6"/><path d="M8 7a7 7 0 0 1 13 3z"/>'),
  water: svg('<path d="M3 9c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M3 14c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0"/>'),
  castle: svg('<path d="M4 21V8h3v2h2V8h2v2h2V8h2v2h2V8h3v13zM10 21v-4a2 2 0 0 1 4 0v4"/>'),
  church: svg('<path d="M12 2v5M10 4h4M7 21v-9l5-4 5 4v9M4 21h16"/>'),
  landmark: svg('<path d="M4 21h16M5 21V10h14v11M3 10l9-6 9 6M9 21v-6h6v6"/>'),
  monument: svg('<path d="M12 2 10 18h4zM7 21h10M9 18h6"/>'),
  market: svg('<path d="M3 9l2-5h14l2 5M3 9h18v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 12v9h14v-9"/>'),
  shop: svg('<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>'),
  cinema: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14"/>'),
  venue: svg('<path d="M3 20 12 4l9 16zM12 4v16"/>'),
  village: svg('<path d="M2 21h20M4 21v-8l4-3 4 3v8M12 21v-11l4-4 4 4v11"/>'),
  nature: svg('<path d="M4 20c6 0 14-4 16-16C10 4 4 10 4 20zM4 20 14 10"/>'),
  hospital: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>'),
  cart: svg('<path d="M3 4h2l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>'),
  basket: svg('<path d="M4 10h16l-1.5 10h-13zM8 10l3-6M16 10l-3-6"/>'),
  fork: svg('<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>'),
  cup: svg('<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17"/>'),
  gym: svg('<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>'),
  pill: svg('<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="m9 9 6 6"/>'),
  mall: svg('<path d="M3 21V9l9-5 9 5v12M3 21h18M8 21v-6h8v6"/>'),
};
export const iconFor = (name) => ICONS[name] || ICONS.landmark;
