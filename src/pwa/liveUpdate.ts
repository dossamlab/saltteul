// Android live update of the screens (Capgo updater in manual mode, no Capgo cloud):
// on start and when the app comes back, read app-update/latest.json from the web host, download a newer zip and
// switch to it the next time the app goes to the background. The iPhone PWA updates through the web as before.
import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { isManifest, shouldDownload } from './updateRule'

declare const __BUILD_ID__: string

export const UPDATE_MANIFEST_URL = 'https://saltteul-family.vercel.app/app-update/latest.json'
const CHECK_EVERY_MS = 60 * 60 * 1000

let lastCheck = 0
let running = false

async function check(): Promise<void> {
  if (running || Date.now() - lastCheck < CHECK_EVERY_MS) return
  running = true
  lastCheck = Date.now()
  try {
    const res = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const manifest: unknown = await res.json()
    if (!isManifest(manifest)) return
    const { native } = await CapacitorUpdater.current()
    if (!shouldDownload(manifest, { buildId: __BUILD_ID__, native })) return
    const bundle = await CapacitorUpdater.download({
      url: new URL(manifest.url, UPDATE_MANIFEST_URL).toString(),
      version: manifest.version,
      checksum: manifest.checksum,
    })
    await CapacitorUpdater.next({ id: bundle.id })
  } catch (e) {
    console.warn('[saltteul] live update skipped', e)
  } finally {
    running = false
  }
}

/** Call once at start-up. Confirms the running screens work (otherwise Capgo rolls back) and starts update checks. */
export function startLiveUpdate(): void {
  if (!Capacitor.isNativePlatform()) return
  void CapacitorUpdater.notifyAppReady().catch(() => undefined)
  void check()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
}
