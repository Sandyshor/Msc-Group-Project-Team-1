// Homepage hero: "Are you new to Dublin?" - green panel on the left, the Ha'penny Bridge at dusk on the
// right, a "New to Dublin?" card, glowing waves and a line-art skyline of Dublin with a Luas tram.
import { Link } from 'react-router-dom'
import './HomeHero.css'

// Full-bleed artwork: green panel, Liffey and Ha'penny Bridge at sunset, glowing skyline with a Luas
const BG = '/images/hero-dublin-bg.jpg'

const ICONS = {
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z'],
  play: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm10 8.5 5.5 3.5-5.5 3.5v-7Z'],
  pin: ['M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21Z', 'M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  check: ['m7.5 12.5 3 3 6-6.5'],
}
const Icon = ({ name, className = '' }) => (
  <svg className={`hx-icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
    {ICONS[name].map((d) => <path d={d} key={d} />)}
  </svg>
)

// three short yellow strokes, like a little burst
const Sparkle = ({ className }) => (
  <svg className={`hx-sparkle ${className}`} viewBox="0 0 40 40" aria-hidden="true">
    <path d="M8 26 4 34M18 20l2-14M28 26l8-6" />
  </svg>
)

// big background shapes: the green panel with its curved edge, a teal swoosh, and the waves at the bottom
function Shamrock() {
  const leaf = 'M0 0C-12-6-22-20-15-32c6-9 15-5 15 4 0-9 9-13 15-4 7 12-3 26-15 32Z'
  return (
    <svg className="hx-shamrock" viewBox="-70 -80 140 150" aria-hidden="true">
      <path className="hx-shamrock-stem" d="M0 0C6 20 16 40 34 54" />
      {[0, 120, 240].map((a) => (
        <g key={a} transform={`rotate(${a}) scale(1.35)`}>
          <path className="hx-shamrock-leaf" d={leaf} />
          <path className="hx-shamrock-vein" d="M0 -2V-24" />
        </g>
      ))}
    </svg>
  )
}

// scroll to the film section and start it (the click counts as the user gesture that allows playback with sound)
const watchIntro = (e) => {
  const film = document.getElementById('explore-dublin')
  if (!film) return
  e.preventDefault()
  film.scrollIntoView({ behavior: 'smooth', block: 'start' })
  window.dispatchEvent(new Event('hf-play'))
}

export default function HomeHero() {
  return (
    <section className="hx-hero" aria-labelledby="hx-title" data-site-tour="home">
      <img className="hx-bg" src={BG} alt="" aria-hidden="true" />
      <div className="hx-bg-shade" aria-hidden="true" />
      <Shamrock />

      <div className="hx-copy">
        <p className="hx-pill"><Icon name="globe" /> A Guide for International Students</p>
        <Sparkle className="hx-sparkle-pill" />
        <h1 id="hx-title">
          <span className="hx-line1">Are you new</span>
          <span className="hx-line2">to Dublin?<Sparkle className="hx-sparkle-title" /></span>
          <svg className="hx-brush" viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true">
            <path d="M6 22C70 10 170 6 294 12" />
          </svg>
        </h1>
        <p className="hx-lead">A personalised guide for international students to find the best area to live, study and explore in Dublin.</p>
        <div className="hx-cta">
          <Link className="hx-btn hx-btn-primary" to="/questionnaire">Start the Questionnaire <span aria-hidden="true">→</span></Link>
          <a className="hx-btn hx-btn-outline" href="#explore-dublin" onClick={watchIntro}><Icon name="play" /> Watch Intro</a>
        </div>
      </div>

      <aside className="hx-card" aria-label="What you can do here">
        <Sparkle className="hx-sparkle-card" />
        <div className="hx-card-head">
          <span className="hx-flag" aria-hidden="true"><i /><i /><i /></span>
          <h2>New to Dublin?</h2>
        </div>
        <ul>
          <li><span className="hx-tick amber"><Icon name="check" /></span>Find the right area to live</li>
          <li><span className="hx-tick amber"><Icon name="check" /></span>Compare rent and living costs</li>
          <li><span className="hx-tick green"><Icon name="check" /></span>Check commute to your university</li>
          <li><span className="hx-tick green"><Icon name="check" /></span>Explore amenities &amp; student life</li>
        </ul>
      </aside>

      <p className="hx-place">
        <Icon name="pin" />
        <span>Ha'penny Bridge,<br />Dublin</span>
        <svg className="hx-place-arrow" viewBox="0 0 200 60" aria-hidden="true">
          <path d="M8 50C66 56 124 42 160 10" />
          <path d="M141 8L160 10l-6 18" />
        </svg>
      </p>
    </section>
  )
}
