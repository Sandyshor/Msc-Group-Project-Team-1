import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import './SiteTour.css'

// 24px line icons (stroke = currentColor)
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9v11h13V9M10 20v-6h4v6',
  film: 'M4 5h16v14H4zM4 9h16M4 15h16M8 5v4M8 15v4M16 5v4M16 15v4M10.5 10.5v3l3-1.5z',
  faq: 'M12 21a9 9 0 1 0-9-9c0 1.6.4 3.1 1.2 4.4L3 21l4.6-1.2A9 9 0 0 0 12 21ZM9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.3M12 16.6v.1',
  map: 'M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20',
  campus: 'M2 9.5 12 5l10 4.5-10 4.5zM6 11.3V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.7M22 9.5V15',
  sights: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21ZM12 12.3a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  steps: 'M4 19h4v-4h4v-4h4V7h4',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  chat: 'M20 11.5a7.5 7.5 0 0 1-11.1 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5ZM8.6 11.5h.01M12 11.5h.01M15.4 11.5h.01',
}

const steps = [
  {
    path: '/', target: 'home', corner: 'right', icon: 'home', place: 'Home',
    title: 'Welcome to Find My Dublin',
    description: 'Your guide to living and studying in Dublin: find a neighbourhood that fits your budget, campus and lifestyle.',
    tip: 'Take the tour any time from “Take a tour” in the header.',
  },
  {
    path: '/', target: 'home-film', keepClear: '.hf-frame', corner: 'left', icon: 'film', place: 'Home',
    title: 'Watch the Dublin introduction',
    description: 'A short film that shows the city and its everyday atmosphere before you arrive.',
  },
  {
    path: '/', target: 'faq', corner: 'left', icon: 'faq', place: 'Home', isNew: true,
    title: 'Quick answers in the FAQ',
    description: 'Short answers to what new students ask most: which area to live in, rent, getting around, your first days, working while you study, and safety.',
    tip: 'Tap a question to open the answer.',
  },
  {
    path: '/districts', target: 'districts', icon: 'map', place: 'Districts',
    title: 'Explore neighbourhoods',
    description: 'Search by district name or code, such as D1 or Dublin 1, and open a profile with rent, safety, amenities and transport.',
  },
  {
    path: '/campuses', target: 'universities', icon: 'campus', place: 'Campuses',
    title: 'Find your campus',
    description: 'Browse Dublin colleges and campuses and open their official pages. Their locations are on the district maps.',
  },
  {
    path: '/attractions', target: 'attractions', icon: 'sights', place: 'Attractions',
    title: 'Discover the city',
    description: 'Landmarks and places to visit, with photos and links for more information.',
  },
  {
    path: '/things-to-know', target: 'things-to-know', icon: 'list', place: 'Things to know', isNew: true,
    title: 'Your arrival checklist',
    description: 'Step-by-step tasks for before you fly, your first week and your first month: IRP appointment, PPS number, bank account, SIM card, Leap card and more.',
    tip: 'Tick tasks off as you go. Your progress is saved on this device.',
  },
  {
    path: '/how-it-works', target: 'how-it-works', icon: 'steps', place: 'How it works',
    title: 'See how it works',
    description: 'How your budget, campus and priorities turn into neighbourhood matches and everyday travel times.',
  },
  {
    path: '/questionnaire', target: 'questionnaire', icon: 'sliders', place: 'Get matched',
    title: 'Tell us what matters to you',
    description: 'Set your monthly budget, university, accommodation type, travel mode and priorities to get matched.',
  },
  {
    path: '/results', target: 'results', icon: 'star', place: 'Your matches',
    title: 'Review your matches',
    description: 'Compare your recommended neighbourhoods: rent, commute, safety, places to live, and why each one matched.',
  },
  {
    path: null, selector: '.chatw-fab', corner: 'left', icon: 'chat', place: 'On every page', isNew: true, assistant: true,
    title: 'Ask the AI assistant',
    description: 'Stuck on something? The “Ask me” button opens the Crib Crew Assistant. Ask about areas, rent, transport or your first weeks in Dublin.',
    tip: 'It can make mistakes, so check important details with official sources.',
  },
]

function TourIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  )
}

const GAP = 16

