import './App.css'
import { useState } from 'react'
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

function App() {
  const location = useLocation()
  const [tourOpen, setTourOpen] = useState(false)

  return (
    <div className="site-shell">
      <header className={`navbar ${location.pathname === '/' ? 'navbar-home' : ''}`}>
        
<Link className="brand" to="/">
  <img
    className="brand-logo"
    src="/images/find-your-dublin-logo.png"
    alt=""
  />
  <img
    className="brand-wordmark"
    src="/images/find-my-dublin-wordmark-4k.png"
    alt="Find My Dublin"
  />
</Link>


        
<nav className="nav-links">
  {/* NavLink marks the current page */}
  <NavLink to="/" end>Home</NavLink>
  <NavLink to="/districts">Explore districts</NavLink>
  <NavLink to="/universities">Universities</NavLink>
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
    Take a tour
  </button>

  <Link className="login-link" to="/login">
    Log in
  </Link>
</div>

      </header>

      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/districts" element={<Districts />} />
          <Route path="/universities" element={<UniversitiesPage />} />
          <Route path="/attractions" element={<AttractionsPage />} />
          <Route path="/results" element={<Results />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/questionnaire" element={<Questionnaire />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            path="*"
            element={<h1>Page not found</h1>}
          />
        </Routes>
      </main>

      {tourOpen && <SiteTour onClose={() => setTourOpen(false)} />}
    </div>
  )
}

export default App
