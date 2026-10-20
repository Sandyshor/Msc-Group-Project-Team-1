import './App.css'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import HowItWorks from './pages/Howitworks'
import Questionnaire from './pages/Questionnaire'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Districts from './pages/Districts'
import Results from './pages/Results'

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
  <Link to="/">Home</Link>
  <Link to="/districts">Explore districts</Link>
  <Link to="/how-it-works">How it works</Link>
</nav>


        
<div className="nav-actions">
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
          <span className="brand-mark">⌂</span>
          <span>Find Your Dublin</span>
        </Link>
        <p>Helping you find your place in Dublin.</p>
        <Link to="/">Back to home ↑</Link>
      </footer>
    </div>
  )
}

export default App
