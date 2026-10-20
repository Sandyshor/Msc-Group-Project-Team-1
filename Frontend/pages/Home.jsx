import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './HomePage.css'

const cityImage =
  'https://images.unsplash.com/photo-1692624459321-518f34276661?auto=format&fit=crop&fm=jpg&q=85&w=2200'

// Photographs are from the institutions' sites or published campus-photo pages.
// Each campus has its own official information link instead of sharing one generic URL.
const universities = [
  {
    id: 'tu-aungier',
    mark: 'TU',
    name: 'TUD Aungier Street',
    location: 'Aungier Street, Dublin 2',
    image: 'https://upload.wikimedia.org/wikipedia/commons/0/04/Aungier_Street_Campus.jpg',
    logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT623AMWRVJ4zikfoOynLoEIK3vpMh0fDyBONMPm-A2Tw&s=10',
    url: 'https://www.tudublin.ie/explore/our-campuses/aungier-street/',
  },
  {
    id: 'tu-bolton',
    mark: 'TU',
    name: 'TUD Bolton Street',
    location: 'Rotunda, Dublin 1',
    image: 'https://www.tudublin.ie/media/website/explore/host-events/bolton-courtyard.jpg',
    logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT623AMWRVJ4zikfoOynLoEIK3vpMh0fDyBONMPm-A2Tw&s=10',
    url: 'https://www.tudublin.ie/explore/our-campuses/bolton-street/',
  },
  {
    id: 'tu-grangegorman',
    mark: 'TU',
    name: 'TUD Grangegorman',
    location: 'Grangegorman, Dublin 7',
    image: 'https://archello.s3.eu-central-1.amazonaws.com/images/2022/04/13/quad-2.1649827721.3442.jpg',
    logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT623AMWRVJ4zikfoOynLoEIK3vpMh0fDyBONMPm-A2Tw&s=10',
    url: 'https://www.tudublin.ie/explore/our-campuses/grangegorman/',
  },
  {
    id: 'tu-blanchardstown',
    mark: 'TU',
    name: 'TUD Blanchardstown',
    location: 'Blanchardstown, Dublin 15',
    image: 'https://www.tudublin.ie/media/website/explore/our-campuses/blanchardstown/images/3005-001.jpg',
    logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT623AMWRVJ4zikfoOynLoEIK3vpMh0fDyBONMPm-A2Tw&s=10',
    url: 'https://www.tudublin.ie/explore/our-campuses/blanchardstown/',
  },
  {
    id: 'tu-tallaght',
    mark: 'TU',
    name: 'TUD Tallaght',
    location: 'Tallaght, Dublin 24',
    image: 'https://pxl01-tudublinie.terminalfour.net/prod01/tudublin-cdn-pxl/media/header-images/tallaght_main_campus.jpg',
    logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT623AMWRVJ4zikfoOynLoEIK3vpMh0fDyBONMPm-A2Tw&s=10',
    url: 'https://www.tudublin.ie/explore/our-campuses/tallaght/',
  },
  {
    id: 'tcd',
    name: 'Trinity College Dublin',
    location: 'College Green, Dublin 2',
    image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTK12vUA-0AeZbMTXsu6DDqu4Kogz6tyTRg5flGYCZ6Ig&s=10',
    logo: 'https://www.elabedu.eu/wp-content/uploads/2024/02/trinity-college-dublin-logo-freelogovectors.net_-universities-in-ireland-1024x1024.png',
    url: 'https://www.tcd.ie/',
  },
  {
    id: 'ucd',
    mark: 'UCD',
    name: 'University College Dublin',
    location: 'Belfield, Dublin 4',
    image: 'https://www.ucd.ie/universityrelations/t4media/Belfield_Campus.jpg',
    logo: 'https://www.ipsa.org/sites/default/files/news-announcements/joboffer/logo-193743.png',
    url: 'https://www.ucd.ie/',
  },
  {
    id: 'dcu',
    name: 'Dublin City University',
    location: 'Glasnevin, Dublin 9',
    image: 'https://www.dcu.ie/sites/default/files/styles/user_defined/public/prospective_editor/2026-04/screenshot-2026-04-29-163332.jpg.webp?itok=02ciHnA9',
    logo: 'https://ik.imagekit.io/onsnhxjshmp/dcu_5812dcc087.png',
    url: 'https://www.dcu.ie/campus-maps',
  },
  {
    id: 'griffith',
    name: 'Griffith College Dublin',
    location: 'South Circular Road, Dublin 8',
    image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS-svKKOqrVWgcP8vO0ej-5PZDaZvp8YUnfz3vJeNs9KQ&s=10',
    logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTVNAgdsyEhzVpQ0QGNedLr0nbhIMn3JkNP8GtZOUMnhw&s',
    url: 'https://www.griffith.ie/locations/dublin',
  },
  {
    id: 'nci',
    name: 'National College of Ireland',
    location: 'IFSC, Dublin 1',
    image: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/NCI_Mayor_Square.jpg',
    logo: 'https://www.ncirl.ie/Portals/0/International/Marketing/NCI_Logo_colour.png',
    url: 'https://www.ncirl.ie/About/Location',
  },
  {
    id: 'dbs',
    name: 'Dublin Business School',
    location: 'Aungier Street, Dublin 2',
    image: 'https://nrighvfgnsewiwblnzyu.supabase.co/storage/v1/object/public/universities/university-155/main.jpg',
    logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQsiIuu2icSyObr6sbJCSTl76dIWwE1anl5cDyzdbLiAg&s=10',
    url: 'https://www.dbs.ie/',
  },
]

