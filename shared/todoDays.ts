// Multi-day todos: a todo with an endDate after its date is that day's todo on every day from date to endDate.
// Overdue is judged by the last day. Used by the web app, the briefings and the calendar sync.
import { addDays, diffDays } from './householdDate'
import type { Todo, Ymd } from './types'

type Span = Pick<Todo, 'date' | 'endDate'>

const YMD = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** The last day of a dated todo (its date unless a valid endDate comes later); null when undated. */
export function todoLastDay(t: Span): Ymd | null {
  if (!t.date) return null
  return t.endDate && YMD.test(t.endDate) && t.endDate > t.date ? t.endDate : t.date
}

export const isMultiDay = (t: Span) => !!t.date && todoLastDay(t) !== t.date

/** True when `day` falls between the todo's date and its last day, inclusive. */
export function occursOn(t: Span, day: Ymd): boolean {
  const last = todoLastDay(t)
  return !!last && t.date! <= day && day <= last
}

/** True when the todo has at least one day inside from..to (inclusive). */
export function overlaps(t: Span, from: Ymd, to: Ymd): boolean {
  const last = todoLastDay(t)
  return !!last && t.date! <= to && last >= from
}

/** Not done and its last day is already past. */
export function isOverdue(t: Span & Pick<Todo, 'done'>, today: Ymd): boolean {
  const last = todoLastDay(t)
  return !t.done && !!last && last < today
}

/**
 * The end of a todo as it may be stored (design 4.3): an end day only after the start day, an end time only with a
 * start time, and on the start day only after the start time. Anything else is dropped.
 */
export function normalizeRange(r: { date: Ymd | null; time: string | null; endDate?: string | null; endTime?: string | null }): {
  endDate: Ymd | null; endTime: string | null
} {
  if (!r.date) return { endDate: null, endTime: null }
  const endDate = r.endDate && YMD.test(r.endDate) && r.endDate > r.date ? r.endDate : null
  const time = r.time && HHMM.test(r.time) ? r.time : null
  let endTime = time && r.endTime && HHMM.test(r.endTime) ? r.endTime : null
  if (endTime && !endDate && endTime <= time!) endTime = null
  return { endDate, endTime }
}

export interface WeekBar<T> {
  todo: T
  /** 0 = Monday … 6 = Sunday */
  col: number
  /** Number of days the bar covers inside this week */
  span: number
  lane: number
  /** The todo started before this week / goes on after it. */
  fromBefore: boolean
  toAfter: boolean
}

/**
 * Bars of one Monday-first week for the month calendar. Bars that start earlier and last longer get the upper lanes;
 * among equal ones the given order is kept. Only `maxLanes` lanes are shown; `more[col]` counts the hidden todos of
 * each day.
 */
export function layoutWeek<T extends Span>(todos: T[], monday: Ymd, maxLanes = 3): { bars: WeekBar<T>[]; more: number[] } {
  const sunday = addDays(monday, 6)
  const segs = todos
    .map((todo, i) => {
      const last = todoLastDay(todo)
      if (!last || !overlaps(todo, monday, sunday)) return null
      const col = Math.max(0, diffDays(monday, todo.date!))
      const end = Math.min(6, diffDays(monday, last))
      return { todo, i, col, span: end - col + 1, fromBefore: todo.date! < monday, toAfter: last > sunday }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.col - b.col || b.span - a.span || a.i - b.i)

  const used: boolean[][] = []
  const bars: WeekBar<T>[] = []
  const more = [0, 0, 0, 0, 0, 0, 0]
  for (const s of segs) {
    let lane = 0
    while (used[lane]?.slice(s.col, s.col + s.span).some(Boolean)) lane++
    used[lane] ??= [false, false, false, false, false, false, false]
    for (let c = s.col; c < s.col + s.span; c++) used[lane][c] = true
    if (lane < maxLanes) bars.push({ todo: s.todo, col: s.col, span: s.span, lane, fromBefore: s.fromBefore, toAfter: s.toAfter })
    else for (let c = s.col; c < s.col + s.span; c++) more[c]++
  }
  return { bars, more }
}
