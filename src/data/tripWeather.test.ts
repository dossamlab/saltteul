import { describe, expect, it } from 'vitest'
import { fetchTripForecast, parseTripForecast, tripForecastUrl } from './tripWeather'

describe('trip forecast', () => {
  it('asks for the trip days in Seoul time', () => {
    const u = new URL(tripForecastUrl(37.75123, 128.9, '2026-11-20', '2026-11-22'))
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      latitude: '37.7512', longitude: '128.9000', start_date: '2026-11-20', end_date: '2026-11-22', timezone: 'Asia/Seoul',
      daily: 'precipitation_probability_max,temperature_2m_min',
    })
  })

  it('reads the daily rain chance and low, keeping gaps as null', () => {
    expect(parseTripForecast({
      daily: { time: ['2026-11-20', '2026-11-21'], precipitation_probability_max: [70, null], temperature_2m_min: [8.6, 11.2] },
    })).toEqual([
      { day: '2026-11-20', popMax: 70, minC: 9 },
      { day: '2026-11-21', popMax: null, minC: 11 },
    ])
    expect(parseTripForecast({})).toEqual([])
  })

  it('fails on an HTTP error', async () => {
    const bad = (async () => new Response('x', { status: 500 })) as typeof fetch
    await expect(fetchTripForecast(1, 2, '2026-11-20', '2026-11-20', bad)).rejects.toThrow('500')
    const ok = (async () => Response.json({ daily: { time: ['2026-11-20'], precipitation_probability_max: [10], temperature_2m_min: [3] } })) as typeof fetch
    expect(await fetchTripForecast(1, 2, '2026-11-20', '2026-11-20', ok)).toEqual([{ day: '2026-11-20', popMax: 10, minC: 3 }])
  })
})
