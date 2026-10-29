import { describe, expect, it } from 'vitest'
import { applyPrepRules } from './prepRules'
import { resolveRelativeDate } from './relativeDate'
import type { PrepRule } from './types'

describe('applyPrepRules', () => {
  const rules: PrepRule[] = [
    { id: '1', keyword: '체육', items: ['체육복', '운동화'] },
    { id: '2', keyword: '수영', items: ['수영복', '수모', '수건'] },
    { id: '3', keyword: '야외', items: ['운동화', '모자'] },
  ]
  it('collects items for every matching keyword without duplicates', () => {
    expect(applyPrepRules('야외 체육활동', rules)).toEqual(['체육복', '운동화', '모자'])
  })
  it('ignores spaces when matching', () => {
    expect(applyPrepRules('수 영 수업', rules)).toEqual(['수영복', '수모', '수건'])
  })
  it('returns empty when nothing matches', () => {
    expect(applyPrepRules('생일 파티', rules)).toEqual([])
  })
})

describe('resolveRelativeDate (written on Wed 2026-10-28)', () => {
  const w = '2026-10-28'
  it.each([
    ['오늘', '2026-10-28'],
    ['내일', '2026-10-29'],
    ['모레', '2026-10-30'],
    ['이번 주 금요일', '2026-10-30'],
    ['다음 주 수요일', '2026-11-04'],
    ['다음주 월요일', '2026-11-02'],
    ['금요일', '2026-10-30'],
    ['수요일', '2026-11-04'],
    ['11월 3일', '2026-11-03'],
    ['1월 5일', '2027-01-05'],
    ['11/7', '2026-11-07'],
    ['3일', '2026-11-03'],
    ['30일', '2026-10-30'],
    ['11월 3일(화)', '2026-11-03'],
  ])('%s -> %s', (text, expected) => {
    expect(resolveRelativeDate(text, w)).toBe(expected)
  })
  it('returns null for unknown phrases', () => {
    expect(resolveRelativeDate('조만간', w)).toBeNull()
    expect(resolveRelativeDate('2월 30일', w)).toBeNull()
  })
})