// how much of rectangle a the card would cover if it sat at rectangle b
function overlap(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

const SOLID = 'a, button, input, select, textarea, video, iframe, canvas, img, .leaflet-container, [role="button"]'

// How much real content (text, buttons, pictures, maps) sits under a spot: checks a grid of points
// and counts those that land on text or a control, looking underneath the tour card itself.
function busyness(card, spot) {
  let hits = 0
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 6; j++) {
      const x = spot.left + ((i + 0.5) / 8) * spot.width
      const y = spot.top + ((j + 0.5) / 6) * spot.height
      const stack = document.elementsFromPoint(x, y).filter((el) => !card.contains(el)).slice(0, 6)
      const hit = stack.some((el) => {
        const solid = el.closest(SOLID)
        if (solid) {
          const b = solid.getBoundingClientRect()
          return b.width < window.innerWidth * 0.6 // a full-width background picture doesn't count
        }
        return [...el.childNodes].some((n) => {
          if (n.nodeType !== 3 || !n.textContent.trim()) return false
          const range = document.createRange()
          range.selectNodeContents(n)
          return [...range.getClientRects()].some((q) => x >= q.left && x <= q.right && y >= q.top && y <= q.bottom)
        })
      })
      if (hit) hits++
    }
  }
  return hits
}

