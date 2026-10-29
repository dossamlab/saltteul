import type { Firestore } from 'firebase-admin/firestore'
import { HID } from '../household'
import { httpStatus, type CalendarPort } from './client'
import { sameEvent, todoToEvent, type TodoDoc } from './mapping'

export async function calendarIdOf(db: Firestore): Promise<string | null> {
  const s = await db.doc(`households/${HID}/settings/main`).get()
  return ((s.exists ? s.get('calendarId') : null) as string | null) || null
}

export type PushOutcome = 'no-calendar' | 'skipped' | 'inserted' | 'patched' | 'removed'

/** True when this write came from the calendar pull and has not been edited in the app since. */
export function isPulledWrite(t: TodoDoc): boolean {
  return t.syncOrigin === 'calendar' && t.calendarUpdated != null && t.updatedAt === t.calendarUpdated
}

async function linkEvent(db: Firestore, todoId: string, eventId: string | null) {
  try {
    await db.doc(`households/${HID}/todos/${todoId}`).update({ calendarEventId: eventId })
  } catch {
    // The todo was deleted in the meantime; its delete trigger cleans up the event.
  }
}

/**
 * Mirrors one todo write onto the household calendar.
 * Dated todo → insert/patch, done → "✓ " title, date removed or todo deleted → delete event.
 */
export async function pushTodoChange(
  db: Firestore,
  cal: CalendarPort,
  todoId: string,
  before: TodoDoc | null,
  after: TodoDoc | null,
): Promise<PushOutcome> {
  const calendarId = await calendarIdOf(db)
  if (!calendarId) return 'no-calendar'

  if (!after) {
    if (!before?.calendarEventId) return 'skipped'
    await cal.remove(calendarId, before.calendarEventId)
    return 'removed'
  }
  if (isPulledWrite(after)) return 'skipped'

  const desired = todoToEvent({ ...after, id: todoId })
  const eventId = after.calendarEventId ?? null

  if (!desired) {
    if (!eventId) return 'skipped'
    await cal.remove(calendarId, eventId)
    await linkEvent(db, todoId, null)
    return 'removed'
  }

  if (eventId) {
    // Only bookkeeping changed (e.g. our own calendarEventId write-back): nothing to send.
    if (before && sameEvent(todoToEvent({ ...before, id: todoId }), desired)) {
      return 'skipped'
    }
    try {
      await cal.patch(calendarId, eventId, desired)
      return 'patched'
    } catch (e) {
      if (httpStatus(e) !== 404 && httpStatus(e) !== 410) throw e
      // Event was deleted on the calendar side; recreate it.
    }
  }
  const created = await cal.insert(calendarId, desired)
  await linkEvent(db, todoId, created.id)
  return 'inserted'
}
