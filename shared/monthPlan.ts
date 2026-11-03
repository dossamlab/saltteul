// Month view and month plans (이달 계획): todos with a month ('YYYY-MM') but no date, plus a shared memo per month.
import { addDays, diffDays, weekdayOf } from './householdDate'
import type { Todo, Ymd } from './types'

/** 'YYYY-MM' */
export type Ym = string

const YM = /^\d{4}-(0[1-9]|1[0-2])$/
export const isYm = (s: unknown): s is Ym => typeof s === 'string' && YM.test(s)
export const monthOf = (d: Ymd): Ym => d.slice(0, 7)

export function addMonths(ym: Ym, n: number): Ym {
  const [y, m] = ym.split('-').map(Number)
  const i = y * 12 + (m - 1) + n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}

/** Months from a to b (b - a). */
export function diffMonths(a: Ym, b: Ym): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

export const monthNumber = (ym: Ym) => Number(ym.slice(5, 7))

export function lastDayOf(ym: Ym): Ymd {
  return addDays(`${addMonths(ym, 1)}-01`, -1)
}

/** Monday of the week that holds `d`. */
export function weekStart(d: Ymd): Ymd {
  const wd = weekdayOf(d)
  return addDays(d, wd === 0 ? -6 : 1 - wd)
}

/** The days shown for a month: whole Monday-first weeks from the week of the 1st to the week of the last day. */
export function monthGrid(ym: Ym): Ymd[] {
  const first = weekStart(`${ym}-01`)
  const weeks = Math.ceil((diffDays(first, lastDayOf(ym)) + 1) / 7)
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i))
}

/** A month plan: no date yet, but meant for a month. */
export const isMonthPlan = (t: Pick<Todo, 'date' | 'month'>) => !t.date && isYm(t.month)

/**
 * Plans shown for month `ym`: its own items, and when `ym` is the current month, open items of earlier months
 * (carried over, never deleted).
 */
export function monthPlans<T extends Pick<Todo, 'date' | 'month' | 'done'>>(todos: T[], ym: Ym, current: Ym): { own: T[]; carried: T[] } {
  const plans = todos.filter(isMonthPlan)
  return {
    own: plans.filter((t) => t.month === ym),
    carried: ym === current ? plans.filter((t) => !t.done && diffMonths(t.month!, ym) > 0) : [],
  }
}

/** Open plans of the current month, carried-over ones included (home line and briefing). */
export function openPlansNow<T extends Pick<Todo, 'date' | 'month' | 'done'>>(todos: T[], today: Ymd): T[] {
  const { own, carried } = monthPlans(todos, monthOf(today), monthOf(today))
  return [...carried, ...own.filter((t) => !t.done)]
}

/** The morning briefing mentions the month plans on the 1st and three days before the last day. */
export function isPlanReminderDay(day: Ymd): boolean {
  return day.endsWith('-01') || day === addDays(lastDayOf(monthOf(day)), -3)
}
