// The Universities and Famous attractions pages: a photo banner, filter chips and a grid of photo cards.
// The maps live in the district profiles; each campus card links to its district there.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './CityGuide.css'

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

// "Technological University Dublin — Aungier Street Campus" -> title "Aungier Street Campus", over-line "TU Dublin"
const SHORT_NAMES = {
  'Technological University Dublin': 'TU Dublin', 'University College Dublin': 'UCD', 'Dublin City University': 'DCU',
  'National College of Ireland': 'NCI', IADT: 'IADT',
}
// multi-campus universities show the campus as the title; single-site colleges keep their name as the title
const MULTI_CAMPUS = new Set(['Technological University Dublin', 'University College Dublin', 'Dublin City University'])
const FULL_NAMES = { IADT: 'Institute of Art, Design + Technology' }
function splitName(name) {
  const [head, tail] = name.split(' — ')
  if (!tail) return { over: null, title: name }
  if (MULTI_CAMPUS.has(head)) return { over: SHORT_NAMES[head] ?? head, title: tail }
  return { over: head === 'IADT' ? `IADT · ${tail}` : tail, title: FULL_NAMES[head] ?? head }
}
const districtOf = (location) => { const m = location.match(/Dublin (\d{1,2})\b/); return m ? `D${m[1]}` : null }

// filter groups
function campusGroup(school) {
  if (school.name.startsWith('Technological University Dublin')) return 'TU Dublin'
  if (/University|Trinity College|Royal College of Surgeons/.test(school.name)) return 'Universities'
  return 'Colleges'
}
function attractionGroup(place) {
  const c = place.category
  if (/GREEN|GARDEN|COAST|NATURE/.test(c)) return 'Parks & nature'
  if (/HISTORY|ART/.test(c)) return 'History & culture'
  return 'City life'
}

const Pin = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" />
  </svg>
)

function UniversityCard({ school, index }) {
  const navigate = useNavigate()
  const { over, title } = splitName(school.name)
  const district = districtOf(school.location)
  return (
    <article className="cg-card cg-campus" style={{ '--i': index }}>
      <a className="cg-photo" href={school.url} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
        <img src={school.image} alt="" loading="lazy" />
        <span className="cg-tag">{CAMPUS_TAGS[campusGroup(school)]}</span>
      </a>
      {school.logo && (
        <span className="cg-logo">
          <img src={school.logo} alt={`${school.name} logo`} loading="lazy" onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }} />
        </span>
      )}
      <div className="cg-body">
        {over && <span className="cg-over">{over}</span>}
        <h3>{title}</h3>
        <p className="cg-where"><Pin /> {school.location}{district && <b className="cg-district">{district}</b>}</p>
        <div className="cg-actions">
          <a className="cg-btn cg-btn-solid" href={school.url} target="_blank" rel="noreferrer">Website <span aria-hidden="true">↗</span></a>
          {district && (
            <button type="button" className="cg-btn" onClick={() => navigate('/districts', { state: { district } })}>
              See the area <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>
      <PhotoCredit credit={school.imageCredit} className="cg-credit" />
    </article>
  )
}

function AttractionCard({ place, index }) {
  return (
    <article className="cg-card cg-place" style={{ '--i': index }}>
      <a className="cg-photo" href={place.url} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
        <img src={place.image} alt="" loading="lazy" />
        <span className="cg-tag"><MapIcon name={place.icon} />{place.category.toLowerCase()}</span>
      </a>
      <div className="cg-body">
        <h3>{place.name}</h3>
        <p className="cg-detail">{place.detail}</p>
        <p className="cg-where"><Pin /> {place.location}</p>
        <div className="cg-actions">
          <a className="cg-btn cg-btn-solid" href={place.url} target="_blank" rel="noreferrer">Explore more <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <PhotoCredit credit={place.imageCredit} className="cg-credit" />
    </article>
  )
}

// cards fade up as they scroll into view
function useReveal(deps) {
  const ref = useRef(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return undefined
    const cards = [...root.querySelectorAll('.cg-card')]
    if (!('IntersectionObserver' in window)) { cards.forEach((c) => c.classList.add('is-in')); return undefined }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) }
    }), { rootMargin: '0px 0px -40px 0px' })
    cards.forEach((c) => io.observe(c))
    return () => io.disconnect()
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}

