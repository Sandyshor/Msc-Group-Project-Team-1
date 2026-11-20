// Getting around: the header (or the Menu on small screens), the footer and the "Find my match" button
import { test, expect } from '@playwright/test'
import { closeTour, isMobile, watchErrors } from './helpers.js'

const HEADER_LINKS = [
  ['Explore districts', /\/districts$/],
  ['Universities', /\/campuses$/],
  ['Famous attractions', /\/attractions$/],
  ['How it works', /\/how-it-works$/],
]

test('the header links open each page', async ({ page }, testInfo) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await closeTour(page)
  for (const [name, url] of HEADER_LINKS) {
    const menu = page.getByRole('button', { name: 'Menu' })
    if (await menu.isVisible()) await menu.click() // narrow screens put the links behind the Menu button
    const scope = (await page.locator('#site-menu').isVisible()) ? page.locator('#site-menu') : page.locator('header')
    await scope.getByRole('link', { name, exact: true }).first().click()
    await expect(page).toHaveURL(url)
  }
  errors.check()
  testInfo.annotations.push({ type: 'size', description: isMobile(testInfo) ? 'phone (Menu button)' : 'desktop header' })
})

test('"Find my match" opens the questionnaire', async ({ page }) => {
  await page.goto('/')
  await closeTour(page)
  await page.getByRole('link', { name: /Find my match/ }).first().click()
  await expect(page).toHaveURL(/\/questionnaire$/)
})

test('the footer links work', async ({ page }) => {
  await page.goto('/how-it-works')
  const footer = page.locator('footer')
  await footer.scrollIntoViewIfNeeded()
  const links = await footer.locator('a[href^="/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))])
  expect(links.length).toBeGreaterThan(5)
  for (const href of links) {
    const response = await page.goto(href)
    expect(response.status(), href).toBeLessThan(400) // 304 = served from the browser's cache, also fine
    await expect(page.locator('h1').first(), href).not.toHaveText('Page not found')
  }
})

test('the contact page links to the project page for reporting problems', async ({ page }) => {
  await page.goto('/contact')
  await expect(page.getByRole('link', { name: /Report a problem or idea/ })).toHaveAttribute('href', /github\.com\/Sandyshor\/Msc-Group-Project-Team-1\/issues/)
})
