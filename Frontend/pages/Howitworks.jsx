import { Link } from 'react-router-dom'

const steps = [
  {
    number: '01',
    icon: 'home',
    visual: 'budget',
    title: 'Set your starting point',
    description: 'Enter your rent budget, choose your university and select the type of accommodation you prefer.',
    detail: 'You can start with estimates if you have not decided everything yet.',
    link: '/questionnaire',
    linkText: 'Start with your details',
  },
  {
    number: '02',
    icon: 'neighbourhood',
    visual: 'areas',
    title: 'Compare neighbourhoods',
    description: 'Explore Dublin areas and compare everyday factors like rent, travel and nearby amenities.',
    detail: 'District profiles are still being expanded, so check which areas have details available.',
    link: '/districts',
    linkText: 'Browse district profiles',
  },
  {
    number: '03',
    icon: 'journey',
    visual: 'journey',
    title: 'Plan your daily journey',
    description: 'Check routes between your chosen area and university, and discover useful places nearby.',
    detail: 'Choose your start and destination, then switch map layers to view amenities.',
    link: '/journey-planner/route.html',
    linkText: 'Open the journey planner',
  },
]

const readyItems = [
  {
    icon: 'budget',
    title: 'A rent range',
    description: 'A monthly budget that feels realistic for you.',
  },
  {
    icon: 'campus',
    title: 'Your campus or destination',
    description: 'Where you expect to travel most often.',
  },
  {
    icon: 'priorities',
    title: 'What matters in a neighbourhood',
    description: 'For example, green space, shops or an easier commute.',
  },
]

