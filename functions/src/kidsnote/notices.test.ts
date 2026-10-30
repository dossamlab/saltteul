import { describe, expect, it } from 'vitest'
import { makeT } from '../../../shared/copy'
import { FakeClaude } from '../claude/client'
import type { KidsnoteExtraction } from '../claude/schemas'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeMessaging } from '../testing/fakeMessaging'
import { FakeKidsnote } from './client'
import { KIDSNOTE_SECRET_PATH } from './connect'
import { runJournal } from './journal'
import { pollKidsnote } from './poll'
import { undoKidsnoteBatch } from './undo'

const W = '2026-10-28'
const NOW = new Date('2026-10-28T03:00:00Z') // 12:00 KST Wednesday
const H = 'households/home'

const t = makeT({
  'kidsnote.eventPrefix': '[KN]',
  'kidsnote.dateCheckTitle': 'Check date: {title} ({dateText})',
  'kidsnote.prepTodoTitle': 'Pack for {title}: {items}',
  'kidsnote.deadlineTitle': 'Due: {title}',
  'push.kidsnote.title': 'Report',
  'push.kidsnoteNotice.title': 'Notice',
  'push.kidsnote.body': '{events} events, {items} items',
  'push.kidsnote.bodyWithCheck': '{events} events, {items} items, {checks} to check',
})

const picnic: KidsnoteExtraction = {
  events: [{
    title: 'Farm picnic', kind: 'field_trip', dateText: '', isoDate: '2026-11-06', time: '09:30',
    prepItems: [{ name: 'Lunch box', source: 'stated', needsPurchase: false }],
  }],
  deadlines: [],
  notes: [],
}

function fakes(children: object[] = [{ id: 'c1', name: 'kid', centerId: '501' }]) {
  const db = new FakeFirestore()
  db.put(H, { memberUids: ['uH', 'uW'] })
  db.put(`${H}/members/uH`, { uid: 'uH', displayName: 'H', role: 'husband', email: 'h@x' })
  db.put(`${H}/devices/a`, { uid: 'uH', platform: 'android', token: 'a' })
  db.put(KIDSNOTE_SECRET_PATH, {
    tokens: { accessToken: 'acc', refreshToken: null, expiresAt: null }, children, childId: 'c1', connectedAt: 1, connectedBy: 'uH',
  })
  const kidsnote = new FakeKidsnote()
  kidsnote.notices = [{ id: 'n1', written: W, createdAt: '2026-10-28T00:30:00.000Z', text: 'Farm picnic helpers\nPlease join', url: 'https://www.kidsnote.com/notice/n1' }]
  const claude = new FakeClaude(undefined, picnic)
  const messaging = new FakeMessaging()
  return { db, kidsnote, claude, messaging, deps: { db: db.asAdmin, kidsnote, claude, messaging, t } }
}

