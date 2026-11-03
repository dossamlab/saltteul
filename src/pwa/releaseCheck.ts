// Reads the latest signed APK from GitHub Releases for the update banner and the settings check.
import { parseRelease, RELEASES_API, type ApkRelease } from './apkRelease'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const CACHE_KEY = 'saltteul.apkRelease'
export const DISMISS_KEY = 'saltteul.apkReleaseDismissed'

// Browser storage only remembers the last check and a dismissed version on this phone; it can be empty at any time.
export function readStore<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
export function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage unavailable: the banner just checks again next time */ }
}

/** The latest release, at most every 6 hours unless force (the settings button). Throws on a failed forced check. */
export async function latestRelease(force = false): Promise<ApkRelease | null> {
  const cached = readStore<{ at: number; release: ApkRelease | null }>(CACHE_KEY)
  if (!force && cached && Date.now() - cached.at < CHECK_EVERY_MS) return cached.release
  const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
  if (!res.ok) {
    if (force) throw new Error(`releases ${res.status}`)
    return cached?.release ?? null
  }
  const release = parseRelease(await res.json())
  writeStore(CACHE_KEY, { at: Date.now(), release })
  return release
}
