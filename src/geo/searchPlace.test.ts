import { describe, expect, it } from 'vitest'
import { toPlace } from './searchPlace'

describe('toPlace', () => {
  it('builds a short label and a longer detail from a Nominatim address', () => {
    expect(toPlace({ display_name: '역삼동, 강남구, 서울특별시, 06232, 대한민국', lat: '37.50012345', lon: '127.0367891' })).toEqual({
      label: '강남구 역삼동',
      detail: '서울특별시 강남구 역삼동',
      lat: 37.5001,
      lon: 127.0368,
    })
  })
  it('skips sub-areas between the place and its district', () => {
    expect(toPlace({ display_name: '역삼동, 역삼2동, 강남구, 서울특별시, 06220, 대한민국', lat: '37.49988', lon: '127.03856' }).label).toBe('강남구 역삼동')
  })
  it('handles a city-level result', () => {
    expect(toPlace({ display_name: '수원시, 경기도, 대한민국', lat: '37.26', lon: '127.03' }).label).toBe('경기도 수원시')
  })
})
