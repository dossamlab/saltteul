import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../copy'
import { shouldOffer, type ApkRelease } from '../pwa/apkRelease'
import { DISMISS_KEY, latestRelease, readStore, writeStore } from '../pwa/releaseCheck'

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
