import { describe, expect, it } from 'vitest'
import { FakeFirestore } from '../testing/fakeFirestore'
import { kmaBaseTime, mergeWeather, parseVillageForecast, type KmaItem, type WeatherPort } from './kma'
import { parseOpenMeteo, skyFromWmo, type FallbackWeatherPort } from './openMeteo'
import { pollWeather, refreshWeather } from './poll'

const row = (category: string, fcstDate: string, fcstTime: string, fcstValue: string): KmaItem => ({ category, fcstDate, fcstTime, fcstValue })

// Trimmed getVilageFcst rows: today (10-28) from the 11:00 run, tomorrow complete.
const FIXTURE: KmaItem[] = [
  row('TMP', '20261028', '1200', '18'), row('TMP', '20261028', '0900', '12'), row('TMP', '20261028', '1500', '20'),
  row('TMX', '20261028', '1500', '21.0'),
  row('POP', '20261028', '0900', '20'), row('POP', '20261028', '1200', '60'), row('POP', '20261028', '1500', '70'),
  row('SKY', '20261028', '0900', '1'), row('SKY', '20261028', '1200', '4'), row('SKY', '20261028', '1500', '4'),
  row('PTY', '20261028', '0900', '0'), row('PTY', '20261028', '1200', '1'), row('PTY', '20261028', '1500', '4'),
  row('PTY', '20261028', '1800', '1'),
  row('TMN', '20261029', '0600', '5.0'), row('TMX', '20261029', '1500', '15.0'),
  row('TMP', '20261029', '0600', '6'), row('TMP', '20261029', '1500', '14'),
  row('SKY', '20261029', '0600', '3'), row('SKY', '20261029', '0900', '3'), row('SKY', '20261029', '1200', '1'),
  row('PTY', '20261029', '0600', '0'), row('PTY', '20261029', '0900', '0'), row('PTY', '20261029', '1200', '0'),
  row('POP', '20261029', '0600', '10'), row('POP', '20261029', '0900', '0'), row('POP', '20261029', '1200', '30'),
  row('TMP', '20261030', '0000', '3'),
]

describe('kmaBaseTime', () => {
  const at = (iso: string) => kmaBaseTime(new Date(iso))
  it('picks the latest run that is at least 10 minutes old (KST)', () => {
    expect(at('2026-10-28T03:00:00Z')).toEqual({ baseDate: '20261028', baseTime: '1100' }) // 12:00
    expect(at('2026-10-28T02:09:00Z')).toEqual({ baseDate: '20261028', baseTime: '0800' }) // 11:09
    expect(at('2026-10-28T02:10:00Z')).toEqual({ baseDate: '20261028', baseTime: '1100' }) // 11:10
    expect(at('2026-10-27T17:05:00Z')).toEqual({ baseDate: '20261027', baseTime: '2300' }) // 02:05
    expect(at('2026-10-27T17:10:00Z')).toEqual({ baseDate: '20261028', baseTime: '0200' }) // 02:10
    expect(at('2026-10-28T14:59:00Z')).toEqual({ baseDate: '20261028', baseTime: '2300' }) // 23:59
  })
})