describe('center notices', () => {
  it('imports a notice as its own undoable batch with the notice push title', async () => {
    const { db, kidsnote, claude, messaging, deps } = fakes()
    expect(await pollKidsnote(deps, NOW)).toEqual({ status: 'ok', processed: 1, batches: ['kn-notice-n1'] })
    expect(kidsnote.noticeCalls).toEqual(['501'])
    expect(claude.extractCalls[0].text).toBe('Farm picnic helpers\nPlease join')
    expect(db.read(`${H}/kidsnote/notice-n1`)).toMatchObject({ kind: 'notice', reportId: 'n1', batchId: 'kn-notice-n1' })
    expect(db.list(`${H}/todos`).every((x) => x.kidsnoteBatchId === 'kn-notice-n1')).toBe(true)
    expect(messaging.sent[0]).toMatchObject({ notification: { title: 'Notice' }, data: { batchId: 'kn-notice-n1', source: 'notice' } })
    expect(db.read(KIDSNOTE_SECRET_PATH)).toMatchObject({ lastPolledAt: NOW.toISOString(), noticesPolledAt: NOW.toISOString() })

    expect(await pollKidsnote(deps, new Date(NOW.getTime() + 3600_000))).toMatchObject({ processed: 0 })
    expect(claude.extractCalls).toHaveLength(1)
    const made = db.list(`${H}/todos`).length
    expect(await undoKidsnoteBatch(db.asAdmin, 'kn-notice-n1', 5)).toMatchObject({ todos: made })
  })

  it('adds an event once when a report and a notice both mention it', async () => {
    const { db, kidsnote, messaging, deps } = fakes()
    kidsnote.reports = [{ id: 'r1', written: W, createdAt: '2026-10-28T01:00:00.000Z', text: 'Picnic next week', url: null }]
    const r = await pollKidsnote(deps, NOW)
    expect(r.processed).toBe(2)
    expect(r.batches).toEqual(['kn-r1'])
    expect(db.list(`${H}/todos`).filter((x) => /Farm picnic/.test(x.title) && !/Pack/.test(x.title))).toHaveLength(1)
    expect(db.read(`${H}/kidsnote/notice-n1`)?.todoIds).toEqual([])
    expect(messaging.sent).toHaveLength(1)
  })

  it('still imports reports when notices cannot be read, and retries the notices next time', async () => {
    const { db, kidsnote, deps } = fakes()
    kidsnote.reports = [{ id: 'r1', written: W, createdAt: '2026-10-28T01:00:00.000Z', text: 'Picnic next week', url: null }]
    kidsnote.noticesFailWith = new Error('kidsnote HTTP 500')
    expect(await pollKidsnote(deps, NOW)).toMatchObject({ status: 'ok', processed: 1, batches: ['kn-r1'] })
    expect(db.read(KIDSNOTE_SECRET_PATH)?.lastPolledAt).toBe(NOW.toISOString())
    expect(db.read(KIDSNOTE_SECRET_PATH)?.noticesPolledAt).toBeUndefined()
    expect(db.read(`${H}/integrations/kidsnote`)).toMatchObject({ consecutiveFailures: 0 })

    kidsnote.noticesFailWith = null
    expect(await pollKidsnote(deps, new Date(NOW.getTime() + 3600_000))).toMatchObject({ processed: 1 })
    expect(db.read(`${H}/kidsnote/notice-n1`)).toBeDefined()
  })

  it('looks the center id up for older connections and saves it', async () => {
    const { db, kidsnote, deps } = fakes([{ id: 'c1', name: 'kid' }])
    kidsnote.children = [{ id: 'c1', name: 'kid', centerId: '777' }]
    await pollKidsnote(deps, NOW)
    expect(kidsnote.noticeCalls).toEqual(['777'])
    expect(db.read(KIDSNOTE_SECRET_PATH)?.children).toEqual([{ id: 'c1', name: 'kid', centerId: '777' }])
  })

  it('skips notices when the center id cannot be found', async () => {
    const { kidsnote, deps, db } = fakes([{ id: 'c1', name: 'kid' }])
    expect(await pollKidsnote(deps, NOW)).toMatchObject({ processed: 0 })
    expect(kidsnote.noticeCalls).toEqual([])
    expect(db.read(KIDSNOTE_SECRET_PATH)?.noticesPolledAt).toBeUndefined()
  })

  it('tells Claude the child\'s class on record, saves the class list, and skips notices posted to another class', async () => {
    const { db, kidsnote, claude, deps } = fakes()
    kidsnote.classInfo = { classes: [{ id: '11', name: 'Sun' }, { id: '12', name: 'Moon' }, { id: '13', name: 'Star' }], childClassId: '12' }
    kidsnote.notices.push({ id: 'n2', written: W, createdAt: '2026-10-28T00:40:00.000Z', text: 'Sun class trip', url: null, classId: '11' })
    expect(await pollKidsnote(deps, NOW)).toMatchObject({ processed: 2, batches: ['kn-notice-n1'] })
    expect(claude.extractCalls).toHaveLength(1)
    expect(claude.extractCalls[0].audience).toEqual({ myClass: 'Moon', otherClasses: ['Sun', 'Star'] })
    expect(db.read(`${H}/kidsnote/notice-n2`)).toMatchObject({ skipped: 'otherClass', classId: '11', todoIds: [] })
    expect(db.read(`${H}/integrations/kidsnote`)).toMatchObject({ classes: kidsnote.classInfo.classes, detectedClassId: '12' })
  })

  it('uses the class chosen in settings over the one on record', async () => {
    const { db, kidsnote, claude, deps } = fakes()
    db.put(`${H}/settings/main`, { familyName: '', kidsnoteClassId: '11' })
    kidsnote.classInfo = { classes: [{ id: '11', name: 'Sun' }, { id: '12', name: 'Moon' }], childClassId: '12' }
    kidsnote.notices.push({ id: 'n2', written: W, createdAt: '2026-10-28T00:40:00.000Z', text: 'Sun class trip', url: null, classId: '11' })
    await pollKidsnote(deps, NOW)
    expect(claude.extractCalls.map((c) => c.audience?.myClass)).toEqual(['Sun', 'Sun'])
  })

  it('reads notices without a class filter when the class list cannot be read', async () => {
    const { kidsnote, claude, deps } = fakes()
    kidsnote.classInfo = new Error('kidsnote HTTP 500')
    expect(await pollKidsnote(deps, NOW)).toMatchObject({ processed: 1 })
    expect(claude.extractCalls[0].audience).toBeUndefined()
  })

  it('reads the class list once after connecting even without new notices', async () => {
    const { db, kidsnote, deps } = fakes()
    kidsnote.notices = []
    kidsnote.classInfo = { classes: [{ id: '12', name: 'Moon' }], childClassId: '12' }
    expect(await pollKidsnote(deps, NOW)).toMatchObject({ processed: 0 })
    expect(db.read(`${H}/integrations/kidsnote`)).toMatchObject({ classes: [{ id: '12', name: 'Moon' }], detectedClassId: '12' })
  })

  it('stops after the list when nothing is new', async () => {
    const { db, kidsnote, claude, deps } = fakes()
    kidsnote.classInfo = { classes: [{ id: '12', name: 'Moon' }], childClassId: '12' }
    await pollKidsnote(deps, NOW)
    let classReads = 0
    kidsnote.getClassInfo = async () => (classReads++, { classes: [], childClassId: null })
    const later = new Date(NOW.getTime() + 3 * 3600_000)
    expect(await pollKidsnote(deps, later)).toEqual({ status: 'ok', processed: 0, batches: [] })
    expect(classReads).toBe(0)
    expect(claude.extractCalls).toHaveLength(1)
    expect(db.read(KIDSNOTE_SECRET_PATH)).toMatchObject({ lastPolledAt: later.toISOString(), noticesPolledAt: later.toISOString() })
  })

  it('leaves notices out of the growth journal', async () => {
    const { db, claude, deps } = fakes()
    db.put(`${H}/kidsnote/r1`, { kind: 'report', reportId: 'r1', written: W, text: 'Played with sand' })
    db.put(`${H}/kidsnote/notice-n1`, { kind: 'notice', reportId: 'n1', written: W, text: 'Farm picnic helpers' })
    claude.journalReply = { title: 'Week', lines: ['sand'] }
    expect((await runJournal({ db: deps.db, kidsnote: deps.kidsnote, claude }, NOW)).status).toBe('written')
    expect(claude.journalCalls[0].reports).toEqual([{ written: W, text: 'Played with sand' }])
  })
})
