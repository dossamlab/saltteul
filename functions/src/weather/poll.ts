import type { Firestore } from 'firebase-admin/firestore'
import { seoulDate } from '../../../shared/householdDate'
import { toKmaGrid } from '../../../shared/kmaGrid'
import type { Settings } from '../../../shared/types'
import { HID } from '../household'
import { recordIntegration } from '../integrations'
import { kmaBaseTime, mergeWeather, parseVillageForecast, type ParsedDay, type WeatherPort } from './kma'
import type { FallbackWeatherPort } from './openMeteo'

export type WeatherSource = 'kma' | 'open-meteo'

/**
 * settings/main.location → KMA grid → forecast → settings/main.weather (days by calendar date, KST). When KMA cannot be
 * reached, the fallback forecast is stored instead and the KMA error is kept on the integration record.
 */
export async function pollWeather(
  db: Firestore,
  port: WeatherPort,
  now: Date = new Date(),
  fallback?: FallbackWeatherPort,
  log?: (msg: string, extra?: unknown) => void,
): Promise<'no-location' | 'ok' | 'failed'> {
  const ref = db.doc(`households/${HID}/settings/main`)
  const snap = await ref.get()
  const settings = (snap.exists ? snap.data() : null) as Partial<Settings> | null
  const loc = settings?.location
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return 'no-location'

  const today = seoulDate(now)
  let parsed: ParsedDay[]
  let source: WeatherSource = 'kma'
  try {
    const { nx, ny } = toKmaGrid(loc.lat, loc.lon)
    const { baseDate, baseTime } = kmaBaseTime(now)
    const items = await port.fetchVillageForecast(nx, ny, baseDate, baseTime)
    if (items.length === 0) throw new Error('KMA returned no forecast rows')
    parsed = parseVillageForecast(items, today)
  } catch (kmaError) {
    if (!fallback) {
      await recordIntegration(db, 'weather', false, kmaError, now.getTime())
      return 'failed'
    }
    log?.('weather: KMA failed, using Open-Meteo', kmaError instanceof Error ? kmaError.message : kmaError)
    try {
      parsed = await fallback.fetchDays(loc.lat, loc.lon, today)
      source = 'open-meteo'
    } catch (e) {
      await recordIntegration(db, 'weather', false, e, now.getTime())
      return 'failed'
    }
  }
  const days = mergeWeather(settings?.weather?.days, parsed, today)
  await ref.set({ weather: { updatedAt: now.getTime(), days, source } }, { merge: true })
  await recordIntegration(db, 'weather', true, undefined, now.getTime())
  return 'ok'
}

/** A fresh enough forecast is not fetched again when the app opens or the refresh button is pressed. */
export const WEATHER_FRESH_MS = 10 * 60 * 1000

export async function refreshWeather(
  db: Firestore,
  port: WeatherPort,
  fallback: FallbackWeatherPort,
  now: Date = new Date(),
  log?: (msg: string, extra?: unknown) => void,
): Promise<{ status: 'fresh' | 'ok' | 'failed' | 'no-location'; updatedAt: number | null }> {
  const snap = await db.doc(`households/${HID}/settings/main`).get()
  const w = (snap.exists ? (snap.data() as Partial<Settings>).weather : null) ?? null
  if (w?.updatedAt && now.getTime() - w.updatedAt < WEATHER_FRESH_MS && w.days?.[0]?.day === seoulDate(now)) {
    return { status: 'fresh', updatedAt: w.updatedAt }
  }
  const status = await pollWeather(db, port, now, fallback, log)
  return { status, updatedAt: status === 'ok' ? now.getTime() : w?.updatedAt ?? null }
}
