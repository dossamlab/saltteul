// JSON schemas for Claude structured outputs, plus validators for what comes back.

export interface BriefingResult {
  headline: string
  lines: string[]
}

export const EVENT_KINDS = ['field_trip', 'event', 'class', 'holiday', 'health', 'other'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export interface ExtractedPrepItem {
  name: string
  source: 'stated' | 'inferred'
  needsPurchase: boolean
}

export interface ExtractedEvent {
  title: string
  kind: EventKind
  dateText: string
  isoDate: string | null
  time: string | null
  prepItems: ExtractedPrepItem[]
}

export interface ExtractedDeadline {
  title: string
  dateText: string
  isoDate: string | null
}

export interface KidsnoteExtraction {
  events: ExtractedEvent[]
  deadlines: ExtractedDeadline[]
  notes: string[]
}

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }

export const briefingSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    lines: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'lines'],
  additionalProperties: false,
} as const

export const extractionSchema = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: [...EVENT_KINDS] },
          dateText: { type: 'string' },
          isoDate: nullableString,
          time: nullableString,
          prepItems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                source: { type: 'string', enum: ['stated', 'inferred'] },
                needsPurchase: { type: 'boolean' },
              },
              required: ['name', 'source', 'needsPurchase'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'kind', 'dateText', 'isoDate', 'time', 'prepItems'],
        additionalProperties: false,
      },
    },
    deadlines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, dateText: { type: 'string' }, isoDate: nullableString },
        required: ['title', 'dateText', 'isoDate'],
        additionalProperties: false,
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['events', 'deadlines', 'notes'],
  additionalProperties: false,
} as const

export class InvalidOutputError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new InvalidOutputError(`${what} is not a string`)
  return v.trim()
}
const optStr = (v: unknown, what: string): string | null => (v === null || v === undefined ? null : str(v, what) || null)
const arr = (v: unknown, what: string): unknown[] => {
  if (!Array.isArray(v)) throw new InvalidOutputError(`${what} is not an array`)
  return v
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export const MAX_BRIEFING_LINES = 8

export function validateBriefing(v: unknown): BriefingResult {
  if (!isObj(v)) throw new InvalidOutputError('briefing is not an object')
  const headline = str(v.headline, 'headline')
  if (!headline) throw new InvalidOutputError('empty headline')
  const lines = arr(v.lines, 'lines')
    .map((l, i) => str(l, `lines[${i}]`))
    .filter(Boolean)
    .slice(0, MAX_BRIEFING_LINES)
  return { headline, lines }
}

export function validateExtraction(v: unknown): KidsnoteExtraction {
  if (!isObj(v)) throw new InvalidOutputError('extraction is not an object')
  const events = arr(v.events, 'events').map((e, i): ExtractedEvent => {
    if (!isObj(e)) throw new InvalidOutputError(`events[${i}] is not an object`)
    const iso = optStr(e.isoDate, 'isoDate')
    const time = optStr(e.time, 'time')
    const kind = EVENT_KINDS.includes(e.kind as EventKind) ? (e.kind as EventKind) : 'other'
    return {
      title: str(e.title, 'title'),
      kind,
      dateText: str(e.dateText ?? '', 'dateText'),
      isoDate: iso && ISO_DATE.test(iso) ? iso : null,
      time: time && HHMM.test(time) ? time : null,
      prepItems: arr(e.prepItems ?? [], 'prepItems').map((p, j): ExtractedPrepItem => {
        if (!isObj(p)) throw new InvalidOutputError(`prepItems[${j}] is not an object`)
        return {
          name: str(p.name, 'name'),
          source: p.source === 'stated' ? 'stated' : 'inferred',
          needsPurchase: p.needsPurchase === true,
        }
      }).filter((p) => p.name),
    }
  }).filter((e) => e.title)
  const deadlines = arr(v.deadlines ?? [], 'deadlines').map((d, i): ExtractedDeadline => {
    if (!isObj(d)) throw new InvalidOutputError(`deadlines[${i}] is not an object`)
    const iso = optStr(d.isoDate, 'isoDate')
    return { title: str(d.title, 'title'), dateText: str(d.dateText ?? '', 'dateText'), isoDate: iso && ISO_DATE.test(iso) ? iso : null }
  }).filter((d) => d.title)
  const notes = arr(v.notes ?? [], 'notes').map((n, i) => str(n, `notes[${i}]`)).filter(Boolean)
  return { events, deadlines, notes }
}

// ── Quick add ───────────────────────────────────────────────────────────────

export const QUICK_KINDS = ['todo', 'shopping', 'routineDone', 'choreDone'] as const
export type QuickKind = (typeof QUICK_KINDS)[number]
export const OWNERS = ['husband', 'wife', 'both'] as const

/** One item as Claude returns it; checked against the household data in quickadd/quickAdd.ts. */
export interface RawQuickItem {
  kind: QuickKind
  /** todo title or shopping item name; routine/chore title for the done kinds */
  title: string
  date: string | null
  time: string | null
  owner: string | null
  note: string | null
  qty: string | null
  /** routine id or chore id for the done kinds */
  refId: string | null
  prepItems: string[]
}

export interface RawQuickAdd {
  items: RawQuickItem[]
  unparsed: string[]
}

export const quickAddSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...QUICK_KINDS] },
          title: { type: 'string' },
          date: nullableString,
          time: nullableString,
          owner: { anyOf: [{ type: 'string', enum: [...OWNERS] }, { type: 'null' }] },
          note: nullableString,
          qty: nullableString,
          refId: nullableString,
          prepItems: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'title', 'date', 'time', 'owner', 'note', 'qty', 'refId', 'prepItems'],
        additionalProperties: false,
      },
    },
    unparsed: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'unparsed'],
  additionalProperties: false,
} as const

