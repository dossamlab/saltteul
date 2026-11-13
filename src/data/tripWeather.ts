// Daily forecast for a trip's place, straight from Open-Meteo (no key; the household forecast goes through the server,
// but a trip place is looked at only on its checklist screen). Only the rain chance and the low are needed.
import type { TripForecastDay } from '../../shared/packing'
import type { Ymd } from '../../shared/types'

export const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

interface DailyResponse {
  daily?: { time?: string[]; precipitation_probability_max?: (number | null)[]; temperature_2m_min?: (number | null)[] }
}

export function parseTripForecast(j: DailyResponse): TripForecastDay[] {
  const d = j.daily ?? {}
  const num = (v: number | null | undefined) => (typeof v === 'number' ? Math.round(v) : null)
  return (d.time ?? []).map((day, i) => ({ day, popMax: num(d.precipitation_probability_max?.[i]), minC: num(d.temperature_2m_min?.[i]) }))
}

export function tripForecastUrl(lat: number, lon: number, from: Ymd, to: Ymd): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    daily: 'precipitation_probability_max,temperature_2m_min',
    timezone: 'Asia/Seoul',
    start_date: from,
    end_date: to,
  })
  return `${OPEN_METEO_ENDPOINT}?${q}`
}

export async function fetchTripForecast(lat: number, lon: number, from: Ymd, to: Ymd, fetchFn: typeof fetch = fetch): Promise<TripForecastDay[]> {
  const res = await fetchFn(tripForecastUrl(lat, lon, from, to), { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`)
  return parseTripForecast((await res.json()) as DailyResponse)
}
