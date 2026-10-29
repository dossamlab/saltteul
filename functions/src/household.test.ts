import { describe, expect, it } from 'vitest'
import { joinHousehold, NotAllowedError } from './household'
import { FakeFirestore } from './testing/fakeFirestore'

const cfg = { husbandEmail: 'h@x', wifeEmail: 'w@x' }
const H = 'households/home'

describe('joinHousehold', () => {
  it('registers a new member with the Google account name', async () => {
    const db = new FakeFirestore()
    expect(await joinHousehold(db.asAdmin, { uid: 'uH', email: 'H@x', displayName: 'Google Name' }, cfg)).toEqual({ hid: 'home', role: 'husband' })
    expect(db.read(`${H}/members/uH`)).toEqual({ uid: 'uH', email: 'H@x', displayName: 'Google Name', role: 'husband' })
    expect(db.read(H)?.memberUids).toEqual(['uH'])
  })

  it('keeps a name the member changed in settings when the app opens again', async () => {
    const db = new FakeFirestore()
    await joinHousehold(db.asAdmin, { uid: 'uH', email: 'h@x', displayName: 'Google Name' }, cfg)
    db.put(`${H}/members/uH`, { ...db.read(`${H}/members/uH`), displayName: 'Minu' })
    await joinHousehold(db.asAdmin, { uid: 'uH', email: 'h@x', displayName: 'Google Name' }, cfg)
    expect(db.read(`${H}/members/uH`)?.displayName).toBe('Minu')
  })

  it('fills an empty name from the Google account', async () => {
    const db = new FakeFirestore()
    await joinHousehold(db.asAdmin, { uid: 'uW', email: 'w@x', displayName: '' }, cfg)
    await joinHousehold(db.asAdmin, { uid: 'uW', email: 'w@x', displayName: 'Jieun' }, cfg)
    expect(db.read(`${H}/members/uW`)?.displayName).toBe('Jieun')
  })

  it('rejects other accounts', async () => {
    const db = new FakeFirestore()
    await expect(joinHousehold(db.asAdmin, { uid: 'x', email: 'other@x', displayName: '' }, cfg)).rejects.toBeInstanceOf(NotAllowedError)
  })
})
