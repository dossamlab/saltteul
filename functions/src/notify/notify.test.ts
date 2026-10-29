import { describe, expect, it } from 'vitest'
import { makeT } from '../../../shared/copy'
import type { Nudge } from '../../../shared/types'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeMessaging } from '../testing/fakeMessaging'
import { handleNudgeCreated, nudgePayload } from './nudge'
import { buildMessage, sendToMembers } from './send'
import { maybePingWidgets } from './widgetPing'

const t = makeT({
  'push.nudge.title': 'from {name}',
  'push.nudge.bodyTargetMessage': '{title}: {message}',
  'push.nudge.bodyTarget': 'about {title}',
  'push.nudge.bodyMessage': 'msg {message}',
  'push.nudge.bodyEmpty': 'ping',
  'push.nudge.someone': 'someone',
  'owner.wife': 'WIFE',
})

const H = 'households/home'
const nudge = (over: Partial<Nudge> = {}): Nudge => ({
  id: 'n1', from: 'uA', to: 'uB', read: false, createdAt: 1, ...over,
})

function seedDevices(db: FakeFirestore) {
  db.put(`${H}/devices/tA`, { uid: 'uA', platform: 'android', token: 'tA' })
  db.put(`${H}/devices/tB1`, { uid: 'uB', platform: 'web', token: 'tB1' })
  db.put(`${H}/devices/tB2`, { uid: 'uB', platform: 'android', token: 'tB2' })
}

describe('nudgePayload', () => {
  it('uses the sender name and combines target and message', () => {
    const p = nudgePayload(nudge({ targetTitle: 'milk', message: 'please', targetType: 'shopping', targetId: 's1' }), 'Min', t)
    expect(p.title).toBe('from Min')
    expect(p.body).toBe('milk: please')
    expect(p.data).toEqual({ type: 'nudge', nudgeId: 'n1', targetType: 'shopping', targetId: 's1' })
  })
  it('falls back through target-only, message-only and empty bodies', () => {
    expect(nudgePayload(nudge({ targetTitle: 'milk' }), 'x', t).body).toBe('about milk')
    expect(nudgePayload(nudge({ message: ' hi ' }), 'x', t).body).toBe('msg hi')
    expect(nudgePayload(nudge(), 'x', t).body).toBe('ping')
    expect(nudgePayload(nudge(), 'x', t).data?.targetType).toBe('')
  })
})

describe('sendToMembers', () => {
  it('sends only to the given members and deletes tokens FCM rejects', async () => {
    const db = new FakeFirestore()
    seedDevices(db)
    const fcm = new FakeMessaging()
    fcm.invalid.add('tB2')
    const res = await sendToMembers(db.asAdmin, fcm, ['uB'], { title: 'a', body: 'b' })
    expect(fcm.tokens().sort()).toEqual(['tB1', 'tB2'])
    expect(res).toEqual({ sent: 1, failed: 1, removed: 1 })
    expect(db.read(`${H}/devices/tB2`)).toBeUndefined()
    expect(db.read(`${H}/devices/tA`)).toBeDefined()
  })

  it('builds platform specific messages', () => {
    const web = buildMessage({ uid: 'u', platform: 'web', token: 'w' }, { title: 'T', body: 'B', data: { k: 'v' } })
    expect(web).toMatchObject({ token: 'w', notification: { title: 'T', body: 'B' }, data: { k: 'v' }, webpush: { fcmOptions: { link: '/' } } })
    const silent = buildMessage({ uid: 'u', platform: 'android', token: 'a' }, { data: { type: 'widget-refresh' } })
    expect(silent).toEqual({ token: 'a', data: { type: 'widget-refresh' }, android: { priority: 'high' } })
  })
})

describe('handleNudgeCreated', () => {
  it('pushes to the receiver with the sender display name', async () => {
    const db = new FakeFirestore()
    seedDevices(db)
    db.put(`${H}/members/uA`, { uid: 'uA', displayName: 'Minu', role: 'husband', email: 'a@x' })
    const fcm = new FakeMessaging()
    await handleNudgeCreated(db.asAdmin, fcm, nudge({ message: 'call me' }), t)
    expect(fcm.tokens().sort()).toEqual(['tB1', 'tB2'])
    expect(fcm.sent[0]).toMatchObject({ notification: { title: 'from Minu', body: 'msg call me' } })
  })
  it('uses the role label when the sender has no display name', async () => {
    const db = new FakeFirestore()
    seedDevices(db)
    db.put(`${H}/members/uB`, { uid: 'uB', displayName: '', role: 'wife', email: 'b@x' })
    const fcm = new FakeMessaging()
    await handleNudgeCreated(db.asAdmin, fcm, nudge({ from: 'uB', to: 'uA' }), t)
    expect(fcm.sent).toHaveLength(1)
    expect(fcm.sent[0]).toMatchObject({ token: 'tA', notification: { title: 'from WIFE' } })
  })
})

describe('maybePingWidgets', () => {
  it('sends a data-only refresh to android devices, at most once per 5 seconds', async () => {
    const db = new FakeFirestore()
    seedDevices(db)
    const fcm = new FakeMessaging()
    expect(await maybePingWidgets(db.asAdmin, fcm, 10_000)).toBe(true)
    expect(fcm.tokens().sort()).toEqual(['tA', 'tB2'])
    expect(fcm.sent.every((m) => !('notification' in m) && m.data?.type === 'widget-refresh')).toBe(true)

    expect(await maybePingWidgets(db.asAdmin, fcm, 14_999)).toBe(false)
    expect(fcm.sent).toHaveLength(2)
    expect(await maybePingWidgets(db.asAdmin, fcm, 15_000)).toBe(true)
    expect(fcm.sent).toHaveLength(4)
    expect(db.read(`${H}/integrations/widgetPing`)).toEqual({ lastSentAt: 15_000 })
  })
})
