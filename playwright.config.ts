import { defineConfig } from '@playwright/test'

// Expects `npm run emulators` (with built functions) and `npm run dev` to be running, and `npm run seed` done.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://localhost:5180', channel: 'msedge', locale: 'ko-KR', timezoneId: 'Asia/Seoul' },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'tablet', use: { viewport: { width: 1180, height: 820 }, hasTouch: true } },
  ],
})
