// Place search for the district map and the journey planner's A / B boxes.
// Local list (instant, as you type): districts, universities, famous places, neighbourhoods, train and
// Luas stations, and the named shops, cafés, gyms etc. already shown on the map.
// Streets and addresses: OpenStreetMap's Nominatim, only when the user presses Enter or picks
// "Search streets and addresses" (its usage policy doesn't allow search-as-you-type), at most once a second.
import { loadAmenityRecords } from './amenityData';
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
  const [places, rail, records, housing] = await Promise.all([
    getJson(`${PLANNER}places.json`),
    getJson('/data/dublin-rail-stations.geojson'),
    loadAmenityRecords().catch(() => []),
    getJson('/data/student-residences.json'),
  ])
  const list = [...extra]
  universities.forEach((u) => {
    const alias = CAMPUS_ALIASES[u.id.split('-')[0]] || ''
    list.push({ kind: 'uni', label: u.name, sub: u.location, lat: u.coordinates[0], lng: u.coordinates[1], keys: `${u.name} ${alias} university college campus` })
  })
  ;(places || []).forEach((p) => list.push({ kind: 'place', label: p.name, sub: p.category || 'Famous place', lat: p.lat, lng: p.lon }))
  ;(housing?.residences || []).forEach((r) => list.push({
    kind: 'housing', label: r.name, sub: [r.operator, r.address].filter(Boolean).join(' · ') || `Student residence in ${r.district}`,
    lat: r.lat, lng: r.lon, keys: `${r.name} ${r.operator || ''} student residence accommodation housing ${r.district}`,
  }))
  ;(rail?.features || []).forEach((f) => {
    const [lng, lat] = f.geometry.coordinates
    list.push({ kind: 'station', label: `${f.properties.name} station`, sub: f.properties.dart ? 'DART station' : 'Train station', lat, lng, keys: `${f.properties.name} station train rail ${f.properties.dart ? 'dart' : ''}` })
  })
  const seen = new Set()
  ;(records || []).forEach((r) => {
    const name = (r.name || '').trim()
    if (!name || !Number.isFinite(r.latitude)) return
    const id = `${norm(name)}|${r.latitude.toFixed(3)}|${r.longitude.toFixed(3)}` // one per ~100 m
    if (seen.has(id)) return
    seen.add(id)
    list.push({ kind: 'amenity', label: name, sub: `${r.category} · ${r.area}`, lat: r.latitude, lng: r.longitude, keys: `${name} ${r.category}` })
  })
  list.forEach((p) => { p.n = norm(p.label); p.words = norm(`${p.label} ${p.keys || ''}`).split(' ') })
  return list
}

export function loadPlaceIndex() {
  if (!built) built = build().catch((e) => { built = null; throw e })
  return built
}

// Every typed word must start a word of the place (so "tu grang" finds TU Dublin Grangegorman).
export function searchPlaces(list, query, limit = 8) {
  const q = norm(query)
  if (!q) return []
  const terms = q.split(' ')
  const hits = []
  for (const p of list) {
    if (!terms.every((t) => p.words.some((w) => w.startsWith(t)))) continue
    let score = KINDS[p.kind][0] * 10
    if (p.n === q) score -= 40
    else if (p.n.startsWith(q)) score -= 25
    else if (p.words[0].startsWith(terms[0])) score -= 12
    score += Math.min(p.label.length, 60) / 20 // shorter names first
    hits.push([score, p])
  }
  hits.sort((a, b) => a[0] - b[0])
  // the same name twice (e.g. a chain shop) keeps both, but not more than three of one name
  const count = {}
  const out = []
  for (const [, p] of hits) {
    count[p.n] = (count[p.n] || 0) + 1
    if (count[p.n] > 3) continue
    out.push(p)
    if (out.length >= limit) break
  }
  return out
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
