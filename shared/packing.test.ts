import { describe, expect, it } from 'vitest'
import { makeT } from './copy'
import {
  canReturnCheck, canReview, categoryChoices, defaultBase, forecastRange, groupByCategory, homeTrips, itemsFromBase, nextOrder,
  packCount, packingBriefLines, progress, recount, returnDay, returnProgress, reviewOffered, reviewProposals, sortTrips,
  streakUpdates, tripPhase, unpackedSummary, weatherTips,
} from './packing'
import type { PackRule, PackingBaseItem, Trip, TripItem } from './types'

const rule = (o: Partial<PackRule> = {}): PackRule => ({ kind: 'fixed', n: 1, extra: 0, overnightOnly: false, perPerson: false, ...o })

const trip = (o: Partial<Trip> = {}): Trip => ({
  id: 't1', name: '강릉', start: '2026-11-20', nights: 2, kids: 1, createdAt: 0, createdBy: 'u', ...o,
})

const item = (o: Partial<TripItem>): TripItem => ({
  id: o.name ?? 'x', tripId: 't1', name: 'x', category: '위생', tab: 'kid', qty: 1, auto: true, rule: rule(), baseId: null,
  order: 1, packed: false, returned: false, ...o,
})

const base = (o: Partial<PackingBaseItem>): PackingBaseItem => ({
  id: o.name ?? 'b', name: 'b', category: '위생', tab: 'kid', order: 1, ...rule(), ...o,
})

describe('packCount', () => {
  it('counts fixed, per day and per night with extra', () => {
    expect(packCount(rule({ n: 2 }), 2, 1, 'wife')).toBe(2)
    expect(packCount(rule({ kind: 'perDay', n: 6 }), 2, 1, 'kid')).toBe(18) // 2 nights = 3 days
    expect(packCount(rule({ kind: 'perNight', n: 1, extra: 1 }), 2, 1, 'both')).toBe(3)
    expect(packCount(rule({ kind: 'perDay', n: 1, extra: 1 }), 0, 1, 'kid')).toBe(2) // day trip = 1 day
    expect(packCount(rule({ kind: 'perNight', n: 2 }), 0, 1, 'kid')).toBe(0)
  })

  it('multiplies per-person kid lines by the children, and only on the kid tab', () => {
    expect(packCount(rule({ kind: 'perDay', n: 1, extra: 1, perPerson: true }), 1, 2, 'kid')).toBe(6)
    expect(packCount(rule({ perPerson: true }), 1, 2, 'wife')).toBe(1)
    expect(packCount(rule({ perPerson: false }), 1, 3, 'kid')).toBe(1)
  })

  it('gives 0 for overnight-only lines on a day trip', () => {
    expect(packCount(rule({ overnightOnly: true }), 0, 1, 'kid')).toBe(0)
    expect(packCount(rule({ overnightOnly: true }), 1, 1, 'kid')).toBe(1)
  })
})

describe('the default kid list', () => {
  const list = defaultBase()

  it('has the agreed lines on the kid tab only, in order with fixed ids', () => {
    expect(list).toHaveLength(35)
    expect(list.every((b) => b.tab === 'kid')).toBe(true)
    expect(list.map((b) => b.order)).toEqual(list.map((_, i) => i + 1))
    expect(list[0]).toMatchObject({ id: 'default-kid-01', name: '물티슈', category: '위생' })
    expect(new Set(list.map((b) => b.id)).size).toBe(35)
  })

  it('counts diapers per day per child and socks per day plus one', () => {
    const diapers = list.find((b) => b.name === '기저귀')!
    expect(diapers).toMatchObject({ kind: 'perDay', n: 6, perPerson: true })
    const socks = list.find((b) => b.name === '양말')!
    expect(packCount(socks, 1, 1, 'kid')).toBe(3)
    expect(list.filter((b) => b.overnightOnly).map((b) => b.name)).toEqual(['베개', '담요', '백색소음기', '워시', '샴푸'])
  })

  it('copies into a trip with counts, keeping overnight-only lines at 0 on a day trip', () => {
    const day = itemsFromBase(list, 0, 1)
    expect(day.find((x) => x.name === '베개')!.qty).toBe(0)
    expect(day.find((x) => x.name === '기저귀')).toMatchObject({ qty: 6, auto: true, baseId: 'default-kid-04', packed: false })
    expect(progress(day.map((x, i) => ({ ...x, id: String(i), tripId: 't' }))).total).toBe(30)
  })
})

describe('recount', () => {
  it('recounts only lines still counted by rule', () => {
    const items = [
      item({ id: 'a', qty: 12, rule: rule({ kind: 'perDay', n: 6 }) }),
      item({ id: 'b', qty: 20, auto: false, rule: rule({ kind: 'perDay', n: 6 }) }),
      item({ id: 'c', qty: 2, auto: false, rule: null }),
      item({ id: 'd', qty: 0, rule: rule({ overnightOnly: true }) }),
      item({ id: 'e', qty: 1, rule: rule() }),
    ]
    expect(recount(items, 2, 1)).toEqual([{ id: 'a', qty: 18 }, { id: 'd', qty: 1 }])
    expect(recount(items, 1, 1)).toEqual([{ id: 'd', qty: 1 }])
    expect(recount(items, 0, 1)).toEqual([{ id: 'a', qty: 6 }])
  })
})

