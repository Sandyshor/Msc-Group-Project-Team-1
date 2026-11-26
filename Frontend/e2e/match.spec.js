// The main journey: answer the questionnaire, see the matches, and use every tab of the results page
import { test, expect } from '@playwright/test'
import { clickTab, resultsUrl, watchErrors } from './helpers.js'

test('the questionnaire leads to matches', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/questionnaire')
  // Continue stays disabled until a university is chosen
  await expect(page.getByText('Choose your university to continue.')).toBeVisible()
  const university = page.locator('main select').first()
  await university.selectOption(await university.locator('option', { hasText: 'Trinity College Dublin' }).getAttribute('value'))
  await page.getByRole('button', { name: 'Private room', exact: true }).click()
  await page.getByRole('button', { name: /^Continue/ }).click()
  await expect(page.locator('h1')).toHaveText(/What matters most to you/i)
  await page.getByRole('button', { name: /See my matches/ }).click()
  await expect(page).toHaveURL(/\/results\?a=/)
  // at least one match card with a monthly rent and a match percentage
  const cards = page.locator('main button').filter({ hasText: /^#\d/ })
  await expect(cards.first()).toBeVisible({ timeout: 30_000 })
  await expect(cards.first()).toContainText('%')
  await expect(cards.first()).toContainText('/month')
  errors.check()
})

// The results page lists the matches; "See why it matches" opens one match with its tabs
async function openFirstMatch(page) {
  const main = page.locator('main')
  await expect(main.locator('button').filter({ hasText: /^#1/ })).toBeVisible({ timeout: 30_000 })
  await main.getByText('See why it matches').first().click()
  await expect(main.getByRole('tab', { name: 'Why it fits' })).toBeVisible()
  return main
}

test('a match can be saved for later once logged in, and the airport journey opens on the district map', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto(resultsUrl())
  const main = await openFirstMatch(page)
  // these tests run without log in, so "Save area" asks the student to log in first
  await expect(main.getByRole('link', { name: /Log in to save this area/ })).toHaveAttribute('href', '/login')
  await clickTab(main, 'From the airport')
  await main.getByRole('button', { name: /See this journey on the .* map/ }).click()
  // the district profile opens on its Journey tab, from Dublin Airport to the matched area
  await expect(page).toHaveURL(/\/districts/)
  await expect(page.locator('input[aria-label="Start point"]').first()).toHaveValue('Dublin Airport')
  await expect(page.locator('input[aria-label="Destination"]').first()).toHaveValue(/, (D\d+W?|[AK]\d{2})$/)
  errors.check()
})

test('every results tab shows its content', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto(resultsUrl())
  const main = await openFirstMatch(page)
  const tabs = [
    ['Why it fits', /Why .* is #1/],
    ['About the area', /./],
    ['Safety', /Safety score|safety/i],
    ['Places to live', /Daft\.ie|Rent\.ie|residence/i],
    ['Letting agents', /PSRA/],
    ['From the airport', /From the airport to/],
  ]
  for (const [name, expected] of tabs) {
    await clickTab(main, name)
    await expect(main, name).toContainText(expected)
    await expect(main, `${name} shows no undefined/NaN`).not.toContainText(/\bundefined\b|\bNaN\b/)
  }
  errors.check()
})

test('Compare puts the top matches side by side', async ({ page }) => {
  await page.goto(resultsUrl())
  const main = page.locator('main')
  await expect(main.locator('button').filter({ hasText: /^#1/ })).toBeVisible({ timeout: 30_000 })
  await main.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(main).toContainText(/side by side/i)
  await expect(main).not.toContainText(/\bundefined\b|\bNaN\b/)
})

test('the shopping card says how many shops are nearby', async ({ page }) => {
  await page.goto(resultsUrl({ importance: { Rent: 5, Safety: 5, Commute: 5, 'Shopping & Groceries': 9, Restaurants: 5, Healthcare: 5, 'Recreation & Wellness': 5 } }))
  const main = await openFirstMatch(page)
  await expect(main.locator('.why-card', { hasText: 'Shopping & Groceries' })).toContainText(/\d+ (nearby|within 1 km)/)
})

test('"district profile" opens the matched district', async ({ page }) => {
  await page.goto(resultsUrl())
  await openFirstMatch(page)
  const button = page.locator('main').getByRole('button', { name: /district profile/i }).first()
  await expect(button).toBeVisible({ timeout: 30_000 })
  const code = (await button.innerText()).match(/D\d+W?|[AK]\d{2}/)[0]
  await button.click()
  await expect(page).toHaveURL(/\/districts/)
  await expect(page.locator('.pc')).toContainText(code)
})

test('a search with no possible match explains why', async ({ page }) => {
  await page.goto(resultsUrl({ university: 'TU Dublin - Tallaght', accommodation: 'student_studio', studentRoom: 'studio', maxCommute: 15 }))
  await expect(page.locator('main')).toContainText(/No student residence|No area is within|Try a longer commute/i, { timeout: 30_000 })
})

// Google polyline encoding (what the journey planner sends as each leg's line)
function encodeLine(points) {
  let out = '', lat = 0, lng = 0
  const enc = (v) => { let n = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5 } return s + String.fromCharCode(n + 63) }
  points.forEach(([a, b]) => { const A = Math.round(a * 1e5), B = Math.round(b * 1e5); out += enc(A - lat) + enc(B - lng); lat = A; lng = B })
  return out
}

test('Getting there: type a start (A), the trip to the university (B) is drawn with its steps', async ({ page }) => {
  // the journey planner's answer, fixed here so the test doesn't depend on the live service
  await page.route('**/route?**', (route) => {
    const u = new URL(route.request().url())
    const from = [Number(u.searchParams.get('from_lat')), Number(u.searchParams.get('from_lon'))]
    const to = [Number(u.searchParams.get('to_lat')), Number(u.searchParams.get('to_lon'))]
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ itineraries: [{
      total_minutes: 17, total_distance_km: 2.1, transfers: 0,
      legs: [
        { mode: 'WALK', from: 'Start', to: 'Parnell Square East', minutes: 4, distance_km: 0.3, geometry: encodeLine([from, mid]) },
        { mode: 'BUS', line: '1', headsign: 'Shaw street', from: 'Parnell Square East', to: 'Townsend Street', minutes: 9, distance_km: 1.5, geometry: encodeLine([mid, to]) },
        { mode: 'WALK', from: 'Townsend Street', to: 'Destination', minutes: 4, distance_km: 0.3, geometry: encodeLine([to, to.map((v) => v + 0.0005)]) },
      ],
    }] }) })
  })
  const errors = watchErrors(page)
  await page.goto(resultsUrl())
  const start = page.getByRole('combobox', { name: 'Start point' })
  await expect(start).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.rm-trip-b')).toContainText('Trinity College Dublin') // B is the university
  await start.fill('Beckett House')
  const option = page.locator('.ps-floating li[role="option"]', { hasText: 'Student residence' }).first()
  await expect(option).toBeVisible({ timeout: 20_000 })
  await start.press('Enter') // the first suggestion (on a phone the list follows the box as the page scrolls)
  await expect(page.locator('.rm-trip .route-numbers')).toContainText('17 min')
  await expect(page.locator('.route-bus-itinerary')).toContainText('Board at Parnell Square East towards Shaw street; get off at Townsend Street')
  await expect(page.locator('.route-bus-itinerary')).toContainText('From Beckett House to the Bus 1 stop at Parnell Square East')
  // the route line is drawn and visible (not left invisible by its draw-in animation)
  await expect.poll(() => page.locator('.route-map path').evaluateAll((paths) =>
    paths.filter((p) => getComputedStyle(p).opacity !== '0' && (parseFloat(getComputedStyle(p).strokeDashoffset) || 0) === 0).length), { timeout: 8000 }).toBeGreaterThan(2)
  await page.getByRole('button', { name: /Back to/ }).click()
  await expect(start).toHaveValue(/\S/)
  errors.check()
})
