import { Link } from 'react-router-dom'
import './HomeHero.css'

const MAP_IMG = '/images/hero-map.png'
const CARD_IMG = '/images/hero-district-card.png'

const STEPS = [
  ['Tell us', 'your college and budget'],
  ['Get', 'your best-matched districts'],
  ['Compare', 'and plan your commute'],
]

export default function HomeHero() {
  return (
    <section className="hm-hero" aria-labelledby="hm-title" data-site-tour="home">
      <div className="hm-copy">
        <p className="hm-kicker">Neighbourhood guide for students</p>
        <h1 id="hm-title">Find the Dublin area that fits you best.</h1>
        <p className="hm-lead">
          Every Dublin district scored on rent, safety, transport and amenities, so you can choose where to live with confidence.
        </p>
        <ol className="hm-steps">
          {STEPS.map(([bold, rest], i) => (
            <li key={bold}><span className="hm-step-num">{i + 1}</span><span><b>{bold}</b> {rest}</span></li>
          ))}
        </ol>
        <div className="hm-cta">
          <Link className="hm-btn hm-btn-primary" to="/questionnaire">Find my match <span aria-hidden="true">→</span></Link>
          <Link className="hm-btn hm-btn-ghost" to="/districts">Explore districts</Link>
        </div>
      </div>

      <Link className="hm-visual" to="/districts" aria-label="Open the Explore districts map">
        <figure className="hm-map-frame">
          <img
            className="hm-map"
            src={MAP_IMG}
            alt="Our Explore districts map: Dublin districts coloured on satellite view, with universities and student housing pinned"
          />
          <figcaption className="hm-credit">Map imagery © Google</figcaption>
        </figure>
        <img
          className="hm-card"
          src={CARD_IMG}
          alt="District profile for Rathmines and Ranelagh, D6: safety 58, rent from €900 a month for a single room, 2 famous places"
        />
      </Link>
    </section>
  )
}