const attractions = [
  {
    number: '01',
    category: 'CITY LANDMARK',
    name: "Ha'penny Bridge",
    detail: 'A familiar crossing over the River Liffey and an easy starting point for a city walk.',
    image: 'https://images.unsplash.com/photo-1663509851482-56ffbd1cf076?auto=format&fit=crop&w=900&q=85',
    url: 'https://dublin.ie/live/things-to-do/attractions/',
  },
  {
    number: '02',
    category: 'HISTORY & CULTURE',
    name: 'Trinity College',
    detail: 'Explore the historic campus and find information about the Book of Kells visitor experience.',
    image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTK12vUA-0AeZbMTXsu6DDqu4Kogz6tyTRg5flGYCZ6Ig&s=10',
    url: 'https://www.visittrinity.ie/',
  },
  {
    number: '03',
    category: 'HISTORY & ARCHITECTURE',
    name: 'Dublin Castle',
    detail: 'Discover the castle grounds, historic rooms and layers of the city’s past.',
    image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQwc1H3LXRFeQkb9GbjQlAp8lsX5hLrrMZBRAYJm9Z3Gg&s=10',
    url: 'https://dublincastle.ie/visit/',
  },
  {
    number: '04',
    category: 'GREEN SPACE',
    name: 'Phoenix Park',
    detail: 'A vast city park for walking, cycling and taking a break outdoors.',
    image: 'https://images.ireland.com/media/Images/Dublin/3afe901e7cd44366adab7228aeec66e5.jpg?w=1200',
    url: 'https://www.phoenixpark.ie/',
  },
  {
    number: '05',
    category: 'HISTORY & ARCHITECTURE',
    name: "St. Patrick's Cathedral",
    detail: 'Founded in 1191, St. Patrick’s Cathedral stands as Ireland’s largest and tallest church.',
    image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRO7diWx6uVbSd86fqhbXPlcxKLCmqW_dMOIkoqUT7UGA&s',
    url: 'https://www.stpatrickscathedral.ie/',
  },
  {
    number: '06',
    category: 'HISTORY & ARCHITECTURE',
    name: "Spire of Dublin",
    detail: "The large, stainless steel, pin-like monument 120 metres (390 ft) in height, on O'Connell Street, Dublin 1",
    image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQnbJQpl3gyUGUNTPA1Ndih3GdtedSeWrDu27_VPtz8Fw&s=10',
    url: 'https://www.visitdublin.com/the-spire',
  }
]

