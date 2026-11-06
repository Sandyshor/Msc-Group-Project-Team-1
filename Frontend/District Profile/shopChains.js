
export const CHAINS = [
  ['tesco', 'Tesco', '#00539f', ['tesco']],
  ['lidl', 'Lidl', '#0050aa', ['lidl']],
  ['aldi', 'Aldi', '#1d2f6f', ['aldi']],
  ['dunnes', 'Dunnes Stores', '#2b2b2b', ['dunnes']],
  ['supervalu', 'SuperValu', '#d7262b', ['supervalu', 'super valu']],
  ['ms', 'M&S Food', '#2f4f3f', ['m&s', 'marks & spencer', 'marks and spencer']],
  ['spar', 'Spar', '#00833e', ['spar']],
  ['centra', 'Centra', '#e5671b', ['centra']],
  ['mace', 'Mace', '#c8102e', ['mace']],
  ['londis', 'Londis', '#1f4e9c', ['londis']],
  ['costcutter', 'Costcutter', '#5b2d8e', ['costcutter']],
  ['daybreak', 'Daybreak', '#f0a81c', ['daybreak']],
  ['circlek', 'Circle K', '#e2231a', ['circle k']],
  ['polonez', 'Polonez (Polish food)', '#b0122d', ['polonez']],
  ['asian', 'Asian markets', '#7a3e9d', ['asian', 'asia market', 'oriental', 'spice bazaar', 'kokonut']],
];

const byKey = Object.fromEntries(CHAINS.map((c) => [c[0], c]));
export const chainInfo = (key) => byKey[key];


export function chainOf(name) {
  const low = String(name || '').toLowerCase();
  // "eurospar" and "spar" are both Spar; check longer names first so "Super Valu" is not "Spar"
  for (const [key, , , words] of CHAINS) {
    if (words.some((w) => (w.length <= 4 ? new RegExp(`(^|[^a-z])${w.replace('&', '\\&')}([^a-z]|$)`).test(low) || low.startsWith('euro' + w) : low.includes(w)))) return key;
  }
  return null;
}


export function allChainShops(amenities) {
  const out = [];
  Object.entries(amenities || {}).forEach(([district, pts]) => (pts || []).forEach(([name, cat, lat, lng]) => {
    if (cat !== 'supermarket' && cat !== 'grocery') return;
    const chain = chainOf(name);
    if (chain) out.push({ chain, name, district, lng, lat });
  }));
  return out;
}
