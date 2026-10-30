// Kids Note processing record (households/{hid}/kidsnote/*, written by the server poll): what each report or notice
// added, or why it added nothing. Pure helpers for the history sheet.
import type { Ymd } from '../../shared/types'

export interface KidsnoteRecord {
  id: string
  kind?: 'report' | 'notice' // docs from before notices existed have no kind: they are reports
  written: Ymd
  processedAt?: number
  url?: string | null
  text?: string
  batchId?: string
  skipped?: 'otherClass'
  counts?: { events: number; prepItems: number; shopping: number; dateChecks: number; deadlines: number }
  todoIds?: string[]
  shoppingIds?: string[]
  undoneAt?: number | null
  extraction?: {
    events?: { title: string; dateText?: string; isoDate?: string | null; time?: string | null }[]
    deadlines?: { title: string; dateText?: string; isoDate?: string | null }[]
    notes?: string[]
  }
}

export type RecordStatus =
  | { kind: 'added'; events: number; items: number; checks: number }
  | { kind: 'nothing' }
  | { kind: 'otherClass' }
  | { kind: 'undone' }

export function recordStatus(r: KidsnoteRecord): RecordStatus {
  if (r.skipped === 'otherClass') return { kind: 'otherClass' }
  if (r.undoneAt) return { kind: 'undone' }
  const made = (r.todoIds?.length ?? 0) + (r.shoppingIds?.length ?? 0)
  if (!made) return { kind: 'nothing' }
  const c = r.counts
  return { kind: 'added', events: (c?.events ?? 0) + (c?.deadlines ?? 0), items: c?.prepItems ?? 0, checks: c?.dateChecks ?? 0 }
}

/** Something was added and not undone yet, so the batch can still be undone. */
export const canUndo = (r: KidsnoteRecord) => recordStatus(r).kind === 'added' && !!r.batchId

/** First non-empty line of the text, for the row title (notices start with their title). */
export function recordTitle(r: KidsnoteRecord, max = 60): string {
  const line = (r.text ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Events and deadlines Claude found, in one list for the detail view. */
export function foundItems(r: KidsnoteRecord): { title: string; when: string }[] {
  const ex = r.extraction ?? {}
  return [
    ...(ex.events ?? []).map((e) => ({ title: e.title, when: e.isoDate ?? e.dateText ?? '' })),
    ...(ex.deadlines ?? []).map((d) => ({ title: d.title, when: d.isoDate ?? d.dateText ?? '' })),
  ].filter((x) => x.title)
}
