import './App.css'
import './HeaderMenu.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Routes, Route, Link, NavLink, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import HowItWorks from './pages/Howitworks'
import Questionnaire from './pages/Questionnaire'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Districts from './pages/Districts'
import Results from './pages/Results'
import { AttractionsPage, UniversitiesPage } from './pages/CityGuide'
import LanguageSwitcher from './LanguageSwitcher'
import SiteTour from './SiteTour'
import SiteFooter from './SiteFooter'
import ChatWidget from './ChatWidget'
import BrandLogo from './BrandLogo'
import InfoPage from './pages/InfoPages'
import ThingsToKnow from './pages/ThingsToKnow'

// Fits the header to whatever room it has - window size, browser zoom, Windows display scaling, scrollbars,
// fonts loading late or longer translations. It tries the full header, then two tighter versions, and only
// shows the Menu button when none of them fits. Measured before the browser paints, so nothing flickers.
const HEADER_LEVELS = ['', 'nav-tight-1', 'nav-tight-2', 'nav-compact']
function useHeaderFit(headerRef, deps) {
  const [level, setLevel] = useState('')
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return undefined
    let frame = 0
    const fitsNow = () => {
      // every part at its natural width, packed from the left: the last one must end inside the padding
      const limit = header.getBoundingClientRect().right - parseFloat(getComputedStyle(header).paddingRight)
      const parts = [...header.children].filter((el) => el.id !== 'site-menu' && getComputedStyle(el).position !== 'absolute' && el.getBoundingClientRect().width > 0)
      return Math.max(...parts.map((el) => el.getBoundingClientRect().right)) <= limit - 12
    }
    const measure = () => {
      cancelAnimationFrame(frame)
      const before = HEADER_LEVELS.filter((c) => c && header.classList.contains(c))
      header.classList.remove(...before)
      header.classList.add('nav-measure')
      let chosen = 'nav-compact'
      for (const c of HEADER_LEVELS.slice(0, -1)) {
        if (c) header.classList.add(c)
        const ok = fitsNow()
        if (c) header.classList.remove(c)
        if (ok) { chosen = c; break }
      }
      header.classList.remove('nav-measure')
      header.classList.add(...before)
      setLevel(chosen)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    measure()
    const ro = new ResizeObserver(schedule)
    ro.observe(header)
    window.addEventListener('resize', schedule) // zooming changes the CSS width of the window
    document.fonts?.ready.then(schedule)
    // the language switcher rewrites the link text, which can make it longer
    const mo = new MutationObserver(schedule)
    header.querySelectorAll('.nav-links, .nav-actions').forEach((el) => mo.observe(el, { subtree: true, childList: true, characterData: true }))
    return () => { cancelAnimationFrame(frame); ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', schedule) }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return level
}

function App() {
  const location = useLocation()
  const [tourOpen, setTourOpen] = useState(false)
  // The menu button appears when the header runs out of room (narrow windows or a zoomed-in browser)
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef(null)
  const headerLevel = useHeaderFit(headerRef, [location.pathname])
  const compact = headerLevel === 'nav-compact'
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => { if (!compact) setMenuOpen(false) }, [compact])
  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    const onClick = (e) => { if (!headerRef.current?.contains(e.target)) setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [menuOpen])

  return (
    <div className="site-shell">
      <header ref={headerRef} className={`navbar ${location.pathname === '/' ? 'navbar-home' : ''}${headerLevel ? ` ${headerLevel}` : ''}${menuOpen ? ' menu-open' : ''}`}>
        
<BrandLogo light={location.pathname !== '/'} />


        
<nav className="nav-links">
  {/* NavLink marks the current page */}
  <NavLink to="/" end>Home</NavLink>
  <NavLink to="/districts">Explore districts</NavLink>
  <NavLink to="/campuses">Universities</NavLink>
  <NavLink to="/attractions">Famous attractions</NavLink>
  <NavLink to="/how-it-works">How it works</NavLink>
</nav>


        
<div className="nav-actions">
  <LanguageSwitcher />
  <Link className="nav-cta" to="/questionnaire">
    Find my match <span>↗</span>
  </Link>

  <button
    type="button"
    className="tour-trigger"
    onClick={() => setTourOpen(true)}
    aria-haspopup="dialog"
    aria-expanded={tourOpen}
    aria-controls={tourOpen ? 'site-tour-panel' : undefined}
  >
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></svg>
    Take a tour
  </button>

  <Link className="login-link" to="/login">
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></svg>
    Log in
  </Link>

  <button type="button" className="menu-toggle" aria-label="Menu" aria-expanded={menuOpen} aria-controls="site-menu" onClick={() => setMenuOpen((v) => !v)}>
    <span className="menu-bars" aria-hidden="true"><i /><i /><i /></span>
    <span className="menu-label">Menu</span>
  </button>
</div>

{menuOpen && (
  <nav id="site-menu" className="site-menu" aria-label="Menu">
    <NavLink to="/" end>Home</NavLink>
    <NavLink to="/districts">Explore districts</NavLink>
    <NavLink to="/campuses">Universities</NavLink>
    <NavLink to="/attractions">Famous attractions</NavLink>
    <NavLink to="/things-to-know">Things to know</NavLink>
    <NavLink to="/how-it-works">How it works</NavLink>
    <div className="site-menu-row">
      <button type="button" onClick={() => { setMenuOpen(false); setTourOpen(true) }}>Take a tour</button>
      <Link to="/login">Log in</Link>
    </div>
  </nav>
)}

      </header>

      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/districts" element={<Districts />} />
          {/* Not /universities: the backend already uses that address for its list of universities */}
          <Route path="/campuses" element={<UniversitiesPage />} />
          <Route path="/attractions" element={<AttractionsPage />} />
          <Route path="/results" element={<Results />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/questionnaire" element={<Questionnaire />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/things-to-know" element={<ThingsToKnow />} />
          <Route path="/terms" element={<InfoPage page="terms" />} />
          <Route path="/privacy" element={<InfoPage page="privacy" />} />
          <Route path="/contact" element={<InfoPage page="contact" />} />
          <Route
            path="*"
            element={<h1>Page not found</h1>}
          />
        </Routes>
      </main>

      {/* the questionnaire and results fill the screen exactly, so they go without a footer */}
      {!['/questionnaire', '/results'].includes(location.pathname) && <SiteFooter />}

      {tourOpen && <SiteTour onClose={() => setTourOpen(false)} />}
      <ChatWidget />
    </div>
  )
}

export default App
