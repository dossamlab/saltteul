// Captures the main screens at desktop width (emulators + `npm run dev` + seed must be running).
// Usage: node scripts/shots-pc.mjs [width] [height] [prefix]
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const [w = '1440', h = '900', prefix = 'pc'] = process.argv.slice(2)
mkdirSync('reviews/screens', { recursive: true })
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
await page.goto('http://localhost:5180/')
await page.waitForFunction(() => '__devSignIn' in window)
await page.evaluate(() => window.__devSignIn('husband@example.com'))
await page.getByText('민우네').first().waitFor({ timeout: 20000 })
await page.waitForTimeout(800)
const tabs = [['home', null], ['todos', '할 일'], ['shopping', '장보기'], ['ourhome', '우리 집']]
for (const [name, label] of tabs) {
  if (label) await page.locator('nav').first().getByText(label, { exact: true }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `reviews/screens/${prefix}-${name}.png` })
  console.log('shot', name)
}
await browser.close()
