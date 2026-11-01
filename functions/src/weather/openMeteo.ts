// Fallback forecast when the KMA endpoint cannot be reached from Cloud Functions: Open-Meteo (no key, free for
// non-commercial use). Same output shape as parseVillageForecast, so storage, the card and briefings do not change.
import { addDays } from '../../../shared/householdDate'
import type { WeatherDay, WeatherHour, Ymd } from '../../../shared/types'
import { RAIN_POP, type ParsedDay } from './kma'

export const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

export interface OpenMeteoResponse {
  hourly?: { time?: string[]; temperature_2m?: (number | null)[]; precipitation_probability?: (number | null)[]; weather_code?: (number | null)[] }
  daily?: { time?: string[]; temperature_2m_min?: (number | null)[]; temperature_2m_max?: (number | null)[]; precipitation_probability_max?: (number | null)[] }
}

/** WMO weather code → the card's sky kinds. */
export function skyFromWmo(code: number | null | undefined): WeatherDay['sky'] {
  if (code === null || code === undefined) return null
  if (code === 0) return 'clear'
  if (code <= 2) return 'partly'
  if (code <= 48) return 'cloudy' // overcast, fog
  if (code <= 67) return 'rain' // drizzle, rain, freezing rain
  if (code <= 77) return 'snow'
  if (code <= 82) return 'shower'
  if (code <= 86) return 'snow' // snow showers
  return 'shower' // thunderstorm
}

const PRECIP: WeatherDay['sky'][] = ['rain', 'rainsnow', 'snow', 'shower']

function mostCommon<T>(xs: T[]): T | null {
  const counts = new Map<T, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  let best: T | null = null
  let n = 0
  for (const [x, c] of counts) if (c > n) [best, n] = [x, c]
  return best
}

export function parseOpenMeteo(j: OpenMeteoResponse, today: Ymd): ParsedDay[] {
  const h = j.hourly ?? {}
  const d = j.daily ?? {}
  return [today, addDays(today, 1)].map((day) => {
    const hours: WeatherHour[] = []
    ;(h.time ?? []).forEach((t, i) => {
      if (!t.startsWith(day)) return
      hours.push({
        time: `${t.slice(11, 13)}:00`,
        tempC: typeof h.temperature_2m?.[i] === 'number' ? Math.round(h.temperature_2m[i]!) : null,
        sky: skyFromWmo(h.weather_code?.[i]),
        pop: h.precipitation_probability?.[i] ?? null,
      })
    })
    const di = (d.time ?? []).indexOf(day)
    const round = (v: number | null | undefined) => (typeof v === 'number' ? Math.round(v) : null)
    const skies = hours.map((x) => x.sky).filter((s): s is NonNullable<WeatherDay['sky']> => !!s)
    const wet = skies.filter((s) => PRECIP.includes(s))
    const rain = hours.find((x) => (x.pop ?? 0) >= RAIN_POP)
    const temps = hours.map((x) => x.tempC).filter((x): x is number => x !== null)
    const pops = hours.map((x) => x.pop).filter((x): x is number => x !== null)
    return {
      day,
      minC: round(d.temperature_2m_min?.[di]) ?? (temps.length ? Math.min(...temps) : null),
      maxC: round(d.temperature_2m_max?.[di]) ?? (temps.length ? Math.max(...temps) : null),
      popMax: d.precipitation_probability_max?.[di] ?? (pops.length ? Math.max(...pops) : null),
      sky: wet.length ? mostCommon(wet) : mostCommon(skies),
      rainFrom: rain ? rain.time : null,
      hours,
      exactMin: di >= 0 && typeof d.temperature_2m_min?.[di] === 'number',
      exactMax: di >= 0 && typeof d.temperature_2m_max?.[di] === 'number',
    }
  })
}

export interface FallbackWeatherPort {
  fetchDays(lat: number, lon: number, today: Ymd): Promise<ParsedDay[]>
}

export class OpenMeteoWeather implements FallbackWeatherPort {
  constructor(private fetchFn: typeof fetch = fetch) {}

  async fetchDays(lat: number, lon: number, today: Ymd): Promise<ParsedDay[]> {
    const q = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      daily: 'temperature_2m_min,temperature_2m_max,precipitation_probability_max',
      timezone: 'Asia/Seoul',
      forecast_days: '3',
    })
    const res = await this.fetchFn(`${OPEN_METEO_ENDPOINT}?${q}`, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`)
    return parseOpenMeteo((await res.json()) as OpenMeteoResponse, today)
  }
}
