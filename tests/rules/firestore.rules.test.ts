import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { joinHousehold, NotAllowedError } from '../../functions/src/household'

const PROJECT = 'demo-saltteul'
let env: RulesTestEnvironment

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
  })
})
afterAll(async () => env?.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'households/home'), { memberUids: ['h', 'w'], allowedEmails: ['h@x', 'w@x'] })
    await setDoc(doc(db, 'households/home/todos/t1'), { title: 'x' })
    await setDoc(doc(db, 'households/home/briefings/b1'), { headline: 'x' })
    await setDoc(doc(db, 'households/home/secrets/kidsnote'), { token: 'x' })
    await setDoc(doc(db, 'users/h'), { hid: 'home' })
  })
})

describe('household data', () => {
  it('members can read and write todos', async () => {
    const db = env.authenticatedContext('h').firestore()
    await assertSucceeds(getDoc(doc(db, 'households/home/todos/t1')))
    await assertSucceeds(setDoc(doc(db, 'households/home/todos/t2'), { title: 'y' }))
  })
  it('other accounts are denied', async () => {
    const db = env.authenticatedContext('stranger').firestore()
    await assertFails(getDoc(doc(db, 'households/home/todos/t1')))
    await assertFails(setDoc(doc(db, 'households/home/todos/t2'), { title: 'y' }))
    await assertFails(getDoc(doc(db, 'households/home')))
  })
  it('signed-out users are denied', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'households/home/todos/t1')))
  })
  it('members cannot change membership', async () => {
    const db = env.authenticatedContext('h').firestore()
    await assertFails(updateDoc(doc(db, 'households/home'), { memberUids: ['h', 'w', 'x'] }))
    await assertFails(updateDoc(doc(db, 'households/home'), { allowedEmails: ['x@x'] }))
  })
  it('server-written collections are read-only and secrets are hidden', async () => {
    const db = env.authenticatedContext('h').firestore()
    await assertSucceeds(getDoc(doc(db, 'households/home/briefings/b1')))
    await assertFails(setDoc(doc(db, 'households/home/briefings/b2'), { headline: 'fake' }))
    await assertFails(getDoc(doc(db, 'households/home/secrets/kidsnote')))
    await assertFails(setDoc(doc(db, 'households/home/integrations/claude'), { x: 1 }))
  })
  it('users/{uid} is readable only by its owner and never writable', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('h').firestore(), 'users/h')))
    await assertFails(getDoc(doc(env.authenticatedContext('w').firestore(), 'users/h')))
    await assertFails(setDoc(doc(env.authenticatedContext('h').firestore(), 'users/h'), { hid: 'other' }))
  })
})

describe('joinHousehold', () => {
  const cfg = { husbandEmail: 'dad@example.com', wifeEmail: 'mom@example.com' }
  const admin = () => {
    if (!getApps().length) initializeApp({ projectId: PROJECT })
    return getFirestore()
  }

  it('creates the household for the first member and adds the second', async () => {
    await env.clearFirestore()
    const db = admin()
    expect(await joinHousehold(db, { uid: 'u1', email: 'Dad@Example.com', displayName: 'D' }, cfg)).toEqual({ hid: 'home', role: 'husband' })
    expect(await joinHousehold(db, { uid: 'u2', email: 'mom@example.com', displayName: 'M' }, cfg)).toEqual({ hid: 'home', role: 'wife' })
    await joinHousehold(db, { uid: 'u1', email: 'dad@example.com', displayName: 'D' }, cfg)
    const h = await db.doc('households/home').get()
    expect(h.get('memberUids')).toEqual(['u1', 'u2'])
    expect((await db.doc('households/home/settings/main').get()).get('briefingTimes')).toEqual({ morning: '07:30', evening: '20:00' })
  })

  it('rejects other emails', async () => {
    await expect(joinHousehold(admin(), { uid: 'x', email: 'x@example.com', displayName: 'X' }, cfg)).rejects.toBeInstanceOf(NotAllowedError)
  })
})
