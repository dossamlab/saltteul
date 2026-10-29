import { describe, expect, it } from 'vitest'
import { addDays, diffDays, householdDate, seoulDate, seoulTime, weekdayOf } from './householdDate'

describe('householdDate', () => {
  it('treats 02:30 KST as the previous household day', () => {
    expect(householdDate(new Date('2026-10-28T17:30:00Z'))).toBe('2026-10-28')
  })
  it('starts a new household day at 04:00 KST', () => {
    expect(householdDate(new Date('2026-10-28T19:00:00Z'))).toBe('2026-10-29')
  })
  it('treats 03:59 KST as the previous day', () => {
    expect(householdDate(new Date('2026-10-28T18:59:00Z'))).toBe('2026-10-28')
  })
})

describe('seoul helpers', () => {
  it('converts UTC to the Seoul calendar date and time', () => {
    expect(seoulDate(new Date('2026-10-28T16:00:00Z'))).toBe('2026-10-29')
    expect(seoulTime(new Date('2026-10-28T16:05:00Z'))).toBe('01:05')
  })
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('counts days between dates', () => {
    expect(diffDays('2026-10-28', '2026-11-04')).toBe(7)
    expect(diffDays('2026-11-04', '2026-10-28')).toBe(-7)
  })
  it('returns the weekday (0=Sun)', () => {
    expect(weekdayOf('2026-10-28')).toBe(3)
  })
})
