import { addDays, diffDays, seoulDate, seoulTime } from '../../../shared/householdDate'
import type { Todo, Ymd } from '../../../shared/types'
import type { CalEvent, EventInput } from './client'

export const TZ = 'Asia/Seoul'
/** Prefix put on the event title when the todo is done (a symbol, not a sentence). */
export const DONE_PREFIX = '✓ '
const TIMED_EVENT_MINUTES = 60

/** Todo as stored, plus the bookkeeping field the calendar pull writes. */
export type TodoDoc = Todo & { calendarUpdated?: number | null }

export interface CalendarFields {
  title: string
  date: Ymd
  time: string | null
  done: boolean
  note: string | null
}

function plusMinutes(date: Ymd, time: string, minutes: number): { date: Ymd; time: string } {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  const dayShift = Math.floor(total / 1440)
  const rest = total - dayShift * 1440
  const hh = String(Math.floor(rest / 60)).padStart(2, '0')
  const mm = String(rest % 60).padStart(2, '0')
  return { date: addDays(date, dayShift), time: `${hh}:${mm}` }
}

/** Event body for a dated todo; null when the todo has no date (it stays app-only). */
export function todoToEvent(todo: Pick<Todo, 'id' | 'title' | 'note' | 'date' | 'time' | 'done'>): EventInput | null {
  if (!todo.date) return null
  const summary = `${todo.done ? DONE_PREFIX : ''}${todo.title}`
  const description = todo.note ?? null
  if (!todo.time) {
    return { summary, description, start: { date: todo.date }, end: { date: addDays(todo.date, 1) }, saltteulId: todo.id }
  }
  const end = plusMinutes(todo.date, todo.time, TIMED_EVENT_MINUTES)
  return {
    summary,
    description,
    start: { dateTime: `${todo.date}T${todo.time}:00`, timeZone: TZ },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone: TZ },
    saltteulId: todo.id,
  }
}

export function sameEvent(a: EventInput | null, b: EventInput | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Todo fields read from a calendar event. All-day → date only; timed → KST date and time. */
export function eventToFields(ev: CalEvent): CalendarFields | null {
  if (ev.status === 'cancelled' || !ev.start) return null
  let date: Ymd | null = null
  let time: string | null = null
  if (ev.start.date) {
    date = ev.start.date
  } else if (ev.start.dateTime) {
    const at = new Date(ev.start.dateTime)
    if (Number.isNaN(at.getTime())) return null
    date = seoulDate(at)
    time = seoulTime(at)
  }
  if (!date) return null
  const raw = (ev.summary ?? '').trim()
  const done = raw.startsWith(DONE_PREFIX.trim())
  const title = done ? raw.slice(DONE_PREFIX.trim().length).trim() : raw
  return { title, date, time, done, note: ev.description?.trim() || null }
}

export function fieldsEqual(todo: TodoDoc, f: CalendarFields): boolean {
  return (
    todo.title === f.title &&
    (todo.date ?? null) === f.date &&
    (todo.time ?? null) === f.time &&
    !!todo.done === f.done &&
    (todo.note?.trim() || null) === f.note
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
