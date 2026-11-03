// Android live update of the screens (Capgo updater in manual mode, no Capgo cloud):
// on start and when the app comes back, read app-update/latest.json from the web host, download a newer zip and
// switch to it the next time the app goes to the background. The iPhone PWA updates through the web as before.
// Settings can also check right away and switch at once (prepareScreens + applyScreens).
import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { compareVersions, isManifest } from './updateRule'

declare const __BUILD_ID__: string

export const UPDATE_MANIFEST_URL = 'https://saltteul-family.vercel.app/app-update/latest.json'
const CHECK_EVERY_MS = 60 * 60 * 1000

export type ScreenCheck =
  | { status: 'latest' }
  /** Newer screens are downloaded and set for the next start; applyScreens(id) switches now. */
  | { status: 'ready'; id: string; version: string }
  /** Newer screens need a newer installed app (APK) first. */
  | { status: 'needsApp'; minNative: string }

let lastCheck = 0
let inflight: Promise<ScreenCheck> | null = null

async function check(): Promise<ScreenCheck> {
  const res = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`update manifest ${res.status}`)
  const manifest: unknown = await res.json()
  if (!isManifest(manifest)) throw new Error('bad update manifest')
  if (manifest.version <= __BUILD_ID__) return { status: 'latest' }
  const { native } = await CapacitorUpdater.current()
  if (compareVersions(native, manifest.minNative) < 0) return { status: 'needsApp', minNative: manifest.minNative }
  // The background check may have fetched this build already; reuse it instead of downloading again.
  const { bundles } = await CapacitorUpdater.list()
  const have = bundles.find((b) => b.version === manifest.version && b.status !== 'error' && b.status !== 'downloading')
  const bundle = have ?? await CapacitorUpdater.download({
    url: new URL(manifest.url, UPDATE_MANIFEST_URL).toString(),
    version: manifest.version,
    checksum: manifest.checksum,
  })
  await CapacitorUpdater.next({ id: bundle.id })
  return { status: 'ready', id: bundle.id, version: manifest.version }
}

/** Checks for newer screens now (one check at a time) and downloads them. Throws when the check fails. */
export function prepareScreens(): Promise<ScreenCheck> {
  lastCheck = Date.now()
  inflight ??= check().finally(() => { inflight = null })
  return inflight
}

/** Switches to downloaded screens right away (the app reloads). */
export async function applyScreens(id: string): Promise<void> {
  await CapacitorUpdater.set({ id })
}

function backgroundCheck() {
  if (inflight || Date.now() - lastCheck < CHECK_EVERY_MS) return
  prepareScreens().catch((e) => console.warn('[saltteul] live update skipped', e))
}

/** Call once at start-up. Confirms the running screens work (otherwise Capgo rolls back) and starts update checks. */
export function startLiveUpdate(): void {
  if (!Capacitor.isNativePlatform()) return
  void CapacitorUpdater.notifyAppReady().catch(() => undefined)
  backgroundCheck()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') backgroundCheck()
  })
}
