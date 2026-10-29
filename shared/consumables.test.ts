import { describe, expect, it } from 'vitest'
import { dueSoon, effectiveCycle, nextDue } from './consumables'
import type { Consumable } from './types'

const base: Consumable = { id: 'c1', name: '식기세척기 세제', initialCycleDays: 30, purchases: [] }

describe('effectiveCycle', () => {
  it('uses the initial cycle with fewer than two gaps', () => {
    expect(effectiveCycle(base)).toBe(30)
    expect(effectiveCycle({ ...base, purchases: ['2026-09-01', '2026-09-26'] })).toBe(30)
  })
  it('averages the last three gaps once two or more exist', () => {
    const c = { ...base, purchases: ['2026-06-01', '2026-07-01', '2026-07-26', '2026-08-20', '2026-09-20'] }
    // gaps: 30, 25, 25, 31 -> last three 25,25,31 -> 27
    expect(effectiveCycle(c)).toBe(27)
  })
})

describe('nextDue / dueSoon', () => {
  it('is null without purchases', () => {
    expect(nextDue(base)).toBeNull()
  })
  it('adds the cycle to the last purchase', () => {
    expect(nextDue({ ...base, purchases: ['2026-10-01'] })).toBe('2026-10-31')
  })
  it('lists items due within the window, soonest first', () => {
    const a = { ...base, id: 'a', purchases: ['2026-10-01'] } // due 10-31
    const b = { ...base, id: 'b', initialCycleDays: 90, purchases: ['2026-08-01'] } // due 10-30
    const c = { ...base, id: 'c', purchases: ['2026-10-20'] } // due 11-19
    expect(dueSoon([a, b, c], '2026-10-28', 5).map((x) => x.id)).toEqual(['b', 'a'])
  })
})