// One page: photo banner, filter chips and the card grid
function GuidePage({ kicker, title, accent, description, banner, stats, groups, groupOf, items, renderCard, tourTarget, gridLabel }) {
  const [group, setGroup] = useState('All')
  const counts = useMemo(() => Object.fromEntries(groups.map((g) => [g, items.filter((x) => groupOf(x) === g).length])), [groups, items, groupOf])
  const shown = group === 'All' ? items : items.filter((x) => groupOf(x) === group)
  const gridRef = useReveal([group])
  return (
    <div className="cg-page" data-site-tour={tourTarget}>
      <header className="cg-hero">
        <img className="cg-hero-img" src={banner.src} alt="" />
        <div className="cg-hero-text">
          <p className="cg-kicker">{kicker}</p>
          <h1>{title} <em>{accent}</em></h1>
          <p className="cg-lead">{description}</p>
          <ul className="cg-stats">
            {stats.map(([n, label]) => <li key={label}><strong>{n}</strong>{label}</li>)}
          </ul>
        </div>
        <p className="cg-hero-credit">{banner.caption} · Photo: <a href={banner.page} target="_blank" rel="noreferrer">{banner.author}</a>, {banner.license}</p>
      </header>

      <div className="cg-toolbar" role="group" aria-label="Filter">
        {['All', ...groups].map((g) => (
          <button key={g} type="button" className={`cg-chip${g === group ? ' is-on' : ''}`} aria-pressed={g === group} onClick={() => setGroup(g)}>
            {g}<span>{g === 'All' ? items.length : counts[g]}</span>
          </button>
        ))}
      </div>

      <div className="cg-grid" ref={gridRef} role="list" aria-label={gridLabel}>
        {shown.map((item, i) => <div role="listitem" key={item.id} className="cg-cell">{renderCard(item, i)}</div>)}
      </div>
    </div>
  )
}

const CAMPUS_GROUPS = ['Universities', 'TU Dublin', 'Colleges']
const CAMPUS_TAGS = { Universities: 'University', 'TU Dublin': 'TU Dublin campus', Colleges: 'College' }
const PLACE_GROUPS = ['History & culture', 'Parks & nature', 'City life']

export function UniversitiesPage() {
  const institutions = new Set(universities.map((u) => u.name.split(' — ')[0])).size
  return (
    <GuidePage
      kicker="CAMPUS LIFE"
      title="Find your"
      accent="campus."
      description="Universities and colleges across the city and the coast. Check where your course is taught, then see what living nearby is like."
      banner={{ src: '/images/flow/trinity-long-room.jpg', caption: 'The Long Room, Trinity College', author: 'Diliff', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Long_Room_Interior,_Trinity_College_Dublin,_Ireland_-_Diliff.jpg' }}
      stats={[[universities.length, 'campuses'], [institutions, 'institutions'], [new Set(universities.map((u) => districtOf(u.location)).filter(Boolean)).size, 'Dublin districts']]}
      groups={CAMPUS_GROUPS}
      groupOf={campusGroup}
      items={universities}
      renderCard={(school, i) => <UniversityCard school={school} index={i} />}
      tourTarget="universities"
      gridLabel="Universities and campuses"
    />
  )
}

export function AttractionsPage() {
  return (
    <GuidePage
      kicker="OUTSIDE THE CLASSROOM"
      title="Famous attractions"
      accent="across Dublin."
      description="Landmarks, history and green spaces for the days when you close your laptop and go exploring."
      banner={{ src: '/images/flow/liffey-sunset.jpg', caption: 'The River Liffey at sunset', author: '瑞丽江的河水', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Liffey_River_sunset_-_2025-11-11.jpg' }}
      stats={[[attractions.length, 'places to explore'], [attractions.filter((p) => attractionGroup(p) === 'Parks & nature').length, 'parks & nature spots'], [attractions.filter((p) => attractionGroup(p) === 'History & culture').length, 'history & culture']]}
      groups={PLACE_GROUPS}
      groupOf={attractionGroup}
      items={attractions}
      renderCard={(place, i) => <AttractionCard place={place} index={i} />}
      tourTarget="attractions"
      gridLabel="Places to explore in Dublin"
    />
  )
}
