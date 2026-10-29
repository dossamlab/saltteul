import { weekdayOf } from './householdDate'
import type { Routine, RoutineLog, Ymd } from './types'

export function routinesForDay(routines: Routine[], day: Ymd): Routine[] {
  const wd = weekdayOf(day)
  return routines
    .filter((r) => r.active && (!r.weekdays || r.weekdays.length === 0 || r.weekdays.includes(wd)))
    .sort((a, b) => a.order - b.order)
}

export function routineLogId(routineId: string, day: Ymd): string {
  return `${routineId}_${day}`
}

export function isRoutineDone(logs: RoutineLog[], routineId: string, day: Ymd): boolean {
  return logs.some((l) => l.routineId === routineId && l.day === day)
}
