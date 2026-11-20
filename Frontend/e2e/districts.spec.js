// The district map: search, every tab of a district profile, Compare districts, the map layers and Eircodes
import { test, expect } from '@playwright/test'
import { clickTab, openDistrict, watchErrors } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await page.goto('/districts')
  await expect(page.locator('.ps-hero input')).toBeVisible()
})

test('a district profile shows every tab', async ({ page }) => {
  const errors = watchErrors(page)
  await openDistrict(page, 'D6')
  const card = page.locator('.pc')
  await expect(card.locator('h2')).toHaveText('Rathmines & Ranelagh')
  const tabs = [
    ['Places', /Rathmines|Ranelagh/],
    ['Journey', /campus|college|journey/i],
    ['Rent', /€\d/],
    ['Amenities', /SUPERMARKETS[\s\S]*CONVENIENCE SHOPS/i],
    ['Safety', /\/ 100|recorded crime/i],
    ['Area', /Population/],
  ]
  for (const [name, expected] of tabs) {
    await clickTab(card, name)
    await expect(card, name).toContainText(expected)
    await expect(card, `${name} shows no undefined/NaN`).not.toContainText(/\bundefined\b|\bNaN\b/)
  }
  errors.check()
})

test('typing "D1" opens D1, not D10 or D11', async ({ page }) => {
  await page.locator('.ps-hero input').fill('D1')
  await expect(page.locator('.ps-floating li[role="option"]').first()).toContainText('D1 · City Centre North')
})

test('the rent tab shows each size once, with where the figure comes from', async ({ page }) => {
  await openDistrict(page, 'D8')
  const card = page.locator('.pc')
  await clickTab(card, 'Rent')
  await expect(card.locator('.rent-tile').first()).toContainText(/€\d/)
  await expect(card).toContainText(/median of \d+ listings?|RTB 2025 average|Daft\.ie report/)
  await clickTab(card, 'Whole homes')
  await expect(card.getByText('1 bed', { exact: true })).toHaveCount(1) // never two different 1-bed prices
})

test('the amenities tab groups the shop chains', async ({ page }) => {
  await openDistrict(page, 'D1')
  const card = page.locator('.pc')
  await clickTab(card, 'Amenities')
  await expect(card.locator('.chain-group-name')).toHaveText([/Supermarkets/i, /Convenience shops/i, /International food/i])
  await expect(card.locator('.amenity-tile').first()).toContainText(/Supermarkets\s*\d+/)
  // picking a chain shows how many there are in the district
  await card.getByRole('button', { name: /^Tesco/ }).click()
  await expect(card.locator('.chain-result')).toContainText(/Tesco in D1, shown on the map/)
})

test('Compare districts puts two districts side by side', async ({ page }) => {
  const errors = watchErrors(page)
  await openDistrict(page, 'D3')
  // on phones the button is further down; the page scrolls smoothly to it, so let that finish before clicking
  const compare = page.getByRole('button', { name: /Compare D3 with another district/ })
  await compare.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  await compare.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('District B').selectOption('D6')
  await expect(dialog).toContainText('Rent per month')
  await expect(dialog).toContainText('Safety score')
  await expect(dialog.getByText('✓').first()).toBeVisible() // the better figure on a row gets a tick
  await dialog.getByRole('button', { name: 'Close comparison' }).click()
  await expect(dialog).toBeHidden()
  errors.check()
})

test('the map layers switch on without errors', async ({ page }) => {
  const errors = watchErrors(page)
  for (const name of ['Bus stops', 'Dublin Bikes', 'DART & rail', 'Student housing', 'Safety map', 'Luas lines']) {
    const chip = page.getByRole('button', { name: new RegExp(name) }).first()
    if (!(await chip.isVisible())) continue // some chips sit behind "Explore" on small screens
    await chip.click()
    await page.waitForTimeout(400)
  }
  await expect(page.locator('.leaflet-container')).toBeVisible()
  errors.check()
})

test('an Eircode drops a pin on the exact address', async ({ page }) => {
  // the exact lookup needs a Google key on the server, so its answer is supplied here
  await page.route('**/eircode/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ eircode: 'D07 ED7R', name: 'Highfield Park Student Residences', street: '274 North Circular Road', area: 'Grangegorman', lat: 53.3589, lng: -6.279 }),
  }))
  await page.locator('.ps-hero input').fill('D07 ED7R')
  const first = page.locator('.ps-floating li[role="option"]').first()
  await expect(first).toContainText('Highfield Park Student Residences')
  await first.click()
  await expect(page.locator('.place-panel .pp-title')).toContainText('Highfield Park Student Residences')
})

// A fixed answer from the journey planner (the real one needs the OpenTripPlanner server)
const ROUTE = { itineraries: [{ total_minutes: 24, total_distance_km: 4.1, walking_km: 0.5, transfers: 0, departure: '2026-11-20T10:00:00', arrival: '2026-11-20T10:24:00', walk_only: false,
  legs: [{ mode: 'WALK', from: 'Start', to: 'Camden Street', minutes: 4, distance_km: 0.3, departure: '2026-11-20T10:00:00', geometry: null },
    { mode: 'BUS', line: '16', headsign: 'Dublin Airport', from: 'Camden Street', to: 'College Green', minutes: 20, distance_km: 3.8, departure: '2026-11-20T10:04:00', geometry: null }] }] }

