// Shared helpers for the end-to-end tests
import { expect } from '@playwright/test'

// Console and page errors that are not bugs in the website: missing optional photos on Wikipedia, external map
// tiles cut off when a test ends, and the backend's "not set up" answers for features that need keys (Eircode
// lookup without a Google key, the assistant without an Anthropic key, log in without Firebase settings), and 429 "too many
// requests" from the free map-tile and address services when the tests run many times in a row.
const NOT_OUR_BUG = [
  /wikipedia/i, /stadiamaps|tile\.openstreetmap|basemaps/i, /Failed to load resource: the server responded with a status of (404|429|503)/,
  /net::ERR_ABORTED/, /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/, /auth\/not-configured/, /Download the React DevTools/,
]

/** Collects JavaScript errors and console errors while a test runs; call .check() at the end. */
export function watchErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOT_OUR_BUG.some((r) => r.test(m.text()))) errors.push(`console: ${m.text()}`)
  })
  return { errors, check: () => expect(errors, errors.join('\n')).toEqual([]) }
}

/** The home page opens the website tour by itself; close it so it doesn't cover what the test clicks. */
export async function closeTour(page) {
  const tour = page.locator('#site-tour-panel, .site-tour')
  await page.waitForTimeout(1600) // it opens 1.2 s after the home page loads
  if (await tour.count()) await page.keyboard.press('Escape')
  await expect(tour).toHaveCount(0)
}

/** A results page link with these questionnaire answers (the same format as the website's Share link). */
export function resultsUrl(overrides = {}) {
  const answers = {
    university: 'Trinity College Dublin', budget: 1000, accommodation: 'private_room', accommodationLabel: 'Private room',
    importance: { Rent: 7, Safety: 7, Commute: 7, 'Shopping & Groceries': 7, Restaurants: 7, Healthcare: 7, 'Recreation & Wellness': 7 },
    travelMode: 'public_transport', ...overrides,
  }
  return `/results?a=${encodeURIComponent(Buffer.from(JSON.stringify(answers)).toString('base64'))}`
}

/** Open a district profile with the map's search box, e.g. openDistrict(page, 'D6'). */
export async function openDistrict(page, code) {
  const search = page.locator('.ps-hero input')
  await search.click()
  await search.fill(code)
  const first = page.locator('.ps-floating li[role="option"]').first()
  // the place list loads the first time the box is used, which can be slow when many tests run at once
  try {
    await expect(first).toContainText(`${code} ·`, { timeout: 20_000 })
  } catch {
    await search.fill('')
    await search.fill(code)
    await expect(first).toContainText(`${code} ·`, { timeout: 20_000 })
  }
  await first.click()
  await expect(page.locator('.pc h2')).toBeVisible()
}

/** Click a tab (or, where there isn't one, a button) by its exact text inside an area of the page. */
export async function clickTab(scope, name) {
  const tab = scope.getByRole('tab', { name, exact: true })
  if (await tab.count()) return tab.first().click()
  return scope.getByRole('button', { name, exact: true }).first().click()
}

/** Answer the assistant with a fixed reply instead of calling the AI (no API key or cost needed). */
export async function mockAssistant(page, reply = 'A student Leap card gives you about **50% off** fares.\n- Apply online\n- Collect it on campus', { status = 200 } = {}) {
  const sent = []
  await page.route('**/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    sent.push(route.request().postDataJSON())
    if (status !== 200) return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ detail: 'The assistant is busy right now.' }) })
    return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: reply })
  })
  return sent
}

/** Open the chat. The button may be tucked into the screen edge, so it's clicked directly. */
export async function openChat(page) {
  await page.locator('.chatw-fab').dispatchEvent('click')
  await expect(page.locator('.chatw-panel')).toBeVisible()
}

export const isMobile = (testInfo) => testInfo.project.name.startsWith('mobile')
