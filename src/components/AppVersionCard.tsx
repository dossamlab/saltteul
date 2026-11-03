import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { Download, Loader2, RefreshCw, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../copy'
import { shouldOffer, type ApkRelease } from '../pwa/apkRelease'
import { applyScreens, prepareScreens, type ScreenCheck } from '../pwa/liveUpdate'
import { latestRelease } from '../pwa/releaseCheck'
import { buildTime } from '../pwa/updateRule'
import { Button, Card, CardHeader } from './ui'

declare const __BUILD_ID__: string

type Result = { screens: ScreenCheck | null; apk: ApkRelease | null; failed: boolean }

function screensLabel() {
  const b = buildTime(__BUILD_ID__)
  return b ? t('version.screens', { m: b.m, d: b.d, time: b.time }) : ''
}

/**
 * Settings: the installed app and screen versions, and a button that checks for both right away (ignoring the
 * hourly / six-hourly background spacing and a banner put off with 「나중에」). On the web the button reloads.
 */
export function AppVersionCard() {
  const android = Capacitor.getPlatform() === 'android'
  const [native, setNative] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    if (!android) return
    CapacitorUpdater.current().then((c) => setNative(c.native)).catch(() => undefined)
  }, [android])

  const check = async () => {
    setBusy(true)
    setResult(null)
    const [screens, apk] = await Promise.allSettled([prepareScreens(), latestRelease(true)])
    const newer = apk.status === 'fulfilled' && apk.value && native && shouldOffer(apk.value, native, null) ? apk.value : null
    setResult({
      screens: screens.status === 'fulfilled' ? screens.value : null,
      apk: newer,
      failed: screens.status === 'rejected' || apk.status === 'rejected',
    })
    setBusy(false)
  }

  const apply = async (id: string) => {
    setApplying(true)
    try {
      await applyScreens(id)
    } catch {
      setApplying(false)
      setResult((r) => r && { ...r, failed: true })
    }
  }

  const ready = result?.screens?.status === 'ready' ? result.screens : null
  const nothing = result && !result.failed && !ready && !result.apk

  return (
    <Card>
      <CardHeader title={t('version.title')} icon={<Smartphone size={18} className="text-sage" />} />
      <p className="text-[14px] text-ink">
        {[android && native ? t('version.app', { version: native }) : '', screensLabel()].filter(Boolean).join(' · ')}
      </p>
      {!android && <p className="mt-1 text-[12px] text-ink-2">{t('version.webHint')}</p>}

      {ready && (
        <div className="mt-3 flex items-center gap-3 rounded-[var(--radius-field)] bg-sage-soft px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-sage">{t('version.screensReady')}</p>
            <p className="text-[12px] text-ink-2">{t('version.applyHint')}</p>
          </div>
          <Button className="h-9 shrink-0 px-4 text-[13px]" disabled={applying} onClick={() => apply(ready.id)}>
            {applying && <Loader2 size={15} className="animate-spin" />}
            {t('version.applyNow')}
          </Button>
        </div>
      )}
      {result?.apk && (
        <div className="mt-3 flex items-center gap-3 rounded-[var(--radius-field)] bg-muted px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">{t('update.banner', { version: result.apk.version })}</p>
            <p className="text-[12px] text-ink-2">{t('update.bannerHint')}</p>
          </div>
          <Button variant="soft" className="h-9 shrink-0 px-4 text-[13px]" onClick={() => { window.location.href = result.apk!.url }}>
            <Download size={15} />
            {t('update.get')}
          </Button>
        </div>
      )}
      {nothing && <p role="status" className="mt-3 text-[13px] font-semibold text-sage">{t('version.latest')}</p>}
      {result?.failed && <p role="alert" className="mt-3 text-[13px] text-terra-2">{t('version.failed')}</p>}

      {android ? (
        <Button variant="soft" className="mt-3 w-full" disabled={busy} onClick={check}>
          <RefreshCw size={18} className={busy ? 'animate-spin' : ''} />
          {busy ? t('version.checking') : t('version.check')}
        </Button>
      ) : (
        <Button variant="soft" className="mt-3 w-full" onClick={() => window.location.reload()}>
          <RefreshCw size={18} />
          {t('version.reload')}
        </Button>
      )}
    </Card>
  )
}
