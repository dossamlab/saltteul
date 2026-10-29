import { describe, expect, it } from 'vitest'
import { FakeFirestore } from '../testing/fakeFirestore'
import { kmaBaseTime, mergeWeather, parseVillageForecast, type KmaItem, type WeatherPort } from './kma'
import { pollWeather } from './poll'

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
    expect(today).toEqual({
      day: '2026-10-28', minC: 12, maxC: 21, popMax: 70, sky: 'rain', rainFrom: '12:00', exactMin: false, exactMax: true,
    })
    expect(tomorrow).toEqual({
      day: '2026-10-29', minC: 5, maxC: 15, popMax: 30, sky: 'partly', rainFrom: null, exactMin: true, exactMax: true,
    })
  })
  it('maps every precipitation type and returns nulls for missing data', () => {
    const one = (pty: string) => parseVillageForecast([row('PTY', '20261028', '0900', pty)], '2026-10-28')[0].sky
    expect([one('1'), one('2'), one('3'), one('4')]).toEqual(['rain', 'rainsnow', 'snow', 'shower'])
    expect(parseVillageForecast([], '2026-10-28')[1]).toEqual({
      day: '2026-10-29', minC: null, maxC: null, popMax: null, sky: null, rainFrom: null, exactMin: false, exactMax: false,
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
    expect(today).toEqual({ day: '2026-10-28', minC: 8, maxC: 21, popMax: 80, sky: 'rain', rainFrom: '12:00' })
    expect(tomorrow).toEqual({ day: '2026-10-29', minC: 5, maxC: 15, popMax: 30, sky: 'partly', rainFrom: null })
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
