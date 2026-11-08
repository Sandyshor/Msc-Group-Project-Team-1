// Site-wide footer: copyright on the left, info links on the right
import { Link } from 'react-router-dom'
import './SiteFooter.css'

const LINKS = [
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/contact', label: 'Contact' },
  { to: '/how-it-works', label: 'About' },
]

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer-copy">&copy;{new Date().getFullYear()} Find My Dublin</p>
      <nav className="site-footer-links" aria-label="Footer">
        {LINKS.map((l) => <Link key={l.to} to={l.to}>{l.label}</Link>)}
      </nav>
    </footer>
  )
}
