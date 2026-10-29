// Renders scripts/icon.svg to PNG icons with the installed Edge browser (no browser download).
// Usage: node scripts/make-icons.mjs
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8')
const targets = [
  ['public/icon-192.png', 192, false],
  ['public/icon-512.png', 512, false],
  ['public/icon-maskable-512.png', 512, true],
  ['scripts/out/icon-1024.png', 1024, false],
]

mkdirSync('scripts/out', { recursive: true })
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
for (const [out, size, maskable] of targets) {
  await page.setViewportSize({ width: size, height: size })
  const inner = maskable ? `<div style="width:100%;height:100%;background:#2d5a43;display:grid;place-items:center"><div style="width:80%;height:80%">${svg}</div></div>` : svg
  await page.setContent(`<html><body style="margin:0;overflow:hidden">${inner.replace('<svg ', `<svg width="100%" height="100%" `)}</body></html>`)
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size } })
  console.log('wrote', out)
}
await browser.close()
