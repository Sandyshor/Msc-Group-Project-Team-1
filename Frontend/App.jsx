import './App.css'
import { Routes, Route, Link, NavLink, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import HowItWorks from './pages/Howitworks'
import Questionnaire from './pages/Questionnaire'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Districts from './pages/Districts'
import Results from './pages/Results'
import LanguageSwitcher from './LanguageSwitcher'

function App() {
  const location = useLocation()
  return (
    <div className="site-shell">
      <header className={`navbar ${location.pathname === '/' ? 'navbar-home' : ''}`}>
        
<Link className="brand" to="/">
  <img
    className="brand-logo"
    src="/images/find-your-dublin-logo.png"
    alt=""
  />
  <span>Find Your Dublin</span>
</Link>


        
<nav className="nav-links">
  {/* NavLink marks the current page */}
  <NavLink to="/" end>Home</NavLink>
  <NavLink to="/districts">Explore districts</NavLink>
  <a href="/#universities">Universities</a>
  {/* Separate page (not React) served from Frontend/public/journey-planner */}
  <a href="/journey-planner/route.html">Journey planner</a>
  <NavLink to="/how-it-works">How it works</NavLink>
</nav>


        
<div className="nav-actions">
  <LanguageSwitcher />
  <Link className="nav-cta" to="/questionnaire">
    Find my match <span>↗</span>
  </Link>

  <Link className="login-link" to="/login">
    Log in
  </Link>
</div>

      </header>

      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/districts" element={<Districts />} />
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

      <footer className="footer">
        <Link className="brand footer-brand" to="/">
          <img className="footer-logo" src="/images/find-your-dublin-logo.png" alt="" />
          <span>Find Your Dublin</span>
        </Link>
        <p>Helping you find your place in Dublin.</p>
        <Link to="/">Back to home ↑</Link>
      </footer>
    </div>
  )
}

export default App
