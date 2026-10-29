// Monthly daycare menu: extractMenu callable (sheet photo/PDF → proposal) and the day lookup for dinner ideas.
// Kids Note's own menu board only has a photo per day, so the family uploads the monthly sheet instead.
import type { Firestore } from 'firebase-admin/firestore'
import { addDays, isValidYmd, weekdayOf } from '../../../shared/householdDate'
import type { DayMenu, MenuExtractResult, MonthlyMenu, Ymd } from '../../../shared/types'
import type { ClaudePort } from '../claude/client'
import type { MenuExtraction } from '../claude/schemas'
import { HID } from '../household'
import { parseFileInput } from '../quickadd/fromFile'
import { QuickInputError } from '../quickadd/quickAdd'

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export const menuPath = (month: string) => `households/${HID}/menus/${month}`

export function parseMonth(v: unknown): string {
  const m = typeof v === 'string' ? v.trim() : ''
  if (!MONTH.test(m)) throw new QuickInputError('month must be YYYY-MM')
  return m
}

const uniq = (xs: string[]) => [...new Set(xs)]

/** Keeps days inside `month`, merges repeated dates, drops days with nothing on them, sorts by date. */
export function finalizeMenu(raw: MenuExtraction, month: string): MenuExtractResult['days'] {
  const byDate = new Map<Ymd, DayMenu>()
  for (const d of raw.days) {
    const m = ISO_DATE.exec(d.date)
    if (!m || `${m[1]}-${m[2]}` !== month || !isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]))) continue
    const prev = byDate.get(d.date) ?? { lunch: [], morningSnack: [], afternoonSnack: [] }
    byDate.set(d.date, {
      lunch: uniq([...prev.lunch, ...d.lunch]),
      morningSnack: uniq([...prev.morningSnack, ...d.morningSnack]),
      afternoonSnack: uniq([...prev.afternoonSnack, ...d.afternoonSnack]),
    })
  }
  return [...byDate]
    .filter(([, v]) => v.lunch.length || v.morningSnack.length || v.afternoonSnack.length)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))
}

export async function runExtractMenu(deps: { claude: ClaudePort }, data: unknown): Promise<MenuExtractResult> {
  const month = parseMonth((data as { month?: unknown } | null)?.month)
  const file = parseFileInput(data)
  const raw = await deps.claude.extractMenu({
    month,
    file: { mediaType: file.mediaType, dataBase64: file.dataBase64, ...(file.fileName ? { name: file.fileName } : {}) },
  })
  return { month, days: finalizeMenu(raw, month), model: raw.model }
}

export interface DaySummary {
  lunch: string[]
  snack: string[]
}

function summarize(d: DayMenu | undefined): DaySummary | null {
  if (!d) return null
  const lunch = d.lunch ?? []
  const snack = [...(d.morningSnack ?? []), ...(d.afternoonSnack ?? [])]
  return lunch.length || snack.length ? { lunch, snack } : null
}

/** The daycare menu of one day as the dinner prompt wants it, or null when no sheet covers that day. */
export async function readDayMenu(db: Firestore, day: Ymd): Promise<DaySummary | null> {
  const snap = await db.doc(menuPath(day.slice(0, 7))).get()
  return summarize(snap.exists ? (snap.data() as MonthlyMenu).days?.[day] : undefined)
}

/** Days around the dinner day: 4 back reaches last Friday from a Monday, 3 ahead reaches next Monday from a Friday. */
export const NEARBY_MENU_DAYS = { before: 4, after: 3 } as const

/**
 * Daycare menus of the days around `day` (not `day` itself), oldest first, only days that have a menu. Reads each month
 * sheet once, so a range across a month boundary costs two reads.
 */
export async function readMenusAround(
  db: Firestore,
  day: Ymd,
  range: { before: number; after: number } = NEARBY_MENU_DAYS,
): Promise<({ day: Ymd; weekday: number } & DaySummary)[]> {
  const days: Ymd[] = []
  for (let i = -range.before; i <= range.after; i++) if (i !== 0) days.push(addDays(day, i))
  const months = [...new Set(days.map((d) => d.slice(0, 7)))]
  const sheets = new Map<string, MonthlyMenu | null>()
  await Promise.all(months.map(async (m) => {
    const snap = await db.doc(menuPath(m)).get()
    sheets.set(m, snap.exists ? (snap.data() as MonthlyMenu) : null)
  }))
  return days.flatMap((d) => {
    const s = summarize(sheets.get(d.slice(0, 7))?.days?.[d])
    return s ? [{ day: d, weekday: weekdayOf(d), ...s }] : []
  })
}
