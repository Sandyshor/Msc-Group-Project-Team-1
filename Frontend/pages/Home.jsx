import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './HomePage.css'

const cityImage =
  '/images/hero-dublin.jpg'

// Photographs are from the institutions' sites or published campus-photo pages.
// Each campus has its own official information link instead of sharing one generic URL.
const universities = [
  {
    id: 'tu-aungier',
    name: 'Technological University Dublin — Aungier Street Campus',
    location: 'Aungier Street, Dublin 2',
    coordinates: [53.3385, -6.2663],
    icon: 'school',
    image: '/images/campus-tu-aungier.jpg',
    imageCredit: { source: 'TU Dublin', url: 'https://www.tudublin.ie/explore/our-campuses/aungier-street/' },
    logo: '/images/logo-tu-dublin.png',
    url: 'https://www.tudublin.ie/explore/our-campuses/aungier-street/',
  },
  {
    id: 'tu-bolton',
    name: 'Technological University Dublin — Bolton Street Campus',
    location: 'Rotunda, Dublin 1',
    coordinates: [53.3533, -6.2697],
    icon: 'school',
    image: '/images/campus-tu-bolton.jpg',
    imageCredit: { source: 'TU Dublin', url: 'https://www.tudublin.ie/explore/our-campuses/bolton-street/' },
    logo: '/images/logo-tu-dublin.png',
    url: 'https://www.tudublin.ie/explore/our-campuses/bolton-street/',
  },
  {
    id: 'tu-grangegorman',
    name: 'Technological University Dublin — Grangegorman Campus',
    location: 'Grangegorman, Dublin 7',
    coordinates: [53.3547, -6.2789],
    icon: 'school',
    image: '/images/campus-tu-grangegorman.jpg',
    imageCredit: { source: 'TU Dublin', url: 'https://www.tudublin.ie/explore/our-campuses/grangegorman/' },
    logo: '/images/logo-tu-dublin.png',
    url: 'https://www.tudublin.ie/explore/our-campuses/grangegorman/',
  },
  {
    id: 'tu-blanchardstown',
    name: 'Technological University Dublin — Blanchardstown Campus',
    location: 'Blanchardstown, Dublin 15',
    coordinates: [53.4065, -6.3759],
    icon: 'school',
    image: '/images/campus-tu-blanchardstown.jpg',
    imageCredit: { source: 'TU Dublin', url: 'https://www.tudublin.ie/explore/our-campuses/blanchardstown/' },
    logo: '/images/logo-tu-dublin.png',
    url: 'https://www.tudublin.ie/explore/our-campuses/blanchardstown/',
  },
  {
    id: 'tu-tallaght',
    name: 'Technological University Dublin — Tallaght Campus',
    location: 'Tallaght, Dublin 24',
    coordinates: [53.2892, -6.3738],
    icon: 'school',
    image: '/images/campus-tu-tallaght.jpg',
    imageCredit: { source: 'TU Dublin', url: 'https://www.tudublin.ie/explore/our-campuses/tallaght/' },
    logo: '/images/logo-tu-dublin.png',
    url: 'https://www.tudublin.ie/explore/our-campuses/tallaght/',
  },
  {
    id: 'tcd',
    name: 'Trinity College Dublin',
    location: 'College Green, Dublin 2',
    coordinates: [53.3438, -6.2546],
    icon: 'school',
    image: '/images/campus-trinity.jpg',
    imageCredit: { source: 'Trinity College Dublin', url: 'https://www.tcd.ie/' },
    logo: '/images/logo-trinity.png',
    url: 'https://www.tcd.ie/',
  },
  {
    id: 'ucd',
    name: 'University College Dublin — Belfield',
    location: 'Belfield, Dublin 4',
    coordinates: [53.3067, -6.2191],
    icon: 'school',
    image: '/images/campus-ucd.jpg',
    imageCredit: { source: 'University College Dublin', url: 'https://www.ucd.ie/' },
    logo: '/images/logo-ucd.png',
    url: 'https://www.ucd.ie/',
  },
  {
    id: 'dcu',
    name: 'Dublin City University — Glasnevin Campus',
    location: 'Glasnevin, Dublin 9',
    coordinates: [53.3852, -6.2578],
    icon: 'school',
    image: '/images/campus-dcu.webp',
    imageCredit: { source: 'Dublin City University', url: 'https://www.dcu.ie/campus-maps' },
    logo: '/images/logo-dcu.png',
    url: 'https://www.dcu.ie/campus-maps',
  },
  {
    id: 'dcu-st-patricks',
    name: "Dublin City University — St Patrick's Campus",
    location: 'Drumcondra Road Upper, Dublin 9',
    coordinates: [53.3708, -6.2519],
    icon: 'school',
    image: '/images/campus-dcu.webp',
    imageCredit: { source: 'Dublin City University', url: 'https://www.dcu.ie/campus-maps' },
    logo: '/images/logo-dcu.png',
    url: 'https://www.dcu.ie/campus-maps',
  },
  {
    id: 'rcsi',
    name: 'Royal College of Surgeons in Ireland',
    location: 'St Stephen’s Green, Dublin 2',
    coordinates: [53.3384, -6.2632],
    icon: 'school',
    image: '/images/campus-rcsi.jpg',
    logo: '/images/logo-rcsi.svg',
    imageCredit: { author: 'Dr Neil Clifton', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', url: 'https://commons.wikimedia.org/wiki/File:Dublin,_Royal_College_of_Surgeons_-_geograph.org.uk_-_2505918.jpg' },
    url: 'https://www.rcsi.com/dublin/',
  },
  {
    id: 'ncad',
    name: 'National College of Art and Design',
    location: 'Thomas Street, Dublin 8',
    coordinates: [53.3428, -6.2793],
    icon: 'school',
    image: '/images/campus-ncad.jpg',
    logo: '/images/logo-ncad.gif',
    imageCredit: { author: 'Twilson r', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', url: 'https://commons.wikimedia.org/wiki/File:NCAD,_Dublin,_facade_on_Thomas_Street,_looking_east.jpg' },
    url: 'https://www.ncad.ie/',
  },
  {
    id: 'griffith',
    name: 'Griffith College Dublin',
    location: 'South Circular Road, Dublin 8',
    coordinates: [53.3368, -6.2781],
    icon: 'school',
    image: '/images/campus-griffith.jpg',
    imageCredit: { source: 'Griffith College', url: 'https://www.griffith.ie/locations/dublin' },
    logo: '/images/logo-griffith.png',
    url: 'https://www.griffith.ie/locations/dublin',
  },
  {
    id: 'nci',
    name: 'National College of Ireland — IFSC',
    location: 'IFSC, Dublin 1',
    coordinates: [53.3482, -6.2438],
    icon: 'school',
    image: '/images/campus-nci.jpg',
    imageCredit: { source: 'National College of Ireland', url: 'https://www.ncirl.ie/About/Location' },
    logo: '/images/logo-nci.png',
    url: 'https://www.ncirl.ie/About/Location',
  },
  {
    id: 'dbs',
    name: 'Dublin Business School',
    location: 'Aungier Street, Dublin 2',
    coordinates: [53.3387, -6.2663],
    icon: 'school',
    image: '/images/campus-dbs.jpg',
    imageCredit: { source: 'Dublin Business School', url: 'https://www.dbs.ie/' },
    logo: '/images/logo-dbs.png',
    url: 'https://www.dbs.ie/',
  },
  {
    id: 'iadt',
    name: 'IADT — Dún Laoghaire',
    location: 'Kill Avenue, Dún Laoghaire',
    coordinates: [53.2878, -6.1358],
    icon: 'school',
    image: '/images/campus-iadt.jpg',
    logo: '/images/logo-iadt.svg',
    imageCredit: { author: 'DubhEire', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://commons.wikimedia.org/wiki/File:D%C3%BAn_Laoghaire_Institute_of_Art_Design_and_Technology_Media_Cube.jpg' },
    url: 'https://iadt.ie/',
  },
]

const attractions = [
  {
    id: 'hapenny-bridge',
    category: 'CITY LANDMARK',
    name: "Ha'penny Bridge",
    detail: 'This historic pedestrian bridge crosses the River Liffey in the heart of Dublin. Pause here for classic river views and an easy start to a city walk.',
    location: 'Liffey Street Lower, Dublin 1',
    coordinates: [53.3463, -6.2631],
    icon: 'bridge',
    image: '/images/attraction-ha-penny-bridge.jpg',
    imageCredit: { source: 'Visit Dublin', url: 'https://www.visitdublin.com/ha-penny-bridge' },
    url: 'https://www.visitdublin.com/ha-penny-bridge',
  },
  {
    id: 'trinity-college',
    category: 'HISTORY & CULTURE',
    name: 'Trinity College',
    detail: 'Founded in 1592, Trinity is Ireland’s oldest university and a landmark in the city centre. Visit the campus and book the Book of Kells experience ahead of time.',
    location: 'College Green, Dublin 2',
    coordinates: [53.3438, -6.2546],
    icon: 'book',
    image: '/images/attraction-trinity-college.jpg',
    imageCredit: { author: 'N Chadwick', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', url: 'https://commons.wikimedia.org/wiki/File:Trinity_College_Dublin_-_front_square_-_geograph.org.uk_-_6046522.jpg' },
    url: 'https://www.visittrinity.ie/',
  },
  {
    id: 'dublin-castle',
    category: 'HISTORY & ARCHITECTURE',
    name: 'Dublin Castle',
    detail: 'Dublin Castle has played a major role in the city’s history for centuries. Explore its state apartments, gardens and museum exhibitions.',
    location: 'Dame Street, Dublin 2',
    coordinates: [53.3429, -6.2674],
    icon: 'castle',
    image: '/images/attraction-dublin-castle.jpg',
    imageCredit: { author: 'Wknight94', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/', url: 'https://commons.wikimedia.org/wiki/File:Dublin_Castle_courtyard_tower.jpg' },
    url: 'https://dublincastle.ie/visit/',
  },
  {
    id: 'phoenix-park',
    category: 'GREEN SPACE',
    name: 'Phoenix Park',
    detail: 'Phoenix Park is one of Europe’s largest enclosed city parks, with broad paths and open lawns. Walk, cycle or visit the park’s historic landmarks.',
    location: 'Phoenix Park, Dublin 8',
    coordinates: [53.3558, -6.3298],
    icon: 'tree',
    image: '/images/attraction-phoenix-park.jpg',
    imageCredit: { source: 'Phoenix Park', url: 'https://www.phoenixpark.ie/' },
    url: 'https://www.phoenixpark.ie/',
  },
  {
    id: 'st-patricks-cathedral',
    category: 'HISTORY & ARCHITECTURE',
    name: "St. Patrick's Cathedral",
    detail: 'Founded in 1191, St Patrick’s is Ireland’s largest cathedral and a striking piece of medieval Dublin. Visit the cathedral and gardens or check its calendar for concerts and events.',
    location: 'St Patrick’s Close, Dublin 8',
    coordinates: [53.3394, -6.2713],
    icon: 'cathedral',
    image: '/images/attraction-st-patricks-cathedral.jpg',
    imageCredit: { author: 'Diliff', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/', url: 'https://commons.wikimedia.org/wiki/File:St_Patrick%27s_Cathedral_Exterior,_Dublin,_Ireland_-_Diliff.jpg' },
    url: 'https://www.stpatrickscathedral.ie/',
  },
  {
    id: 'spire-of-dublin',
    category: 'HISTORY & ARCHITECTURE',
    name: "Spire of Dublin",
    detail: 'The Spire is a 120-metre stainless-steel monument rising above O’Connell Street. See it up close while exploring the shops and historic buildings of the north city centre.',
    location: 'O’Connell Street, Dublin 1',
    coordinates: [53.3498, -6.2603],
    icon: 'spire',
    image: '/images/attraction-spire-of-dublin.jpg',
    imageCredit: { author: 'Almbauer', license: 'Public domain', licenseUrl: 'https://commons.wikimedia.org/wiki/File:The_Spire.jpg', url: 'https://commons.wikimedia.org/wiki/File:The_Spire.jpg' },
    url: 'https://www.visitdublin.com/the-spire',
  },
  {
    id: 'guinness-storehouse',
    category: 'FOOD & DRINK',
    name: 'Guinness Storehouse',
    detail: 'Discover the story of Guinness inside the former fermentation plant at St James’s Gate. The visit ends at the Gravity Bar, with wide views across Dublin.',
    location: 'St James’s Gate, Dublin 8',
    coordinates: [53.3419, -6.2867],
    icon: 'pint',
    image: '/images/attraction-guinness-storehouse.jpg',
    imageCredit: { author: 'Joseph Mischyshyn', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', url: 'https://commons.wikimedia.org/wiki/File:Dublin_-_Guinness_Storehouse_-_geograph.org.uk_-_1492760.jpg' },
    url: 'https://www.guinness-storehouse.com/en',
  },
  {
    id: 'kilmainham-gaol',
    category: 'HISTORY & CULTURE',
    name: 'Kilmainham Gaol',
    detail: 'This former prison is closely connected with key events in Irish history. Guided tours share the stories of its prisoners and the struggle for independence.',
    location: 'Inchicore Road, Dublin 8',
    coordinates: [53.3419, -6.3096],
    icon: 'castle',
    image: '/images/attraction-kilmainham-gaol.jpg',
    imageCredit: { author: 'Joseph Mischyshyn', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', url: 'https://commons.wikimedia.org/wiki/File:Dublin_-_Kilmainham_Jail_-_Courtyard_-_geograph.org.uk_-_1492763.jpg' },
    url: 'https://kilmainhamgaolmuseum.ie/',
  },
  {
    id: 'temple-bar',
    category: 'CITY CULTURE',
    name: 'Temple Bar',
    detail: 'Temple Bar is a lively central quarter known for its pubs, cultural venues and cobbled lanes. Come for the atmosphere, but explore its galleries and food spots too.',
    location: 'Temple Bar, Dublin 2',
    coordinates: [53.3456, -6.2641],
    icon: 'pub',
    image: '/images/attraction-temple-bar.jpg',
    imageCredit: { author: 'Gordon Leggett', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', url: 'https://commons.wikimedia.org/wiki/File:2008-05-23_The_Temple_Bar,_Dublin,_Ireland.jpg' },
    url: 'https://www.visitdublin.com/guides/things-to-do-temple-bar',
  },
  {
    id: 'st-stephens-green',
    category: 'GREEN SPACE',
    name: 'St Stephen’s Green',
    detail: 'This central Victorian park offers leafy paths, flower beds and a lake among busy city streets. It’s a peaceful spot for a stroll or a lunch break.',
    location: 'St Stephen’s Green, Dublin 2',
    coordinates: [53.3379, -6.2591],
    icon: 'tree',
    image: '/images/attraction-st-stephens-green.jpg',
    imageCredit: { author: 'Ian S', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', url: 'https://commons.wikimedia.org/wiki/File:St_Stephen%27s_Green,_Dublin_-_geograph.org.uk_-_4794028.jpg' },
    url: 'https://heritageireland.ie/places-to-visit/st-stephens-green/',
  },
  {
    id: 'epic-museum',
    category: 'HISTORY & CULTURE',
    name: 'EPIC The Irish Emigration Museum',
    detail: 'EPIC tells the stories of Irish people who left home and shaped communities around the world. Interactive galleries explore their journeys, lives and legacy.',
    location: 'Custom House Quay, Dublin 1',
    coordinates: [53.3486, -6.2439],
    icon: 'ship',
    image: '/images/attraction-epic-museum.jpg',
    imageCredit: { author: 'Eleanor Milano', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', url: 'https://commons.wikimedia.org/wiki/File:EPIC_Irish_Emigration_Museum_Dublin.jpg' },
    url: 'https://epicchq.com/',
  },
  {
    id: 'howth',
    category: 'COAST & NATURE',
    name: 'Howth',
    detail: 'Howth is a harbour village on Dublin Bay, known for its coastal paths and sea views. Take the DART for a seaside walk, harbour visit or fresh seafood.',
    location: 'Howth, County Dublin',
    coordinates: [53.3878, -6.0668],
    icon: 'lighthouse',
    image: '/images/attraction-howth.jpg',
    imageCredit: { author: 'Christine Matthews', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', url: 'https://commons.wikimedia.org/wiki/File:Howth,_Ireland_-_geograph.org.uk_-_2550003.jpg' },
    url: 'https://www.visitdublin.com/guides/things-to-do-in-howth',
  },
  {
    id: 'national-botanic-gardens',
    category: 'GARDENS & NATURE',
    name: 'National Botanic Gardens',
    detail: 'Wander through themed gardens, glasshouses and collections of plants from around the world. The gardens offer a calm escape in Glasnevin, just north of the city centre.',
    location: 'Glasnevin, Dublin 9',
    coordinates: [53.3729, -6.2729],
    icon: 'flower',
    image: '/images/attraction-national-botanic-gardens.jpg',
    imageCredit: { author: 'William Murphy', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', url: 'https://commons.wikimedia.org/wiki/File:Botanic_Gardens_Glasnevin_-150600_(47397822692).jpg' },
    url: 'https://www.botanicgardens.ie/',
  },
  {
    id: 'national-gallery',
    category: 'ART & CULTURE',
    name: 'National Gallery of Ireland',
    detail: 'The gallery’s collection spans Irish and European art, from historic paintings to modern works. Entry to the permanent collection is free, making it an easy cultural stop.',
    location: 'Merrion Square West, Dublin 2',
    coordinates: [53.3409, -6.2523],
    icon: 'art',
    image: '/images/attraction-national-gallery.jpg',
    imageCredit: { author: 'David Kernan', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', url: 'https://commons.wikimedia.org/wiki/File:National_Gallery_of_Ireland,_Merrion_Square_Entrance_Fa%C3%A7ade.jpg' },
    url: 'https://www.nationalgallery.ie/',
  },
  {
    id: 'iveagh-gardens',
    category: 'GREEN SPACE',
    name: 'Iveagh Gardens',
    detail: 'Tucked behind the city centre, Iveagh Gardens has fountains, lawns and a small maze. Its quieter paths make it a lovely break from nearby Grafton Street.',
    location: 'Clonmel Street, Dublin 2',
    coordinates: [53.3367, -6.2612],
    icon: 'fountain',
    image: '/images/attraction-iveagh-gardens.jpg',
    imageCredit: { author: 'Oliver Gargan', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', url: 'https://commons.wikimedia.org/wiki/File:Iveagh_Gardens,_Dublin_City_Park.jpg' },
    url: 'https://www.gov.ie/en/office-of-public-works/services/iveagh-gardens/',
  },
  {
    id: 'blessington-basin',
    category: 'GREEN SPACE',
    name: 'Blessington Street Basin',
    detail: 'This former city reservoir is now a small waterside park in Dublin 7. Sit by the water, watch the birds or take a quiet pause near the city centre.',
    location: 'Blessington Street, Dublin 7',
    coordinates: [53.3583, -6.2734],
    icon: 'water',
    image: '/images/attraction-blessington-basin.jpg',
    imageCredit: { author: 'KevForkan', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', url: 'https://commons.wikimedia.org/wiki/File:Blessington_Street_Basin_-_20141230140248.jpg' },
    url: 'https://www.dublincity.ie/parks-and-nature/dublin-city-parks/visit-park/blessington-street-basin',
  },
  {
    id: 'dublinia',
    category: 'HISTORY & CULTURE',
    name: 'Dublinia',
    detail: 'Dublinia brings Viking and medieval Dublin to life through hands-on exhibits and reconstructed streets. It sits beside Christ Church Cathedral in the historic city.',
    location: 'St Michael’s Hill, Dublin 8',
    coordinates: [53.3438, -6.2711],
    icon: 'viking',
    image: '/images/attraction-dublinia.jpg',
    imageCredit: { author: 'N Chadwick', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', url: 'https://commons.wikimedia.org/wiki/File:Dublinia_-_geograph.org.uk_-_6021101.jpg' },
    url: 'https://dublinia.ie/',
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

const mapIconPaths = {
  school: [
    'M2 9 12 4l10 5-10 5L2 9Z',
    'M6 11v5c3.5 2.5 8.5 2.5 12 0v-5',
    'M22 9v6',
  ],
  bridge: [
    'M3 19V9c2.2 0 2.9 5 5.2 5S11 9 13.2 9s2.8 5 5.2 5 2.8-5 5-5v10',
    'M2 20h21',
    'M7 14v4M12 14v4M17 14v4',
  ],
  book: [
    'M3 5.5A2.5 2.5 0 0 1 5.5 3H12v17H5.5A2.5 2.5 0 0 0 3 22V5.5Z',
    'M21 5.5A2.5 2.5 0 0 0 18.5 3H12v17h6.5A2.5 2.5 0 0 1 21 22V5.5Z',
  ],
  castle: [
    'M3 21V8l4 3V7l5 4 5-4v4l4-3v13H3Z',
    'M9 21v-6h6v6',
    'M12 4v3',
  ],
  tree: [
    'M12 3 7 10h3l-5 7h6v4h2v-4h6l-5-7h3l-5-7Z',
  ],
  cathedral: [
    'M4 21V9l8-5 8 5v12',
    'M2 21h20',
    'M9 21v-6a3 3 0 0 1 6 0v6',
    'M12 2v3M10 4h4',
  ],
  spire: [
    'M12 2 7 21h10L12 2Z',
    'M9 15h6M8 19h8',
  ],
  pint: [
    'M6 4h12l-1 17H7L6 4Z',
    'M6 8H4a2 2 0 0 0 0 4h2M8 4V2m4 2V2m4 2V2',
    'M8 13h8',
  ],
  pub: [
    'M3 21h18M5 21V10h14v11M4 10V5h16v5',
    'M8 5V3m8 2V3M9 14h6',
  ],
  ship: [
    'M3 15h18l-3 5H7l-4-5Z',
    'M6 15V7h12v8M10 7V3h4v4M2 22c2 1 4 1 6 0s4-1 6 0 4 1 8 0',
  ],
  lighthouse: [
    'M9 21h6l-1-12h-4L9 21Z',
    'M9 9h6l2-4H7l2 4ZM10 5V2h4v3',
    'M4 7l4 2m12-2-4 2',
  ],
  flower: [
    'M12 12c-4-1-5-5-2-7 2-1 3 2 2 7Zm0 0c1-4 5-5 7-2 1 2-2 3-7 2Zm0 0c4 1 5 5 2 7-2 1-3-2-2-7Zm0 0c-1 4-5 5-7 2-1-2 2-3 7-2Z',
    'M12 12c2 0 2 2 0 2s-2-2 0-2Zm0 2v8m0-4-3 3m3-3 3 3',
  ],
  art: [
    'M3 5h18v14H3z',
    'm5 17 5-6 3 3 2-2 4 5',
    'M15.5 8.5h.01',
  ],
  fountain: [
    'M12 3v4m-3-1h6M5 11c0-2 3-2 3 0s3 2 3 0 3-2 3 0 3 2 3 0',
    'M4 15c0-2 3-2 3 0s3 2 3 0 3-2 3 0 3 2 3 0 3 2 3 0',
    'M5 20h14',
  ],
  water: [
    'M12 3c-3 4-6 7-6 11a6 6 0 0 0 12 0c0-4-3-7-6-11Z',
    'M9 15a3 3 0 0 0 3 3',
  ],
  viking: [
    'M4 20h16l-2-11H6l-2 11Z',
    'M8 9 5 4l5 2m6 3 3-5-5 2',
    'M9 14h.01M15 14h.01M10 17h4',
  ],
}

function MapIcon({ name, className, x, y, width, height }) {
  return (
    <svg className={className} viewBox="0 0 24 24" x={x} y={y} width={width} height={height} aria-hidden="true">
      {mapIconPaths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  )
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

function PhotoCredit({ credit, className }) {
  if (!credit) return null

  if (credit.author) {
    return (
      <p className={className}>
        Photo: <a href={credit.url} target="_blank" rel="noreferrer">{credit.author}</a>
        {credit.license && (
          <>
            {' · '}
            <a href={credit.licenseUrl} target="_blank" rel="noreferrer">{credit.license}</a>
          </>
        )}
      </p>
    )
  }

  return (
    <p className={className}>
      Photo source: <a href={credit.url} target="_blank" rel="noreferrer">{credit.source}</a>
    </p>
  )
}

function DublinMap({ title, locations, variant }) {
  const isCampusMap = variant === 'campuses'
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(new Map())
  const [activeLocation, setActiveLocation] = useState(null)

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return undefined

    const map = L.map(mapContainerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(map)

    const markers = new Map()
    locations.forEach((location) => {
      const locationKey = location.id
      const paths = mapIconPaths[location.icon]
        .map((path) => `<path d="${path}" />`)
        .join('')
      const markerClass = isCampusMap ? 'fd-map-marker-campus' : 'fd-map-marker-attraction'
      const icon = L.divIcon({
        className: 'fd-map-marker',
        html: `<span class="${markerClass}"><svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg></span>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -18],
      })
      const marker = L.marker(location.coordinates, {
        icon,
        title: location.name,
        alt: location.name,
        keyboard: true,
      }).addTo(map)
      const popup = document.createElement('div')
      const name = document.createElement('strong')
      const address = document.createElement('p')
      const link = document.createElement('a')

      name.textContent = location.name
      address.textContent = location.location || 'Dublin, Ireland'
      link.href = location.url
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.textContent = `${isCampusMap ? 'Official website' : 'Explore more'} ↗`
      popup.append(name, address, link)
      marker.bindPopup(popup, { className: 'fd-map-popup' })
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event)
        setActiveLocation(locationKey)
      })
      markers.set(locationKey, marker)
    })

    map.fitBounds(
      L.latLngBounds(locations.map((location) => location.coordinates)),
      { padding: [28, 28], maxZoom: 13 },
    )
    map.on('click', () => setActiveLocation(null))
    mapRef.current = map
    markersRef.current = markers
    requestAnimationFrame(() => map.invalidateSize())

    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = new Map()
    }
  }, [isCampusMap, locations])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((marker, locationKey) => {
      const isActive = locationKey === activeLocation
      marker.getElement()?.classList.toggle('is-active', isActive)
      if (isActive) {
        map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.45 })
        marker.openPopup()
      } else {
        marker.closePopup()
      }
    })
  }, [activeLocation])

  return (
    <section className={`fd-location-map fd-location-map-${variant}`} aria-labelledby={`${variant}-map-heading`}>
      <div className="fd-map-heading">
        <div>
          <p className="fd-section-kicker">DUBLIN AT A GLANCE</p>
          <h3 id={`${variant}-map-heading`}>{title}</h3>
        </div>
        <span className="fd-map-caption"><i /> INTERACTIVE OPENSTREETMAP</span>
      </div>
      <div className="fd-map-panel">
        <div className="fd-map-canvas">
          <div
            ref={mapContainerRef}
            className="fd-leaflet-map"
            role="region"
            aria-label={`${title} interactive OpenStreetMap`}
          />
        </div>
        <ol className="fd-map-legend">
          {locations.map((location) => {
            const locationKey = location.id

            return (
              <li key={locationKey}>
                <a
                  className={activeLocation === locationKey ? 'is-active' : ''}
                  href={location.url}
                  target="_blank"
                  rel="noreferrer"
                  onMouseEnter={() => setActiveLocation(locationKey)}
                  onMouseLeave={() => setActiveLocation(null)}
                  onFocus={() => setActiveLocation(locationKey)}
                  onBlur={() => setActiveLocation(null)}
                  aria-current={activeLocation === locationKey ? 'location' : undefined}
                >
                  <MapIcon name={location.icon} className="fd-map-legend-icon" />
                  <span><strong>{location.name}</strong><small>{location.location || location.category}</small></span>
                  <b aria-hidden="true">↗</b>
                </a>
              </li>
            )
          })}
        </ol>
      </div>
      <p className="fd-map-disclaimer">Explore a live OpenStreetMap with pan, zoom and place markers. Map tiles and street data are provided by OpenStreetMap contributors; opening hours and travel conditions can change.</p>
    </section>
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
        <img className="fd-hero-image" src={cityImage} alt="Dublin city beside the River Liffey" />
        <div className="fd-hero-shade" />

        <div className="fd-hero-copy">
          <p className="fd-hero-kicker"><span /> A CITY GUIDE FOR INTERNATIONAL STUDENTS</p>
          <h1 id="fd-hero-title">
            New to
            <em>Dublin?</em>
            <span>Let’s help you find your place.</span>
          </h1>
          <p className="fd-hero-description">
            From finding your campus to discovering a neighbourhood that feels
            like yours, get to know Dublin at your own pace.
          </p>
          <div className="fd-hero-actions">
            <Link className="fd-button fd-button-cream" to="/districts">Explore districts <span>↗</span></Link>
            <a className="fd-hero-watch" href="/journey-planner/route.html"><span className="fd-play">⇄</span> Plan a journey</a>
            <a className="fd-hero-watch" href="#explore-dublin"><span className="fd-play">▶</span> Meet Dublin through film</a>
          </div>
        </div>

        <aside className="fd-hero-guide" aria-label="Quick links to explore Dublin">
          <div className="fd-guide-topline">
            <span><i /> YOUR CITY GUIDE</span>
            <span>01 — 04</span>
          </div>
          <div className="fd-guide-route" aria-hidden="true">
            <span>DISTRICTS</span>
            <i />
            <span>CAMPUSES</span>
            <i />
            <span>CITY LIFE</span>
          </div>
          <h2>Start with what matters to you.</h2>
          <p>Explore your new city one step at a time.</p>
          <nav className="fd-guide-links" aria-label="Explore the city guide">
            <Link to="/districts"><span>01</span><strong>Neighbourhoods</strong><b>↗</b></Link>
            <a href="#universities"><span>02</span><strong>Campus life</strong><b>↗</b></a>
            <a href="#attractions"><span>03</span><strong>Places to explore</strong><b>↗</b></a>
            {/* Separate page (not React) served from Frontend/public/journey-planner */}
            <a href="/journey-planner/route.html"><span>04</span><strong>Journey planner</strong><b>↗</b></a>
          </nav>
        </aside>

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
          <p>Explore universities and colleges across the city and nearby coast. Check your course location before deciding how you’ll travel each day.</p>
        </div>

        <div className="fd-moving-window" aria-label="Universities and campuses, moving list">
          <div className="fd-moving-track fd-university-track">
            {[...universities, ...universities].map((school, index) => (
              <article className="fd-university-card" key={`${school.id}-${index}`}>
                <a className="fd-university-card-link" href={school.url} target="_blank" rel="noreferrer">
                  <div className="fd-university-photo" style={{ backgroundImage: `url("${school.image}")` }}>
                    <div className="fd-university-photo-shade" />
                    <div className="fd-university-logo-wrap">
                      {school.logo && (
                        <img className="fd-university-logo" src={school.logo} alt={`${school.name} logo`} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} />
                      )}
                    </div>
                    <span className="fd-card-category">{school.type || 'UNIVERSITY / CAMPUS'}</span>
                    <strong className="fd-university-name">{school.name}</strong>
                  </div>
                  <div className="fd-university-details">
                    <span className="fd-card-location">{school.location}</span>
                    <span className="fd-card-link">Official website <b>↗</b></span>
                  </div>
                </a>
                <PhotoCredit credit={school.imageCredit} className="fd-university-photo-credit" />
              </article>
            ))}
          </div>
        </div>
        <p className="fd-moving-hint">THE LIST MOVES AUTOMATICALLY · HOVER TO PAUSE</p>
        <DublinMap title="Find the campuses across Dublin." locations={universities} variant="campuses" />
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
              <article className="fd-attraction-card" key={`${place.id}-${index}`}>
                <a className="fd-attraction-card-link" href={place.url} target="_blank" rel="noreferrer">
                  <div className="fd-attraction-image-wrap">
                    <img src={place.image} alt={place.name} loading="lazy" />
                    <span className="fd-attraction-icon"><MapIcon name={place.icon} /></span>
                  </div>
                  <div className="fd-attraction-info">
                    <span className="fd-card-category">{place.category}</span>
                    <strong>{place.name}</strong>
                    <p>{place.detail}</p>
                    <span className="fd-card-link">Explore more <b>↗</b></span>
                  </div>
                </a>
                <PhotoCredit credit={place.imageCredit} className="fd-attraction-photo-credit" />
              </article>
            ))}
          </div>
        </div>
        <p className="fd-moving-hint">A FEW PLACES TO BEGIN · HOVER TO PAUSE</p>
        <DublinMap title="Landmarks, all around the city." locations={attractions} variant="attractions" />
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
