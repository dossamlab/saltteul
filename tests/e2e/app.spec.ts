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
  const phone = info.project.name === 'phone'
  await expect(page.getByText(phone ? T['home.todayCardTitle'] : T['home.todayTitle'], { exact: true }).first()).toBeVisible()
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
  // One place to type on the shopping tab: the quick-add line, no separate shopping box.
  await expect(page.getByRole('textbox', { name: T['quick.title'] })).toHaveCount(1)
  const item = page.getByRole('checkbox', { name: '애호박' })
  const was = await item.getAttribute('aria-checked')
  await item.click()
  await expect(item).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true')
  await noHorizontalScroll(page)
  await page.screenshot({ path: `reviews/screens/${info.project.name}-shopping.png`, fullPage: true })

  await nav.getByText(T['tab.kids']).click()
  await expect(page.getByText(T['kidsnote.cardTitle'])).toBeVisible()
  await noHorizontalScroll(page)
  await page.screenshot({ path: `reviews/screens/${info.project.name}-kids.png`, fullPage: true })

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
  const mine = a.getByRole('checkbox', { name: '우유 1L' })
  const theirs = b.getByRole('checkbox', { name: '우유 1L' })
  const was = await theirs.getAttribute('aria-checked')
  await mine.click()
  await expect(theirs).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true', { timeout: 10_000 })
})
