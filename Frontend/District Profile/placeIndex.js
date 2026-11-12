// Place search for the district map and the journey planner's A / B boxes.
// Local list (instant, as you type): districts, universities, famous places, neighbourhoods, train and
// Luas stations, every supermarket-chain shop (dublin-chain-shops.json) and the named shops, cafés, gyms etc.
// already shown on the map. Typing an Eircode routing key (D07, D7, D6W, A96, or a whole Eircode such as
// D07 X2Y3) lists that area: on its own its supermarkets, with other words ("D07 gym") the matching places in it.
// Streets and addresses: OpenStreetMap's Nominatim, only when the user presses Enter or picks
// "Search streets and addresses" (its usage policy doesn't allow search-as-you-type), at most once a second.
import { loadAmenityRecords, loadVerifiedChainShops } from './amenityData';
import { chainOf } from './shopChains';
import { universities } from './cityPlaces';
import { format as streetLabel, nominatimTurn } from './placeNames';

const PLANNER = '/journey-planner/';

// short names people type for each campus
const CAMPUS_ALIASES = {
  tu: 'tu dublin tud dit technological university',
  tcd: 'trinity tcd',
  ucd: 'ucd',
  dcu: 'dcu',
  rcsi: 'rcsi surgeons',
  ncad: 'ncad art design',
  griffith: 'griffith',
  nci: 'nci national college of ireland',
  dbs: 'dbs dublin business school',
  iadt: 'iadt dun laoghaire',
  maynooth: 'maynooth mu nuim',
}
// a university's own short names: typing one exactly puts that university first
const SHORT_NAMES = {
  tu: ['tu', 'tud', 'dit'], tcd: ['tcd', 'trinity'], ucd: ['ucd'], dcu: ['dcu'], rcsi: ['rcsi'], ncad: ['ncad'],
  griffith: ['griffith'], nci: ['nci'], dbs: ['dbs'], iadt: ['iadt'], maynooth: ['maynooth', 'mu', 'nuim'],
}

// kind → [order in the results, label shown under the name]
export const KINDS = {
  district: [0, 'District'],
  uni: [1, 'University'],
  place: [2, 'Famous place'],
  housing: [2, 'Student residence'],
  area: [3, 'Neighbourhood'],
  station: [4, 'Station'],
  amenity: [5, 'Place'],
  address: [6, 'Address'],
}

