import type { Firestore } from 'firebase-admin/firestore'
import type { HouseholdSnapshot } from '../../shared/briefingInput'
import { addDays, householdDate } from '../../shared/householdDate'
import type { DinnerSuggestion, Settings } from '../../shared/types'
import { DEFAULT_SETTINGS, HID } from './household'

async function all<T>(db: Firestore, coll: string): Promise<T[]> {
  const snap = await db.collection(`households/${HID}/${coll}`).get()
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))
}

export async function loadSettings(db: Firestore): Promise<Settings> {
  const s = await db.doc(`households/${HID}/settings/main`).get()
  return { ...DEFAULT_SETTINGS, ...((s.exists ? s.data() : {}) as Partial<Settings>) }
}

/** Everything the briefing needs. Routine logs are limited to the last few household days. */
export async function loadSnapshot(db: Firestore, now: Date): Promise<HouseholdSnapshot> {
  const since = addDays(householdDate(now), -2)
  const [members, todos, shopping, routines, logs, chores, anniversaries, consumables, pantry, settings] = await Promise.all([
    all<HouseholdSnapshot['members'][number]>(db, 'members'),
    all<HouseholdSnapshot['todos'][number]>(db, 'todos'),
    all<HouseholdSnapshot['shopping'][number]>(db, 'shopping'),
    all<HouseholdSnapshot['routines'][number]>(db, 'routines'),
    db.collection(`households/${HID}/routineLogs`).where('day', '>=', since).get(),
    all<HouseholdSnapshot['chores'][number]>(db, 'chores'),
    all<HouseholdSnapshot['anniversaries'][number]>(db, 'anniversaries'),
    all<HouseholdSnapshot['consumables'][number]>(db, 'consumables'),
    all<NonNullable<HouseholdSnapshot['pantry']>[number]>(db, 'pantry'),
    loadSettings(db),
  ])
  const dinnerSnap = await db.doc(`households/${HID}/dinner/${householdDate(now)}`).get()
  return {
    members,
    todos,
    shopping,
    routines,
    routineLogs: logs.docs.map((d) => d.data() as HouseholdSnapshot['routineLogs'][number]),
    chores,
    anniversaries,
    consumables,
    pantry,
    dinner: dinnerSnap.exists ? (dinnerSnap.data() as DinnerSuggestion) : null,
    settings,
  }
}