// Extend this dictionary with the 2–3 local names verified for each district profile.
// Normalisation lets users enter D1, D 1, Dublin 1, City Centre, etc. without a dropdown.
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
        <img className="fd-hero-image" src={cityImage} alt="Dublin city beside the River Liffey" />
        <div className="fd-hero-shade" />

        <div className="fd-hero-copy">
          <p className="fd-hero-kicker"><span /> A CITY GUIDE FOR INTERNATIONAL STUDENTS</p>
          <h1 id="fd-hero-title">
            Coming to Dublin
            <em>to study?</em>
            <span>Let’s help you find your place.</span>
          </h1>
          <p className="fd-hero-description">
            Welcome to Dublin. We’ll help you make sense of student life here —
            from finding your campus to exploring districts that fit your budget,
            commute and everyday needs.
          </p>
          <div className="fd-hero-actions">
            <Link className="fd-button fd-button-cream" to="/districts">Explore districts <span>↗</span></Link>
            <a className="fd-hero-watch" href="#explore-dublin"><span className="fd-play">▶</span> Meet Dublin through film</a>
          </div>
        </div>

        <div className="fd-hero-footer-left">BAILE ÁTHA CLIATH <span>—</span> DUBLIN, IRELAND</div>
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

      <section className="fd-moving-section fd-university-section" id="universities">
        <div className="fd-moving-heading">
          <div>
            <p className="fd-section-kicker">02 / CAMPUS LIFE</p>
            <h2>Find your <em>campus.</em></h2>
          </div>
          <p>Start with where you’ll study. For TU Dublin, each campus has its own information page — check your course location before deciding how you’ll travel each day.</p>
        </div>

        <div className="fd-moving-window" aria-label="Universities and campuses, moving list">
          <div className="fd-moving-track fd-university-track">
            {[...universities, ...universities].map((school, index) => (
              <a className="fd-university-card" href={school.url} target="_blank" rel="noreferrer" key={`${school.id}-${index}`}>
                <div className="fd-university-photo" style={{ backgroundImage: `url("${school.image}")` }}>
                  <div className="fd-university-photo-shade" />
                  <div className="fd-university-logo-wrap">
                    <span className="fd-logo-fallback">{school.mark}</span>
                    {school.logo && (
                      <img className="fd-university-logo" src={school.logo} alt={`${school.name} logo`} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} />
                    )}
                  </div>
                  <span className="fd-card-category">{school.type}</span>
                  <strong className="fd-university-name">{school.name}</strong>
                </div>
                <div className="fd-university-details">
                  <span className="fd-card-location">{school.location}</span>
                  <span className="fd-card-link">Campus / official information <b>↗</b></span>
                </div>
              </a>
            ))}
          </div>
        </div>
        <p className="fd-moving-hint">THE LIST MOVES AUTOMATICALLY · HOVER TO PAUSE</p>
      </section>

      <section className="fd-moving-section fd-attractions-section" id="attractions">
        <div className="fd-moving-heading">
          <div>
            <p className="fd-section-kicker">03 / OUTSIDE THE CLASSROOM</p>
            <h2>Get to know <em>the city.</em></h2>
          </div>
          <p>Landmarks, history and green spaces for the days when you close your laptop and go exploring.</p>
        </div>

        <div className="fd-moving-window" aria-label="Dublin attractions, moving list">
          <div className="fd-moving-track fd-attraction-track">
            {[...attractions, ...attractions].map((place, index) => (
              <a className="fd-attraction-card" href={place.url} target="_blank" rel="noreferrer" key={`${place.number}-${index}`}>
                <div className="fd-attraction-image-wrap">
                  <img src={place.image} alt={place.name} loading="lazy" />
                  <span>{place.number}</span>
                </div>
                <div className="fd-attraction-info">
                  <span className="fd-card-category">{place.category}</span>
                  <strong>{place.name}</strong>
                  <p>{place.detail}</p>
                  <span className="fd-card-link">Plan a visit <b>↗</b></span>
                </div>
              </a>
            ))}
          </div>
        </div>
        <p className="fd-moving-hint">A FEW PLACES TO BEGIN · HOVER TO PAUSE</p>
      </section>

      <section className="fd-final-section">
        <div className="fd-final-mark" aria-hidden="true">⌂</div>
        <div>
          <p className="fd-section-kicker">04 / MAKE IT YOURS</p>
          <h2>Now, find the part of Dublin <em>that fits your life.</em></h2>
          <p>Compare areas through the lens of your campus, budget, commute and everyday essentials.</p>
        </div>
        <div className="fd-final-actions">
          <Link className="fd-button fd-button-cream" to="/questionnaire">Start the questionnaire <span>↗</span></Link>
          <Link className="fd-final-text-link" to="/districts">Explore districts</Link>
        </div>
        <small>District information and recommendation features are still being developed. See the current District Explorer for available coverage.</small>
      </section>
    </div>
  )
}

export default Home
