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
