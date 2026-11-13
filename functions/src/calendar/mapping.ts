import { addDays, diffDays, seoulDate, seoulTime } from '../../../shared/householdDate'
import { normalizeRange } from '../../../shared/todoDays'
import type { Owner, Todo, Ymd } from '../../../shared/types'
import type { CalEvent, CalTime, EventInput } from './client'

export const TZ = 'Asia/Seoul'
/** Prefix put on the event title when the todo is done (a symbol, not a sentence). */
export const DONE_PREFIX = '✓ '
const TIMED_EVENT_MINUTES = 60

/** Google Calendar event colours per owner: tangerine, sage, peacock. */
export const OWNER_COLOR: Record<Owner, string> = { wife: '6', husband: '2', both: '7' }

/** Owner of an event pulled in for the first time; other colours and no colour mean both. */
export function ownerFromColor(colorId: string | null | undefined): Owner {
  return colorId === OWNER_COLOR.wife ? 'wife' : colorId === OWNER_COLOR.husband ? 'husband' : 'both'
}

/** Todo as stored, plus the bookkeeping field the calendar pull writes. */
export type TodoDoc = Todo & { calendarUpdated?: number | null }

export interface CalendarFields {
  title: string
  date: Ymd
  time: string | null
  done: boolean
  note: string | null
  endDate: Ymd | null
  endTime: string | null
}

type TimeFields = Pick<Todo, 'date' | 'time' | 'endDate' | 'endTime'>

function plusMinutes(date: Ymd, time: string, minutes: number): { date: Ymd; time: string } {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  const dayShift = Math.floor(total / 1440)
  const rest = total - dayShift * 1440
  const hh = String(Math.floor(rest / 60)).padStart(2, '0')
  const mm = String(rest % 60).padStart(2, '0')
  return { date: addDays(date, dayShift), time: `${hh}:${mm}` }
}

const at = (p: { date: Ymd; time: string }): CalTime => ({ dateTime: `${p.date}T${p.time}:00`, timeZone: TZ })

/**
 * Start and end of the event for a dated todo. All-day: the end is the day after the last day (Google's end is
 * exclusive). Timed: endTime on endDate ?? date, else 60 minutes after the start time on the last day.
 */
function eventTimes(t: TimeFields & { date: Ymd }): { start: CalTime; end: CalTime } {
  const { endDate, endTime } = normalizeRange({ date: t.date, time: t.time ?? null, endDate: t.endDate, endTime: t.endTime })
  const last = endDate ?? t.date
  if (!t.time) return { start: { date: t.date }, end: { date: addDays(last, 1) } }
  return {
    start: at({ date: t.date, time: t.time }),
    end: at(endTime ? { date: last, time: endTime } : plusMinutes(last, t.time, TIMED_EVENT_MINUTES)),
  }
}

/** Event body for a dated todo; null when the todo has no date (it stays app-only). */
export function todoToEvent(
  todo: Pick<Todo, 'id' | 'title' | 'note' | 'date' | 'time' | 'done' | 'owner' | 'endDate' | 'endTime'>,
): EventInput | null {
  if (!todo.date) return null
  const summary = `${todo.done ? DONE_PREFIX : ''}${todo.title}`
  const description = todo.note ?? null
  const { start, end } = eventTimes({ ...todo, date: todo.date })
  return { summary, description, start, end, colorId: OWNER_COLOR[todo.owner] ?? OWNER_COLOR.both, saltteulId: todo.id }
}

export function sameEvent(a: EventInput | null, b: EventInput | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const parseAt = (s: string | null | undefined): Date | null => {
  const d = s ? new Date(s) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}

/**
 * Todo fields read from a calendar event. All-day → date only, the exclusive end read back as the last day; timed →
 * KST date and time, and an end time unless the end is the app's default (60 minutes after the start time on the
 * start day or a later day, which then becomes the last day).
 */
export function eventToFields(ev: CalEvent): CalendarFields | null {
  if (ev.status === 'cancelled' || !ev.start) return null
  let date: Ymd | null = null
  let time: string | null = null
  let endDate: Ymd | null = null
  let endTime: string | null = null
  if (ev.start.date) {
    date = ev.start.date
    if (ev.end?.date) endDate = addDays(ev.end.date, -1)
  } else if (ev.start.dateTime) {
    const start = parseAt(ev.start.dateTime)
    if (!start) return null
    date = seoulDate(start)
    time = seoulTime(start)
    const end = parseAt(ev.end?.dateTime)
    if (end) {
      const e = { date: seoulDate(end), time: seoulTime(end) }
      const startTime = time
      const defaultLast = [e.date, addDays(e.date, -1)].find((d) => {
        const p = plusMinutes(d, startTime, TIMED_EVENT_MINUTES)
        return d >= date! && p.date === e.date && p.time === e.time
      })
      endDate = defaultLast ?? e.date
      endTime = defaultLast ? null : e.time
    }
  }
  if (!date) return null
  const range = normalizeRange({ date, time, endDate, endTime })
  const raw = (ev.summary ?? '').trim()
  const done = raw.startsWith(DONE_PREFIX.trim())
  const title = done ? raw.slice(DONE_PREFIX.trim().length).trim() : raw
  return { title, date, time, done, note: ev.description?.trim() || null, ...range }
}

/** Same end as far as the calendar is concerned (an end time equal to the default counts as none). */
const sameEnd = (a: TimeFields & { date: Ymd }, b: TimeFields & { date: Ymd }) =>
  JSON.stringify(eventTimes(a).end) === JSON.stringify(eventTimes(b).end)

export function fieldsEqual(todo: TodoDoc, f: CalendarFields): boolean {
  return (
    todo.title === f.title &&
    (todo.date ?? null) === f.date &&
    (todo.time ?? null) === f.time &&
    !!todo.done === f.done &&
    (todo.note?.trim() || null) === f.note &&
    sameEnd({ ...todo, date: f.date }, f)
  )
}

export type PullAction =
  | { kind: 'skip'; reason: string }
  | { kind: 'create'; fields: CalendarFields; updatedAt: number }
  | { kind: 'update'; todoId: string; fields: CalendarFields; updatedAt: number }
  | { kind: 'delete'; todoId: string }

/** Events far outside this window are not pulled into the todo list. */
export const PULL_WINDOW = { pastDays: 30, futureDays: 400 }

/**
 * Decides what one changed calendar event means for the app. Last write wins:
 * the event's `updated` time is compared with the todo's `updatedAt`.
 */
export function decidePull(ev: CalEvent, todo: TodoDoc | null, today: Ymd): PullAction {
  const updatedAt = ev.updated ? Date.parse(ev.updated) : 0
  if (ev.status === 'cancelled') {
    return todo ? { kind: 'delete', todoId: todo.id } : { kind: 'skip', reason: 'cancelled-unknown' }
  }
  const fields = eventToFields(ev)
  if (!fields) return { kind: 'skip', reason: 'unreadable' }
  if (!todo) {
    // Created by the app but the todo is gone: the push trigger removes such events; do not resurrect.
    if (ev.saltteulId) return { kind: 'skip', reason: 'orphan' }
    const d = diffDays(today, fields.date)
    if (d < -PULL_WINDOW.pastDays || d > PULL_WINDOW.futureDays) return { kind: 'skip', reason: 'out-of-window' }
    return { kind: 'create', fields, updatedAt }
  }
  if (fieldsEqual(todo, fields)) return { kind: 'skip', reason: 'unchanged' }
  if (updatedAt <= (todo.updatedAt ?? 0)) return { kind: 'skip', reason: 'app-newer' }
  return { kind: 'update', todoId: todo.id, fields, updatedAt }
}
