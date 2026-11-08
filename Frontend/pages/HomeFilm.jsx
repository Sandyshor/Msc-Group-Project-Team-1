// "First look" film section under the hero: carries the hero's green and lime glow down the page,
// with a framed film player and a big play button.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './HomeFilm.css'

const FILM = '/videos/dublin-intro.mp4'
const POSTER = '/images/film/poster-liffey.jpg'

const HIGHLIGHTS = [
  { icon: 'plane', title: 'Land and settle in', text: 'From the airport into the heart of the city.' },
  { icon: 'tram', title: 'Get around easily', text: 'Luas, buses and walkable Georgian streets.' },
  { icon: 'people', title: 'Find your people', text: 'Cafés, culture and a big student community.' },
]

const ICONS = {
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  plane: 'M2.5 13.5 21 6.5c.8-.3 1.5.6 1 1.3l-3 3.7-6 1.5-3.5 5.5H7.6l1.4-5-4 1-2-1.5 1.5-1Z',
  tram: 'M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-3 8h16M8 21l2-3m6 3-2-3M9 1.5h6M8 14.5h.01M16 14.5h.01',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6.5 9c.4-3.4 3-5.5 6.5-5.5s6.1 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4m2.3 3.8c1.9.8 3 2.6 3.2 5.5',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
}
const Icon = ({ name, filled = false }) => (
  <svg className="hf-icon" viewBox="0 0 24 24" aria-hidden="true" fill={filled ? 'currentColor' : 'none'}
    stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={ICONS[name]} />
  </svg>
)

export default function HomeFilm() {
  const video = useRef(null)
  const [started, setStarted] = useState(false)

  const play = (at) => {
    const v = video.current
    if (!v) return
    if (typeof at === 'number') v.currentTime = at
    setStarted(true)
    v.play().catch(() => {})
  }

  // the hero's "Watch Intro" button scrolls here and starts the film
  useEffect(() => {
    const onPlay = () => play(0)
    window.addEventListener('hf-play', onPlay)
    return () => window.removeEventListener('hf-play', onPlay)
  }, [])

  return (
    <section className="hf" id="explore-dublin" data-site-tour="home-film" aria-labelledby="hf-title">
      <svg className="hf-waves" viewBox="0 0 1440 220" preserveAspectRatio="none" aria-hidden="true">
        <path className="hf-wave-a" d="M0 40C260 120 520 10 820 60s420 90 620 10" />
        <path className="hf-wave-b" d="M0 90C300 150 600 60 900 110s360 60 540 0" />
      </svg>
      <span className="hf-glow hf-glow-1" aria-hidden="true" />
      <span className="hf-glow hf-glow-2" aria-hidden="true" />

      <div className="hf-inner">
        <div className="hf-copy">
          <h2 id="hf-title">
            <span>Explore Dublin.</span>
            <em>Feel the place.</em>
            <svg className="hf-brush" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 17C80 6 190 4 296 10" />
            </svg>
          </h2>
          <p className="hf-lead">A one-minute film about the streets, the river and the everyday energy of the city you&rsquo;re moving to.</p>

          <ul className="hf-points">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title}>
                <span className="hf-point-icon"><Icon name={h.icon} /></span>
                <span><strong>{h.title}</strong>{h.text}</span>
              </li>
            ))}
          </ul>

          <div className="hf-cta">
            <button type="button" className="hf-btn hf-btn-primary" onClick={() => play(started ? undefined : 0)}>
              <Icon name="play" filled /> {started ? 'Resume' : 'Play the film'} <small>1:16</small>
            </button>
            <Link className="hf-btn hf-btn-ghost" to="/questionnaire">Find my match <Icon name="arrow" /></Link>
          </div>
        </div>

        <div className="hf-stage">
          <div className={`hf-frame${started ? ' is-playing' : ''}`}>
            <video
              ref={video}
              className="hf-video"
              src={FILM}
              poster={POSTER}
              controls={started}
              playsInline
              preload="metadata"
              onPlay={() => setStarted(true)}
            >
              Your browser does not support embedded video.
            </video>
            {!started && (
              <button type="button" className="hf-overlay" onClick={() => play(0)} aria-label="Play the film about Dublin">
                <span className="hf-play"><Icon name="play" filled /></span>
                <span className="hf-overlay-text">
                  <strong>Watch the intro</strong>
                  <span>A short film about your new city</span>
                </span>
                <span className="hf-duration">1:16</span>
              </button>
            )}
          </div>
        </div>
      </div>

    </section>
  )
}