function SiteTour({ onClose }) {
  const [stepIndex, setStepIndex] = useState(0)
  // which corner of the screen the card sits in, so it never hides the part of the page being shown
  const [corner, setCorner] = useState({ v: 'bottom', h: steps[0].corner || 'right' })
  const [vw, setVw] = useState(() => document.documentElement.clientWidth)
  const cardRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  const step = steps[stepIndex]
  const onPage = !step.path || location.pathname === step.path
  const phone = vw <= 480

  // The tour opens each step's page. `expected` is the page the tour wants to be on; `moving` is true
  // while the tour itself is changing page.
  const expected = useRef(null)
  const moving = useRef(false)
  useEffect(() => {
    expected.current = step.path || location.pathname
    if (step.path && location.pathname !== step.path) { moving.current = true; navigate(step.path) }
  }, [stepIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // The user went to another page themselves (a menu link, "Start the questionnaire"...): the tour closes
  // and lets them go, instead of pulling them back.
  useEffect(() => {
    if (location.pathname === expected.current) { moving.current = false; return }
    if (!moving.current) onClose()
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onResize = () => setVw(document.documentElement.clientWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Steps with a set corner start gliding there the moment Next is pressed, while the page scrolls,
  // instead of waiting for the scroll to finish and then jumping.
  useLayoutEffect(() => {
    if (step.corner && !phone) setCorner((c) => (c.h === step.corner && c.v === 'bottom' ? c : { ...c, v: 'bottom', h: step.corner }))
  }, [stepIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Where the card sits. Steps can name a corner (home: bottom right; film and FAQ: bottom left, next to the
  // video and the questions). Other steps take the bottom corner that hides the least text, buttons and
  // pictures. Phones (card spans the width): bottom, or top when that hides less of the highlighted part.
  const place = useCallback((allowScroll) => {
    const card = cardRef.current
    const target = document.querySelector(step.selector || `[data-site-tour="${step.target}"]`)
    if (!card || !target) return
    const clear = (step.keepClear && target.querySelector(step.keepClear)) || target
    const vw = window.innerWidth
    const vh = window.innerHeight
    const top = Math.max(GAP, document.querySelector('.navbar')?.getBoundingClientRect().bottom + GAP || GAP)
    const cw = card.offsetWidth
    const ch = card.offsetHeight
    const r = clear.getBoundingClientRect()
    const seen = { left: r.left, right: r.right, top: Math.max(r.top, 0), bottom: Math.min(r.bottom, vh) }
    const phone = vw <= 480
    let best

    if (phone) {
      const spots = ['bottom', 'top'].map((v) => {
        const y = v === 'bottom' ? vh - GAP - ch : top
        return { v, h: 'right', cover: overlap(seen, { left: GAP, right: GAP + cw, top: y, bottom: y + ch }) }
      }).sort((a, b) => a.cover - b.cover)
      best = spots[0]
    } else if (step.corner) {
      best = { v: 'bottom', h: step.corner }
    } else {
      const y = vh - GAP - ch
      const score = (h) => busyness(card, { left: h === 'left' ? GAP : vw - GAP - cw, top: y, width: cw, height: ch })
      const left = score('left')
      const right = score('right')
      // keep the current side unless the other one is clearly emptier, so the card doesn't jump while scrolling
      const now = cardRef.current.classList.contains('at-left') ? 'left' : 'right'
      const other = now === 'left' ? 'right' : 'left'
      const s = { left, right }
      best = { v: 'bottom', h: s[other] + 3 < s[now] ? other : now }
    }

    if (allowScroll) {
      // still covering the highlighted part? scroll so it sits fully above (or on phones, below) the card
      const x = phone || best.h === 'left' ? GAP : vw - GAP - cw
      const y = best.v === 'bottom' ? vh - GAP - ch : top
      const room = vh - top - ch - GAP * 2
      if (overlap(seen, { left: x, right: x + cw, top: y, bottom: y + ch }) > 0 && r.height <= room) {
        const up = r.bottom - (vh - ch - GAP * 2)
        const down = r.top - (top + ch + GAP)
        const useBottom = !phone || Math.abs(up) <= Math.abs(down)
        window.scrollBy({ top: useBottom ? up : down, behavior: 'instant' })
        best = { v: useBottom ? 'bottom' : 'top', h: best.h }
      }
    }
    setCorner((c) => (c.v === best.v && c.h === best.h && c.top === top ? c : { v: best.v, h: best.h, top }))
  }, [step])

  useEffect(() => {
    if (!onPage) return undefined
    const target = document.querySelector(step.selector || `[data-site-tour="${step.target}"]`)
    if (!target) return undefined
    target.classList.add('site-tour-highlight')
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!step.selector) {
      // a whole page taller than the screen opens at its top (title and intro); smaller parts are centred
      const focus = (step.keepClear && target.querySelector(step.keepClear)) || target
      const tall = focus.getBoundingClientRect().height > window.innerHeight
      focus.scrollIntoView({ behavior: instant ? 'instant' : 'smooth', block: tall ? 'start' : 'center' })
    }
    const timer = setTimeout(() => place(true), instant ? 30 : 650)
    let idle
    const onMove = () => { clearTimeout(idle); idle = setTimeout(() => place(false), 150) }
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, { passive: true })
    return () => {
      clearTimeout(timer)
      clearTimeout(idle)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove)
      target.classList.remove('site-tour-highlight')
    }
  }, [onPage, step, place])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowRight') setStepIndex((i) => Math.min(i + 1, steps.length - 1))
      if (event.key === 'ArrowLeft') setStepIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function openAssistant() {
    onClose()
    setTimeout(() => document.querySelector('.chatw-fab')?.click(), 50)
  }

  const last = stepIndex === steps.length - 1

  return createPortal(
    <aside
      id="site-tour-panel"
      ref={cardRef}
      className={`site-tour at-${corner.v} at-${corner.h}`}
      style={phone
        ? (corner.v === 'top' ? { top: corner.top } : undefined)
        // laptops and tablets: a pixel `left` (not left/right) so the card slides smoothly between corners
        : { left: corner.h === 'left' ? 20 : vw - Math.min(400, vw - 32) - 20, right: 'auto' }}
      role="dialog"
      aria-modal="false"
      aria-label="Website tour"
    >
      <div className="site-tour-band">
        <div className="site-tour-topline">
          <span>Website tour · {stepIndex + 1} of {steps.length}</span>
          <button type="button" className="site-tour-close" onClick={onClose} aria-label="Close tour">×</button>
        </div>
        <div className="site-tour-bar" aria-hidden="true">
          <i style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      <div className="site-tour-body" key={stepIndex} aria-live="polite">
        <div className="site-tour-head">
          <span className="site-tour-icon"><TourIcon name={step.icon} /></span>
          <span className="site-tour-place">
            {step.place}
            {step.isNew && <em>New</em>}
          </span>
        </div>
        <h2>{step.title}</h2>
        <p className="site-tour-description">{step.description}</p>
        {step.tip && <p className="site-tour-tip"><b>Tip</b>{step.tip}</p>}
        {step.assistant && (
          <button type="button" className="site-tour-try" onClick={openAssistant}>
            Try the assistant <span aria-hidden="true">→</span>
          </button>
        )}
      </div>

      <nav className="site-tour-dots" aria-label="Tour steps">
        {steps.map((s, i) => (
          <button
            key={s.title}
            type="button"
            className={`${i === stepIndex ? 'is-on' : ''}${i < stepIndex ? ' is-past' : ''}`}
            onClick={() => setStepIndex(i)}
            aria-label={`Step ${i + 1}: ${s.title}`}
            aria-current={i === stepIndex ? 'step' : undefined}
          />
        ))}
      </nav>

      <div className="site-tour-controls">
        <button type="button" className="site-tour-skip" onClick={onClose}>{last ? 'Close' : 'Skip tour'}</button>
        <div className="site-tour-navigation">
          {stepIndex > 0 && (
            <button type="button" className="site-tour-back" onClick={() => setStepIndex(stepIndex - 1)}>
              <span aria-hidden="true">←</span> Back
            </button>
          )}
          {!last ? (
            <button type="button" className="site-tour-next" onClick={() => setStepIndex(stepIndex + 1)}>
              Next <span aria-hidden="true">→</span>
            </button>
          ) : (
            <button type="button" className="site-tour-next" onClick={onClose}>Finish tour ✓</button>
          )}
        </div>
      </div>
    </aside>,
    document.body
  )
}

export default SiteTour
