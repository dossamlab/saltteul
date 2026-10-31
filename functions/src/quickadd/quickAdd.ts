// quickAdd callable: one line of free text → proposed todos / shopping / routine and chore check-offs.
// Nothing is written here; the app shows the proposal and saves what the user keeps.
import type { Firestore } from 'firebase-admin/firestore'
import { diffDays, householdDate, isValidYmd, seoulTime, weekdayOf } from '../../../shared/householdDate'
import { routinesForDay } from '../../../shared/routines'
import { applyPantryOp } from '../../../shared/pantry'
import type { Chore, Owner, PantryItem, PrepItem, QuickAddResult, QuickItem, Routine, RoutineLog, ShoppingItem, Ymd } from '../../../shared/types'
import type { ClaudePort } from '../claude/client'
import type { QuickAddInput } from '../claude/inputs'
import { OWNERS, type RawQuickAdd } from '../claude/schemas'
import { HID } from '../household'
import { listMembers } from '../members'

export class QuickInputError extends Error {}

export const QUICK_TEXT_MAX = 500
export const QUICK_MAX_ITEMS = 20
const MAX_UNPARSED = 10
/** Accepted todo dates: yesterday … a year ahead. */
export const QUICK_DATE_WINDOW = { before: 1, after: 365 }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const cut = (s: string | null, n: number) => (s ? s.slice(0, n) : null)

export function parseQuickText(data: unknown): string {
  const raw = (data as { text?: unknown } | null)?.text
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text || text.length > QUICK_TEXT_MAX) throw new QuickInputError(`text must be 1-${QUICK_TEXT_MAX} characters`)
  return text
}

/** A YYYY-MM-DD inside today−1 … today+365, else null. */
export function quickDate(v: string | null, today: Ymd): Ymd | null {
  const m = v ? ISO_DATE.exec(v) : null
  if (!m || !isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]))) return null
  const d = diffDays(today, v!)
  return d >= -QUICK_DATE_WINDOW.before && d <= QUICK_DATE_WINDOW.after ? v! : null
}

export interface QuickContext {
  today: Ymd
  routines: QuickAddInput['routines']
  chores: QuickAddInput['chores']
  pantry: (QuickAddInput['pantry'][number] & { restockQty?: number })[]
}

const PANTRY_OPS = { pantryUse: 'use', pantrySet: 'set', pantryAdd: 'add' } as const
const MAX_PANTRY_AMOUNT = 9999

/** Applies the household rules to Claude's proposal. Bad fields are cleared, unknown routine/chore ids dropped. */
export function finalizeQuickAdd(raw: RawQuickAdd, ctx: QuickContext): Pick<QuickAddResult, 'items' | 'unparsed'> {
  const routines = new Map(ctx.routines.map((r) => [r.id, r]))
  const chores = new Map(ctx.chores.map((c) => [c.id, c]))
  const pantry = new Map(ctx.pantry.map((p) => [p.id, p]))
  /** Running counts, so "3개 쓰고 2개 샀어" on one item chains correctly. */
  const running = new Map(ctx.pantry.map((p) => [p.id, p.qty]))
  const items: QuickItem[] = []
  const unparsedExtra: string[] = []
  const seen = new Set<string>()
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true))

  for (const it of raw.items) {
    if (items.length >= QUICK_MAX_ITEMS) break
    switch (it.kind) {
      case 'todo': {
        const title = cut(it.title, 100)
        if (!title) break
        const date = quickDate(it.date, ctx.today)
        if (!once(`todo|${norm(title)}|${date ?? ''}`)) break
        const prepSeen = new Set<string>()
        const prepItems: PrepItem[] = it.prepItems
          .filter((p) => !prepSeen.has(norm(p)) && !!prepSeen.add(norm(p)))
          .map((p) => ({ name: p.slice(0, 40), source: 'stated' }))
        items.push({
          kind: 'todo',
          title,
          date,
          time: it.time && HHMM.test(it.time) ? it.time : null,
          owner: OWNERS.includes(it.owner as Owner) ? (it.owner as Owner) : 'both',
          note: cut(it.note, 200),
          ...(prepItems.length ? { prepItems } : {}),
        })
        break
      }
      case 'shopping': {
        const name = cut(it.title, 60)
        if (!name || !once(`shopping|${norm(name)}`)) break
        items.push({ kind: 'shopping', name, qty: cut(it.qty, 20), note: cut(it.note, 100) })
        break
      }
      case 'routineDone': {
        const r = it.refId ? routines.get(it.refId) : undefined
        if (!r || r.doneToday || !once(`routine|${r.id}`)) break
        items.push({ kind: 'routineDone', routineId: r.id, title: r.title })
        break
      }
      case 'choreDone': {
        const c = it.refId ? chores.get(it.refId) : undefined
        if (!c || !once(`chore|${c.id}`)) break
        items.push({ kind: 'choreDone', choreId: c.id, title: c.title })
        break
      }
      case 'pantryUse':
      case 'pantrySet':
      case 'pantryAdd': {
        const op = PANTRY_OPS[it.kind]
        const said = it.amount === null ? null : Math.min(MAX_PANTRY_AMOUNT, Math.round(it.amount))
        const p = it.refId ? pantry.get(it.refId) : undefined
        if (!p) {
          // Unknown item: offer to register it when a count was said, otherwise show the words as not understood.
          const name = cut(it.title, 40)
          if (!name) break
          if ((op === 'set' || op === 'add') && said !== null && once(`pantryNew|${norm(name)}`)) {
            items.push({ kind: 'pantryNew', name, unit: '개', qty: said })
          } else {
            unparsedExtra.push(said === null ? name : `${name} ${said}`)
          }
          break
        }
        const amount = said ?? (op === 'use' ? 1 : op === 'add' ? p.restockQty || 0 : null)
        if (amount === null || (op !== 'set' && amount <= 0)) {
          unparsedExtra.push(p.name)
          break
        }
        const before = running.get(p.id) ?? p.qty
        const after = applyPantryOp(before, op, amount)
        running.set(p.id, after)
        items.push({ kind: 'pantry', pantryId: p.id, name: p.name, unit: p.unit, op, amount, before, after })
        break
      }
    }
  }
  const unparsed = [...raw.unparsed, ...unparsedExtra].map((u) => u.slice(0, 200)).slice(0, MAX_UNPARSED)
  return { items, unparsed }
}

