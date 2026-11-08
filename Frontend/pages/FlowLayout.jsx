// The one-screen layout of the "find my match" flow: a sidebar with the steps, a photo panel with the
// step's heading, and the step's content. Used by the questionnaire (and later the results page).
import { useEffect, useRef, useState } from 'react'
import './FlowLayout.css'

const ICON_PATHS = {
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5'],
  sliders: ['M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0', 'M16 4v4M10 10v4M18 16v4'],
  pin: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  euro: ['M17 6.5A7 7 0 1 0 17 17.5', 'M4 10h9M4 14h9'],
  cap: ['M2 9 12 4l10 5-10 5L2 9Z', 'M6 11v5c3.5 2.5 8.5 2.5 12 0v-5', 'M22 9v6'],
  home: ['M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z'],
  route: ['M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  shield: ['M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z', 'm9 12 2 2 4-4'],
  bus: ['M6 4h12a2 2 0 0 1 2 2v10H4V6a2 2 0 0 1 2-2Z', 'M4 11h16M7 19v-3M17 19v-3M8 14h.01M16 14h.01'],
  walk: ['M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'm9 21 2.5-6.5L14 17v4M8 11l2.5-3.5L14 9l2 3M11.5 14.5 13 8'],
  bike: ['M5.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M5.5 14.5 9 8h5l4.5 6.5M9 8l3.5 6.5h-7M13 5h2.5'],
  basket: ['M4 10h16l-1.5 9a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7L4 10Z', 'M8 10l3-6M16 10l-3-6M9 14v3M15 14v3'],
  fork: ['M7 3v8a2 2 0 0 0 4 0V3M9 13v8', 'M16 21V3c2 1.5 3 4 3 7h-3'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z', 'M9 11h6M12 8v6'],
  tree: ['M12 3 7 10h3l-5 7h6v4h2v-4h6l-5-7h3l-5-7Z'],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5 11h14v10H5z', 'M12 15v2'],
  check: ['m5 12.5 4.5 4.5L19 7'],
}

export function FlowIcon({ name }) {
  return (
    <svg className="flow-icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICON_PATHS[name].map((path) => <path d={path} key={path} />)}
    </svg>
  )
}

// label, icon
const STEPS = [
  ['About you', 'person'],
  ['Your priorities', 'sliders'],
  ['Your matches', 'pin'],
]

// step: 1-3 (the current one); onStep(n) when another step is clicked - every step can be clicked, so students
// can go back and forth (the page decides what to do if a step isn't ready yet). Steps listed in `locked`
// show a padlock until the earlier steps are done.
export function FlowSidebar({ step, onStep, locked = [] }) {
  return (
    <nav className="flow-sidebar" aria-label="Steps">
      {STEPS.map(([label, icon], index) => {
        const number = index + 1
        const current = number === step
        const isLocked = locked.includes(number) && !current
        return (
          <button
            key={label}
            type="button"
            className={`flow-step${current ? ' is-current' : ''}${isLocked ? ' is-locked' : ''}`}
            aria-current={current ? 'step' : undefined}
            aria-label={isLocked ? `Step ${number}: ${label} (locked until the earlier steps are done)` : undefined}
            disabled={current}
            onClick={() => onStep(number)}
          >
            <FlowIcon name={icon} />
            <span>
              <small>Step {number}</small>
              {label}
            </span>
            {isLocked && <span className="flow-step-lock" aria-hidden="true"><FlowIcon name="lock" /></span>}
          </button>
        )
      })}
    </nav>
  )
}

// Dublin photos for the panel: a new one every 5 seconds. All from Wikimedia Commons, credited on screen.
// pos = focus point so the subject stays in view in the tall panel
export const FLOW_PHOTOS = [
  { src: '/images/flow/liffey-sunset.jpg', pos: '50% center', place: 'River Liffey at sunset', author: '瑞丽江的河水', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Liffey_River_sunset_-_2025-11-11.jpg' },
  { src: '/images/flow/trinity-long-room.jpg', pos: 'center', place: 'Long Room, Trinity College', author: 'Diliff', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Long_Room_Interior,_Trinity_College_Dublin,_Ireland_-_Diliff.jpg' },
  { src: '/images/flow/georgian-doors.jpg', pos: 'center', place: 'Georgian doors', author: 'Tim Sackton', license: 'CC BY-SA 2.0', page: 'https://commons.wikimedia.org/wiki/File:The_Doors_of_Dublin_(7580307812).jpg' },
  { src: '/images/flow/st-patricks-nave.jpg', pos: 'center', place: "St Patrick's Cathedral", author: 'Diliff', license: 'CC BY-SA 3.0', page: 'https://commons.wikimedia.org/wiki/File:St_Patrick%27s_Cathedral_Nave_3,_Dublin,_Ireland_-_Diliff.jpg' },
  { src: '/images/flow/hapenny-bridge.jpg', pos: '62% center', place: "Ha'penny Bridge", author: 'The wub', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Ha%27penny_Bridge,_Dublin_-_2022-07-20.jpg' },
]
const PHOTO_MS = 5000

export function FlowPhoto({ step, label, title, accent, description, photos = FLOW_PHOTOS }) {
  const [shown, setShown] = useState(0)
  // only load a photo once it is shown or next up, so the page doesn't fetch all of them at once
  const [loaded, setLoaded] = useState(() => new Set([0, 1 % photos.length]))
  useEffect(() => {
    setLoaded((prev) => (prev.has(shown) && prev.has((shown + 1) % photos.length)
      ? prev : new Set([...prev, shown, (shown + 1) % photos.length])))
  }, [shown, photos.length])
  useEffect(() => {
    if (photos.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const id = setInterval(() => setShown((n) => (n + 1) % photos.length), PHOTO_MS)
    return () => clearInterval(id)
  }, [photos.length, shown]) // restarting on a manual pick gives that photo its full 5 seconds

  const current = photos[shown]
  return (
    <aside className="flow-photo">
      {photos.map((p, i) => (
        <div key={p.src} className={`flow-photo-slide${i === shown ? ' is-shown' : ''}`} aria-hidden="true"
          style={{ backgroundImage: loaded.has(i) ? `url("${p.src}")` : undefined, backgroundPosition: p.pos }} />
      ))}
      {current?.author && (
        <p className="flow-photo-credit">
          {current.place} · <a href={current.page} target="_blank" rel="noreferrer">{current.author}</a>, {current.license}
        </p>
      )}
      {photos.length > 1 && (
        <div className="flow-photo-dots" role="group" aria-label="Photos">
          {photos.map((p, i) => (
            <button key={p.src} type="button" aria-label={`Show photo ${i + 1} of ${photos.length}: ${p.place}`} aria-pressed={i === shown}
              className={i === shown ? 'is-shown' : ''} onClick={() => setShown(i)} />
          ))}
        </div>
      )}
      <div className="flow-photo-text">
        <p className="flow-eyebrow">LET'S FIND YOUR PLACE</p>
        <div className="flow-progress-info">
          <span>{label}</span>
          <span>STEP {step} OF 3</span>
        </div>
        <div className="flow-progress" aria-hidden="true">
          <span style={{ width: `${(step / 3) * 100}%` }} />
        </div>
        <h1>
          {title} <em>{accent}</em>
        </h1>
        <p className="flow-description">{description}</p>
      </div>
    </aside>
  )
}

// One question: icon, title and question on the left, its control on the right
export function FlowRow({ icon, title, question, htmlFor, children, className = '' }) {
  return (
    <div className={`flow-row ${className}`.trim()}>
      <span className="flow-row-icon"><FlowIcon name={icon} /></span>
      <div className="flow-row-text">
        <h2>{htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}</h2>
        <p>{question}</p>
      </div>
      <div className="flow-row-control">{children}</div>
    </div>
  )
}

// A row of buttons, one of which is selected: options are [value, label, icon?]
export function FlowChoices({ label, options, value, onChange, className = '' }) {
  return (
    <div className={`flow-choices ${className}`.trim()} role="group" aria-label={label}>
      {options.map(([optionValue, optionLabel, icon]) => (
        <button
          key={optionValue}
          type="button"
          aria-pressed={value === optionValue}
          className={value === optionValue ? 'flow-choice selected' : 'flow-choice'}
          onClick={() => onChange(optionValue)}
        >
          {icon && <FlowIcon name={icon} />}
          {optionLabel}
        </button>
      ))}
    </div>
  )
}

// A small pop-up message (e.g. "complete steps 1 and 2 first"). Closes with Esc, the X or a click outside.
export function FlowDialog({ title, children, actions, onClose }) {
  const box = useRef(null)
  useEffect(() => {
    const before = document.activeElement
    box.current?.querySelector('button')?.focus()
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.() }
  }, [onClose])
  return (
    <div className="flow-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flow-dialog" role="dialog" aria-modal="true" aria-labelledby="flow-dialog-title" ref={box}>
        <span className="flow-dialog-icon" aria-hidden="true"><FlowIcon name="lock" /></span>
        <h2 id="flow-dialog-title">{title}</h2>
        {children}
        <div className="flow-dialog-actions">{actions}</div>
        <button type="button" className="flow-dialog-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
    </div>
  )
}
