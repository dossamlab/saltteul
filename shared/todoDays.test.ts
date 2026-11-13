import { describe, expect, it } from 'vitest'
import { isMultiDay, isOverdue, layoutWeek, normalizeRange, occursOn, overlaps, todoLastDay } from './todoDays'

const span = (date: string | null, endDate?: string | null) => ({ date, endDate })

describe('todoLastDay / occursOn / overlaps', () => {
  it('uses endDate only when it is a real date after the start', () => {
    expect(todoLastDay(span(null, '2026-11-20'))).toBeNull()
    expect(todoLastDay(span('2026-11-18'))).toBe('2026-11-18')
    expect(todoLastDay(span('2026-11-18', '2026-11-20'))).toBe('2026-11-20')
    expect(todoLastDay(span('2026-11-18', '2026-11-18'))).toBe('2026-11-18')
    expect(todoLastDay(span('2026-11-18', '2026-11-17'))).toBe('2026-11-18')
    expect(todoLastDay(span('2026-11-18', 'soon'))).toBe('2026-11-18')
    expect(isMultiDay(span('2026-11-18', '2026-11-20'))).toBe(true)
    expect(isMultiDay(span('2026-11-18', '2026-11-18'))).toBe(false)
  })

  it('counts every day from the start to the last day, inclusive', () => {
    const trip = span('2026-11-30', '2026-12-02')
    expect(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'].map((d) => occursOn(trip, d)))
      .toEqual([false, true, true, true, false])
    expect(occursOn(span('2026-11-18'), '2026-11-18')).toBe(true)
    expect(occursOn(span(null), '2026-11-18')).toBe(false)
    expect(overlaps(trip, '2026-12-02', '2026-12-08')).toBe(true)
    expect(overlaps(trip, '2026-12-03', '2026-12-09')).toBe(false)
    expect(overlaps(span(null), '2026-01-01', '2026-12-31')).toBe(false)
  })

  it('judges overdue by the last day', () => {
    const trip = { ...span('2026-11-10', '2026-11-14'), done: false }
    expect(isOverdue(trip, '2026-11-14')).toBe(false)
    expect(isOverdue(trip, '2026-11-15')).toBe(true)
    expect(isOverdue({ ...trip, done: true }, '2026-11-15')).toBe(false)
    expect(isOverdue({ date: null, done: false }, '2026-11-15')).toBe(false)
  })
})

describe('normalizeRange', () => {
  const r = (date: string | null, time: string | null, endDate: string | null, endTime: string | null) =>
    normalizeRange({ date, time, endDate, endTime })

  it('keeps a later end day and an end time', () => {
    expect(r('2026-11-18', null, '2026-11-20', null)).toEqual({ endDate: '2026-11-20', endTime: null })
    expect(r('2026-11-18', '15:00', null, '17:00')).toEqual({ endDate: null, endTime: '17:00' })
    // On a later day the end time may be earlier than the start time.
    expect(r('2026-11-18', '15:00', '2026-11-19', '10:00')).toEqual({ endDate: '2026-11-19', endTime: '10:00' })
  })

  it('drops an end day before or on the start, and a same-day end time not after the start', () => {
    expect(r('2026-11-18', null, '2026-11-17', null)).toEqual({ endDate: null, endTime: null })
    expect(r('2026-11-18', null, '2026-11-18', null)).toEqual({ endDate: null, endTime: null })
    expect(r('2026-11-18', '15:00', null, '15:00')).toEqual({ endDate: null, endTime: null })
    expect(r('2026-11-18', '15:00', null, '14:00')).toEqual({ endDate: null, endTime: null })
    // The end day was dropped, so the end time is judged on the start day.
    expect(r('2026-11-18', '15:00', '2026-11-16', '14:00')).toEqual({ endDate: null, endTime: null })
  })

  it('drops both without a start date, an end time without a start time, and malformed values', () => {
    expect(r(null, null, '2026-11-20', '10:00')).toEqual({ endDate: null, endTime: null })
    expect(r('2026-11-18', null, '2026-11-20', '10:00')).toEqual({ endDate: '2026-11-20', endTime: null })
    expect(r('2026-11-18', '09:00', '11/20', '25:00')).toEqual({ endDate: null, endTime: null })
  })
})

describe('layoutWeek', () => {
  const MON = '2026-11-16'
  const todo = (id: string, date: string, endDate?: string) => ({ id, date, endDate: endDate ?? null })

  it('clips bars to the week, marks bars that continue, and stacks overlapping ones in lanes', () => {
    const { bars, more } = layoutWeek([
      todo('a', '2026-11-14', '2026-11-17'), // from last week, Mon-Tue
      todo('b', '2026-11-18'), // Wed
      todo('c', '2026-11-17', '2026-11-25'), // Tue to next week
      todo('x', '2026-11-30'), // not this week
    ], MON)
    expect(bars.map((b) => [b.todo.id, b.col, b.span, b.lane, b.fromBefore, b.toAfter])).toEqual([
      ['a', 0, 2, 0, true, false],
      ['c', 1, 6, 1, false, true],
      ['b', 2, 1, 0, false, false],
    ])
    expect(more).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('shows up to three lanes and counts the rest per day', () => {
    const list = [todo('long', MON, '2026-11-18'), todo('t1', '2026-11-17'), todo('t2', '2026-11-17'), todo('t3', '2026-11-17'), todo('t4', '2026-11-17')]
    const { bars, more } = layoutWeek(list, MON)
    expect(bars.map((b) => [b.todo.id, b.lane])).toEqual([['long', 0], ['t1', 1], ['t2', 2]])
    expect(more).toEqual([0, 2, 0, 0, 0, 0, 0])
  })

  it('keeps the given order for bars that start on the same day with the same length', () => {
    const { bars } = layoutWeek([todo('second', '2026-11-19'), todo('first', '2026-11-19')].reverse(), MON)
    expect(bars.map((b) => b.todo.id)).toEqual(['first', 'second'])
  })
})
