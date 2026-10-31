import { describe, expect, it } from 'vitest'
import { makeT } from '../../../shared/copy'
import type { PantryItem } from '../../../shared/types'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeMessaging } from '../testing/fakeMessaging'
import { handlePantryWrite } from './pantryLow'

const H = 'households/home'
const t = makeT({
  'push.pantryLow.title': '{name} low',
  'push.pantryLow.body': '{who} used, {qty} left',
  'push.pantryLow.bodyNoName': '{qty} left',
})

const wipes = (o: Partial<PantryItem>): PantryItem => ({
  id: 'p1', name: 'Wipes', unit: 'pack', qty: 5, minQty: 2, restockQty: 10, updatedAt: 1, updatedBy: 'uH', ...o,
})

function setup() {
  const db = new FakeFirestore()
  db.put(`${H}/members/uH`, { uid: 'uH', displayName: 'Minu', role: 'husband', email: 'h@x' })
  db.put(`${H}/members/uW`, { uid: 'uW', displayName: 'Jieun', role: 'wife', email: 'w@x' })
  db.put(`${H}/devices/a`, { uid: 'uH', platform: 'android', token: 'tH' })
  db.put(`${H}/devices/w`, { uid: 'uW', platform: 'web', token: 'tW' })
  const messaging = new FakeMessaging()
  return { db, messaging, deps: { db: db.asAdmin, messaging, t } }
}

describe('pantry low alert', () => {
  it('tells the other member once when the count drops to the minimum', async () => {
    const { db, messaging, deps } = setup()
    db.put(`${H}/pantry/p1`, wipes({ qty: 2 }))
    expect(await handlePantryWrite(deps, 'p1', wipes({ qty: 3 }), wipes({ qty: 2 }), 99)).toBe('sent')
    expect(messaging.tokens()).toEqual(['tW'])
    expect(messaging.sent[0]).toMatchObject({ notification: { title: 'Wipes low', body: 'Minu used, 2pack left' }, data: { type: 'pantry-low', pantryId: 'p1' } })
    expect(db.read(`${H}/pantry/p1`)?.lowNotifiedAt).toBe(99)

    // Further use while low, or the trigger fired by its own update, stays quiet.
    expect(await handlePantryWrite(deps, 'p1', wipes({ qty: 2, lowNotifiedAt: 99 }), wipes({ qty: 1, lowNotifiedAt: 99 }))).toBe('none')
    expect(messaging.sent).toHaveLength(1)
  })

  it('clears the mark once restocked, so the next drop alerts again', async () => {
    const { db, deps } = setup()
    db.put(`${H}/pantry/p1`, wipes({ qty: 12, lowNotifiedAt: 99 }))
    expect(await handlePantryWrite(deps, 'p1', wipes({ qty: 2, lowNotifiedAt: 99 }), wipes({ qty: 12, lowNotifiedAt: 99 }))).toBe('cleared')
    expect(db.read(`${H}/pantry/p1`)?.lowNotifiedAt).toBeNull()
  })

  it('stays quiet for a new item that starts low and for deletes', async () => {
    const { messaging, deps } = setup()
    expect(await handlePantryWrite(deps, 'p1', null, wipes({ qty: 0 }))).toBe('none')
    expect(await handlePantryWrite(deps, 'p1', wipes({}), null)).toBe('none')
    expect(messaging.sent).toHaveLength(0)
  })

  it('tells both members when nobody is recorded as the one who changed it (e.g. a server write)', async () => {
    const { db, messaging, deps } = setup()
    db.put(`${H}/pantry/p1`, wipes({ qty: 1, updatedBy: null }))
    expect(await handlePantryWrite(deps, 'p1', wipes({ qty: 4, updatedBy: null }), wipes({ qty: 1, updatedBy: null }))).toBe('sent')
    expect(messaging.tokens().sort()).toEqual(['tH', 'tW'])
    expect(messaging.sent[0].notification?.body).toBe('1pack left')
  })
})