/** Structural check only; a malformed item is dropped instead of failing the whole answer. */
export function validateQuickAddRaw(v: unknown): RawQuickAdd {
  if (!isObj(v)) throw new InvalidOutputError('quick add is not an object')
  const items: RawQuickItem[] = []
  for (const it of arr(v.items, 'items')) {
    if (!isObj(it) || !QUICK_KINDS.includes(it.kind as QuickKind)) continue
    const s = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
    items.push({
      kind: it.kind as QuickKind,
      title: s(it.title) ?? '',
      date: s(it.date),
      time: s(it.time),
      owner: s(it.owner),
      note: s(it.note),
      qty: s(it.qty),
      refId: s(it.refId),
      prepItems: Array.isArray(it.prepItems) ? it.prepItems.map(s).filter((x): x is string => !!x) : [],
    })
  }
  const unparsed = arr(v.unparsed ?? [], 'unparsed')
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter(Boolean)
  return { items, unparsed }
}

// ── Growth journal ──────────────────────────────────────────────────────────

export interface JournalResult {
  title: string
  lines: string[]
}

export const MAX_JOURNAL_LINES = 8

export const journalSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    lines: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'lines'],
  additionalProperties: false,
} as const

export function validateJournal(v: unknown): JournalResult {
  if (!isObj(v)) throw new InvalidOutputError('journal is not an object')
  const title = str(v.title, 'title')
  if (!title) throw new InvalidOutputError('empty journal title')
  const lines = arr(v.lines, 'lines')
    .map((l, i) => str(l, `lines[${i}]`))
    .filter(Boolean)
    .slice(0, MAX_JOURNAL_LINES)
  if (!lines.length) throw new InvalidOutputError('empty journal')
  return { title, lines }
}

// ── Dinner suggestions ──────────────────────────────────────────────────────

export interface DinnerResult {
  options: { name: string; why: string; ingredients: string[] }[]
}

export const DINNER_OPTIONS = 3
const MAX_INGREDIENTS = 12

export const dinnerSchema = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          why: { type: 'string' },
          ingredients: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'why', 'ingredients'],
        additionalProperties: false,
      },
    },
  },
  required: ['options'],
  additionalProperties: false,
} as const

export function validateDinner(v: unknown): DinnerResult {
  if (!isObj(v)) throw new InvalidOutputError('dinner is not an object')
  const options = arr(v.options, 'options')
    .map((o, i) => {
      if (!isObj(o)) throw new InvalidOutputError(`options[${i}] is not an object`)
      return {
        name: str(o.name, 'name'),
        why: str(o.why ?? '', 'why'),
        ingredients: arr(o.ingredients ?? [], 'ingredients')
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter(Boolean)
          .slice(0, MAX_INGREDIENTS),
      }
    })
    .filter((o) => o.name)
    .slice(0, DINNER_OPTIONS)
  if (!options.length) throw new InvalidOutputError('no dinner options')
  return { options }
}

export interface RawMenuDay {
  date: string
  lunch: string[]
  morningSnack: string[]
  afternoonSnack: string[]
}

export interface MenuExtraction {
  days: RawMenuDay[]
}

export const MAX_MENU_ITEMS = 10

export const menuSchema = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          lunch: { type: 'array', items: { type: 'string' } },
          morningSnack: { type: 'array', items: { type: 'string' } },
          afternoonSnack: { type: 'array', items: { type: 'string' } },
        },
        required: ['date', 'lunch', 'morningSnack', 'afternoonSnack'],
        additionalProperties: false,
      },
    },
  },
  required: ['days'],
  additionalProperties: false,
} as const

const dishes = (v: unknown, what: string) =>
  arr(v ?? [], what)
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_MENU_ITEMS)

/** Shape check only; dates are checked against the month by the caller. */
export function validateMenu(v: unknown): MenuExtraction {
  if (!isObj(v)) throw new InvalidOutputError('menu is not an object')
  const days = arr(v.days, 'days').map((d, i) => {
    if (!isObj(d)) throw new InvalidOutputError(`days[${i}] is not an object`)
    return {
      date: str(d.date, 'date'),
      lunch: dishes(d.lunch, 'lunch'),
      morningSnack: dishes(d.morningSnack, 'morningSnack'),
      afternoonSnack: dishes(d.afternoonSnack, 'afternoonSnack'),
    }
  })
  return { days }
}
