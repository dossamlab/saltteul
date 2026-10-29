import { expect, test, type Page } from '@playwright/test'
import ko from '../../copy/ko.json' with { type: 'json' }

const T = ko as Record<string, string>

async function login(page: Page, email = 'husband@example.com') {
  await page.goto('/')
  await page.waitForFunction(() => '__devSignIn' in window)
  await page.evaluate((e) => (window as unknown as { __devSignIn: (e: string) => Promise<unknown> }).__devSignIn(e), email)
  await expect(page.getByText(T['brief.title'])).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('민우네')).toBeVisible()
  await page.waitForTimeout(500)
}

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over).toBeLessThanOrEqual(0)
}

test('home shows briefing, weather and today', async ({ page }, info) => {
  await login(page)
  await expect(page.getByText(T['home.todayTitle'])).toBeVisible()
  await expect(page.getByText('자동차 정기검사 예약').first()).toBeVisible()
  await noHorizontalScroll(page)
  await page.screenshot({ path: `reviews/screens/${info.project.name}-home.png`, fullPage: true })
})

test('routine check, chore and shopping flows', async ({ page }, info) => {
  await login(page)
  const nav = info.project.name === 'phone' ? page.locator('nav').last() : page.locator('nav').first()

  await nav.getByText(T['tab.todos']).click()
  await page.getByRole('button', { name: T['todos.tab.routines'] }).click()
  const box = page.getByRole('checkbox', { name: '설거지' })
  const before = await box.getAttribute('aria-checked')
  await box.click()
  await expect(box).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
  await noHorizontalScroll(page)
  await page.screenshot({ path: `reviews/screens/${info.project.name}-routines.png`, fullPage: true })

  await page.getByRole('button', { name: T['todos.tab.chores'] }).click()
  await expect(page.getByText('화장실 청소')).toBeVisible()
  await page.screenshot({ path: `reviews/screens/${info.project.name}-chores.png`, fullPage: true })

  await nav.getByText(T['tab.shopping']).click()
  const name = `시험 품목 ${Date.now() % 10000}`
  await page.getByPlaceholder(T['shop.quickPlaceholder']).fill(name)
  await page.keyboard.press('Enter')
  await expect(page.getByText(name)).toBeVisible()
  await page.getByRole('checkbox', { name }).click()
  await expect(page.getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'true')
  await noHorizontalScroll(page)
  await page.screenshot({ path: `reviews/screens/${info.project.name}-shopping.png`, fullPage: true })

  await nav.getByText(T['tab.ourhome']).click()
  await expect(page.getByText('결혼기념일')).toBeVisible()
  await page.screenshot({ path: `reviews/screens/${info.project.name}-ourhome.png`, fullPage: true })
})

test('partner sees a change made by the other member', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()
  await login(a, 'husband@example.com')
  await login(b, 'wife@example.com')
  for (const p of [a, b]) {
    const phone = (p.viewportSize()?.width ?? 0) < 900
    await (phone ? p.locator('nav').last() : p.locator('nav').first()).getByText(T['tab.shopping']).click()
  }
  const name = `공유 시험 ${Date.now() % 10000}`
  await a.getByPlaceholder(T['shop.quickPlaceholder']).fill(name)
  await a.keyboard.press('Enter')
  await expect(b.getByText(name)).toBeVisible({ timeout: 10_000 })
})
