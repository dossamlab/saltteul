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
  it('polls kids note on the hour between 06 and 22', () => {
    expect(dueJobs(kst(6, 0))).toContain('kidsnote')
    expect(dueJobs(kst(22, 0))).toContain('kidsnote')
    expect(dueJobs(kst(23, 0))).not.toContain('kidsnote')
    expect(dueJobs(kst(5, 0))).not.toContain('kidsnote')
  })
  it('sends briefings at 07:30 and 20:00', () => {
    expect(dueJobs(kst(7, 30))).toEqual(['calendar', 'morningBriefing'])
    expect(dueJobs(kst(20, 0))).toEqual(['calendar', 'kidsnote', 'eveningBriefing'])
  })
  it('tolerates a trigger that fires a few minutes late', () => {
    expect(dueJobs(kst(7, 33))).toContain('morningBriefing')
    expect(dueJobs(kst(7, 44))).toContain('morningBriefing')
    expect(dueJobs(kst(7, 45))).not.toContain('morningBriefing')
  })
  it('replaces the Sunday evening briefing with the weekly preview and the growth journal', () => {
    expect(dueJobs(sunday(20, 0))).toEqual(['calendar', 'kidsnote', 'weeklyPreview', 'journal'])
    expect(dueJobs(sunday(20, 14))).toContain('journal')
    expect(dueJobs(saturday(20, 0))).toEqual(['calendar', 'kidsnote', 'eveningBriefing'])
    expect(dueJobs(sunday(7, 30))).toEqual(['calendar', 'morningBriefing'])
  })
  it('suggests dinner at 15:00 on weekdays only', () => {
    expect(dueJobs(kst(15, 0))).toEqual(['calendar', 'kidsnote', 'dinner'])
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
