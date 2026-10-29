import type { Firestore } from 'firebase-admin/firestore'
import { householdDate } from '../../../shared/householdDate'
import { HID } from '../household'
import { SyncTokenExpiredError, type CalEvent, type CalendarPort, type ChangeSet } from './client'
import { decidePull, type TodoDoc } from './mapping'
import { calendarIdOf } from './push'

export interface PullSummary {
  created: number
  updated: number
  deleted: number
  skipped: number
  fullSync: boolean
}

async function findTodo(db: Firestore, ev: CalEvent): Promise<TodoDoc | null> {
  const todos = db.collection(`households/${HID}/todos`)
  if (ev.saltteulId) {
    const s = await todos.doc(ev.saltteulId).get()
    if (s.exists) return { ...(s.data() as TodoDoc), id: s.id }
  }
  const q = await todos.where('calendarEventId', '==', ev.id).limit(1).get()
  if (!q.empty) return { ...(q.docs[0].data() as TodoDoc), id: q.docs[0].id }
  return null
}

/**
 * Incremental pull from the household calendar into todos (source 'calendar').
 * The sync token is kept in integrations/calendar together with the calendar it belongs to.
 * Returns null when no calendar is configured.
 */
export async function pullCalendar(db: Firestore, cal: CalendarPort, now: Date = new Date()): Promise<PullSummary | null> {
  const calendarId = await calendarIdOf(db)
  if (!calendarId) return null

  const stateRef = db.doc(`households/${HID}/integrations/calendar`)
  const state = await stateRef.get()
  const sameCalendar = state.exists && state.get('syncCalendarId') === calendarId
  const token = sameCalendar ? ((state.get('syncToken') as string | null) ?? null) : null

  let changes: ChangeSet
  let fullSync = !token
  try {
    changes = await cal.listChanges(calendarId, token)
  } catch (e) {
    if (!(e instanceof SyncTokenExpiredError)) throw e
    fullSync = true
    changes = await cal.listChanges(calendarId, null)
  }

  const today = householdDate(now)
  const todos = db.collection(`households/${HID}/todos`)
  const sum: PullSummary = { created: 0, updated: 0, deleted: 0, skipped: 0, fullSync }

  for (const ev of changes.events) {
    const todo = await findTodo(db, ev)
    const action = decidePull(ev, todo, today)
    switch (action.kind) {
      case 'skip':
        sum.skipped++
        break
      case 'delete':
        await todos.doc(action.todoId).delete()
        sum.deleted++
        break
      case 'create': {
        const ref = todos.doc()
        const f = action.fields
        const doc: TodoDoc = {
          id: ref.id,
          title: f.title,
          note: f.note ?? '',
          date: f.date,
          time: f.time,
          owner: 'both',
          done: f.done,
          doneBy: null,
          doneAt: f.done ? action.updatedAt : null,
          source: 'calendar',
          calendarEventId: ev.id,
          kidsnoteBatchId: null,
          prepItems: [],
          updatedAt: action.updatedAt,
          syncOrigin: 'calendar',
          calendarUpdated: action.updatedAt,
        }
        await ref.set(doc)
        sum.created++
        break
      }
      case 'update': {
        const f = action.fields
        const prevDone = !!todo?.done
        await todos.doc(action.todoId).update({
          title: f.title,
          note: f.note ?? '',
          date: f.date,
          time: f.time,
          done: f.done,
          ...(prevDone !== f.done ? { doneAt: f.done ? action.updatedAt : null, doneBy: null } : {}),
          calendarEventId: ev.id,
          updatedAt: action.updatedAt,
          syncOrigin: 'calendar',
          calendarUpdated: action.updatedAt,
        })
        sum.updated++
        break
      }
    }
  }

  await stateRef.set({ syncToken: changes.nextSyncToken, syncCalendarId: calendarId }, { merge: true })
  return sum
}