function StepIcon({ type }) {
  if (type === 'home') {
    return (
      <svg viewBox="0 0 32 32" fill="none">
        <path d="m5.5 14 10.5-8 10.5 8v12.5h-21V14Z" />
        <path d="M12.5 26.5v-8h7v8M4 14.5 16 5l4.2 3.3" />
        <circle cx="23.5" cy="8" r="3" />
      </svg>
    )
  }

  if (type === 'neighbourhood') {
    return (
      <svg viewBox="0 0 32 32" fill="none">
        <path d="m4.5 8 7-3 9 3 7-3v19l-7 3-9-3-7 3V8Z" />
        <path d="M11.5 5v19M20.5 8v19" />
        <path d="M16 11.5a3 3 0 0 0-3 3c0 2.2 3 5.2 3 5.2s3-3 3-5.2a3 3 0 0 0-3-3Z" />
        <circle cx="16" cy="14.5" r=".8" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 32 32" fill="none">
      <path d="M6 24.5c4-8 7-10 11-7s5 4 9-5" />
      <circle cx="6" cy="24.5" r="2.5" />
      <path d="M26 6a4 4 0 0 0-4 4c0 2.8 4 6.8 4 6.8s4-4 4-6.8a4 4 0 0 0-4-4Z" />
      <circle cx="26" cy="10" r="1.1" />
    </svg>
  )
}

function ReadyIcon({ type }) {
  if (type === 'budget') {
    return (
      <svg viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="11.5" />
        <path d="M19.5 11.5c-.8-.8-1.9-1.2-3.5-1.2-2 0-3.4 1-3.4 2.5 0 3.8 7.1 1.1 7.1 4.9 0 1.6-1.5 2.7-3.7 2.7-1.5 0-2.8-.5-3.8-1.5M16 8v16" />
      </svg>
    )
  }

  if (type === 'campus') {
    return (
      <svg viewBox="0 0 32 32" fill="none">
        <path d="m5 12 11-6 11 6-11 6-11-6Z" />
        <path d="M9 14.5v7c4.5 3.5 9.5 3.5 14 0v-7M27 12v8" />
        <circle cx="27" cy="22" r="1.5" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 32 32" fill="none">
      <path d="M16 25s-10-5.8-10-13a5.5 5.5 0 0 1 10-3.2A5.5 5.5 0 0 1 26 12c0 7.2-10 13-10 13Z" />
      <path d="M9.5 16h4l2-4 3 8 2-4h2.5" />
    </svg>
  )
}

function StepVisual({ type }) {
  if (type === 'budget') {
    return (
      <div className="step-visual step-visual-budget" aria-hidden="true">
        <div className="budget-visual-top"><span>MONTHLY RENT RANGE</span><strong>€1,000</strong></div>
        <div className="budget-visual-track"><span /></div>
        <div className="budget-visual-bottom"><span>€700</span><span>€1,500+</span></div>
        <div className="budget-visual-campus"><span>⌂</span> Campus · TU Dublin</div>
      </div>
    )
  }

  if (type === 'areas') {
    return (
      <div className="step-visual step-visual-areas" aria-hidden="true">
        <div className="area-visual-card area-visual-card-selected">
          <span className="area-visual-mark">R</span>
          <span><strong>Rathmines</strong><small>Rent · €1,450</small></span>
          <span className="area-visual-rating">GOOD FIT</span>
        </div>
        <div className="area-visual-card">
          <span className="area-visual-mark">D</span>
          <span><strong>Drumcondra</strong><small>Rent · €1,250</small></span>
          <span className="area-visual-arrow">↗</span>
        </div>
      </div>
    )
  }

  return (
    <div className="step-visual step-visual-journey" aria-hidden="true">
      <div className="journey-visual-stops">
        <span className="journey-visual-stop journey-visual-home"><i>⌂</i><small>HOME</small></span>
        <span className="journey-visual-route"><i /><i /><i /></span>
        <span className="journey-visual-stop journey-visual-campus"><i>⌖</i><small>CAMPUS</small></span>
      </div>
      <div className="journey-visual-footer"><span>ESTIMATED COMMUTE</span><strong>24 min</strong></div>
    </div>
  )
}

function HowItWorks() {
  return (
    <div className="how-page">
      <section className="how-process" id="how-steps" aria-labelledby="how-process-title">
        <div className="how-section-heading">
          <div>
            <p className="how-section-kicker">YOUR JOURNEY, STEP BY STEP</p>
            <h2 id="how-process-title">From first choices to a Dublin routine.</h2>
          </div>
          <p>Start with your needs, compare neighbourhoods, then see how getting around could work.</p>
        </div>

        <ol className="steps-grid">
          {steps.map((step) => (
            <li className="step-flow-item" key={step.number}>
              <article className="step-card">
                <div className="step-card-top">
                  <span className={`step-icon step-icon-${step.icon}`} aria-hidden="true">
                    <StepIcon type={step.icon} />
                  </span>
                  <span className="step-number">STEP {step.number}</span>
                </div>
                <StepVisual type={step.visual} />
                <h3>{step.title}</h3>
                <p className="step-description">{step.description}</p>
                <p className="step-detail">{step.detail}</p>
                <Link className="step-link" to={step.link}>{step.linkText}<span aria-hidden="true">↗</span></Link>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <section className="how-ready" aria-labelledby="how-ready-title">
        <div className="how-ready-copy">
          <p className="how-section-kicker">NO NEED TO HAVE IT ALL FIGURED OUT</p>
          <h2 id="how-ready-title">A few details can help you get started.</h2>
          <p>Bring what you know today. You can still browse the guide if some plans are not settled yet.</p>
        </div>
        <ul className="how-ready-list">
          {readyItems.map((item) => (
            <li className={`how-ready-item how-ready-item-${item.icon}`} key={item.icon}>
              <span className="how-ready-icon" aria-hidden="true"><ReadyIcon type={item.icon} /></span>
              <div><strong>{item.title}</strong><small>{item.description}</small></div>
              <span className="how-ready-check" aria-hidden="true">✓</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="how-cta" aria-labelledby="how-cta-title">
        <div>
          <p className="how-section-kicker how-cta-kicker">
            <img className="how-cta-logo" src="/images/find-your-dublin-logo.png" alt="" />
            <span>YOUR NEXT STEP</span>
          </p>
          <h2 id="how-cta-title">Let’s make Dublin feel a little more familiar.</h2>
          <p>Start with your budget and campus, or explore the city guide first.</p>
        </div>
        <div className="how-cta-actions">
          <Link className="how-button how-button-green" to="/questionnaire">Get started <span aria-hidden="true">↗</span></Link>
          <Link className="how-cta-secondary" to="/districts">Explore districts</Link>
        </div>
      </section>
      <p className="how-page-footnote">District profiles are still being expanded. Use local amenity and travel information as a starting point, and verify important details before making decisions.</p>
    </div>
  )
}

export default HowItWorks
