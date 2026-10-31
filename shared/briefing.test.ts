import { describe, expect, it } from 'vitest'
import { buildBriefingInput, type HouseholdSnapshot } from './briefingInput'
import { makeT } from './copy'
import { fallbackBriefing } from './fallbackBriefing'
import { toKmaGrid } from './kmaGrid'

describe('toKmaGrid', () => {
  it('maps Seoul City Hall to 60,127', () => {
    expect(toKmaGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 })
  })
})

const snap: HouseholdSnapshot = {
  members: [
    { uid: 'h', email: 'h@x', displayName: '남편', role: 'husband' },
    { uid: 'w', email: 'w@x', displayName: '아내', role: 'wife' },
  ],
  todos: [
    { id: '1', title: '체육활동', date: '2026-10-29', owner: 'both', done: false, source: 'kidsnote', updatedAt: 0,
      prepItems: [{ name: '체육복', source: 'rule' }] },
    { id: '2', title: '병원 예약', date: '2026-10-28', time: '15:00', owner: 'wife', done: false, source: 'manual', updatedAt: 0 },
    { id: '3', title: '전구 사기', owner: 'husband', done: false, source: 'manual', updatedAt: 0 },
  ],
  shopping: [{ id: 's', name: '두부', addedBy: 'w', bought: false, source: 'manual', createdAt: 0 }],
  routines: [{ id: 'r', title: '설거지', owner: 'both', order: 0, active: true }],
  routineLogs: [],
  chores: [{ id: 'c', title: '화장실 청소', owner: 'both', cycleDays: 7, lastDone: '2026-10-21', createdDay: '2026-10-01' }],
  anniversaries: [
    { id: 'a', kind: 'wedding', title: '결혼기념일', date: '2018-11-04' },
    { id: 't', kind: 'together', title: '처음 만난 날', date: '2026-10-01' },
  ],
  consumables: [{ id: 'k', name: '세제', initialCycleDays: 30, purchases: ['2026-10-01'] }],
  settings: { familyName: '우리집', briefingTimes: { morning: '07:30', evening: '20:00' },
    weather: { updatedAt: 0, days: [{ day: '2026-10-28', minC: 8, maxC: 17, popMax: 70, sky: 'rain', rainFrom: '16:00' }] } },
}

describe('buildBriefingInput', () => {
  const morning = new Date('2026-10-27T22:30:00Z') // KST 10-28 07:30
  const evening = new Date('2026-10-28T11:00:00Z') // KST 10-28 20:00

  it('collects today items in the morning', () => {
    const i = buildBriefingInput(snap, morning, 'morning')
    expect(i.focusDay).toBe('2026-10-28')
    expect(i.focusTodos.map((t) => t.title)).toEqual(['병원 예약'])
    expect(i.chores).toEqual([{ title: '화장실 청소', owner: 'both', status: { kind: 'today', days: 0 } }])
    expect(i.weather?.popMax).toBe(70)
    expect(i.togetherDays).toBe(28)
    expect(i.undatedOpenCount).toBe(1)
    expect(i.consumablesDue).toEqual([{ name: '세제', daysLeft: 3 }])
    expect(i.routinesLeft).toEqual([])
  })

  it('looks at tomorrow in the evening and lists open routines', () => {
    const i = buildBriefingInput(snap, evening, 'evening')
    expect(i.focusDay).toBe('2026-10-29')
    expect(i.focusTodos[0]).toMatchObject({ title: '체육활동', fromKidsnote: true })
    expect(i.todayLeft.map((t) => t.title)).toEqual(['병원 예약'])
    expect(i.routinesLeft).toEqual([{ title: '설거지', owner: 'both' }])
    expect(i.chores).toEqual([])
  })
})

describe('pantry in briefings', () => {
  const withPantry: HouseholdSnapshot = {
    ...snap,
    pantry: [
      { id: 'p1', name: '물티슈', unit: '팩', qty: 1, minQty: 2, restockQty: 10, updatedAt: 0 },
      { id: 'p2', name: '햇반', unit: '개', qty: 8, minQty: 4, restockQty: 12, updatedAt: 0, expiry: '2026-11-02' },
      { id: 'p3', name: '휴지', unit: '롤', qty: 20, minQty: 6, restockQty: 30, updatedAt: 0, expiry: '2027-01-01' },
    ],
  }
  it('lists low items and, in the morning, items expiring within 7 days', () => {
    const m = buildBriefingInput(withPantry, new Date('2026-10-27T22:30:00Z'), 'morning')
    expect(m.pantryLow).toEqual([{ name: '물티슈', left: '1팩' }])
    expect(m.pantryExpiring).toEqual([{ name: '햇반', days: 5 }])
    const e = buildBriefingInput(withPantry, new Date('2026-10-28T11:00:00Z'), 'evening')
    expect(e.pantryLow).toHaveLength(1)
    expect(e.pantryExpiring).toEqual([])
    const t = makeT({ 'brief.fb.pantryLow': '{name} {qty}', 'brief.fb.pantryExpiry': '{name} {days}' })
    expect(fallbackBriefing(m, t).lines).toEqual(expect.arrayContaining(['물티슈 1팩', '햇반 5']))
  })
  it('puts today\'s dinner ideas in the morning briefing only', () => {
    const withDinner: HouseholdSnapshot = {
      ...snap,
      dinner: { id: '2026-10-28', day: '2026-10-28', daycareMenu: null, createdAt: 0, model: 'm', options: [
        { name: '소고기 뭇국', why: '', ingredients: [] }, { name: '고등어구이', why: '', ingredients: [] },
      ] },
    }
    const m = buildBriefingInput(withDinner, new Date('2026-10-27T22:30:00Z'), 'morning')
    expect(m.dinnerIdeas).toEqual(['소고기 뭇국', '고등어구이'])
    expect(buildBriefingInput(withDinner, new Date('2026-10-28T11:00:00Z'), 'evening').dinnerIdeas).toEqual([])
    // Yesterday's ideas are not repeated.
    expect(buildBriefingInput({ ...withDinner, dinner: { ...withDinner.dinner!, day: '2026-10-27' } }, new Date('2026-10-27T22:30:00Z'), 'morning').dinnerIdeas).toEqual([])
    const t = makeT({ 'brief.fb.dinner': 'dinner: {names}' })
    expect(fallbackBriefing(m, t).lines).toContain('dinner: 소고기 뭇국, 고등어구이')
  })
  it('works without pantry data', () => {
    expect(buildBriefingInput(snap, new Date('2026-10-27T22:30:00Z'), 'morning').pantryLow).toEqual([])
  })
})

describe('fallbackBriefing', () => {
  it('builds lines from copy keys', () => {
    const t = makeT({})
    const i = buildBriefingInput(snap, new Date('2026-10-28T11:00:00Z'), 'evening')
    const out = fallbackBriefing(i, t)
    expect(out.headline).toBe('brief.fb.headlineEvening')
    expect(out.lines).toContain('brief.fb.prep')
    expect(out.lines).toContain('brief.fb.routinesLeft')
  })
  it('fills placeholders', () => {
    const t = makeT({ 'brief.fb.routinesLeft': '{count}:{titles}' })
    const i = buildBriefingInput(snap, new Date('2026-10-28T11:00:00Z'), 'evening')
    expect(fallbackBriefing(i, t).lines).toContain('1:설거지')
  })
})
