import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../copy'
import { parseRelease, RELEASES_API, shouldOffer, type ApkRelease } from '../pwa/apkRelease'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const CACHE_KEY = 'saltteul.apkRelease'
const DISMISS_KEY = 'saltteul.apkReleaseDismissed'

// Browser storage only remembers the last check and a dismissed version on this phone; it can be empty at any time.
function readStore<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage unavailable: the banner just checks again next time */ }
}

async function latestRelease(): Promise<ApkRelease | null> {
  const cached = readStore<{ at: number; release: ApkRelease | null }>(CACHE_KEY)
  if (cached && Date.now() - cached.at < CHECK_EVERY_MS) return cached.release
  const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) return cached?.release ?? null
  const release = parseRelease(await res.json())
  writeStore(CACHE_KEY, { at: Date.now(), release })
  return release
}

/**
 * Android app only: when GitHub has a newer signed APK than the one installed, a band offers it. 「받기」 opens the
 * download in the phone's browser (Capacitor sends external URLs there); Android then asks once to install it.
 */
export function UpdateBanner() {
  const [release, setRelease] = useState<ApkRelease | null>(null)

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    let alive = true
    void (async () => {
      try {
        const [r, current] = await Promise.all([latestRelease(), CapacitorUpdater.current()])
        if (alive && r && shouldOffer(r, current.native, readStore<string>(DISMISS_KEY))) setRelease(r)
      } catch (e) {
        console.warn('[saltteul] release check skipped', e)
      }
    })()
    return () => { alive = false }
  }, [])

  if (!release) return null
  return (
    <div role="status" className="mb-4 flex items-center gap-3 rounded-[var(--radius-card)] bg-sage px-4 py-3 text-white shadow-[var(--shadow-card)]">
      <Download size={20} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{t('update.banner', { version: release.version })}</p>
        <p className="text-[12px] text-white/80">{t('update.bannerHint')}</p>
      </div>
      <button type="button" onClick={() => { window.location.href = release.url }}
        className="shrink-0 rounded-full bg-white px-4 py-2 text-[13px] font-bold text-sage">
        {t('update.get')}
      </button>
      <button type="button" aria-label={t('update.later')} title={t('update.later')}
        onClick={() => { writeStore(DISMISS_KEY, release.version); setRelease(null) }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/80">
        <X size={18} />
      </button>
    </div>
  )
}
