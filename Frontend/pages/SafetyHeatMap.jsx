import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

// Light basemap so the safety colours stand out (OpenFreeMap: no API key, same provider as the District Profile map).
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Heat scale on the street safety score: 50 = Dublin average. Red below, amber around, green above.
const HEAT_STOPS = [
  [0, '#b23a2f'], [25, '#e0694a'], [40, '#f0a23f'], [50, '#f4cf62'], [60, '#b5cf6c'], [75, '#5fae6b'], [100, '#25704a'],
]
const HEAT_COLOR = ['interpolate', ['linear'], ['get', 'score'], ...HEAT_STOPS.flat()]
const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]

// Same colours in JS, for the pop-up badge and the legend marker.
function heatColor(score) {
  const i = Math.max(1, HEAT_STOPS.findIndex(([v]) => v >= score))
  const [[v0, c0], [v1, c1]] = [HEAT_STOPS[i - 1], HEAT_STOPS[i] ?? HEAT_STOPS[i - 1]]
  const t = v1 === v0 ? 0 : (score - v0) / (v1 - v0)
  const rgb = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16))
  const [a, b] = [rgb(c0), rgb(c1)]
  return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * t)).join(',')})`
}

function label(raw) {
  const score = Math.round(raw)
  if (score >= 60) return 'Safer than Dublin average'
  if (score >= 40) return 'Around Dublin average'
  return 'Below Dublin average'
}

function areaPopup(p) {
  const div = document.createElement('div')
  div.className = 'heat-popup'
  const head = document.createElement('div')
  head.className = 'heat-popup-head'
  const badge = document.createElement('span')
  badge.className = 'heat-popup-score'
  badge.style.background = heatColor(p.score)
  badge.textContent = Math.round(p.score)
  const name = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = p.ed
  const words = document.createElement('small')
  words.textContent = label(p.score)
  name.append(title, words)
  head.append(badge, name)
  const facts = document.createElement('ul')
  for (const text of [`Robberies: ${p.robbery_per_100k} per 100,000 a year`,
    `Public order: ${p.public_order_per_100k} per 100,000 a year`, `Garda station: ${p.garda_nearest_km} km away`]) {
    const li = document.createElement('li')
    li.textContent = text
    facts.append(li)
  }
  div.append(head, facts)
  return div
}

// Neighbourhood chip: a score badge in its heat colour and the name.
function chipElement(place) {
  const chip = document.createElement('div')
  chip.className = 'heat-chip'
  const badge = document.createElement('span')
  badge.style.background = heatColor(place.score)
  badge.textContent = Math.round(place.score)
  const name = document.createElement('span')
  name.textContent = place.name
  const leader = document.createElement('i')
  leader.className = 'heat-chip-leader'
  chip.append(leader, badge, name)
  chip.title = `${place.name}: ${Math.round(place.score)}/100 · ${label(place.score)}`
  return chip
}

// Spots tried around each dot (unit directions), nearest ring first, then a ring further out.
const SPOTS = [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]]
const RINGS = [1, 2.2]
const GAP = 7

function overlap(a, b) {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
  return w > 0 && h > 0 ? w * h : 0
}

// Greedy label layout: every chip is shown, each at the spot that overlaps other chips, dots, the map
// controls and the map edge the least.
function layoutChips(map, chips, pins = []) {
  const { clientWidth: W, clientHeight: H } = map.getContainer()
  const blocked = [{ x1: W - 48, y1: 0, x2: W, y2: 84 }]   // zoom buttons
  const toggles = map.getContainer().parentElement?.querySelector('.heat-toggles')
  if (toggles) {   // layer switches over the top-left corner
    const t = toggles.getBoundingClientRect(), c = map.getContainer().getBoundingClientRect()
    blocked.push({ x1: t.left - c.left - 4, y1: t.top - c.top - 4, x2: t.right - c.left + 4, y2: t.bottom - c.top + 4 })
  }
  for (const pin of pins) {   // residence pins (drawn above their point)
    const p = map.project(pin.getLngLat())
    blocked.push({ x1: p.x - 13, y1: p.y - 30, x2: p.x + 13, y2: p.y + 2 })
  }
  const dots = chips.map(({ marker }) => {
    const p = map.project(marker.getLngLat())
    return { p, box: { x1: p.x - 7, y1: p.y - 7, x2: p.x + 7, y2: p.y + 7 } }
  })
  const placed = []
  chips.forEach(({ marker, el }, i) => {
    const { p } = dots[i]
    const w = el.offsetWidth, h = el.offsetHeight
    let best = null
    for (const ring of RINGS) {
      for (const [ux, uy] of SPOTS) {
        const dx = ux * (w / 2 + GAP) * ring, dy = uy * (h / 2 + GAP) * ring
        const box = { x1: p.x + dx - w / 2, y1: p.y + dy - h / 2, x2: p.x + dx + w / 2, y2: p.y + dy + h / 2 }
        const inside = { x1: 4, y1: 4, x2: W - 4, y2: H - 4 }
        let cost = w * h - overlap(box, inside) * 1   // part outside the map
        for (const other of [...placed, ...blocked]) cost += overlap(box, other) * 2
        dots.forEach((d, j) => { if (j !== i) cost += overlap(box, d.box) * 3 })
        cost += ring > 1 ? 40 : 0   // prefer close to the dot
        if (!best || cost < best.cost) best = { cost, dx, dy, box }
      }
      if (best.cost < 1) break
    }
    placed.push(best.box)
    marker.setOffset([best.dx, best.dy])
    // Leader line from the chip's edge back to its dot.
    const dist = Math.hypot(best.dx, best.dy)
    const angle = Math.atan2(-best.dy, -best.dx)
    const edge = Math.min(w / 2 / Math.abs(Math.cos(angle) || 1e-9), h / 2 / Math.abs(Math.sin(angle) || 1e-9))
    const leader = el.querySelector('.heat-chip-leader')
    leader.style.width = `${Math.max(0, dist - edge - 6)}px`
    leader.style.transform = `rotate(${angle}rad) translateX(${edge}px)`
  })
}

const HOUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z" fill="currentColor"/></svg>'

// Student residence pin, with a pop-up naming it and linking to its website.
function residencePin(res) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'heat-home-pin'
  el.setAttribute('aria-label', `Student residence: ${res.name}`)
  el.innerHTML = HOUSE_ICON
  const box = document.createElement('div')
  box.className = 'heat-popup'
  const title = document.createElement('strong')
  title.textContent = res.name
  const sub = document.createElement('small')
  sub.textContent = ['Student residence', res.operator].filter(Boolean).join(' · ')
  box.append(title, document.createElement('br'), sub)
  if (res.address) {
    const where = document.createElement('small')
    where.className = 'heat-popup-address'
    where.textContent = res.approximate_position ? `${res.address} (pin shows the street, not the exact building)` : res.address
    box.append(where)
  }
  if (res.website) {
    const link = document.createElement('a')
    link.href = res.website
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'Visit website ↗'
    link.className = 'heat-popup-link'
    box.append(link)
  }
  const popup = new maplibregl.Popup({ offset: 26, closeButton: false, focusAfterOpen: false, maxWidth: '240px', className: 'heat-popup-box' })
    .setDOMContent(box)
  return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([res.lon, res.lat]).setPopup(popup)
}

function outerRings(geometry) {
  if (!geometry) return []
  return geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((poly) => poly[0])
}

// Each Census Electoral Division (ED) in the district, coloured by its street safety score, with the
// district's named neighbourhoods labelled on top. Data from GET /safety-map/{area}.
const NO_RESIDENCES = []

export default function SafetyHeatMap({ area, data, score, residences = NO_RESIDENCES }) {
  const container = useRef(null)
  const [failed, setFailed] = useState(false)
  // One layer at a time on top of the colours: neighbourhood names, or student residence pins.
  const [view, setView] = useState('names')
  const shown = useRef({ names: true, homes: false })
  const live = useRef(null)

  useEffect(() => {
    if (!container.current || !data?.areas?.features?.length) return undefined
    const [w, s, e, n] = data.bounds
    const padX = (e - w) * 0.35, padY = (n - s) * 0.35
    let map
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE,
        // Start a little wider and glide in to the district once it's drawn.
        bounds: REDUCED_MOTION ? [[w, s], [e, n]] : [[w - padX, s - padY], [e + padX, n + padY]],
        fitBoundsOptions: { padding: 30 },
        // The page keeps scrolling over the map: zoom with the +/- buttons (or pinch); on touch screens one
        // finger scrolls the page and two fingers move the map.
        scrollZoom: false,
        dragPan: !window.matchMedia?.('(pointer: coarse)').matches,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      })
    } catch {
      setFailed(true)   // e.g. WebGL not available
      return undefined
    }
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    const places = {
      type: 'FeatureCollection',
      features: (data.places || []).map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { score: p.score },
      })),
    }
    const mask = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [WORLD, ...outerRings(data.outline)] } }
    const outline = data.outline ? { type: 'Feature', geometry: data.outline } : null

    // Neighbourhood chips, laid out again whenever the view changes so they never pile up.
    const chips = (data.places || []).map((place) => {
      const el = chipElement(place)
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([place.lon, place.lat])
      return { el, marker }
    })
    const pins = residences.filter((r) => r.lon != null && r.lat != null).map(residencePin)
    // Only one pop-up at a time: opening a residence closes the area one and any other residence.
    let areaPopupOpen = null
    pins.forEach((pin) => pin.getPopup().on('open', () => {
      areaPopupOpen?.remove()
      pins.forEach((other) => other !== pin && other.getPopup().isOpen() && other.togglePopup())
    }))
    const relayout = () => {
      layoutChips(map, shown.current.names ? chips : [], shown.current.homes ? pins : [])
      container.current?.classList.add('chips-ready')
    }
    live.current = { map, chips, pins, relayout, loaded: false, district: [[w, s], [e, n]] }
    // Lay out again when the view settles, once the web font is in (chip widths change) and when the card resizes.
    map.on('idle', relayout)
    let alive = true
    document.fonts?.ready.then(() => alive && relayout())
    const resized = new ResizeObserver(() => { map.resize(); relayout() })
    resized.observe(container.current)

    map.on('load', () => {
      if (shown.current.names) chips.forEach(({ marker }) => marker.addTo(map))
      if (shown.current.homes) pins.forEach((pin) => pin.addTo(map))
      live.current.loaded = true
      // Start the credits folded into the (i) button so they don't cover the district on small cards.
      container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      map.addSource('heat-areas', { type: 'geojson', data: data.areas, generateId: true })
      map.addSource('heat-places', { type: 'geojson', data: places })
      const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
      const fade = { duration: REDUCED_MOTION ? 0 : 900, delay: 0 }

      // Under the basemap's street names: the heat colours and soft white edges between areas.
      map.addLayer({ id: 'heat-fill', type: 'fill', source: 'heat-areas',
        paint: { 'fill-color': HEAT_COLOR, 'fill-opacity': 0, 'fill-opacity-transition': fade } }, firstLabel)
      map.addLayer({ id: 'heat-edges', type: 'line', source: 'heat-areas',
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.85,
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3.5, 0.8] } }, firstLabel)

      // Over everything else: fade out the rest of Dublin, then a glowing district outline.
      if (outline) {
        map.addSource('heat-mask', { type: 'geojson', data: mask })
        map.addSource('heat-outline', { type: 'geojson', data: outline })
        map.addLayer({ id: 'heat-mask', type: 'fill', source: 'heat-mask',
          paint: { 'fill-color': '#f7f4ee', 'fill-opacity': 0.62 } })
        map.addLayer({ id: 'heat-glow', type: 'line', source: 'heat-outline',
          paint: { 'line-color': '#173f32', 'line-width': 10, 'line-blur': 8, 'line-opacity': 0.22 } })
        map.addLayer({ id: 'heat-border', type: 'line', source: 'heat-outline',
          paint: { 'line-color': '#173f32', 'line-width': 1.8, 'line-opacity': 0.85 } })
      }

      // Neighbourhoods: a dot in their own heat colour; the chips are HTML markers (below).
      map.addLayer({ id: 'heat-place-dots', type: 'circle', source: 'heat-places',
        layout: { visibility: shown.current.names ? 'visible' : 'none' },
        paint: { 'circle-radius': 5, 'circle-color': HEAT_COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } })
      requestAnimationFrame(() => {
        map.setPaintProperty('heat-fill', 'fill-opacity', 0.78)
        if (REDUCED_MOTION) relayout()
        else map.fitBounds([[w, s], [e, n]], { padding: { top: 56, bottom: 34, left: 34, right: 58 }, duration: 1400 })
      })
    })

    // Hover (desktop) outlines an area; click or tap shows its figures.
    let hovered = null
    const setHover = (id) => {
      if (hovered != null) map.setFeatureState({ source: 'heat-areas', id: hovered }, { hover: false })
      hovered = id
      if (id != null) map.setFeatureState({ source: 'heat-areas', id }, { hover: true })
    }
    map.on('mousemove', 'heat-fill', (ev) => { map.getCanvas().style.cursor = 'pointer'; setHover(ev.features[0].id) })
    map.on('mouseleave', 'heat-fill', () => { map.getCanvas().style.cursor = ''; setHover(null) })
    map.on('click', 'heat-fill', (ev) => {
      // A tap on a residence pin is for the pin only, not the area underneath.
      if (ev.originalEvent?.target?.closest?.('.heat-home-pin')) return
      pins.forEach((pin) => pin.getPopup().isOpen() && pin.togglePopup())
      areaPopupOpen?.remove()
      areaPopupOpen = new maplibregl.Popup({ closeButton: false, maxWidth: '270px', className: 'heat-popup-box' })
        .setLngLat(ev.lngLat).setDOMContent(areaPopup(ev.features[0].properties)).addTo(map)
    })
    return () => { alive = false; live.current = null; resized.disconnect(); map.remove() }
  }, [data, residences])

  // Switching a layer adds or removes its markers and lays the name chips out again around what's left.
  useEffect(() => {
    const names = view === 'names', homes = view === 'homes'
    shown.current = { names, homes }
    const l = live.current
    if (!l?.loaded) return
    l.chips.forEach(({ marker }) => (names ? marker.addTo(l.map) : marker.remove()))
    l.pins.forEach((pin) => (homes ? pin.addTo(l.map) : pin.remove()))
    if (!homes) l.pins.forEach((pin) => pin.getPopup()?.remove())
    if (l.map.getLayer('heat-place-dots')) l.map.setLayoutProperty('heat-place-dots', 'visibility', names ? 'visible' : 'none')
    // Residences tend to cluster near campuses: zoom in to where they are, and back out to the district after.
    const motion = { duration: REDUCED_MOTION ? 0 : 900 }
    if (homes && l.pins.length) {
      const b = new maplibregl.LngLatBounds()
      l.pins.forEach((pin) => b.extend(pin.getLngLat()))
      l.map.fitBounds(b, { padding: { top: 70, bottom: 30, left: 40, right: 64 }, maxZoom: 16, ...motion })
    } else {
      l.map.fitBounds(l.district, { padding: { top: 56, bottom: 34, left: 34, right: 58 }, ...motion })
    }
    l.relayout()
  }, [view])

  if (failed) return null
  return (
    <figure className="heat-map">
      <div className="heat-map-frame">
        <div ref={container} className="heat-map-canvas" role="img"
          aria-label={`Map of ${area} coloured by street safety score, from red (below the Dublin average) to green (safer)`} />
        {residences.length > 0 && (
          <div className="heat-toggles" role="radiogroup" aria-label="Show on the map">
            <button type="button" role="radio" aria-checked={view === 'names'} onClick={() => setView('names')}>
              <span className="heat-toggle-dot names" aria-hidden="true" />Area names
            </button>
            <button type="button" role="radio" aria-checked={view === 'homes'} onClick={() => setView('homes')}>
              <span className="heat-toggle-dot homes" aria-hidden="true" dangerouslySetInnerHTML={{ __html: HOUSE_ICON }} />
              Student homes ({residences.length})
            </button>
          </div>
        )}
      </div>
      <figcaption className="heat-legend">
        <span className="heat-bar" style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.map(([v, c]) => `${c} ${v}%`).join(', ')})` }}>
          <span className="heat-bar-average" aria-hidden="true" />
          {score != null && (
            <span className="heat-bar-marker" style={{ left: `${Math.max(0, Math.min(100, score))}%`, '--c': heatColor(score) }}>
              <span>{area} {Math.round(score)}</span>
            </span>
          )}
        </span>
        <span className="heat-ticks"><span>Less safe</span><span>Dublin average</span><span>Safer</span></span>
        <span className="heat-note">
          Each area is a Census Electoral Division · tap an area for its figures
        </span>
      </figcaption>
    </figure>
  )
}
