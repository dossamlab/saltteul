import { describe, expect, it } from 'vitest'
import { addMonths, diffMonths, isPlanReminderDay, lastDayOf, monthGrid, monthPlans, openPlansNow, weekStart } from './monthPlan'

describe('month helpers', () => {
  it('moves across years and finds the last day', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(diffMonths('2026-10', '2027-01')).toBe(3)
    expect(lastDayOf('2026-11')).toBe('2026-11-30')
    expect(lastDayOf('2028-02')).toBe('2028-02-29')
  })

  it('builds Monday-first weeks around the month', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26') // a Sunday belongs to the week before
    expect(weekStart('2026-11-04')).toBe('2026-11-02')
    const nov = monthGrid('2026-11')
    expect(nov[0]).toBe('2026-10-26')
    expect(nov).toHaveLength(42)
    expect(nov.at(-1)).toBe('2026-12-06')
    expect(monthGrid('2027-02')).toHaveLength(28) // Feb 2027 starts on a Monday
  })

  it('reminds on the 1st and three days before the last day', () => {
    expect(isPlanReminderDay('2026-11-01')).toBe(true)
    expect(isPlanReminderDay('2026-11-27')).toBe(true)
    expect(isPlanReminderDay('2026-11-28')).toBe(false)
    expect(isPlanReminderDay('2026-12-28')).toBe(true)
  })
})

describe('monthPlans', () => {
  const todos = [
    { id: 'a', month: '2026-11', date: null, done: false },
    { id: 'b', month: '2026-11', date: null, done: true },
    { id: 'c', month: '2026-10', date: null, done: false },
    { id: 'd', month: '2026-10', date: null, done: true },
    { id: 'e', month: '2026-12', date: null, done: false },
    { id: 'f', month: '2026-11', date: '2026-11-05', done: false }, // has a date: a normal todo now
    { id: 'g', month: null, date: null, done: false },
  ]
  it('shows own items and, for the current month only, open items carried from earlier months', () => {
    const now = monthPlans(todos, '2026-11', '2026-11')
    expect(now.own.map((x) => x.id)).toEqual(['a', 'b'])
    expect(now.carried.map((x) => x.id)).toEqual(['c'])
    expect(monthPlans(todos, '2026-10', '2026-11').carried).toEqual([])
    expect(monthPlans(todos, '2026-12', '2026-11').own.map((x) => x.id)).toEqual(['e'])
    expect(openPlansNow(todos, '2026-11-04').map((x) => x.id)).toEqual(['c', 'a'])
  })
})
