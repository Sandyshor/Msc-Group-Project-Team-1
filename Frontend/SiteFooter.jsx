// Site-wide footer: brand and call to action, three columns of links, and a bottom bar
import { Link } from 'react-router-dom'
import './SiteFooter.css'

const COLUMNS = [
  ['Explore', [['/districts', 'District profiles'], ['/campuses', 'Universities'], ['/attractions', 'Famous attractions'], ['/how-it-works', 'How it works']]],
  ['Get started', [['/questionnaire', 'Find my match'], ['/things-to-know', 'Things to know'], ['/login', 'Log in']]],
  ['Help', [['/contact', 'Contact us'], ['/privacy', 'Privacy policy'], ['/terms', 'Terms of use']]],
]

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <svg className="sf-wave" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 34C240 6 480 58 720 34s480-30 720-6" />
      </svg>
      <div className="sf-top">
        <div className="sf-brand">
          <Link to="/" className="sf-logo" aria-label="Find My Dublin home">
            <img src="/images/find-your-dublin-logo.png" alt="" />
            <img src="/images/find-my-dublin-wordmark-light.png" alt="Find My Dublin" className="sf-wordmark" />
          </Link>
          <p>Helping international students find the right neighbourhood, settle in, and feel at home in Dublin.</p>
          <div className="sf-cta">
            <Link className="sf-btn sf-btn-lime" to="/questionnaire">Find my match <span aria-hidden="true">↗</span></Link>
            <button type="button" className="sf-btn" onClick={() => window.dispatchEvent(new Event('chatw-open'))}>
              <span aria-hidden="true">💬</span> Ask the assistant
            </button>
          </div>
        </div>
        {COLUMNS.map(([title, links]) => (
          <nav key={title} className="sf-col" aria-label={title}>
            <h2>{title}</h2>
            <ul>{links.map(([to, label]) => <li key={to}><Link to={to}>{label}</Link></li>)}</ul>
          </nav>
        ))}
      </div>
      <div className="sf-bottom">
        <p>&copy; {new Date().getFullYear()} Find My Dublin · Built by the Crib Crew</p>
        <p className="sf-made">Made with <span aria-hidden="true">☘</span><span className="sr-only">love</span> in Dublin</p>
      </div>
    </footer>
  )
}
