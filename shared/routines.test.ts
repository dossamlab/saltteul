import { describe, expect, it } from 'vitest'
import { choreNextDue, choreStatus, sortChores } from './chores'
import { isRoutineDone, routinesForDay } from './routines'
import type { Chore, Routine, RoutineLog } from './types'

const routines: Routine[] = [
  { id: 'r1', title: '설거지', owner: 'both', order: 2, active: true },
  { id: 'r2', title: '분리수거 내놓기', owner: 'husband', weekdays: [2, 4, 0], order: 1, active: true },
  { id: 'r3', title: '쉬는 루틴', owner: 'wife', order: 0, active: false },
]

describe('routinesForDay', () => {
  it('filters by weekday and active, sorted by order', () => {
    expect(routinesForDay(routines, '2026-10-27').map((r) => r.id)).toEqual(['r2', 'r1']) // Tue
    expect(routinesForDay(routines, '2026-10-28').map((r) => r.id)).toEqual(['r1']) // Wed
  })
  it('checks completion per household day', () => {
    const logs: RoutineLog[] = [{ routineId: 'r1', day: '2026-10-28', doneBy: 'u1', doneAt: 1 }]
    expect(isRoutineDone(logs, 'r1', '2026-10-28')).toBe(true)
    expect(isRoutineDone(logs, 'r1', '2026-10-29')).toBe(false)
  })
})

describe('chores', () => {
  const toilet: Chore = { id: 'c1', title: '화장실 청소', owner: 'both', cycleDays: 7, lastDone: '2026-10-22', createdDay: '2026-10-01' }
  it('counts the next turn from the last done day', () => {
    expect(choreNextDue(toilet)).toBe('2026-10-29')
    expect(choreNextDue({ ...toilet, lastDone: null })).toBe('2026-10-01')
  })
  it('reports left / today / overdue', () => {
    expect(choreStatus(toilet, '2026-10-27')).toEqual({ kind: 'left', days: 2 })
    expect(choreStatus(toilet, '2026-10-29')).toEqual({ kind: 'today', days: 0 })
    expect(choreStatus(toilet, '2026-10-31')).toEqual({ kind: 'overdue', days: 2 })
  })
  it('sorts overdue first, then by days left', () => {
    const bed: Chore = { ...toilet, id: 'c2', cycleDays: 14, lastDone: '2026-10-10' } // due 10-24 overdue 4
    const fridge: Chore = { ...toilet, id: 'c3', cycleDays: 14, lastDone: '2026-10-25' } // due 11-08
    expect(sortChores([fridge, toilet, bed], '2026-10-28').map((c) => c.id)).toEqual(['c2', 'c1', 'c3'])
  })
})