describe('parseVillageForecast', () => {
  it('builds today and tomorrow', () => {
    const [today, tomorrow] = parseVillageForecast(FIXTURE, '2026-10-28')
    expect(today).toMatchObject({
      day: '2026-10-28', minC: 12, maxC: 21, popMax: 70, sky: 'rain', rainFrom: '12:00', exactMin: false, exactMax: true,
    })
    expect(tomorrow).toMatchObject({
      day: '2026-10-29', minC: 5, maxC: 15, popMax: 30, sky: 'partly', rainFrom: null, exactMin: true, exactMax: true,
    })
  })
  it('lists each forecast hour with temperature, sky (precipitation first) and rain chance', () => {
    const [today, tomorrow] = parseVillageForecast(FIXTURE, '2026-10-28')
    expect(today.hours).toEqual([
      { time: '09:00', tempC: 12, sky: 'clear', pop: 20 },
      { time: '12:00', tempC: 18, sky: 'rain', pop: 60 },
      { time: '15:00', tempC: 20, sky: 'shower', pop: 70 },
    ])
    expect(tomorrow.hours).toEqual([
      { time: '06:00', tempC: 6, sky: 'partly', pop: 10 },
      { time: '15:00', tempC: 14, sky: null, pop: null },
    ])
  })
  it('maps every precipitation type and returns nulls for missing data', () => {
    const one = (pty: string) => parseVillageForecast([row('PTY', '20261028', '0900', pty)], '2026-10-28')[0].sky
    expect([one('1'), one('2'), one('3'), one('4')]).toEqual(['rain', 'rainsnow', 'snow', 'shower'])
    expect(parseVillageForecast([], '2026-10-28')[1]).toEqual({
      day: '2026-10-29', minC: null, maxC: null, popMax: null, sky: null, rainFrom: null, hours: [], exactMin: false, exactMax: false,
    })
  })
})

describe('mergeWeather', () => {
  it('keeps the morning minimum for today but takes tomorrow as forecast', () => {
    const prev = [
      { day: '2026-10-28', minC: 8, maxC: 19, popMax: 80, sky: 'cloudy' as const, rainFrom: '07:00' },
      { day: '2026-10-29', minC: 1, maxC: 20, popMax: 90, sky: 'rain' as const, rainFrom: '09:00' },
    ]
    const [today, tomorrow] = mergeWeather(prev, parseVillageForecast(FIXTURE, '2026-10-28'), '2026-10-28')
    expect(today).toMatchObject({ day: '2026-10-28', minC: 8, maxC: 21, popMax: 80, sky: 'rain', rainFrom: '12:00' })
    expect(today.hours).toHaveLength(3)
    expect(tomorrow).toMatchObject({ day: '2026-10-29', minC: 5, maxC: 15, popMax: 30, sky: 'partly', rainFrom: null })
  })
})

describe('pollWeather', () => {
  it('converts the location to the KMA grid and stores the forecast', async () => {
    const db = new FakeFirestore()
    db.put('households/home/settings/main', { familyName: 'f', location: { label: 'City Hall', lat: 37.5665, lon: 126.978 } })
    const calls: unknown[][] = []
    const port: WeatherPort = { async fetchVillageForecast(...a) { calls.push(a); return FIXTURE } }
    expect(await pollWeather(db.asAdmin, port, new Date('2026-10-28T03:00:00Z'))).toBe('ok')
    expect(calls).toEqual([[60, 127, '20261028', '1100']])
    const s = db.read('households/home/settings/main') as { weather: { updatedAt: number; days: { day: string }[] }; familyName: string }
    expect(s.familyName).toBe('f')
    expect(s.weather.days.map((d) => d.day)).toEqual(['2026-10-28', '2026-10-29'])
    expect(s.weather.days[0]).not.toHaveProperty('exactMin')
    expect(db.read('households/home/integrations/weather')).toMatchObject({ consecutiveFailures: 0 })
  })

  it('records failures and skips when no location is set', async () => {
    const db = new FakeFirestore()
    const failing: WeatherPort = { async fetchVillageForecast() { throw new Error('KMA HTTP 500') } }
    expect(await pollWeather(db.asAdmin, failing)).toBe('no-location')
    db.put('households/home/settings/main', { location: { label: 'x', lat: 37.5, lon: 127 } })
    expect(await pollWeather(db.asAdmin, failing)).toBe('failed')
    expect(db.read('households/home/integrations/weather')).toMatchObject({ consecutiveFailures: 1, lastError: 'KMA HTTP 500' })
  })
})

