import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './HomePage.css'

// The film's poster frame
const cityImage =
  '/images/hero-dublin.jpg'
// Hero background: the Ha'penny Bridge (a dusk colour treatment is added in HomePage.css)
const heroImage = '/images/attraction-ha-penny-bridge.jpg'

const districtAliases = {
  D1: ['city centre', 'city center', 'dublin city centre', 'dublin city center', "o'connell street", 'oconnell street', 'henry street'],
  D2: ['temple bar', 'dublin city south'],
  D3: ['clontarf', 'fairview', 'marino'],
  D4: ['ballsbridge', 'donnybrook', 'sandymount'],
  D6: ['ranelagh', 'rathmines'],
  D7: ['phibsborough', 'stoneybatter'],
}

function normaliseSearch(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]/g, '')
}

function resolveDistrict(value) {
  const normalised = normaliseSearch(value)
  const codeMatch = normalised.match(/^(?:d|dublin)(0?[1-9]|1[0-9]|2[0-4])$/)
  if (codeMatch) {
    const number = Number(codeMatch[1])
    return `D${number}`
  }

  for (const [code, names] of Object.entries(districtAliases)) {
    if (names.some((name) => normaliseSearch(name) === normalised)) return code
  }
  return null
}

const HERO_ICONS = {
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z'],
  play: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm10 8.5 5.5 3.5-5.5 3.5v-7Z'],
  check: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm8 12.5 2.6 2.5L16 9.5'],
  pin: ['M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21Z', 'M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
}

function HeroIcon({ name, className = '' }) {
  return (
    <svg className={`fd-hero-icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      {HERO_ICONS[name].map((d) => <path d={d} key={d} />)}
    </svg>
  )
}

function HeroUnderline() {
  return (
    <svg className="fd-hero-underline" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
      <path d="M4 18C70 6 170 4 296 12" />
    </svg>
  )
}

// A dashed flight path with a plane - arriving in Dublin
function HeroFlightPath() {
  return (
    <svg className="fd-hero-flight" viewBox="0 0 520 260" aria-hidden="true">
      <path className="fd-hero-flight-path" d="M10 250C70 120 190 40 330 60S470 50 500 30" />
      <path className="fd-hero-plane" d="m478 38 26-14c3-1.5 6 1 4.5 4l-13 26-5-1 3-14-9 5-1 6-4 1-1.5-6.5L472 43l1-4 6 .5 9-5-14 3Z" />
    </svg>
  )
}

function HeroShamrock() {
  const leaf = 'M0 0C-10-6-18-18-12-27c5-7 12-4 12 3 0-7 7-10 12-3 6 9-2 21-12 27Z'
  return (
    <svg className="fd-hero-shamrock" viewBox="-60 -70 120 130" aria-hidden="true">
      <path className="fd-hero-shamrock-stem" d="M0 0C4 18 14 34 30 46" />
      {[0, 120, 240].map((angle) => <path key={angle} d={leaf} transform={`rotate(${angle})`} />)}
    </svg>
  )
}

// Dublin's skyline as line art: Custom House, the Spire, Christ Church, the Ha'penny Bridge
function HeroSkyline() {
  return (
    <svg className="fd-hero-skyline" viewBox="0 0 1200 150" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <path d="M0 140H1200" />
      {/* trees */}
      <path d="M60 140v-22m0 0a12 12 0 1 1 0-24 12 12 0 1 1 0 24ZM980 140v-22m0 0a12 12 0 1 1 0-24 12 12 0 1 1 0 24Z" />
      {/* terrace of houses */}
      <path d="M90 140V92h70v48M100 104h10M120 104h10M140 104h10M100 120h10M120 120h10M140 120h10M90 92l35-18 35 18" />
      {/* Custom House with its dome */}
      <path d="M190 140V96h180v44M200 96V84h160v12M230 84V72h100v12M260 72c0-18 40-18 40 0M280 54v-8" />
      <path d="M205 110h12M225 110h12M245 110h12M303 110h12M323 110h12M343 110h12M205 126h12M225 126h12M343 126h12M323 126h12M268 140v-26h24v26" />
      {/* the Spire */}
      <path d="M430 140 440 8 450 140" />
      {/* GPO-like front with columns */}
      <path d="M480 140V98h120v42M480 98l60-20 60 20M495 104v36M515 104v36M535 104v36M555 104v36M575 104v36" />
      {/* Christ Church: nave and two spires */}
      <path d="M640 140V100h90v40M650 100V70l10-18 10 18v30M700 100V60l10-20 10 20v40M655 116h10M680 116h10M705 116h10" />
      {/* the Ha'penny Bridge */}
      <path d="M760 140c40-46 160-46 200 0M770 128c40-36 140-36 180 0M790 116v24M820 106v34M850 102v38M880 102v38M910 106v34M940 116v24" />
      {/* modern blocks of the docklands */}
      <path d="M1010 140V70h44v70M1062 140V96h40v44M1110 140V54h34v86M1020 84h8M1036 84h8M1020 100h8M1036 100h8M1120 70h6M1132 70h6M1120 88h6M1132 88h6" />
    </svg>
  )
}

function Home() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMessage, setSearchMessage] = useState('')

  function handleSearch(event) {
    event.preventDefault()
    const query = searchQuery.trim()

    if (!query) {
      setSearchMessage('Enter a district code or a neighbourhood name to begin.')
      return
    }

    const districtCode = resolveDistrict(query)
    if (!districtCode) {
      setSearchMessage('We couldn’t match that yet. Try D1, D 1, Dublin 1, or a neighbourhood such as City Centre.')
      return
    }

    navigate(`/districts?district=${encodeURIComponent(districtCode)}&search=${encodeURIComponent(query)}`)
  }

  return (
    <div className="fd-home">
      <section className="fd-hero" aria-labelledby="fd-hero-title">
        <img className="fd-hero-image" src={heroImage} alt="The Ha'penny Bridge over the River Liffey" />
        <div className="fd-hero-dusk" />
        <div className="fd-hero-shade" />

        <HeroFlightPath />

        <div className="fd-hero-copy">
          <p className="fd-hero-pill"><HeroIcon name="globe" /> A guide for international students</p>
          <h1 id="fd-hero-title">
            Are you new <em>to Dublin?</em>
            <HeroUnderline />
          </h1>
          <p className="fd-hero-lead">
            A personalised guide for international students to find the best area to live, study and explore in Dublin.
          </p>
          <div className="fd-hero-cta">
            {/* same words as the menu bar's button, as both start the questionnaire */}
            <Link className="fd-cta-primary" to="/questionnaire">Find my match <span aria-hidden="true">→</span></Link>
            <a className="fd-cta-outline" href="#explore-dublin"><HeroIcon name="play" /> Watch intro</a>
          </div>
        </div>

        <aside className="fd-hero-card" aria-label="What you can do here">
          <span className="fd-hero-flag" aria-hidden="true"><i /><i /><i /></span>
          <h2>New to Dublin?</h2>
          <ul>
            <li><Link to="/questionnaire"><HeroIcon name="check" className="gold" /> Find the right area to live</Link></li>
            <li><Link to="/districts"><HeroIcon name="check" className="gold" /> Compare rent and living costs</Link></li>
            <li><a href="/journey-planner/route.html"><HeroIcon name="check" /> Check commute to your university</a></li>
            <li><Link to="/attractions"><HeroIcon name="check" /> Explore amenities &amp; student life</Link></li>
          </ul>
        </aside>

        <p className="fd-hero-place"><HeroIcon name="pin" /> Ha'penny Bridge, Dublin</p>
        <p className="fd-hero-credit">
          Photo: <a href="https://www.visitdublin.com/ha-penny-bridge" target="_blank" rel="noreferrer">Visit Dublin</a>
        </p>
        <HeroShamrock />
        <HeroSkyline />

      </section>

      <section className="fd-search-wrap" aria-label="Explore Dublin districts">
        <form className="fd-search-bar" onSubmit={handleSearch}>
          <span className="fd-search-symbol" aria-hidden="true">⌕</span>
          <div className="fd-search-field">
            <label htmlFor="fd-site-search">FIND A DISTRICT OR NEIGHBOURHOOD</label>
            <input
              id="fd-site-search"
              type="search"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                setSearchMessage('')
              }}
              placeholder="Try D1, D 1, Dublin 1 or City Centre…"
              autoComplete="off"
            />
          </div>
          <button type="submit">Explore <span>↗</span></button>
        </form>
        {searchMessage && <p className="fd-search-message" role="status">{searchMessage}</p>}
        <div className="fd-search-hints"><span>TRY:</span> D1 <i>·</i> D 1 <i>·</i> Dublin 1 <i>·</i> City Centre</div>
      </section>

      <section className="fd-film-section" id="explore-dublin">
        <div className="fd-film-copy">
          <p className="fd-section-kicker">01 / FIRST LOOK</p>
          <h2>Explore Dublin.<br /><em>Feel the place.</em></h2>
          <p>A moving introduction to the streets, river and everyday energy of the city you’re coming to.</p>
          <span className="fd-film-note">A SHORT FILM ABOUT YOUR NEW CITY</span>
        </div>
        <div className="fd-film-wrap">
          <video className="fd-film-video" controls playsInline preload="metadata" poster={cityImage}>
            <source src="/videos/dublin-intro.mp4" type="video/mp4" />
            Your browser does not support embedded video.
          </video>
          <div className="fd-film-caption"><span>PRESS PLAY TO EXPLORE</span><span>DUBLIN / IRELAND ↗</span></div>
        </div>
      </section>
    </div>
  )
}

export default Home
