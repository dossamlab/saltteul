import { describe, expect, it } from 'vitest'
import { daysFromRows, rowsFromDays, rowsFromStored, shiftMonth, splitDishes } from './menu'

describe('menu helpers', () => {
  it('moves between months across years', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('splits dishes on commas and line breaks without repeats', () => {
    expect(splitDishes(' rice, soup，\nkimchi ,, soup ')).toEqual(['rice', 'soup', 'kimchi'])
  })

  it('turns rows into the stored map and back', () => {
    const rows = rowsFromDays([
      { date: '2026-11-03', lunch: ['rice', 'soup'], morningSnack: [], afternoonSnack: ['milk'] },
      { date: '2026-11-02', lunch: ['noodles'], morningSnack: ['banana'], afternoonSnack: [] },
    ])
    expect(rows[0]).toEqual({ date: '2026-11-02', lunch: 'noodles', morningSnack: 'banana', afternoonSnack: '' })
    const edited = [...rows, { date: '2026-11-04', lunch: ' ', morningSnack: '', afternoonSnack: '' }, { date: '2026-12-01', lunch: 'x', morningSnack: '', afternoonSnack: '' }]
    const days = daysFromRows(edited, '2026-11')
    expect(days).toEqual({
      '2026-11-02': { lunch: ['noodles'], morningSnack: ['banana'], afternoonSnack: [] },
      '2026-11-03': { lunch: ['rice', 'soup'], morningSnack: [], afternoonSnack: ['milk'] },
    })
    expect(rowsFromStored(days)).toEqual(rows)
  })
})
