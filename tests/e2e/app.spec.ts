import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import ko from '../../copy/ko.json' with { type: 'json' }

// Same merge as src/copy.ts: household-only wording wins when copy/ko.private.json exists.
const PRIVATE = new URL('../../copy/ko.private.json', import.meta.url)
const T: Record<string, string> = { ...ko, ...(existsSync(PRIVATE) ? JSON.parse(readFileSync(PRIVATE, 'utf8')) : {}) }
// Screens with household-only wording stay out of the committed review shots.
const SHOTS = existsSync(PRIVATE) ? 'test-results/screens' : 'reviews/screens'

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
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-home.png`, fullPage: true })
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
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-routines.png`, fullPage: true })

  await page.getByRole('button', { name: T['todos.tab.chores'] }).click()
  await expect(page.getByText('화장실 청소')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-chores.png`, fullPage: true })

  await nav.getByText(T['tab.shopping']).click()
  // One place to type on the shopping tab: the quick-add line, no separate shopping box.
  await expect(page.getByRole('textbox', { name: T['quick.title'] })).toHaveCount(1)
  const item = page.getByRole('checkbox', { name: '애호박' })
  const was = await item.getAttribute('aria-checked')
  await item.click()
  await expect(item).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true')
  await noHorizontalScroll(page)
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-shopping.png`, fullPage: true })

  await nav.getByText(T['tab.kids']).click()
  await expect(page.getByText(T['kidsnote.cardTitle'])).toBeVisible()
  await noHorizontalScroll(page)
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-kids.png`, fullPage: true })

  await nav.getByText(T['tab.ourhome']).click()
  await expect(page.getByText('결혼기념일')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-ourhome.png`, fullPage: true })
})

test('month view, month plan and its memo', async ({ page }, info) => {
  await login(page)
  const nav = info.project.name === 'phone' ? page.locator('nav').last() : page.locator('nav').first()
  const now = new Date(Date.now() + 9 * 3600_000) // Seoul
  const m = now.getUTCMonth() + 1
  const fill = (key: string, vars: Record<string, string | number>) => T[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k]))

  // The home line counts this month's open plans plus the one carried over: 겨울옷 정리, 독감 예방접종, 가족사진 인화.
  await page.getByRole('button', { name: fill('home.monthPlansLeft', { m, n: 3 }) }).click()
  await expect(page.getByRole('heading', { name: fill('todo.monthTitle', { y: now.getUTCFullYear(), m }) })
    .or(page.getByText(fill('todo.monthTitle', { y: now.getUTCFullYear(), m }), { exact: true }))).toBeVisible()
  await expect(page.getByText(fill('plan.title', { m }), { exact: true })).toBeVisible()
  await expect(page.getByText('겨울 준비하는 달. 김장 전에 냉장고 비우기.')).toBeVisible()
  await expect(page.getByText(fill('plan.carried', { m: m === 1 ? 12 : m - 1 }))).toBeVisible()

  const plan = page.getByRole('checkbox', { name: '겨울옷 정리' })
  const was = await plan.getAttribute('aria-checked')
  await plan.click()
  await expect(plan).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true')
  await noHorizontalScroll(page)
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-month.png`, fullPage: true })
  await plan.click() // back as seeded, so the next project sees the same count
  await expect(plan).toHaveAttribute('aria-checked', was ?? 'false')

  await page.getByRole('button', { name: T['todo.viewWeek'], exact: true }).click()
  await expect(page.getByText(fill('plan.title', { m }), { exact: true })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-week.png`, fullPage: true })
  await nav.getByText(T['tab.home']).click()
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
