import { useEffect, useState } from 'react'
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
    path: '/', target: 'home', icon: 'home', place: 'Home',
    title: 'Welcome to Find My Dublin',
    description: 'Your guide to living and studying in Dublin: find a neighbourhood that fits your budget, campus and lifestyle.',
    tip: 'Take the tour any time from “Take a tour” in the header.',
  },
  {
    path: '/', target: 'home-film', icon: 'film', place: 'Home',
    title: 'Watch the Dublin introduction',
    description: 'A short film that shows the city and its everyday atmosphere before you arrive.',
  },
  {
    path: '/', target: 'faq', icon: 'faq', place: 'Home', isNew: true,
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
    path: null, selector: '.chatw-fab', icon: 'chat', place: 'On every page', isNew: true, assistant: true,
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

function SiteTour({ onClose }) {
  const [stepIndex, setStepIndex] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()
  const step = steps[stepIndex]
  const onPage = !step.path || location.pathname === step.path

  useEffect(() => {
    if (step.path && location.pathname !== step.path) navigate(step.path)
  }, [location.pathname, navigate, step.path])

  useEffect(() => {
    if (!onPage) return undefined
    const target = document.querySelector(step.selector || `[data-site-tour="${step.target}"]`)
    if (!target) return undefined
    target.classList.add('site-tour-highlight')
    if (!step.selector) {
      target.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'center',
      })
    }
    return () => target.classList.remove('site-tour-highlight')
  }, [onPage, step])

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
      className={`site-tour${step.assistant ? ' is-assistant' : ''}`}
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
