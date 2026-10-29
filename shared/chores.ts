import { addDays, diffDays } from './householdDate'
import type { Chore, Ymd } from './types'

/** Next turn = last done day + cycle. Never done → due from the day it was registered. */
export function choreNextDue(c: Chore): Ymd {
  return c.lastDone ? addDays(c.lastDone, c.cycleDays) : c.createdDay
}

export type ChoreStatus = { kind: 'left' | 'today' | 'overdue'; days: number }

export function choreStatus(c: Chore, today: Ymd): ChoreStatus {
  const left = diffDays(today, choreNextDue(c))
  if (left > 0) return { kind: 'left', days: left }
  if (left === 0) return { kind: 'today', days: 0 }
  return { kind: 'overdue', days: -left }
}

/** Most urgent first: by days until due (overdue are negative). */
export function sortChores(list: Chore[], today: Ymd): Chore[] {
  return [...list].sort((a, b) => diffDays(today, choreNextDue(a)) - diffDays(today, choreNextDue(b)))
}
