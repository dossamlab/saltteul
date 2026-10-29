// Monthly daycare menu: pure helpers for the upload / check screen.
import type { DayMenu, Ymd } from '../../shared/types'

export const MENU_FIELDS = ['lunch', 'morningSnack', 'afternoonSnack'] as const
export type MenuField = (typeof MENU_FIELDS)[number]

/** Editable row: one day, each field as the comma-separated text shown in the input. */
export interface MenuRow {
  date: Ymd
  lunch: string
  morningSnack: string
  afternoonSnack: string
}

export const monthOf = (day: Ymd) => day.slice(0, 7)

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const i = y * 12 + (m - 1) + by
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}

export function splitDishes(text: string): string[] {
  return [...new Set(text.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean))]
}

export const joinDishes = (xs: string[] | undefined) => (xs ?? []).join(', ')

export function rowsFromDays(days: ({ date: Ymd } & DayMenu)[]): MenuRow[] {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, lunch: joinDishes(d.lunch), morningSnack: joinDishes(d.morningSnack), afternoonSnack: joinDishes(d.afternoonSnack) }))
}

export function rowsFromStored(days: Record<Ymd, DayMenu> | undefined): MenuRow[] {
  return rowsFromDays(Object.entries(days ?? {}).map(([date, d]) => ({ date, ...d })))
}

/** Rows → the stored map. Rows outside the month or with nothing in them are left out. */
export function daysFromRows(rows: MenuRow[], month: string): Record<Ymd, DayMenu> {
  const out: Record<Ymd, DayMenu> = {}
  for (const r of rows) {
    if (monthOf(r.date) !== month) continue
    const d: DayMenu = { lunch: splitDishes(r.lunch), morningSnack: splitDishes(r.morningSnack), afternoonSnack: splitDishes(r.afternoonSnack) }
    if (d.lunch.length || d.morningSnack.length || d.afternoonSnack.length) out[r.date] = d
  }
  return out
}
