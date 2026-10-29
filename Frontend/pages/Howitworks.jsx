import { Link } from 'react-router-dom'

const steps = [
  {
    number: '01',
    icon: '⌂',
    title: 'Set your starting point',
    description: 'Enter your rent budget, choose your university and select the type of accommodation you prefer.',
    detail: 'You can start with estimates if you have not decided everything yet.',
    link: '/questionnaire',
    linkText: 'Start with your details',
  },
  {
    number: '02',
    icon: '✳',
    title: 'Compare neighbourhoods',
    description: 'Explore Dublin areas and compare everyday factors like rent, travel and nearby amenities.',
    detail: 'District profiles are still being expanded, so check which areas have details available.',
    link: '/districts',
    linkText: 'Browse district profiles',
  },
  {
    number: '03',
    icon: '⌖',
    title: 'Plan your daily journey',
    description: 'Check routes between your chosen area and university, and discover useful places nearby.',
    detail: 'Choose your start and destination, then switch map layers to view amenities.',
    link: '/journey-planner/route.html',
    linkText: 'Open the journey planner',
  },
]

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
                  <span className="step-icon" aria-hidden="true">{step.icon}</span>
                  <span className="step-number">STEP {step.number}</span>
                </div>
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
          <li><span aria-hidden="true">€</span><div><strong>A rent range</strong><small>A monthly budget that feels realistic for you.</small></div></li>
          <li><span aria-hidden="true">⌖</span><div><strong>Your campus or destination</strong><small>Where you expect to travel most often.</small></div></li>
          <li><span aria-hidden="true">♡</span><div><strong>What matters in a neighbourhood</strong><small>For example, green space, shops or an easier commute.</small></div></li>
        </ul>
      </section>

      <section className="how-cta" aria-labelledby="how-cta-title">
        <div>
          <p className="how-section-kicker">YOUR NEXT STEP</p>
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
