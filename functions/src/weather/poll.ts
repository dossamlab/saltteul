import type { Firestore } from 'firebase-admin/firestore'
import { seoulDate } from '../../../shared/householdDate'
import { toKmaGrid } from '../../../shared/kmaGrid'
import type { Settings } from '../../../shared/types'
import { HID } from '../household'
import { recordIntegration } from '../integrations'
import { kmaBaseTime, mergeWeather, parseVillageForecast, type WeatherPort } from './kma'

/** Hourly: settings/main.location → KMA grid → forecast → settings/main.weather. */
export async function pollWeather(db: Firestore, port: WeatherPort, now: Date = new Date()): Promise<'no-location' | 'ok' | 'failed'> {
  const ref = db.doc(`households/${HID}/settings/main`)
  const snap = await ref.get()
  const settings = (snap.exists ? snap.data() : null) as Partial<Settings> | null
  const loc = settings?.location
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return 'no-location'

  try {
    const { nx, ny } = toKmaGrid(loc.lat, loc.lon)
    const { baseDate, baseTime } = kmaBaseTime(now)
    const items = await port.fetchVillageForecast(nx, ny, baseDate, baseTime)
    if (items.length === 0) throw new Error('KMA returned no forecast rows')
    const today = seoulDate(now)
    const days = mergeWeather(settings?.weather?.days, parseVillageForecast(items, today), today)
    await ref.set({ weather: { updatedAt: now.getTime(), days } }, { merge: true })
    await recordIntegration(db, 'weather', true, undefined, now.getTime())
    return 'ok'
  } catch (e) {
    await recordIntegration(db, 'weather', false, e, now.getTime())
    return 'failed'
  }
}
