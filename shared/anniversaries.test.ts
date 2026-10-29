import { describe, expect, it } from 'vitest'
import { dDay, nextOccurrence, togetherDays, upcoming } from './anniversaries'
import type { Anniversary } from './types'

describe('nextOccurrence', () => {
  it('returns this year when the date is still ahead', () => {
    expect(nextOccurrence('2015-11-07', '2026-10-28')).toBe('2026-11-07')
  })
  it('returns today when it is the day', () => {
    expect(nextOccurrence('2015-10-28', '2026-10-28')).toBe('2026-10-28')
  })
  it('rolls to next year when passed', () => {
    expect(nextOccurrence('2015-03-01', '2026-10-28')).toBe('2027-03-01')
  })
  it('maps Feb 29 to Feb 28 in common years', () => {
    expect(nextOccurrence('2020-02-29', '2026-10-28')).toBe('2027-02-28')
    expect(nextOccurrence('2020-02-29', '2027-10-28')).toBe('2028-02-29')
  })
})

describe('dDay and togetherDays', () => {
  it('counts days until a target', () => {
    expect(dDay('2026-11-07', '2026-10-28')).toBe(10)
  })
  it('counts the start day as day 1', () => {
    expect(togetherDays('2026-10-28', '2026-10-28')).toBe(1)
    expect(togetherDays('2024-07-10', '2026-10-28')).toBe(841)
  })
})

describe('upcoming', () => {
  const list: Anniversary[] = [
    { id: 'a', kind: 'wedding', title: '결혼기념일', date: '2018-05-12' },
    { id: 'b', kind: 'birthday', title: '아이 생일', date: '2022-11-03', person: '아이' },
    { id: 'c', kind: 'together', title: '처음 만난 날', date: '2016-01-20' },
  ]
  it('sorts by days left and skips the together kind', () => {
    const r = upcoming(list, '2026-10-28', 5)
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
    expect(r[0]).toMatchObject({ next: '2026-11-03', daysLeft: 6, years: 4 })
  })
})