test('clicking the map shows that place in the side panel, with directions', async ({ page }) => {
  const errors = watchErrors(page)
  await page.route('**/route?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROUTE) }))
  // a university pin: its details, distances to the other campuses and what's nearby
  await page.locator('.pm-uni', { hasText: 'Trinity College' }).first().click({ force: true })
  const panel = page.locator('.place-panel')
  await expect(panel.locator('.pp-title')).toHaveText('Trinity College Dublin')
  await expect(panel).toContainText('Distance to universities')
  await expect(panel).toContainText(/Getting around[\s\S]*(Luas|bus stop|DART|Rail)/i, { timeout: 20_000 })
  // Directions: the place becomes the destination
  await panel.getByRole('button', { name: 'Directions', exact: true }).click()
  const dir = page.locator('.directions-panel')
  await expect(dir.getByRole('combobox', { name: 'Destination' })).toHaveValue('Trinity College Dublin')
  // a start from the popular list of places, then the route comes back with its time
  await dir.getByRole('combobox', { name: 'Start point' }).fill('Rathmines')
  const rathmines = page.getByRole('listbox', { name: 'Start point suggestions' }).getByRole('option', { name: /Neighbourhood in D6/ })
  await expect(rathmines).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(600) // the list settles once the address results arrive
  await rathmines.click()
  await expect(dir.locator('.jp-route-tab').first()).toContainText('24 min')
  await expect(page.locator('.jp-map-hint')).toBeHidden()
  // the pins can't be dragged any more
  await expect(page.locator('.leaflet-marker-draggable')).toHaveCount(0)
  errors.check()
})

test('a spot on the map shows its address, district and the Start here button', async ({ page }) => {
  await page.route('**/nominatim.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ name: '', address: { house_number: '12', road: 'Camden Street Lower', suburb: 'Portobello' } }) }))
  await openDistrict(page, 'D2')
  // an empty spot (just map tiles, no pin or label on top)
  await page.locator('.jp-route-map').scrollIntoViewIfNeeded()
  const spot = await page.locator('.jp-route-map').evaluate((map) => {
    const r = map.getBoundingClientRect()
    for (let fy = 0.3; fy < 0.8; fy += 0.05) for (let fx = 0.25; fx < 0.75; fx += 0.05) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy
      const clear = [[0, 0], [-35, 0], [35, 0], [0, -35], [0, 35], [-25, -25], [25, 25], [-25, 25], [25, -25]].every(([dx, dy]) => {
        const hit = document.elementFromPoint(x + dx, y + dy)
        return hit && (hit.classList.contains('leaflet-tile') || hit === map)
      })
      if (clear) return { x, y }
    }
    return null
  })
  expect(spot).not.toBeNull()
  await page.mouse.click(spot.x, spot.y)
  const panel = page.locator('.place-panel')
  await expect(panel.locator('.pp-kicker')).toContainText('Dropped pin')
  await expect(panel.locator('.pp-title')).toHaveText('12 Camden Street Lower, Portobello')
  await panel.getByRole('button', { name: 'Start here' }).click()
  await expect(page.locator('.directions-panel').getByRole('combobox', { name: 'Start point' })).toHaveValue('12 Camden Street Lower, Portobello')
  // closing goes back to the district profile
  await page.locator('.directions-panel').getByRole('button', { name: 'Close directions' }).click()
  await expect(page.locator('.pc h2')).toBeVisible()
})

test('a street search offers OpenStreetMap addresses', async ({ page }) => {
  await page.locator('.ps-hero input').fill('Camden Street')
  await expect(page.locator('.ps-floating')).toContainText(/Search streets and addresses|Camden/)
})

test('a clicked salon shows whether it is open, its week of hours and how to book', async ({ page }) => {
  // OpenStreetMap's answer for the salon (fixed here so the test doesn't depend on the live service)
  await page.route('**/place-info?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    source: 'overpass',
    place: { name: 'Test Hair Studio', type: 'Hair salon', key: 'shop', value: 'hairdresser', appointment: true, osm: 'https://www.openstreetmap.org/node/1',
      tags: { opening_hours: 'Mo-Sa 09:00-18:00; Su off', phone: '+353 1 234 5678', website: 'https://example.ie', wheelchair: 'yes' } },
    inside: null,
    nearby: [{ name: 'Corner Café', type: 'Café', lat: 53.3401, lng: -6.2652, distance_m: 40, tags: { opening_hours: '24/7' } }],
  }) }))
  await page.locator('.ps-hero input').fill("Ali's Turkish Barber")
  const option = page.locator('.ps-floating li[role="option"]', { hasText: /Salon/ }).first()
  await expect(option).toContainText("Ali's Turkish Barber", { timeout: 20_000 })
  await page.waitForTimeout(1500) // street-address results arrive a moment later and the list redraws
  await option.click()
  const panel = page.locator('.place-panel')
  await expect(panel.locator('.pp-kicker')).toContainText('Hair salon')
  await expect(panel.locator('.pp-status')).toContainText(/^(Open|Closed)/)
  await expect(panel.locator('.pp-week tr')).toHaveCount(7)
  await expect(panel.locator('.pp-week')).toContainText('Sunday')
  await expect(panel.locator('.pp-week')).toContainText('09:00–18:00')
  await expect(panel.getByRole('link', { name: /Book online/ })).toHaveAttribute('href', 'https://example.ie')
  await expect(panel.getByRole('link', { name: /Call to book/ })).toHaveAttribute('href', 'tel:+35312345678')
  await expect(panel).toContainText('Wheelchair accessible')
  // another place close by opens in the panel
  await panel.getByRole('button', { name: /Corner Café/ }).click()
  await expect(panel.locator('.pp-title')).toHaveText('Corner Café')
})
