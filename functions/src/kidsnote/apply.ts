import type { Firestore } from 'firebase-admin/firestore'
import { addDays, diffDays, isValidYmd } from '../../../shared/householdDate'
import { applyPrepRules } from '../../../shared/prepRules'
import { resolveRelativeDate } from '../../../shared/relativeDate'
import type { PrepItem, PrepRule, ShoppingItem, Ymd } from '../../../shared/types'
import type { TodoDoc } from '../calendar/mapping'
import type { ExtractedPrepItem, KidsnoteExtraction } from '../claude/schemas'
import type { T } from '../copy'
import { HID } from '../household'

/** Accepted distance of a resolved date from the day the notice was written. */
export const DATE_WINDOW = { before: 7, after: 120 }
export const PREP_REMINDER_TIME = '20:00'

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

function isIsoDate(s: string | null | undefined): s is Ymd {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  return isValidYmd(y, m, d)
}

/**
 * Server-side date first (`resolveRelativeDate` against the written day), Claude's isoDate second.
 * Anything outside written−7d … written+120d is treated as unknown.
 */
export function resolveEventDate(dateText: string, isoDate: string | null, written: Ymd): Ymd | null {
  const candidate = (dateText ? resolveRelativeDate(dateText, written) : null) ?? (isIsoDate(isoDate) ? isoDate : null)
  if (!candidate) return null
  const d = diffDays(written, candidate)
  return d >= -DATE_WINDOW.before && d <= DATE_WINDOW.after ? candidate : null
}

/** House rule items first, then stated, then inferred; the first occurrence of a name wins. */
export function mergePrepItems(ruleItems: string[], extracted: ExtractedPrepItem[]): PrepItem[] {
  const out: PrepItem[] = []
  const seen = new Set<string>()
  const push = (name: string, source: PrepItem['source']) => {
    const k = norm(name)
    if (!k || seen.has(k)) return
    seen.add(k)
    out.push({ name: name.trim(), source })
  }
  for (const r of ruleItems) push(r, 'rule')
  for (const p of extracted) if (p.source === 'stated') push(p.name, 'stated')
  for (const p of extracted) if (p.source === 'inferred') push(p.name, 'inferred')
  return out
}

export type NewTodo = Omit<TodoDoc, 'id'>
export type NewShopping = Omit<ShoppingItem, 'id'>

export interface KidsnotePlan {
  todos: NewTodo[]
  shopping: NewShopping[]
  counts: { events: number; prepItems: number; shopping: number; dateChecks: number; deadlines: number }
}

export interface PlanInput {
  extraction: KidsnoteExtraction
  written: Ymd
  /** Household day "now", used to keep prep reminders out of the past. */
  today: Ymd
  rules: PrepRule[]
  /** `${title}|${date}` of kidsnote todos that already exist, to avoid duplicates. */
  existingTodoKeys: Set<string>
  /** Names of shopping items not yet bought. */
  openShoppingNames: string[]
  batchId: string
  now: number
  t: T
}

export const todoKey = (title: string, date: Ymd | null | undefined) => `${norm(title)}|${date ?? ''}`

/** "{title} 마감" via copy, without doubling a title that already ends in 마감. */
export const deadlineTitle = (title: string, t: T) =>
  /마감\s*$/.test(title) ? title.trim() : t('kidsnote.deadlineTitle', { title: title.trim() })

