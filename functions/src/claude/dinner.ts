// Weekdays 15:00: three dinner ideas that avoid what the daycare served for lunch and snack, and balance the days
// around it (from the monthly menu sheets the family uploaded, menus/{YYYY-MM}).
import type { Firestore } from 'firebase-admin/firestore'
import { addDays, householdDate, weekdayOf } from '../../../shared/householdDate'
import type { DinnerSuggestion, Ymd } from '../../../shared/types'
import { HID } from '../household'
import { recordIntegration } from '../integrations'
import { readDayMenu, readMenusAround } from '../menu/menu'
import type { ClaudePort } from './client'

export interface DinnerDeps {
  db: Firestore
  claude: ClaudePort
  log?: (msg: string, extra?: unknown) => void
}

export type DinnerStatus = 'written' | 'exists' | 'failed'

const RECENT_DAYS = 3

export const dinnerPath = (day: Ymd) => `households/${HID}/dinner/${day}`

export async function dinnerExists(db: Firestore, day: Ymd): Promise<boolean> {
  return (await db.doc(dinnerPath(day)).get()).exists
}

export async function runDinner(deps: DinnerDeps, now: Date = new Date()): Promise<{ status: DinnerStatus; doc?: DinnerSuggestion }> {
  const { db, claude } = deps
  const day = householdDate(now)
  if (await dinnerExists(db, day)) return { status: 'exists' }

  const [daycareMenu, nearbyMenus] = await Promise.all([readDayMenu(db, day), readMenusAround(db, day)])
  const recentDocs = await Promise.all(
    Array.from({ length: RECENT_DAYS }, (_, i) => db.doc(dinnerPath(addDays(day, -(i + 1)))).get()),
  )
  const recent = recentDocs
    .filter((d) => d.exists)
    .flatMap((d) => ((d.data() as DinnerSuggestion).options ?? []).map((o) => o.name))

  try {
    const r = await claude.suggestDinner({ day, weekday: weekdayOf(day), daycareMenu, nearbyMenus, recent })
    await recordIntegration(db, 'claude', true, undefined, now.getTime())
    const doc: DinnerSuggestion = { id: day, day, daycareMenu, options: r.options, createdAt: now.getTime(), model: r.model }
    await db.doc(dinnerPath(day)).set(doc)
    return { status: 'written', doc }
  } catch (e) {
    deps.log?.('dinner: claude failed', e instanceof Error ? e.message : e)
    await recordIntegration(db, 'claude', false, e, now.getTime())
    return { status: 'failed' }
  }
}
