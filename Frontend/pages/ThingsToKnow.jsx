// "Things to know": an arrival checklist for international students moving to Dublin, grouped by when each step
// matters. Each item says why it matters, how to do it, and links to the official source. Ticks are remembered
// on this device only.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './CityGuide.css'
import './ThingsToKnow.css'
import THINGS from './things-to-know.json'

const STORE_KEY = 'fmd-things-done'

// The checklist lives in things-to-know.json, so the AI assistant (Backend/chat.py) can use the same steps
const PHASES = THINGS.phases

const ALL_IDS = PHASES.flatMap((p) => p.items.map((i) => i.id))

function loadDone() {
  try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY)) || []) } catch { return new Set() }
}

export default function ThingsToKnow() {
  const [done, setDone] = useState(loadDone)
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify([...done])) } catch { /* private mode */ } }, [done])
  const toggle = (id) => setDone((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  return (
    <div className="cg-page ttk-page" data-site-tour="things-to-know">
      <header className="cg-hero">
        <img className="cg-hero-img" src="/images/flow/georgian-doors.jpg" alt="" />
        <div className="cg-hero-text">
          <p className="cg-kicker">NEW TO DUBLIN</p>
          <h1>Things to know <em>before you settle in.</em></h1>
          <p className="cg-lead">Your arrival checklist: the permits, numbers and cards every international student needs, in the order you’ll need them.</p>
          <ul className="cg-stats">
            <li><strong>{ALL_IDS.length}</strong>essentials</li>
            <li><strong>4</strong>stages</li>
            <li><strong>✓</strong>tick off as you go</li>
          </ul>
        </div>
        <p className="cg-hero-credit">Georgian doors, Dublin · Photo: <a href="https://commons.wikimedia.org/wiki/File:The_Doors_of_Dublin_(7580307812).jpg" target="_blank" rel="noreferrer">Tim Sackton</a>, CC BY-SA 2.0</p>
      </header>

      <div className="ttk-progress" aria-live="polite">
        <div>
          <span>Tick each step as you complete it. Your progress is saved on this device.</span>
        </div>
        <nav className="ttk-jump" aria-label="Jump to a stage">
          {PHASES.map((p, i) => <a key={p.id} href={`#${p.id}`}><b>{i + 1}</b>{p.title}</a>)}
        </nav>
      </div>

      <div className="ttk-phases">
        {PHASES.map((phase, pi) => (
          <section key={phase.id} id={phase.id} className="ttk-phase">
            <div className="ttk-phase-head">
              <span className="ttk-num">{pi + 1}</span>
              <div>
                <h2>{phase.title}</h2>
                <p>{phase.note}</p>
              </div>
            </div>
            <div className="ttk-grid">
              {phase.items.map((item) => {
                const isDone = done.has(item.id)
                return (
                  <article key={item.id} className={`ttk-card${isDone ? ' is-done' : ''}`}>
                    <div className="ttk-card-head">
                      <span className="ttk-icon" aria-hidden="true">{item.icon}</span>
                      <h3>{item.title}</h3>
                      <button type="button" className="ttk-check" aria-pressed={isDone} onClick={() => toggle(item.id)}
                        aria-label={isDone ? `Mark “${item.title}” as not done` : `Mark “${item.title}” as done`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                      </button>
                    </div>
                    <p className="ttk-why">{item.why}</p>
                    <ul className="ttk-how">{item.how.map((h) => <li key={h}>{h}</li>)}</ul>
                    {item.options && (
                      <div className="ttk-options">
                        {item.options.map((o) => (
                          <a key={o.name} className="ttk-option" href={o.url} target="_blank" rel="noopener noreferrer">
                            <span className="ttk-option-head"><strong>{o.name}</strong><span aria-hidden="true">↗</span></span>
                            <span className="ttk-option-price"><b>{o.price}</b> {o.per}{o.indicative && <em> · indicative</em>}</span>
                            <span className="ttk-option-detail">{o.detail}</span>
                          </a>
                        ))}
                        <p className="ttk-options-note">{item.optionsNote}</p>
                      </div>
                    )}
                    {item.link && (
                      <a className="ttk-link" href={item.link[1]} target="_blank" rel="noreferrer">{item.link[0]} <span aria-hidden="true">↗</span></a>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <aside className="ttk-cta">
        <div>
          <h2>Next: find where you’ll live</h2>
          <p>Answer a few questions and we’ll rank Dublin’s neighbourhoods for your budget and university.</p>
        </div>
        <Link className="ttk-cta-btn" to="/questionnaire">Find my match <span aria-hidden="true">→</span></Link>
      </aside>
      <p className="ttk-disclaimer">Rules, fees and processes change. This page is general guidance, so always check the linked official sites before you act.</p>
    </div>
  )
}
