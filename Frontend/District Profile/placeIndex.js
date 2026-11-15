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
  eircode: [0, 'Eircode'],
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
      list.push({ kind: 'district', code, label: `${code} · ${p.name}`, sub: 'District profile', lat: at[0], lng: at[1], keys: `${code} ${num ? `dublin ${num} d ${num} d${num.padStart(2, '0')}` : ''} ${p.name}` })
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
    list.push({ kind: 'uni', label: u.name, sub: u.location, lat: u.coordinates[0], lng: u.coordinates[1], keys: `${u.name} ${alias} university college campus`, short: SHORT_NAMES[u.id.split('-')[0]] || [] })
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
    // a university's own short name ("ucd", "dcu", "tcd", "trinity") puts it first, above places named after it
    if (p.short?.includes(q)) score -= 60
    if (p.n === q) score -= 40
    else if (p.n.startsWith(q)) score -= 25
    else if (p.words[0].startsWith(terms[0])) score -= 12
    // every typed word is a whole word of the place: "D1" and "Dublin 1" put D1 above D10, D11 and D13
    if (terms.every((t) => p.words.includes(t))) score -= 15
    score += Math.min(p.label.length, 60) / 20 // shorter names first
    hits.push([score, p])
  }
  hits.sort((a, b) => a[0] - b[0])
  // rows that would look identical (e.g. three "Spar · Groceries · D1") show once; the same name in different
  // areas stays (up to three)
  const count = {}
  const seen = new Set()
  const out = []
  for (const [, p] of hits) {
    const look = `${p.n}|${norm(p.sub)}`
    if (seen.has(look)) continue
    seen.add(look)
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

// ---------------- Eircodes: "D07 ED7R", "d07ed7r", "K78 X2Y3"…
// A routing key (A, C-F, H, K, N, P, R, T, V-Y and two digits, or D6W) and a four-character identifier
const EIRCODE = /^\s*([AC-FHKNPRTV-Y]\d{2}|D6W)\s*([0-9AC-FHKNPRTV-Y]{4})\s*$/i

// The Eircode written the standard way ("D07 ED7R"), or null if the text isn't one
export function parseEircode(text) {
  const m = (text || '').match(EIRCODE)
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null
}

const eircodeCache = new Map()
const API_URL = import.meta.env.VITE_API_URL ?? 'https://crib-crew-recommender-api.onrender.com'

// The place an Eircode belongs to: our server's exact lookup first (every Eircode), then OpenStreetMap (many
// of them), and failing both, the area its routing key names (D07 → D7, K78 → Lucan), so that area opens.
export async function searchEircode(text) {
  const code = parseEircode(text)
  if (!code) return []
  if (eircodeCache.has(code)) return eircodeCache.get(code)
  const flat = code.replace(' ', '')
  let out = []
  // 1. our server: every Eircode, from the Eircode address data (Google Geocoding)
  try {
    const r = await fetch(`${API_URL}/eircode/${encodeURIComponent(flat)}`, { headers: { Accept: 'application/json' } })
    if (r.ok) {
      const p = await r.json()
      const title = p.name || p.street
      out = [{
        kind: 'eircode', label: title || `Eircode ${code}`,
        sub: [title ? `Eircode ${code}` : null, p.name && p.street ? p.street : null, p.area].filter(Boolean).join(' · ') || 'Dublin',
        lat: p.lat, lng: p.lng,
      }]
    }
  } catch { /* server unreachable: try OpenStreetMap */ }
  // 2. OpenStreetMap, which has many Eircodes (used when the server's lookup isn't set up or doesn't answer)
  if (!out.length) await nominatimTurn()
  if (!out.length) try {
    const params = new URLSearchParams({ q: code, format: 'jsonv2', limit: '5', countrycodes: 'ie', addressdetails: '1', namedetails: '1', 'accept-language': 'en' })
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' } })
    const rows = r.ok ? await r.json() : []
    const row = rows.find((x) => (x.address?.postcode || '').replace(/\s+/g, '').toUpperCase() === flat)
    if (row) {
      const a = row.address || {}
      const isCode = (t) => (t || '').replace(/\s+/g, '').toUpperCase() === flat
      const district = (a.postcode || code).match(/^D0?(\d{1,2})\b/i)?.[1]
      const named = [row.name, row.namedetails?.name, a.building, a.amenity, a.tourism, a.shop, a.office, a.leisure, a.house_name]
        .find((t) => t && !isCode(t) && !/\b(ED|ward)\b/i.test(t))
      const street = [a.house_number, a.road].filter(Boolean).join(' ')
      // electoral divisions and old wards ("Saint Kevin's ED", "Arran Quay B Ward 1986") aren't places people know
      const admin = (t) => /\b(ED|ward)\b|\bward \d{4}/i.test(t || '')
      const area = [a.suburb, a.neighbourhood, a.quarter, a.city_district, a.town, a.village].find((t) => t && !admin(t))
        || (district ? `Dublin ${district}` : a.city)
      // the building's name is often only in the display name, right after the Eircode itself
      const fromName = row.display_name.split(',').map((t) => t.trim()).slice(0, 2)
        .find((t) => t && !isCode(t) && !admin(t) && !/^\d+$/.test(t) && t !== a.road && t !== area && !/^(dublin|county|leinster|ireland|éire)/i.test(t))
      const title = named || fromName
      out = [{
        kind: 'eircode', label: title || street || `Eircode ${code}`,
        sub: [title || street ? `Eircode ${code}` : null, title && street ? street : null, area].filter(Boolean).join(' · ') || 'Dublin',
        lat: Number(row.lat), lng: Number(row.lon),
      }]
    }
  } catch { /* no network: fall back to the area below */ }
  // 3. the Eircode's routing key still says which Dublin area it is in
  if (!out.length) {
    const key = code.slice(0, 3)
    const district = key.startsWith('D') && key !== 'D6W' ? `D${Number(key.slice(1))}` : key
    const hit = extra.find((p) => p.kind === 'district' && p.code === district)
    if (hit) {
      out = [{
        kind: 'eircode', approx: true, code: district, label: code,
        sub: `Exact address isn’t on the open map · shows ${hit.label.split(' · ')[1] || district} (${district})`,
        lat: hit.lat, lng: hit.lng,
      }]
    }
  }
  eircodeCache.set(code, out)
  return out
}