/** Title without the kids-note prefix, punctuation and term words, for near-duplicate checks. */
function coreTitle(title: string, prefix: string): string {
  return norm(title.replace(prefix, ''))
    .replace(/[\[\]()·•.,:~!?'"-]/g, '')
    .replace(/\d+학기|\d+차|\d+월|\d+일|가을|봄|여름|겨울/g, '')
}

function bigrams(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

/** Same event worded differently by two notices, e.g. "2학기 학부모 방문상담" and "학부모 방문상담". */
export function similarTitles(a: string, b: string, prefix: string): boolean {
  const x = coreTitle(a, prefix)
  const y = coreTitle(b, prefix)
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  const bx = bigrams(x)
  const by = new Set(bigrams(y))
  if (!bx.length || !by.size) return false
  const shared = bx.filter((g) => by.has(g)).length
  return (2 * shared) / (bx.length + by.size) >= 0.6
}

export function planKidsnote(p: PlanInput): KidsnotePlan {
  const { t, batchId, now } = p
  const todos: NewTodo[] = []
  const shopping: NewShopping[] = []
  const counts = { events: 0, prepItems: 0, shopping: 0, dateChecks: 0, deadlines: 0 }
  const shoppingSeen = new Set(p.openShoppingNames.map(norm))
  const prepSeen = new Set<string>()
  const keys = new Set(p.existingTodoKeys)
  const prefix = t('kidsnote.eventPrefix')
  /** An existing or planned todo on the same date that is the same event under another wording. */
  const hasSimilar = (title: string, date: Ymd) => {
    for (const k of keys) {
      const cut = k.lastIndexOf('|')
      if (k.slice(cut + 1) === date && similarTitles(k.slice(0, cut), title, norm(prefix))) return true
    }
    return false
  }
  const isPast = (date: Ymd) => diffDays(p.today, date) < 0

  const base = (title: string, date: Ymd | null, time: string | null, prepItems: PrepItem[], note = ''): NewTodo => ({
    title,
    note,
    date,
    time,
    owner: 'both',
    done: false,
    doneBy: null,
    doneAt: null,
    source: 'kidsnote',
    calendarEventId: null,
    kidsnoteBatchId: batchId,
    prepItems,
    updatedAt: now,
    syncOrigin: 'app',
  })

  const dateCheck = (title: string, dateText: string, prepItems: PrepItem[]) => {
    const checkTitle = t('kidsnote.dateCheckTitle', { title, dateText: dateText || '-' })
    if (keys.has(todoKey(checkTitle, null))) return false
    keys.add(todoKey(checkTitle, null))
    todos.push(base(checkTitle, null, null, prepItems, dateText))
    counts.dateChecks++
    return true
  }

  for (const ev of p.extraction.events) {
    const date = resolveEventDate(ev.dateText, ev.isoDate, p.written)
    const items = mergePrepItems(applyPrepRules(ev.title, p.rules), ev.prepItems)

    if (!date) {
      if (!dateCheck(ev.title, ev.dateText, items)) continue
    } else {
      const title = `${prefix} ${ev.title}`
      // Skip events that already happened and ones another notice already registered.
      if (isPast(date) || keys.has(todoKey(title, date)) || hasSimilar(title, date)) continue
      keys.add(todoKey(title, date))
      todos.push(base(title, date, ev.time, items))
      counts.events++

      if (items.length) {
        const dayBefore = addDays(date, -1)
        const inPast = diffDays(p.today, dayBefore) < 0
        todos.push(
          base(
            t('kidsnote.prepTodoTitle', { title: ev.title, items: items.map((i) => i.name).join(', ') }),
            inPast ? date : dayBefore,
            inPast ? null : PREP_REMINDER_TIME,
            items,
          ),
        )
      }
    }

    for (const i of items) {
      if (prepSeen.has(norm(i.name))) continue
      prepSeen.add(norm(i.name))
      counts.prepItems++
    }

    for (const it of ev.prepItems) {
      if (!it.needsPurchase || shoppingSeen.has(norm(it.name))) continue
      shoppingSeen.add(norm(it.name))
      shopping.push({
        name: it.name.trim(),
        qty: '',
        note: ev.title,
        addedBy: 'kidsnote',
        bought: false,
        boughtBy: null,
        boughtAt: null,
        source: 'kidsnote',
        consumableId: null,
        kidsnoteBatchId: batchId,
        createdAt: now,
      })
      counts.shopping++
    }
  }

  for (const dl of p.extraction.deadlines) {
    const date = resolveEventDate(dl.dateText, dl.isoDate, p.written)
    if (!date) {
      dateCheck(dl.title, dl.dateText, [])
      continue
    }
    const title = deadlineTitle(dl.title, t)
    if (isPast(date) || keys.has(todoKey(title, date)) || hasSimilar(title, date)) continue
    keys.add(todoKey(title, date))
    todos.push(base(title, date, null, []))
    counts.deadlines++
  }

  return { todos, shopping, counts }
}

/** Writes the plan in one batch. Every document carries the batch id so it can be undone together. */
export async function applyPlan(db: Firestore, plan: KidsnotePlan): Promise<{ todoIds: string[]; shoppingIds: string[] }> {
  const batch = db.batch()
  const todoIds: string[] = []
  const shoppingIds: string[] = []
  for (const td of plan.todos) {
    const ref = db.collection(`households/${HID}/todos`).doc()
    batch.set(ref, { ...td, id: ref.id })
    todoIds.push(ref.id)
  }
  for (const s of plan.shopping) {
    const ref = db.collection(`households/${HID}/shopping`).doc()
    batch.set(ref, { ...s, id: ref.id })
    shoppingIds.push(ref.id)
  }
  await batch.commit()
  return { todoIds, shoppingIds }
}
