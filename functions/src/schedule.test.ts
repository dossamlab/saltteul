import { describe, expect, it } from 'vitest'
import { dueJobs, isDinnerTime } from './schedule'

// KST = UTC+9. 2026-10-28 is a Wednesday; 2026-11-01 a Sunday; 2026-10-31 a Saturday.
const kst = (hh: number, mm: number, day = 28, month = 9) => new Date(Date.UTC(2026, month, day, hh - 9, mm, 20))
const sunday = (hh: number, mm: number) => kst(hh, mm, 1, 10)
const saturday = (hh: number, mm: number) => kst(hh, mm, 31)

describe('dueJobs', () => {
  it('always syncs the calendar', () => {
    expect(dueJobs(kst(3, 45))).toEqual(['calendar'])
  })
  it('fetches weather at quarter past every hour', () => {
    expect(dueJobs(kst(13, 15))).toEqual(['calendar', 'weather'])
  })
  it('reads kids note five times a day: 07, 10, 13, 16 and 19 KST', () => {
    const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => dueJobs(kst(h, 0)).includes('kidsnote'))
    expect(hours).toEqual([7, 10, 13, 16, 19])
    expect(dueJobs(kst(19, 15))).not.toContain('kidsnote')
  })
  it('sends briefings at 07:30 and 20:00', () => {
    expect(dueJobs(kst(7, 30))).toEqual(['calendar', 'morningBriefing'])
    expect(dueJobs(kst(20, 0))).toEqual(['calendar', 'eveningBriefing'])
  })
  it('tolerates a trigger that fires a few minutes late', () => {
    expect(dueJobs(kst(7, 33))).toContain('morningBriefing')
    expect(dueJobs(kst(7, 44))).toContain('morningBriefing')
    expect(dueJobs(kst(7, 45))).not.toContain('morningBriefing')
  })
  it('replaces the Sunday evening briefing with the weekly preview and the growth journal', () => {
    expect(dueJobs(sunday(20, 0))).toEqual(['calendar', 'weeklyPreview', 'journal'])
    expect(dueJobs(sunday(20, 14))).toContain('journal')
    expect(dueJobs(saturday(20, 0))).toEqual(['calendar', 'eveningBriefing'])
    expect(dueJobs(sunday(7, 30))).toEqual(['calendar', 'morningBriefing'])
  })
  it('suggests dinner at 15:00 on weekdays only', () => {
    expect(dueJobs(kst(15, 0))).toEqual(['calendar', 'dinner'])
    expect(dueJobs(kst(15, 15))).not.toContain('dinner')
    expect(dueJobs(saturday(15, 0))).not.toContain('dinner')
    expect(dueJobs(sunday(15, 0))).not.toContain('dinner')
  })
})

describe('isDinnerTime', () => {
  it('is true on weekdays from 15:00 KST until midnight', () => {
    expect(isDinnerTime(kst(14, 59))).toBe(false)
    expect(isDinnerTime(kst(15, 0))).toBe(true)
    expect(isDinnerTime(kst(23, 50))).toBe(true)
    expect(isDinnerTime(saturday(16, 0))).toBe(false)
  })
})
