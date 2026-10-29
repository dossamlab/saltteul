// Sunday 20:00: the week's Kids Note notices → a short growth journal in journal/{weekStart}.
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import { addDays, householdDate, weekdayOf } from '../../../shared/householdDate'
import type { JournalEntry, Ymd } from '../../../shared/types'
import type { ClaudePort } from '../claude/client'
import { HID } from '../household'
import { recordIntegration } from '../integrations'
import type { KidsnotePort } from './client'
import { KIDSNOTE_SECRET_PATH, type KidsnoteSecret } from './connect'

export interface JournalDeps {
  db: Firestore
  kidsnote: KidsnotePort
  claude: ClaudePort
  log?: (msg: string, extra?: unknown) => void
}

export type JournalStatus = 'written' | 'exists' | 'no-reports' | 'failed'

const MAX_REPORTS = 20
const MAX_TEXT = 3000

/** Monday of the week (Mon–Sun) containing `day`. */
export function weekStartOf(day: Ymd): Ymd {
  const wd = weekdayOf(day)
  return addDays(day, wd === 0 ? -6 : 1 - wd)
}

interface Notice {
  written: Ymd
  text: string
}

/**
 * Reports come from kidsnote/{reportId} docs (center notices in the same collection are skipped) (which keep `text` since this feature). Docs from before that have
 * no text, so when any doc of the week lacks it, the week is fetched again with the stored session.
 */
async function weekNotices(deps: JournalDeps, secret: KidsnoteSecret | null, weekStart: Ymd, weekEnd: Ymd): Promise<Notice[]> {
  const { db } = deps
  const snap = await db.collection(`households/${HID}/kidsnote`).where('written', '>=', weekStart).where('written', '<=', weekEnd).get()
  const byId = new Map<string, Notice>()
  const missing = new Map<string, DocumentReference>()
  for (const d of snap.docs) {
    const data = d.data() as { kind?: string; reportId?: string; written?: Ymd; text?: unknown }
    // Center notices (newsletters, event notices) are not about the child's day.
    if (data.kind === 'notice') continue
    const id = String(data.reportId ?? d.id)
    if (typeof data.text === 'string') byId.set(id, { written: data.written ?? weekStart, text: data.text })
    else missing.set(id, d.ref)
  }

  if (missing.size && secret?.tokens?.accessToken && secret.childId) {
    try {
      const since = new Date(`${weekStart}T00:00:00+09:00`).toISOString()
      const reports = await deps.kidsnote.listReports(secret.tokens, secret.childId, since)
      for (const r of reports) {
        if (r.written < weekStart || r.written > weekEnd) continue
        byId.set(r.id, { written: r.written, text: r.text })
        const ref = missing.get(r.id)
        if (ref) await ref.set({ text: r.text }, { merge: true })
      }
    } catch (e) {
      deps.log?.('journal: could not refetch the week', e instanceof Error ? e.message : e)
    }
  }

  return [...byId.values()]
    .filter((n) => n.text.trim())
    .sort((a, b) => a.written.localeCompare(b.written))
    .slice(0, MAX_REPORTS)
    .map((n) => ({ written: n.written, text: n.text.trim().slice(0, MAX_TEXT) }))
}

export async function runJournal(deps: JournalDeps, now: Date = new Date()): Promise<{ status: JournalStatus; entry?: JournalEntry }> {
  const { db, claude } = deps
  const weekStart = weekStartOf(householdDate(now))
  const weekEnd = addDays(weekStart, 6)
  const ref = db.doc(`households/${HID}/journal/${weekStart}`)
  if ((await ref.get()).exists) return { status: 'exists' }

  const secretSnap = await db.doc(KIDSNOTE_SECRET_PATH).get()
  const secret = (secretSnap.exists ? secretSnap.data() : null) as KidsnoteSecret | null
  const reports = await weekNotices(deps, secret, weekStart, weekEnd)
  if (!reports.length) return { status: 'no-reports' }

  const childName = secret?.children?.find((c) => c.id === secret.childId)?.name ?? ''
  try {
    const r = await claude.writeJournal({ childName, weekStart, weekEnd, reports })
    await recordIntegration(db, 'claude', true, undefined, now.getTime())
    const entry: JournalEntry = {
      id: weekStart, weekStart, weekEnd, childName, title: r.title, lines: r.lines,
      reportCount: reports.length, createdAt: now.getTime(), model: r.model,
    }
    await ref.set(entry)
    return { status: 'written', entry }
  } catch (e) {
    deps.log?.('journal: claude failed', e instanceof Error ? e.message : e)
    await recordIntegration(db, 'claude', false, e, now.getTime())
    return { status: 'failed' }
  }
}
