// Every page loads: the right heading and browser-tab title, no JavaScript errors, and nothing wider than the screen
import { test, expect } from '@playwright/test'
import { watchErrors } from './helpers.js'

const PAGES = [
  ['/', 'Find My Dublin · Student housing guide', /new\s*to Dublin/i],
  ['/districts', 'Explore districts · Find My Dublin', /Dublin district profiles/i],
  ['/campuses', 'Universities · Find My Dublin', /Find your campus/i],
  ['/attractions', 'Famous attractions · Find My Dublin', /Famous attractions/i],
  ['/how-it-works', 'How it works · Find My Dublin', /A simple guide to finding your place in Dublin/i],
  ['/questionnaire', 'Find my match · Find My Dublin', /tell us a little about/i],
  ['/things-to-know', 'Things to know · Find My Dublin', /Things to know/i],
  ['/login', 'Log in · Find My Dublin', /Your Dublin story continues here/i],
  ['/signup', 'Sign up · Find My Dublin', /Make Dublin feel like home/i],
  ['/my-searches', 'My recent searches · Find My Dublin', /Your searches/i],
  ['/terms', 'Terms of use · Find My Dublin', /Terms of use/i],
  ['/privacy', 'Privacy policy · Find My Dublin', /Privacy policy/i],
  ['/contact', 'Contact · Find My Dublin', /Get in touch/i],
  ['/results', 'Your matches · Find My Dublin', /No answers yet/i],
]

for (const [path, title, heading] of PAGES) {
  test(`${path} loads`, async ({ page }) => {
    const errors = watchErrors(page)
    const response = await page.goto(path)
    expect(response.ok()).toBeTruthy()
    await expect(page.locator('h1').first()).toHaveText(heading)
    await expect(page).toHaveTitle(title)
    // nothing pokes out sideways (a common phone layout bug)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'page is wider than the screen').toBeLessThanOrEqual(1)
    // images that are on the page actually load
    const broken = await page.evaluate(() => [...document.images]
      .filter((i) => i.complete && i.naturalWidth === 0 && getComputedStyle(i).display !== 'none' && !/wikipedia|wikimedia/.test(i.src))
      .map((i) => i.getAttribute('src')))
    expect(broken, `broken images: ${broken.join(', ')}`).toEqual([])
    errors.check()
  })
}

test('an unknown address shows the "Page not found" page', async ({ page }) => {
  await page.goto('/no-such-page')
  await expect(page.locator('h1')).toHaveText('Page not found')
  await expect(page).toHaveTitle('Page not found · Find My Dublin')
  await page.locator('main').getByRole('link', { name: 'Find my match' }).click()
  await expect(page).toHaveURL(/\/questionnaire$/)
})
