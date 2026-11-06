import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import './SiteTour.css'

const steps = [
  {
    path: '/',
    target: 'home',
    title: 'Welcome to Find Your Dublin',
    description:
      'Start here for a guide to living, studying, and exploring in Dublin. The homepage video introduces the city.',
  },
  {
    path: '/',
    target: 'home-film',
    title: 'Watch the Dublin introduction',
    description:
      'Play the short film for a visual introduction to Dublin and its everyday atmosphere.',
  },
  {
    path: '/districts',
    target: 'districts',
    title: 'Explore neighbourhoods',
    description:
      'Search by district name or code, such as D1 or Dublin 1. District profiles show the details currently available.',
  },
  {
    path: '/universities',
    target: 'universities',
    title: 'Find your campus',
    description:
      'Browse Dublin colleges and campuses, explore their locations on the map, and open official university information.',
  },
  {
    path: '/attractions',
    target: 'attractions',
    title: 'Discover the city',
    description:
      'Browse Dublin landmarks and places to visit, with map locations and links for more information.',
  },
  {
    path: '/how-it-works',
    target: 'how-it-works',
    title: 'See how it works',
    description:
      'Learn how to use your budget, campus, and neighbourhood priorities to find a suitable area and plan everyday travel.',
  },
  {
    path: '/questionnaire',
    target: 'questionnaire',
    title: 'Tell us what matters to you',
    description:
      'Set your monthly budget, university, accommodation type, travel mode, and commute preferences to get matched.',
  },
  {
    path: '/results',
    target: 'results',
    title: 'Review your matches',
    description:
      'After completing the questionnaire, compare your recommended neighbourhoods, including rent, commute, safety, and why each place matched.',
  },
]

function SiteTour({ onClose }) {
  const [stepIndex, setStepIndex] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()
  const step = steps[stepIndex]

  useEffect(() => {
    if (location.pathname !== step.path) {
      navigate(step.path)
    }
  }, [location.pathname, navigate, step.path])

  useEffect(() => {
    if (location.pathname !== step.path) return undefined

    const target = document.querySelector(`[data-site-tour="${step.target}"]`)
    if (!target) return undefined

    target.classList.add('site-tour-highlight')
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'center',
    })

    return () => target.classList.remove('site-tour-highlight')
  }, [location.pathname, step])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function goToStep(index) {
    setStepIndex(index)
    if (location.pathname !== steps[index].path) {
      navigate(steps[index].path)
    }
  }

  return createPortal(
    <aside
      id="site-tour-panel"
      className="site-tour"
      role="dialog"
      aria-modal="false"
      aria-label="Website tour"
      aria-live="polite"
    >
      <div className="site-tour-topline">
        <span>GETTING AROUND THE WEBSITE</span>
        <button
          type="button"
          className="site-tour-close"
          onClick={onClose}
          aria-label="Close tour"
        >
          ×
        </button>
      </div>
      <p className="site-tour-progress">
        Step {stepIndex + 1} of {steps.length}
      </p>
      <h2>{step.title}</h2>
      <p className="site-tour-description">{step.description}</p>
      {step.link && (
        <a
          className="site-tour-link"
          href={step.link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open journey planner <span aria-hidden="true">↗</span>
        </a>
      )}
      <div className="site-tour-controls">
        <button type="button" className="site-tour-skip" onClick={onClose}>
          Skip tour
        </button>
        <div className="site-tour-navigation">
          {stepIndex > 0 && (
            <button
              type="button"
              className="site-tour-back"
              onClick={() => goToStep(stepIndex - 1)}
            >
              Back
            </button>
          )}
          {stepIndex < steps.length - 1 ? (
            <button
              type="button"
              className="site-tour-next"
              onClick={() => goToStep(stepIndex + 1)}
            >
              Next <span aria-hidden="true">→</span>
            </button>
          ) : (
            <button
              type="button"
              className="site-tour-next"
              onClick={onClose}
            >
              Finish tour
            </button>
          )}
        </div>
      </div>
    </aside>,
    document.body
  )
}

export default SiteTour