describe('trip days', () => {
  it('ends start + nights and moves to past the day after', () => {
    expect(returnDay(trip())).toBe('2026-11-22')
    expect(tripPhase(trip(), '2026-11-19')).toBe('upcoming')
    expect(tripPhase(trip(), '2026-11-20')).toBe('ongoing')
    expect(tripPhase(trip(), '2026-11-22')).toBe('ongoing')
    expect(tripPhase(trip(), '2026-11-23')).toBe('past')
    expect(tripPhase(trip({ nights: 0 }), '2026-11-21')).toBe('past')
  })

  it('sorts coming trips soonest first and past trips latest first', () => {
    const list = [
      trip({ id: 'old', start: '2026-10-01' }), trip({ id: 'later', start: '2026-12-01' }),
      trip({ id: 'soon', start: '2026-11-15' }), trip({ id: 'older', start: '2026-09-01' }),
    ]
    expect(sortTrips(list, '2026-11-14').map((x) => x.id)).toEqual(['soon', 'later', 'old', 'older'])
  })

  it('offers the return check from the last day', () => {
    expect(canReturnCheck(trip(), '2026-11-21')).toBe(false)
    expect(canReturnCheck(trip(), '2026-11-22')).toBe(true)
    expect(canReturnCheck(trip({ nights: 0 }), '2026-11-20')).toBe(true)
  })

  it('offers the review from the day after coming home until it is done', () => {
    expect(canReview(trip(), '2026-11-22')).toBe(false)
    expect(canReview(trip(), '2026-11-23')).toBe(true)
    expect(canReview(trip({ reviewedAt: 1 }), '2026-11-23')).toBe(false)
    expect(reviewOffered(trip(), '2026-12-06')).toBe(true)
    expect(reviewOffered(trip(), '2026-12-07')).toBe(false)
  })

  it('shows on home from 7 days before through the return day', () => {
    const list = [trip({ id: 'a' }), trip({ id: 'b', start: '2026-11-15', nights: 0 })]
    expect(homeTrips(list, '2026-11-12').map((x) => x.id)).toEqual(['b'])
    expect(homeTrips(list, '2026-11-13').map((x) => x.id)).toEqual(['b', 'a'])
    expect(homeTrips(list, '2026-11-16').map((x) => x.id)).toEqual(['a'])
    expect(homeTrips(list, '2026-11-22').map((x) => x.id)).toEqual(['a'])
    expect(homeTrips(list, '2026-11-23')).toEqual([])
  })
})

describe('lists and counts', () => {
  const items = [
    item({ id: '1', name: '물티슈', order: 1, packed: true, returned: true }),
    item({ id: '2', name: '베개', category: '잠자리', order: 3, qty: 0 }),
    item({ id: '3', name: '기저귀', order: 2, packed: true }),
    item({ id: '4', name: '인형', category: '잠자리', order: 4 }),
    item({ id: '5', name: '선크림', tab: 'wife', category: '씻기', order: 5 }),
    item({ id: '6', name: '돗자리', tab: 'both', category: '기타', order: 6, packed: true }),
  ]

  it('counts packed of shown lines per tab and in all', () => {
    expect(progress(items, 'kid')).toEqual({ packed: 2, total: 3 })
    expect(progress(items, 'husband')).toEqual({ packed: 0, total: 0 })
    expect(progress(items)).toEqual({ packed: 3, total: 5 })
    expect(returnProgress(items, 'kid')).toEqual({ returned: 1, total: 2 })
  })

  it('groups by category in list order', () => {
    expect(groupByCategory(items.filter((x) => x.tab === 'kid')).map((g) => [g.category, g.items.map((x) => x.id)])).toEqual([
      ['위생', ['1', '3']], ['잠자리', ['2', '4']],
    ])
    expect(nextOrder(items)).toBe(7)
    expect(nextOrder([])).toBe(1)
  })

  it('offers categories in use first, then the defaults', () => {
    expect(categoryChoices([{ category: '캠핑', order: 1 }, { category: '씻기', order: 2 }]).slice(0, 4)).toEqual(['캠핑', '씻기', '위생', '잠자리'])
  })

  it('summarises what is not packed per tab', () => {
    expect(unpackedSummary(items)).toEqual({ total: 2, byTab: [{ tab: 'kid', n: 1 }, { tab: 'wife', n: 1 }] })
  })
})

