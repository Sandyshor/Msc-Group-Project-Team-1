// The one-screen layout of the "find my match" flow: a sidebar with the steps, a photo panel with the
// step's heading, and the step's content. Used by the questionnaire (and later the results page).
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
  ['Your situation', 'person'],
  ['Your priorities', 'sliders'],
  ['Your matches', 'pin'],
]

// step: 1-3 (the current one); onStep(n) when a step the student can go to is clicked; canGoTo(n) -> bool
export function FlowSidebar({ step, onStep, canGoTo = () => false }) {
  return (
    <nav className="flow-sidebar" aria-label="Steps">
      {STEPS.map(([label, icon], index) => {
        const number = index + 1
        const current = number === step
        return (
          <button
            key={label}
            type="button"
            className={current ? 'flow-step is-current' : 'flow-step'}
            aria-current={current ? 'step' : undefined}
            disabled={current || !canGoTo(number)}
            onClick={() => onStep(number)}
          >
            <FlowIcon name={icon} />
            <span>
              <small>Step {number}</small>
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

export function FlowPhoto({ step, label, title, accent, description, image = '/images/questionnaire-background.png' }) {
  return (
    <aside className="flow-photo" style={{ backgroundImage: `url("${image}")` }}>
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
