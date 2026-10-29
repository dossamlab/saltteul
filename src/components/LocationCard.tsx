import { CloudSun, LocateFixed, MapPin, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t } from '../copy'
import { updateSettings } from '../data/actions'
import { useHousehold } from '../data/store'
import { reversePlace, searchPlace, type PlaceResult } from '../geo/searchPlace'
import { Button, Card, CardHeader, Empty } from './ui'

/** Weather location: either the device's current position or a searched place. */
export function LocationCard() {
  const h = useHousehold()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async (label: string, lat: number, lon: number) => {
    await updateSettings(h.hid, { location: { label, lat, lon } })
    setResults(null)
    setQuery('')
    setMsg(t('settings.locationSaved', { label }))
  }

  const useHere = () => {
    setMsg('')
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = Number(p.coords.latitude.toFixed(4))
        const lon = Number(p.coords.longitude.toFixed(4))
        const place = await reversePlace(lat, lon)
        await save(place?.label || t('settings.locationDefault'), lat, lon)
      },
      () => setMsg(t('settings.locationDenied')),
      { enableHighAccuracy: false, timeout: 15000 },
    )
  }

  const search = async (e: FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    setMsg('')
    try {
      setResults(await searchPlace(query))
    } catch {
      setResults(null)
      setMsg(t('settings.locationSearchFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title={t('settings.location')} icon={<CloudSun size={18} className="text-sage" />} />
      {h.settings.location && (
        <p className="mb-3 flex items-center gap-1.5 text-[14px] text-ink">
          <MapPin size={15} className="text-sage" />
          {t('settings.locationCurrent', { label: h.settings.location.label })}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Button variant="soft" onClick={useHere}><LocateFixed size={18} />{t('settings.useHere')}</Button>
        <form onSubmit={search} className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('settings.locationSearchPlaceholder')}
            aria-label={t('settings.locationSearchPlaceholder')}
            className="h-12 min-w-0 flex-1 rounded-[var(--radius-field)] border border-sand bg-white px-3.5 text-[15px] outline-none placeholder:text-ink-3 focus:border-sage" />
          <Button type="submit" variant="soft" className="w-12 px-0" aria-label={t('settings.locationSearch')} disabled={busy || !query.trim()}>
            <Search size={18} />
          </Button>
        </form>
        {results && results.length === 0 && <Empty>{t('settings.locationNoResult')}</Empty>}
        {results && results.length > 0 && (
          <div className="divide-y divide-line rounded-[var(--radius-field)] border border-line">
            {results.map((r) => (
              <button key={r.detail} type="button" onClick={() => save(r.label, r.lat, r.lon)}
                className="flex w-full flex-col items-start px-3.5 py-2.5 text-left hover:bg-muted">
                <span className="text-[15px]">{r.label}</span>
                <span className="text-[12px] text-ink-2">{r.detail}</span>
              </button>
            ))}
          </div>
        )}
        {msg && <p className="text-[13px] text-ink-2">{msg}</p>}
        <p className="text-[11px] text-ink-3">{t('settings.locationSearchCredit')}</p>
      </div>
    </Card>
  )
}
