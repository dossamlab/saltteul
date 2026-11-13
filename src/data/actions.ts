import { addDoc, collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where, writeBatch, type WriteBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { defaultBase, itemsFromBase, recount, streakUpdates, type ReviewProposal } from '../../shared/packing'
import { applyPantryOp } from '../../shared/pantry'
import { routineLogId } from '../../shared/routines'
import type {
  Anniversary, Chore, Consumable, MenuExtractResult, MonthlyMenu, Nudge, Owner, PackingBaseItem, PantryItem, PantryLog, PantryOp, PrepRule,
  QuickAddResult, Routine, Settings, ShoppingItem, Todo, Trip, TripItem, Ymd,
} from '../../shared/types'
import { db, functions } from '../firebase'

// All writes for one household. Every function takes hid first so screens stay thin.
const col = (hid: string, name: string) => collection(db, `households/${hid}/${name}`)
const ref = (hid: string, name: string, id: string) => doc(db, `households/${hid}/${name}/${id}`)
const now = () => Date.now()

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

// Todos
export type TodoDraft = Pick<Todo, 'title' | 'owner'> & Partial<Pick<Todo, 'note' | 'date' | 'time' | 'prepItems' | 'month'>>

export function addTodo(hid: string, d: TodoDraft) {
  return addDoc(col(hid, 'todos'), clean({
    title: d.title.trim(), owner: d.owner, note: d.note?.trim() || undefined, date: d.date || null, time: d.time || null,
    // A month plan only while there is no date.
    month: !d.date && d.month ? d.month : undefined,
    prepItems: d.prepItems?.length ? d.prepItems : undefined,
    done: false, source: 'manual', updatedAt: now(), syncOrigin: 'app',
  }))
}
export function updateTodo(hid: string, id: string, patch: Partial<Todo>) {
  return updateDoc(ref(hid, 'todos', id), clean({ ...patch, updatedAt: now(), syncOrigin: 'app' }))
}
export function toggleTodo(hid: string, todo: Todo, uid: string) {
  const done = !todo.done
  return updateTodo(hid, todo.id, { done, doneBy: done ? uid : null, doneAt: done ? now() : null })
}
export const deleteTodo = (hid: string, id: string) => deleteDoc(ref(hid, 'todos', id))

/** The shared memo of a month plan (one document per month). */
export const saveMonthNote = (hid: string, uid: string, month: string, text: string) =>
  setDoc(ref(hid, 'monthNotes', month), { text: text.trim(), updatedAt: now(), updatedBy: uid })

// Shopping
export function addShopping(hid: string, uid: string, name: string, extra: Partial<ShoppingItem> = {}) {
  return addDoc(col(hid, 'shopping'), clean({
    name: name.trim(), addedBy: uid, bought: false, source: 'manual' as const, createdAt: now(), ...extra,
  }))
}
export async function toggleShopping(
  hid: string, item: ShoppingItem, uid: string, today: Ymd, consumables: Consumable[], pantry: PantryItem[] = [],
) {
  const bought = !item.bought
  const b = writeBatch(db)
  b.update(ref(hid, 'shopping', item.id), { bought, boughtBy: bought ? uid : null, boughtAt: bought ? now() : null })
  const c = item.consumableId ? consumables.find((x) => x.id === item.consumableId) : undefined
  if (c) {
    const purchases = bought
      ? [...c.purchases.filter((p) => p !== today), today].sort()
      : c.purchases.filter((p) => p !== today)
    b.update(ref(hid, 'consumables', c.id), { purchases })
  }
  // A linked pantry item gets its usual purchase amount; unticking takes it back off.
  const p = item.pantryId ? pantry.find((x) => x.id === item.pantryId) : undefined
  if (p && p.restockQty > 0) pantryChange(b, hid, uid, p, bought ? 'buy' : 'use', p.restockQty, 'shopping')
  await b.commit()
}
export const updateShopping = (hid: string, id: string, patch: Partial<ShoppingItem>) =>
  updateDoc(ref(hid, 'shopping', id), clean(patch))
export const deleteShopping = (hid: string, id: string) => deleteDoc(ref(hid, 'shopping', id))
export async function clearBought(hid: string, items: ShoppingItem[]) {
  const b = writeBatch(db)
  items.filter((i) => i.bought).forEach((i) => b.delete(ref(hid, 'shopping', i.id)))
  await b.commit()
}

// Routines (daily checklist; a log doc per routine per household day)
export async function toggleRoutine(hid: string, routineId: string, day: Ymd, done: boolean, uid: string) {
  const r = ref(hid, 'routineLogs', routineLogId(routineId, day))
  if (done) await deleteDoc(r)
  else await setDoc(r, { routineId, day, doneBy: uid, doneAt: now() })
}
export const addRoutine = (hid: string, r: Omit<Routine, 'id'>) => addDoc(col(hid, 'routines'), clean(r))
export const updateRoutine = (hid: string, id: string, patch: Partial<Routine>) => updateDoc(ref(hid, 'routines', id), clean(patch))
export const deleteRoutine = (hid: string, id: string) => deleteDoc(ref(hid, 'routines', id))

// Chores (cycle counted from the last done day)
export function markChoreDone(hid: string, chore: Chore, day: Ymd, uid: string) {
  const history = [...(chore.history ?? []), { day, by: uid, at: now() }].slice(-20)
  return updateDoc(ref(hid, 'chores', chore.id), { lastDone: day, history })
}
export function undoChoreDone(hid: string, chore: Chore) {
  const history = (chore.history ?? []).slice(0, -1)
  return updateDoc(ref(hid, 'chores', chore.id), { lastDone: history.at(-1)?.day ?? null, history })
}
export const addChore = (hid: string, c: Omit<Chore, 'id'>) => addDoc(col(hid, 'chores'), clean(c))
export const updateChore = (hid: string, id: string, patch: Partial<Chore>) => updateDoc(ref(hid, 'chores', id), clean(patch))
export const deleteChore = (hid: string, id: string) => deleteDoc(ref(hid, 'chores', id))

// Anniversaries, consumables, prep rules
export const addAnniversary = (hid: string, a: Omit<Anniversary, 'id'>) => addDoc(col(hid, 'anniversaries'), clean(a))
export const updateAnniversary = (hid: string, id: string, p: Partial<Anniversary>) => updateDoc(ref(hid, 'anniversaries', id), clean(p))
export const deleteAnniversary = (hid: string, id: string) => deleteDoc(ref(hid, 'anniversaries', id))

export const addConsumable = (hid: string, c: Omit<Consumable, 'id'>) => addDoc(col(hid, 'consumables'), clean(c))
export const updateConsumable = (hid: string, id: string, p: Partial<Consumable>) => updateDoc(ref(hid, 'consumables', id), clean(p))
export const deleteConsumable = (hid: string, id: string) => deleteDoc(ref(hid, 'consumables', id))
export const addConsumableToShopping = (hid: string, uid: string, c: Consumable) =>
  addShopping(hid, uid, c.name, { source: 'consumable', consumableId: c.id })

// Pantry (상비품). Counts are written from the app's current snapshot, so a change also works offline; the two members
// rarely change the same item at the same moment, and the last write wins like every other field here.
export type PantryDraft = Pick<PantryItem, 'name' | 'unit' | 'qty' | 'minQty' | 'restockQty'> & Partial<Pick<PantryItem, 'aliases' | 'expiry'>>
export const addPantryItem = (hid: string, uid: string, p: PantryDraft) =>
  addDoc(col(hid, 'pantry'), clean({ ...p, name: p.name.trim(), unit: p.unit.trim() || '개', updatedAt: now(), updatedBy: uid, lowNotifiedAt: null }))
export const updatePantryItem = (hid: string, uid: string, id: string, p: Partial<PantryDraft>) =>
  updateDoc(ref(hid, 'pantry', id), clean({ ...p, updatedAt: now(), updatedBy: uid }))
export const deletePantryItem = (hid: string, id: string) => deleteDoc(ref(hid, 'pantry', id))

/** Adds the count change and its log line to a batch. */
function pantryChange(b: WriteBatch, hid: string, uid: string, p: PantryItem, op: PantryOp, amount: number, source: PantryLog['source']) {
  const before = p.qty ?? 0
  const after = applyPantryOp(before, op, amount)
  b.update(ref(hid, 'pantry', p.id), { qty: after, updatedAt: now(), updatedBy: uid })
  b.set(doc(col(hid, 'pantryLog')), { itemId: p.id, name: p.name, op, amount: Math.round(amount), before, after, by: uid, at: now(), source })
  return after
}

export async function changePantryQty(
  hid: string, uid: string, p: PantryItem, op: PantryOp, amount: number, source: PantryLog['source'] = 'app',
) {
  const b = writeBatch(db)
  pantryChange(b, hid, uid, p, op, amount, source)
  await b.commit()
}

/** Several changes in order (quick add): each starts from the count the previous one left. One batch. */
export async function applyPantryOps(
  hid: string, uid: string, pantry: PantryItem[], ops: { pantryId: string; op: PantryOp; amount: number }[], source: PantryLog['source'],
): Promise<number> {
  const running = new Map(pantry.map((p) => [p.id, { ...p }]))
  const b = writeBatch(db)
  let n = 0
  for (const o of ops) {
    const p = running.get(o.pantryId)
    if (!p) continue
    p.qty = pantryChange(b, hid, uid, p, o.op, o.amount, source)
    n++
  }
  if (n) await b.commit()
  return n
}

export const addPantryToShopping = (hid: string, uid: string, p: PantryItem) =>
  addShopping(hid, uid, p.name, { source: 'pantry', pantryId: p.id, ...(p.restockQty > 0 ? { qty: `${p.restockQty}${p.unit || '개'}` } : {}) })

// Trips and packing. The base list is seeded with the default kid list the first time it is needed (fixed ids, so two
// phones doing it at once write the same documents); settings.packingSeeded keeps an emptied list from coming back.
// A trip copies the base list into its own tripItems; after that the two never change each other.
export async function ensurePackingBase(hid: string, base: PackingBaseItem[], seeded: boolean | undefined): Promise<PackingBaseItem[]> {
  if (base.length || seeded) return base
  const list = defaultBase()
  const b = writeBatch(db)
  for (const { id, ...item } of list) b.set(ref(hid, 'packingBase', id), item)
  b.set(doc(db, `households/${hid}/settings/main`), { packingSeeded: true }, { merge: true })
  await b.commit()
  return list
}

export type TripDraft = Pick<Trip, 'name' | 'start' | 'nights' | 'kids'> & { place: Trip['place'] }

export async function createTrip(hid: string, uid: string, d: TripDraft, base: PackingBaseItem[], seeded: boolean | undefined) {
  const list = await ensurePackingBase(hid, base, seeded)
  const tripRef = doc(col(hid, 'trips'))
  const b = writeBatch(db)
  b.set(tripRef, clean({ ...d, name: d.name.trim(), place: d.place ?? null, createdAt: now(), createdBy: uid, reviewedAt: null }))
  for (const item of itemsFromBase(list, d.nights, d.kids)) b.set(doc(col(hid, 'tripItems')), { ...item, tripId: tripRef.id })
  await b.commit()
  return tripRef.id
}

/** Saves the trip; a change of nights or children recounts the lines still counted by rule. */
export async function updateTrip(hid: string, trip: Trip, d: TripDraft, items: TripItem[]) {
  const b = writeBatch(db)
  b.update(ref(hid, 'trips', trip.id), { ...d, name: d.name.trim(), place: d.place ?? null })
  if (d.nights !== trip.nights || d.kids !== trip.kids) {
    for (const c of recount(items, d.nights, d.kids)) b.update(ref(hid, 'tripItems', c.id), { qty: c.qty })
  }
  await b.commit()
}

/** Deletes the trip with all its items (read again here, so lines not on screen go too). */
export async function deleteTrip(hid: string, tripId: string) {
  const snap = await getDocs(query(col(hid, 'tripItems'), where('tripId', '==', tripId)))
  const refs = [...snap.docs.map((d) => d.ref), ref(hid, 'trips', tripId)]
  for (let i = 0; i < refs.length; i += 450) {
    const b = writeBatch(db)
    refs.slice(i, i + 450).forEach((r) => b.delete(r))
    await b.commit()
  }
}

export type TripLineDraft = Pick<TripItem, 'name' | 'category' | 'tab' | 'order'>

/** A line added by hand; with alsoBase it is put at the end of the base list too (fixed 1, linked for the review). */
export async function addTripItem(hid: string, tripId: string, d: TripLineDraft, alsoBase: { order: number } | null) {
  const b = writeBatch(db)
  let baseId: string | null = null
  if (alsoBase) {
    const baseRef = doc(col(hid, 'packingBase'))
    baseId = baseRef.id
    b.set(baseRef, {
      name: d.name.trim(), category: d.category, tab: d.tab, order: alsoBase.order, kind: 'fixed', n: 1, extra: 0, overnightOnly: false, perPerson: false,
    })
  }
  b.set(doc(col(hid, 'tripItems')), {
    tripId, name: d.name.trim(), category: d.category, tab: d.tab, order: d.order, qty: 1, auto: false, rule: null, baseId,
    packed: false, packedBy: null, returned: false, review: null,
  } satisfies Omit<TripItem, 'id'>)
  await b.commit()
}

export const updateTripItem = (hid: string, id: string, patch: Partial<Omit<TripItem, 'id'>>) => updateDoc(ref(hid, 'tripItems', id), clean(patch))
export const togglePacked = (hid: string, item: TripItem, uid: string) =>
  updateTripItem(hid, item.id, item.packed ? { packed: false, packedBy: null, returned: false } : { packed: true, packedBy: uid })
/** A count changed by hand is no longer recounted. */
export const setTripItemQty = (hid: string, item: TripItem, qty: number) =>
  updateTripItem(hid, item.id, { qty: Math.max(1, Math.round(qty)), auto: false })
export const deleteTripItem = (hid: string, id: string) => deleteDoc(ref(hid, 'tripItems', id))
/** Undo of a delete: the same document comes back. */
export const restoreTripItem = (hid: string, { id, ...item }: TripItem) => setDoc(ref(hid, 'tripItems', id), item)
export const tripItemToShopping = (hid: string, uid: string, item: TripItem, qty?: string) =>
  addShopping(hid, uid, item.name, qty ? { qty } : {})

export type BaseDraft = Omit<PackingBaseItem, 'id' | 'unusedStreak'>
export const addBaseItem = (hid: string, d: BaseDraft) => addDoc(col(hid, 'packingBase'), clean({ ...d, name: d.name.trim() }))
export const updateBaseItem = (hid: string, id: string, p: Partial<BaseDraft>) => updateDoc(ref(hid, 'packingBase', id), clean(p))
export const deleteBaseItem = (hid: string, id: string) => deleteDoc(ref(hid, 'packingBase', id))
export const restoreBaseItem = (hid: string, { id, ...item }: PackingBaseItem) => setDoc(ref(hid, 'packingBase', id), clean(item))

/** One approved change from the review. */
export function applyReviewProposal(hid: string, p: ReviewProposal) {
  return p.kind === 'more' ? updateBaseItem(hid, p.baseId, { n: p.to }) : deleteBaseItem(hid, p.baseId)
}

/** Ends the review: unused streaks of the base lines (those still there) and the trip marked reviewed. */
export async function finishReview(hid: string, tripId: string, items: TripItem[], base: PackingBaseItem[]) {
  const b = writeBatch(db)
  for (const u of streakUpdates(items, base)) b.update(ref(hid, 'packingBase', u.id), { unusedStreak: u.unusedStreak })
  b.update(ref(hid, 'trips', tripId), { reviewedAt: now() })
  await b.commit()
}

export const addPrepRule =(hid: string, r: Omit<PrepRule, 'id'>) => addDoc(col(hid, 'prepRules'), r)
export const updatePrepRule = (hid: string, id: string, p: Partial<PrepRule>) => updateDoc(ref(hid, 'prepRules', id), p)
export const deletePrepRule = (hid: string, id: string) => deleteDoc(ref(hid, 'prepRules', id))

// Nudges to the partner
export function sendNudge(hid: string, n: Omit<Nudge, 'id' | 'read' | 'createdAt'>) {
  return addDoc(col(hid, 'nudges'), clean({ ...n, read: false, createdAt: now() }))
}
export const markNudgeRead = (hid: string, id: string) => updateDoc(ref(hid, 'nudges', id), { read: true })

// Settings and members
export const updateSettings = (hid: string, p: Partial<Settings>) =>
  setDoc(doc(db, `households/${hid}/settings/main`), clean(p), { merge: true })
export const updateMyName = (hid: string, uid: string, displayName: string) =>
  updateDoc(ref(hid, 'members', uid), { displayName: displayName.trim() })

// Server callables
export const refreshNow = () =>
  httpsCallable<unknown, Record<string, 'ok' | 'failed'>>(functions, 'refreshNow', { timeout: 300_000 })({})
export const undoKidsnoteBatch = (batchId: string) => httpsCallable(functions, 'undoKidsnoteBatch')({ batchId })
export const connectKidsnote = (id: string, password: string) =>
  httpsCallable<{ id: string; password: string }, { children: { id: string; name: string }[] }>(functions, 'connectKidsnote')({ id, password })


// Quick add (one line of text) and newsletter photo/PDF: the server only proposes items, the app writes the kept ones.
export const quickAdd = (text: string) =>
  httpsCallable<{ text: string }, QuickAddResult>(functions, 'quickAdd', { timeout: 120_000 })({ text })
export const extractMenu = (p: { month: string; fileName: string; mimeType: string; dataBase64: string }) =>
  httpsCallable<typeof p, MenuExtractResult>(functions, 'extractMenu', { timeout: 180_000 })(p)
export function saveMonthlyMenu(hid: string, uid: string, month: string, days: MonthlyMenu['days']) {
  return setDoc(ref(hid, 'menus', month), { id: month, month, days, updatedAt: now(), updatedBy: uid } satisfies MonthlyMenu)
}
/** Server fetches the forecast unless it is less than 10 minutes old; no Claude involved. */
export const refreshWeather = () =>
  httpsCallable<void, { status: 'fresh' | 'ok' | 'failed' | 'no-location'; updatedAt: number | null }>(functions, 'refreshWeather', { timeout: 60_000 })()
export const transcribe = (p: { audioBase64: string; sampleRate: number }) =>
  httpsCallable<typeof p, { text: string; heard?: string }>(functions, 'transcribe', { timeout: 60_000 })(p)
export const extractFromFile = (p: { fileName: string; mimeType: string; dataBase64: string }) =>
  httpsCallable<typeof p, QuickAddResult>(functions, 'extractFromFile', { timeout: 180_000 })(p)

export const OWNERS: Owner[] = ['husband', 'wife', 'both']