describe('Open-Meteo fallback', () => {
  const om = {
    hourly: {
      time: ['2026-10-28T09:00', '2026-10-28T10:00', '2026-10-29T09:00', '2026-10-30T09:00'],
      temperature_2m: [11.6, 13.2, 7.4, 1],
      precipitation_probability: [20, 70, 0, 0],
      weather_code: [1, 61, 0, 0],
    },
    daily: { time: ['2026-10-28', '2026-10-29'], temperature_2m_min: [8.4, 5], temperature_2m_max: [17.5, 15], precipitation_probability_max: [70, 0] },
  }
  it('maps WMO codes and builds the same day shape as KMA', () => {
    expect([0, 2, 3, 45, 61, 66, 71, 80, 86, 95].map(skyFromWmo)).toEqual(['clear', 'partly', 'cloudy', 'cloudy', 'rain', 'rain', 'snow', 'shower', 'snow', 'shower'])
    const [today, tomorrow] = parseOpenMeteo(om, '2026-10-28')
    expect(today).toEqual({
      day: '2026-10-28', minC: 8, maxC: 18, popMax: 70, sky: 'rain', rainFrom: '10:00', exactMin: true, exactMax: true,
      hours: [{ time: '09:00', tempC: 12, sky: 'partly', pop: 20 }, { time: '10:00', tempC: 13, sky: 'rain', pop: 70 }],
    })
    expect(tomorrow).toMatchObject({ day: '2026-10-29', minC: 5, maxC: 15, sky: 'clear', hours: [{ time: '09:00', tempC: 7, sky: 'clear', pop: 0 }] })
  })

  it('is used when KMA cannot be reached, keeping the source', async () => {
    const db = new FakeFirestore()
    db.put('households/home/settings/main', { location: { label: 'x', lat: 37.5, lon: 127 } })
    const failing: WeatherPort = { async fetchVillageForecast() { throw new Error('KMA unreachable: ECONNRESET') } }
    const fallback: FallbackWeatherPort = { async fetchDays(_lat, _lon, today) { return parseOpenMeteo(om, today) } }
    expect(await pollWeather(db.asAdmin, failing, new Date('2026-10-28T03:00:00Z'), fallback)).toBe('ok')
    expect(db.read('households/home/settings/main')?.weather).toMatchObject({ source: 'open-meteo', days: [{ day: '2026-10-28' }, { day: '2026-10-29' }] })
    expect(db.read('households/home/integrations/weather')).toMatchObject({ consecutiveFailures: 0 })
  })
})

describe('refreshWeather', () => {
  it('reuses a forecast younger than 10 minutes and fetches otherwise', async () => {
    const db = new FakeFirestore()
    const now = new Date('2026-10-28T03:00:00Z')
    db.put('households/home/settings/main', {
      location: { label: 'x', lat: 37.5665, lon: 126.978 },
      weather: { updatedAt: now.getTime() - 5 * 60_000, days: [{ day: '2026-10-28' }] },
    })
    let calls = 0
    const port: WeatherPort = { async fetchVillageForecast() { calls++; return FIXTURE } }
    const fallback: FallbackWeatherPort = { async fetchDays() { throw new Error('unused') } }
    expect(await refreshWeather(db.asAdmin, port, fallback, now)).toEqual({ status: 'fresh', updatedAt: now.getTime() - 5 * 60_000 })
    expect(calls).toBe(0)
    const later = new Date(now.getTime() + 6 * 60_000)
    expect(await refreshWeather(db.asAdmin, port, fallback, later)).toEqual({ status: 'ok', updatedAt: later.getTime() })
    expect(calls).toBe(1)
  })

  it('fetches again after midnight even if the stored forecast is recent', async () => {
    const db = new FakeFirestore()
    const justAfterMidnight = new Date('2026-10-28T15:02:00Z') // 10-29 00:02 KST
    db.put('households/home/settings/main', {
      location: { label: 'x', lat: 37.5665, lon: 126.978 },
      weather: { updatedAt: justAfterMidnight.getTime() - 3 * 60_000, days: [{ day: '2026-10-28' }] },
    })
    const port: WeatherPort = { async fetchVillageForecast() { return FIXTURE } }
    const fallback: FallbackWeatherPort = { async fetchDays() { throw new Error('unused') } }
    expect((await refreshWeather(db.asAdmin, port, fallback, justAfterMidnight)).status).toBe('ok')
  })
})
