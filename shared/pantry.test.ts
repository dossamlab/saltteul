import { describe, expect, it } from 'vitest'
import { applyPantryOp, daysToExpiry, expiresSoon, findPantryItem, isLow, qtyLabel, sortPantry } from './pantry'
import type { PantryItem } from './types'

const item = (o: Partial<PantryItem>): PantryItem => ({
  id: o.name ?? 'x', name: 'x', unit: '개', qty: 10, minQty: 2, restockQty: 10, updatedAt: 0, ...o,
})

describe('pantry rules', () => {
  it('is low at or below the minimum', () => {
    expect(isLow(item({ qty: 2 }))).toBe(true)
    expect(isLow(item({ qty: 3 }))).toBe(false)
  })

  it('counts days to expiry and flags the next 7 days', () => {
    expect(daysToExpiry(item({ expiry: '2026-11-07' }), '2026-10-31')).toBe(7)
    expect(expiresSoon(item({ expiry: '2026-11-07' }), '2026-10-31')).toBe(true)
    expect(expiresSoon(item({ expiry: '2026-11-08' }), '2026-10-31')).toBe(false)
    expect(expiresSoon(item({ expiry: '2026-10-30' }), '2026-10-31')).toBe(true)
    expect(expiresSoon(item({ expiry: null }), '2026-10-31')).toBe(false)
  })

  it('sorts low, then expiring, then by name', () => {
    const list = [
      item({ name: '휴지' }),
      item({ name: '햇반', qty: 1 }),
      item({ name: '우유', expiry: '2026-11-02' }),
      item({ name: '물티슈' }),
    ]
    expect(sortPantry(list, '2026-10-31').map((p) => p.name)).toEqual(['햇반', '우유', '물티슈', '휴지'])
  })

  it('applies use / set / add / buy and never goes below zero', () => {
    expect(applyPantryOp(8, 'use', 3)).toBe(5)
    expect(applyPantryOp(2, 'use', 3)).toBe(0)
    expect(applyPantryOp(8, 'set', 5)).toBe(5)
    expect(applyPantryOp(1, 'add', 12)).toBe(13)
    expect(applyPantryOp(1, 'buy', 10)).toBe(11)
    expect(applyPantryOp(4, 'use', 1.6)).toBe(2)
  })

  it('labels counts and matches names and aliases', () => {
    expect(qtyLabel(item({ qty: 3, unit: '팩' }))).toBe('3팩')
    const list = [item({ name: '햇반', aliases: ['즉석밥'] }), item({ name: '물 티슈' })]
    expect(findPantryItem(list, '즉석 밥')?.name).toBe('햇반')
    expect(findPantryItem(list, '물티슈')?.name).toBe('물 티슈')
    expect(findPantryItem(list, '휴지')).toBeUndefined()
  })
})