export const norm = (text) => (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

let extra = []
let built = null

// How each map category reads under a place's name
const CATEGORY = {
  Supermarkets: 'Supermarket', Groceries: 'Grocery shop', Restaurants: 'Restaurant', Asian_Restaurants: 'Asian restaurant',
  Cafes: 'Café', Parks: 'Park', Pharmacies: 'Pharmacy', Gyms: 'Gym', Shopping_Malls: 'Shopping centre', Hospitals: 'Hospital',
}

// D1 … D24 in number order, D6W after D6, then the County Dublin areas (A41 … K78)
const areaOrder = (code) => {
  const m = String(code || '').match(/^D(\d+)(W?)$/)
  return m ? Number(m[1]) + (m[2] ? 0.5 : 0) : code ? 30 : 99
}

// An Eircode routing key in any usual spelling ("d07", "d7", "d6w", "a96") or a whole Eircode ("d07x2y3")
// → the area code the site uses (D7, D6W, A96); anything else → null
export function areaCode(term) {
  const t = term.length === 7 && /\d/.test(term.slice(3)) ? term.slice(0, 3) : term
  const d = t.match(/^d0?(\d{1,2})(w?)$/)
  if (d && Number(d[1]) >= 1 && Number(d[1]) <= 24) return `D${Number(d[1])}${d[2] ? 'W' : ''}`
  return /^[ak]\d{2}$/.test(t) ? t.toUpperCase() : null
}

// The district page adds its districts and neighbourhoods once its data has loaded
export function addDistrictPlaces(data) {
  if (!data?.profiles) return
  const list = []
  Object.entries(data.profiles).forEach(([code, p]) => {
    const at = data.labels?.[code]
    if (at) {
      const num = code.match(/^D(\d+)/)?.[1]
      list.push({ kind: 'district', code, label: `${code} · ${p.name}`, sub: 'District profile', lat: at[0], lng: at[1], keys: `${code} ${num ? `dublin ${num} d ${num}` : ''} ${p.name}` })
    }
    ;(p.areas || []).forEach(([name, lat, lng]) => list.push({ kind: 'area', label: name, sub: `Neighbourhood in ${code}`, lat, lng, district: code }))
  })
  ;(data.stops || []).forEach((s) => list.push({ kind: 'station', label: `${s.name} (Luas)`, sub: 'Luas stop', lat: s.lat, lng: s.lng, keys: `${s.name} luas` }))
  extra = list
  built = null
}

const getJson = (url) => fetch(url, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

async function build() {
  const [places, rail, records, housing, chainShops] = await Promise.all([
    getJson(`${PLANNER}places.json`),
    getJson('/data/dublin-rail-stations.geojson'),
    loadAmenityRecords().catch(() => []),
    getJson('/data/student-residences.json'),
    loadVerifiedChainShops().catch(() => []),
  ])
  const list = [...extra]
  universities.forEach((u) => {
    const alias = CAMPUS_ALIASES[u.id.split('-')[0]] || ''
    list.push({ kind: 'uni', label: u.name, sub: u.location, lat: u.coordinates[0], lng: u.coordinates[1], keys: `${u.name} ${alias} university college campus`, short: SHORT_NAMES[u.id.split('-')[0]] || [] })
  })
  ;(places || []).forEach((p) => list.push({ kind: 'place', label: p.name, sub: p.category || 'Famous place', lat: p.lat, lng: p.lon }))
  ;(housing?.residences || []).forEach((r) => list.push({
    kind: 'housing', label: r.name, sub: [r.operator, r.address].filter(Boolean).join(' · ') || `Student residence in ${r.district}`,
    lat: r.lat, lng: r.lon, district: r.district, keys: `${r.name} ${r.operator || ''} student residence accommodation housing ${r.district}`,
  }))
  ;(rail?.features || []).forEach((f) => {
    const [lng, lat] = f.geometry.coordinates
    list.push({ kind: 'station', label: `${f.properties.name} station`, sub: f.properties.dart ? 'DART station' : 'Train station', lat, lng, keys: `${f.properties.name} station train rail ${f.properties.dart ? 'dart' : ''}` })
  })
  // Every supermarket-chain shop in Dublin, each in the district it is actually in. The map's own list (the
  // CSV) only covers the streets near each district's commute points, so on its own it misses many shops.
  const shops = []
  ;(chainShops || []).forEach((c) => {
    if (!Number.isFinite(c.lat)) return
    shops.push({ kind: 'amenity', label: c.name, cat: 'Supermarket', shop: true, chain: c.chain, district: c.district, lat: c.lat, lng: c.lng,
      keys: `${c.name} supermarket supermarkets shop grocery ${c.district}` })
  })
  const nearChainShop = (name, lat, lng) => {
    const chain = chainOf(name)
    return chain && shops.some((c) => c.chain === chain && Math.abs(c.lat - lat) < 0.0011 && Math.abs(c.lng - lng) < 0.0016) // ~120 m
  }
  list.push(...shops)
  const seen = new Set()
  ;(records || []).forEach((r) => {
    const name = (r.name || '').trim()
    if (!name || !Number.isFinite(r.latitude)) return
    const id = `${norm(name)}|${r.latitude.toFixed(3)}|${r.longitude.toFixed(3)}` // one per ~100 m
    if (seen.has(id)) return
    seen.add(id)
    const grocery = r.category === 'Supermarkets' || r.category === 'Groceries'
    if (grocery && nearChainShop(name, r.latitude, r.longitude)) return // already listed from the chain-shop file
    const cat = CATEGORY[r.category] || r.category
    list.push({ kind: 'amenity', label: name, cat, shop: r.category === 'Supermarkets', district: r.area, lat: r.latitude, lng: r.longitude,
      keys: `${name} ${r.category} ${cat}` })
  })
  // "Lidl · Supermarket · near Phibsborough, D7": the nearest neighbourhood tells shops of the same name apart
  const hoods = list.filter((p) => p.kind === 'area')
  list.forEach((p) => {
    if (p.kind !== 'amenity') return
    let best = null
    let bestKm = 1.5
    for (const h of hoods) {
      if (p.district && h.district && h.district !== p.district) continue
      const km = Math.hypot((h.lat - p.lat) * 111, (h.lng - p.lng) * 67)
      if (km < bestKm) { best = h; bestKm = km }
    }
    p.sub = [p.cat, best ? `near ${best.label}${p.district ? `, ${p.district}` : ''}` : p.district].filter(Boolean).join(' · ')
  })
  list.forEach((p) => { p.n = norm(p.label); p.words = norm(`${p.label} ${p.keys || ''}`).split(' '); p.order = areaOrder(p.district || p.code) })
  return list
}

export function loadPlaceIndex() {
  if (!built) built = build().catch((e) => { built = null; throw e })
  return built
}

// The same place mapped twice (a point and its building) shows once; shops of the same name each show
function unique(places, limit) {
  const seen = new Set()
  const out = []
  for (const p of places) {
    const look = `${p.n}|${norm(p.sub)}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`
    if (seen.has(look)) continue
    seen.add(look)
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}

// Every typed word must start a word of the place (so "tu grang" finds TU Dublin Grangegorman). Every match is
// listed (up to `limit`), so all of a chain's shops show, not just the first few.
export function searchPlaces(list, query, limit = 60) {
  const q = norm(query)
  if (!q) return []
  let area = null
  let terms = q.split(' ').filter((t) => {
    if (area) return true
    area = areaCode(t)
    return !area
  })
  if (area) terms = terms.filter((t) => !/^(?=.*\d)[a-z0-9]{4}$/.test(t)) // the second half of a whole Eircode
  const inArea = (p) => p.district === area || (p.kind === 'district' && p.code === area)
  if (area && !terms.length) {
    // just a routing key ("D07"): that district, then its supermarkets
    const district = list.filter((p) => p.kind === 'district' && p.code === area)
    const shops = list.filter((p) => p.shop && p.district === area)
      .sort((a, b) => a.label.localeCompare(b.label) || a.sub.localeCompare(b.sub))
    return unique([...district, ...shops], limit)
  }
  const hits = []
  for (const p of area ? list.filter(inArea) : list) {
    if (!terms.every((t) => p.words.some((w) => w.startsWith(t)))) continue
    let score = KINDS[p.kind][0] * 10
    // a university's own short name ("ucd", "dcu", "tcd", "trinity") puts it first, above places named after it
    if (p.short?.includes(q)) score -= 60
    if (p.n === q) score -= 40
    else if (p.n.startsWith(q)) score -= 25
    else if (p.words[0].startsWith(terms[0])) score -= 12
    score += Math.min(p.label.length, 60) / 20 // shorter names first
    score += p.order / 1000 // then district by district: D1, D2 … D24, County Dublin
    hits.push([score, p])
  }
  hits.sort((a, b) => a[0] - b[0])
  return unique(hits.map(([, p]) => p), limit)
}

const addressCache = new Map()

// Streets and addresses in County Dublin
export async function searchAddresses(query) {
  const q = query.trim()
  if (q.length < 3) return []
  if (addressCache.has(q)) return addressCache.get(q)
  await nominatimTurn()
  const params = new URLSearchParams({
    q, format: 'jsonv2', limit: '6', countrycodes: 'ie', viewbox: '-6.55,53.64,-6.0,53.17', bounded: '1', addressdetails: '1', 'accept-language': 'en',
  })
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' } })
    if (!r.ok) return []
    const rows = await r.json()
    const out = []
    rows.forEach((row) => {
      const a = row.address || {}
      const label = streetLabel(row) || row.display_name.split(',')[0]
      if (out.some((o) => o.label === label)) return // the same street in several pieces
      const district = (a.postcode || '').match(/^D0?(\d{1,2})\b/i)?.[1] // D01 FK52 → Dublin 1
      const sub = [district ? `Dublin ${district}` : null, a.suburb || a.city || a.town || a.village].filter(Boolean).join(', ')
      out.push({ kind: 'address', label, sub: sub || 'Dublin', lat: Number(row.lat), lng: Number(row.lon) })
    })
    addressCache.set(q, out)
    return out
  } catch {
    return []
  }
}
