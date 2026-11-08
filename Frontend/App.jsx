import './App.css'
import './HeaderMenu.css'
import { useEffect, useRef, useState } from 'react'
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

function App() {
  const location = useLocation()
  const [tourOpen, setTourOpen] = useState(false)
  // The menu button appears when the header runs out of room (narrow windows or a zoomed-in browser)
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef(null)
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
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
      <header ref={headerRef} className={`navbar ${location.pathname === '/' ? 'navbar-home' : ''}${menuOpen ? ' menu-open' : ''}`}>
        
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