describe('review after the trip', () => {
  const b = [
    base({ id: 'wipes', name: '물티슈', n: 1 }),
    base({ id: 'curry', name: '카레', n: 1, unusedStreak: 1 }),
    base({ id: 'tofu', name: '두부', n: 1 }),
    base({ id: 'comb', name: '빗', n: 1, unusedStreak: 1 }),
    base({ id: 'doll', name: '인형', unusedStreak: 2 }),
  ]
  const items = [
    item({ id: '1', baseId: 'wipes', packed: true, review: 'short', order: 1 }),
    item({ id: '2', baseId: 'curry', packed: true, review: 'unused', order: 2 }),
    item({ id: '3', baseId: 'tofu', packed: true, review: 'unused', order: 3 }),
    item({ id: '4', baseId: 'comb', packed: true, order: 4 }),
    item({ id: '5', baseId: 'doll', packed: false, order: 5 }),
    item({ id: '6', baseId: null, packed: true, review: 'short', order: 6 }),
    item({ id: '7', baseId: 'gone', packed: true, review: 'unused', order: 7 }),
  ]

  it('proposes one more for short lines and removal on the second unused trip in a row', () => {
    expect(reviewProposals(items, b)).toEqual([
      { kind: 'more', baseId: 'wipes', name: '물티슈', from: 1, to: 2 },
      { kind: 'remove', baseId: 'curry', name: '카레' },
    ])
  })

  it('counts unused trips in a row and resets on a used line', () => {
    expect(streakUpdates(items, b)).toEqual([
      { id: 'curry', unusedStreak: 2 },
      { id: 'tofu', unusedStreak: 1 },
      { id: 'comb', unusedStreak: 0 },
    ])
  })
})

describe('forecast suggestions', () => {
  const place = { label: '강릉', lat: 37.75, lon: 128.9 }

  it('looks at the trip days the 16-day forecast covers', () => {
    expect(forecastRange(trip(), '2026-11-14')).toBeNull()
    expect(forecastRange(trip({ place }), '2026-11-14')).toEqual({ from: '2026-11-20', to: '2026-11-22' })
    expect(forecastRange(trip({ place, start: '2026-11-29', nights: 3 }), '2026-11-14')).toEqual({ from: '2026-11-29', to: '2026-11-29' })
    expect(forecastRange(trip({ place, start: '2026-11-30' }), '2026-11-14')).toBeNull()
    expect(forecastRange(trip({ place }), '2026-11-21')).toEqual({ from: '2026-11-21', to: '2026-11-22' })
    expect(forecastRange(trip({ place }), '2026-11-23')).toBeNull()
  })

  it('suggests rain gear at 60% and a jacket at 10 degrees or below', () => {
    expect(weatherTips([{ day: 'a', popMax: 59, minC: 11 }])).toEqual([])
    expect(weatherTips([{ day: 'a', popMax: 20, minC: 12 }, { day: 'b', popMax: 60, minC: 10 }])).toEqual([
      { kind: 'rain', pop: 60, items: ['umbrella', 'raincoat'] },
      { kind: 'cold', minC: 10, items: ['jacket'] },
    ])
    expect(weatherTips([{ day: 'a', popMax: null, minC: null }])).toEqual([])
  })
})

describe('packingBriefLines', () => {
  const t = makeT({
    'brief.fb.packingLeft': '아직 안 챙긴 짐 {n}개({tabs})',
    'brief.fb.packingLeftNamed': '{name}: 아직 안 챙긴 짐 {n}개({tabs})',
    'trip.tab.kid': '아이', 'trip.tab.wife': '엄마', 'trip.tab.husband': '아빠', 'trip.tab.both': '함께',
  })
  const items = [
    ...[1, 2, 3, 4, 5].map((i) => item({ id: `k${i}`, tab: 'kid' })),
    item({ id: 'k6', tab: 'kid', packed: true }),
    item({ id: 'k7', tab: 'kid', qty: 0 }),
    item({ id: 'w1', tab: 'wife' }), item({ id: 'w2', tab: 'wife' }),
    item({ id: 'o1', tripId: 'other', tab: 'husband' }),
  ]

  it('writes one line for the trip leaving tomorrow', () => {
    expect(packingBriefLines([trip({ start: '2026-11-15' })], items, '2026-11-14', t)).toEqual(['아직 안 챙긴 짐 7개(아이 5, 엄마 2)'])
    expect(packingBriefLines([trip({ start: '2026-11-16' })], items, '2026-11-14', t)).toEqual([])
  })

  it('says nothing when all is packed, and names trips when two leave tomorrow', () => {
    expect(packingBriefLines([trip({ start: '2026-11-15' })], items.map((x) => ({ ...x, packed: true })), '2026-11-14', t)).toEqual([])
    const two = [trip({ start: '2026-11-15' }), trip({ id: 'other', name: '할머니 댁', start: '2026-11-15', createdAt: 1 })]
    expect(packingBriefLines(two, items, '2026-11-14', t)).toEqual([
      '강릉: 아직 안 챙긴 짐 7개(아이 5, 엄마 2)', '할머니 댁: 아직 안 챙긴 짐 1개(아빠 1)',
    ])
  })
})