/** Everything Claude needs besides the text. */
export async function loadQuickAddContext(
  db: Firestore, uid: string, now: Date,
): Promise<Omit<QuickAddInput, 'text'> & Pick<QuickContext, 'pantry'>> {
  const h = `households/${HID}`
  const today = householdDate(now)
  const [members, routinesSnap, logsSnap, choresSnap, shoppingSnap, pantrySnap] = await Promise.all([
    listMembers(db),
    db.collection(`${h}/routines`).get(),
    db.collection(`${h}/routineLogs`).where('day', '==', today).get(),
    db.collection(`${h}/chores`).get(),
    db.collection(`${h}/shopping`).where('bought', '==', false).get(),
    db.collection(`${h}/pantry`).get(),
  ])
  const me = members.find((m) => m.uid === uid)
  const routines = routinesSnap.docs.map((d) => ({ ...(d.data() as Routine), id: d.id }))
  const logs = logsSnap.docs.map((d) => d.data() as RoutineLog)
  return {
    today,
    weekday: weekdayOf(today),
    nowTime: seoulTime(now),
    speaker: me ? { role: me.role, name: me.displayName ?? '' } : null,
    names: {
      husband: members.find((m) => m.role === 'husband')?.displayName ?? '',
      wife: members.find((m) => m.role === 'wife')?.displayName ?? '',
    },
    routines: routinesForDay(routines, today).map((r) => ({
      id: r.id, title: r.title, owner: r.owner, doneToday: logs.some((l) => l.routineId === r.id),
    })),
    chores: choresSnap.docs.map((d) => ({ ...(d.data() as Chore), id: d.id })).map((c) => ({ id: c.id, title: c.title, owner: c.owner })),
    openShopping: shoppingSnap.docs.map((d) => (d.data() as ShoppingItem).name).filter(Boolean),
    pantry: pantrySnap.docs.map((d) => ({ ...(d.data() as PantryItem), id: d.id })).map((p) => ({
      id: p.id, name: p.name, unit: p.unit || '개', qty: p.qty ?? 0, aliases: p.aliases ?? [], restockQty: p.restockQty ?? 0,
    })),
  }
}

export async function runQuickAdd(
  deps: { db: Firestore; claude: ClaudePort },
  uid: string,
  data: unknown,
  now: Date = new Date(),
): Promise<QuickAddResult> {
  const text = parseQuickText(data)
  const ctx = await loadQuickAddContext(deps.db, uid, now)
  const raw = await deps.claude.quickAdd({ ...ctx, text })
  return { ...finalizeQuickAdd(raw, ctx), model: raw.model }
}
