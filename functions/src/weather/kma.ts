import { addDays, seoulDate } from '../../../shared/householdDate'
import type { WeatherDay, Ymd } from '../../../shared/types'

/** One row of the getVilageFcst response. */
export interface KmaItem {
  category: string
  fcstDate: string // YYYYMMDD
  fcstTime: string // HHMM
  fcstValue: string
}

export interface WeatherPort {
  fetchVillageForecast(nx: number, ny: number, baseDate: string, baseTime: string): Promise<KmaItem[]>
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23]
const PUBLISH_DELAY_MIN = 10
export const RAIN_POP = 60

const compact = (ymd: Ymd) => ymd.replace(/-/g, '')

/** Latest issued forecast: 02,05,…,23 KST, each usable 10 minutes after the hour. */
export function kmaBaseTime(now: Date): { baseDate: string; baseTime: string } {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  const today = seoulDate(now)
  const ready = BASE_HOURS.filter((h) => h * 60 + PUBLISH_DELAY_MIN <= minutes)
  if (ready.length === 0) return { baseDate: compact(addDays(today, -1)), baseTime: '2300' }
  const h = ready[ready.length - 1]
  return { baseDate: compact(today), baseTime: `${String(h).padStart(2, '0')}00` }
}

const PTY_SKY: Record<string, WeatherDay['sky']> = { '1': 'rain', '2': 'rainsnow', '3': 'snow', '4': 'shower' }
const SKY_SKY: Record<string, WeatherDay['sky']> = { '1': 'clear', '3': 'partly', '4': 'cloudy' }

function num(v: string | undefined): number | null {
  if (v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  for (const [v, n] of counts) if (n > bestN) [best, bestN] = [v, n]
  return best
}

/**
 * Turns forecast rows into WeatherDay for `today` and the next day.
 * Sky: any precipitation type (PTY 1 rain, 2 rain/snow, 3 snow, 4 shower) wins; otherwise the most
 * common SKY (1 clear, 3 partly, 4 cloudy). rainFrom = first hour with POP ≥ 60.
 */
export function parseVillageForecast(items: KmaItem[], today: Ymd): ParsedDay[] {
  return [today, addDays(today, 1)].map((day) => {
    const rows = items.filter((i) => i.fcstDate === compact(day)).sort((a, b) => a.fcstTime.localeCompare(b.fcstTime))
    const by = (cat: string) => rows.filter((r) => r.category === cat)
    const tmn = num(by('TMN')[0]?.fcstValue)
    const tmx = num(by('TMX')[0]?.fcstValue)
    const tmp = by('TMP').map((r) => num(r.fcstValue)).filter((n): n is number => n !== null)
    const pops = by('POP').map((r) => ({ time: r.fcstTime, v: num(r.fcstValue) ?? 0 }))
    const pty = by('PTY').map((r) => r.fcstValue).filter((v) => v !== '0' && PTY_SKY[v])
    const sky = by('SKY').map((r) => r.fcstValue).filter((v) => SKY_SKY[v])
    const rain = pops.find((p) => p.v >= RAIN_POP)

    let skyOut: WeatherDay['sky'] = null
    if (pty.length) skyOut = PTY_SKY[mostCommon(pty)!]
    else if (sky.length) skyOut = SKY_SKY[mostCommon(sky)!]

    return {
      day,
      minC: tmn ?? (tmp.length ? Math.min(...tmp) : null),
      maxC: tmx ?? (tmp.length ? Math.max(...tmp) : null),
      popMax: pops.length ? Math.max(...pops.map((p) => p.v)) : null,
      sky: skyOut,
      rainFrom: rain ? `${rain.time.slice(0, 2)}:00` : null,
      exactMin: tmn !== null,
      exactMax: tmx !== null,
    }
  })
}

/** Parsed day; `exactMin/Max` say whether TMN/TMX were present (otherwise the hourly TMP range was used). */
export type ParsedDay = WeatherDay & { exactMin: boolean; exactMax: boolean }

const pick = (a: number | null, b: number | null, f: (x: number, y: number) => number) =>
  a === null ? b : b === null ? a : f(a, b)

/**
 * Later forecasts drop the hours that have passed (and today's TMN/TMX), so for `today` the new values
 * are combined with what was stored earlier. Other days take the newest forecast as is.
 */
export function mergeWeather(prev: WeatherDay[] | undefined | null, next: ParsedDay[], today: Ymd): WeatherDay[] {
  return next.map(({ exactMin, exactMax, ...n }) => {
    const p = n.day === today ? prev?.find((d) => d.day === n.day) : undefined
    if (!p) return n
    return {
      day: n.day,
      minC: exactMin ? n.minC : pick(n.minC, p.minC, Math.min),
      maxC: exactMax ? n.maxC : pick(n.maxC, p.maxC, Math.max),
      popMax: pick(n.popMax, p.popMax, Math.max),
      sky: n.sky ?? p.sky,
      rainFrom: n.rainFrom ?? p.rainFrom ?? null,
    }
  })
}

export const KMA_ENDPOINT = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst'

/**
 * Real data.go.kr client. `serviceKey` is the *decoded* key from the portal; it is URL-encoded here.
 * Errors never include the request URL (it contains the key).
 */
export class KmaWeather implements WeatherPort {
  constructor(private serviceKey: string, private fetchFn: typeof fetch = fetch) {}

  async fetchVillageForecast(nx: number, ny: number, baseDate: string, baseTime: string): Promise<KmaItem[]> {
    const q = new URLSearchParams({
      pageNo: '1',
      numOfRows: '1000',
      dataType: 'JSON',
      base_date: baseDate,
      base_time: baseTime,
      nx: String(nx),
      ny: String(ny),
    })
    const res = await this.fetchFn(`${KMA_ENDPOINT}?serviceKey=${encodeURIComponent(this.serviceKey)}&${q.toString()}`)
    if (!res.ok) throw new Error(`KMA HTTP ${res.status}`)
    const text = await res.text()
    let j: { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: KmaItem[] } } } }
    try {
      j = JSON.parse(text)
    } catch {
      throw new Error('KMA response is not JSON (service key or quota problem)')
    }
    const code = j.response?.header?.resultCode
    if (code !== '00') throw new Error(`KMA result ${code ?? '?'}: ${j.response?.header?.resultMsg ?? ''}`)
    return j.response?.body?.items?.item ?? []
  }
}
