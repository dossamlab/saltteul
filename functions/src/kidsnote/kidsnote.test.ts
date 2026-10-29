import { describe, expect, it } from 'vitest'
import { makeT } from '../../../shared/copy'
import { FakeClaude } from '../claude/client'
import type { KidsnoteExtraction } from '../claude/schemas'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeMessaging } from '../testing/fakeMessaging'
import { mergePrepItems, planKidsnote, resolveEventDate } from './apply'
import { FakeKidsnote, HttpKidsnote, KidsnoteAuthError, parseReport, type KidsnoteTokens } from './client'
import { connectKidsnote, KIDSNOTE_SECRET_PATH } from './connect'
import { pollKidsnote } from './poll'
import { undoKidsnoteBatch } from './undo'

// Korean strings below are notice data that resolveRelativeDate parses, not UI copy.
const NEXT_WED = '다음 주 수요일'
const TOMORROW = '내일'
const NOV_2 = '11월 2일'
const W = '2026-10-28' // a Wednesday
const NOW = new Date('2026-10-28T03:00:00Z') // 12:00 KST
const H = 'households/home'

const t = makeT({
  'kidsnote.eventPrefix': '[KN]',
  'kidsnote.dateCheckTitle': 'Check date: {title} ({dateText})',
  'kidsnote.prepTodoTitle': 'Pack for {title}: {items}',
  'kidsnote.deadlineTitle': 'Due: {title}',
  'push.kidsnote.title': 'Kids Note',
  'push.kidsnote.body': '{events} events, {items} items',
  'push.kidsnote.bodyWithCheck': '{events} events, {items} items, {checks} to check',
  'push.kidsnoteDown.title': 'down',
  'push.kidsnoteDown.body': 'reconnect',
})

const extraction: KidsnoteExtraction = {
  events: [
    {
      title: 'Picnic', kind: 'field_trip', dateText: NEXT_WED, isoDate: '2026-11-20', time: '09:30',
      prepItems: [
        { name: 'Lunch box', source: 'stated', needsPurchase: false },
        { name: 'Raincoat', source: 'inferred', needsPurchase: true },
        { name: 'Mat', source: 'inferred', needsPurchase: false },
      ],
    },
    { title: 'Farm visit', kind: 'event', dateText: 'someday', isoDate: null, time: null, prepItems: [] },
  ],
  deadlines: [{ title: 'Consent form', dateText: NOV_2, isoDate: null }],
  notes: ['Wear name tags'],
}
const rules = [{ id: 'r', keyword: 'Picnic', items: ['Mat', 'Hat'] }]

describe('resolveEventDate', () => {
  it('prefers the server-side relative date, then Claude, within written-7d..+120d', () => {
    expect(resolveEventDate(NEXT_WED, null, W)).toBe('2026-11-04')
    expect(resolveEventDate(TOMORROW, '2026-11-20', W)).toBe('2026-10-29')
    expect(resolveEventDate('later', '2026-11-20', W)).toBe('2026-11-20')
    expect(resolveEventDate('', '2026-10-21', W)).toBe('2026-10-21')
    expect(resolveEventDate('', '2026-10-20', W)).toBeNull()
    expect(resolveEventDate('', '2027-02-26', W)).toBeNull() // 121 days
    expect(resolveEventDate('', '2026-02-30', W)).toBeNull()
    expect(resolveEventDate('', null, W)).toBeNull()
  })
})

describe('mergePrepItems', () => {
  it('keeps rule items first, then stated, then inferred, without duplicate names', () => {
    expect(
      mergePrepItems(['Mat', 'Hat'], [
        { name: 'Hat ', source: 'stated', needsPurchase: false },
        { name: 'Water', source: 'inferred', needsPurchase: false },
        { name: 'Cap', source: 'stated', needsPurchase: false },
        { name: 'mat', source: 'inferred', needsPurchase: false },
      ]),
    ).toEqual([
      { name: 'Mat', source: 'rule' },
      { name: 'Hat', source: 'rule' },
      { name: 'Cap', source: 'stated' },
      { name: 'Water', source: 'inferred' },
    ])
  })
})

describe('planKidsnote', () => {
  const plan = () =>
    planKidsnote({
      extraction, written: W, today: W, rules, existingTodoKeys: new Set(), openShoppingNames: [], batchId: 'b1', now: 5, t,
    })

  it('creates the event, a prep reminder the evening before, a date check, a deadline and shopping', () => {
    const p = plan()
    const [event, reminder, check, deadline] = p.todos
    expect(event).toMatchObject({
      title: '[KN] Picnic', date: '2026-11-04', time: '09:30', source: 'kidsnote', kidsnoteBatchId: 'b1', done: false, owner: 'both',
    })
    expect(event.prepItems).toEqual([
      { name: 'Mat', source: 'rule' },
      { name: 'Hat', source: 'rule' },
      { name: 'Lunch box', source: 'stated' },
      { name: 'Raincoat', source: 'inferred' },
    ])
    expect(reminder).toMatchObject({ title: 'Pack for Picnic: Mat, Hat, Lunch box, Raincoat', date: '2026-11-03', time: '20:00' })
    expect(check).toMatchObject({ title: 'Check date: Farm visit (someday)', date: null, kidsnoteBatchId: 'b1' })
    expect(deadline).toMatchObject({ title: 'Due: Consent form', date: '2026-11-02', time: null })
    expect(p.todos).toHaveLength(4)
    expect(p.shopping).toEqual([expect.objectContaining({ name: 'Raincoat', source: 'kidsnote', kidsnoteBatchId: 'b1', bought: false })])
    expect(p.counts).toEqual({ events: 1, prepItems: 4, shopping: 1, dateChecks: 1, deadlines: 1 })
  })

  it('skips events and shopping items that already exist', () => {
    const p = planKidsnote({
      extraction, written: W, today: W, rules, batchId: 'b2', now: 6, t,
      existingTodoKeys: new Set(['[KN]Picnic|2026-11-04'.toLowerCase()]),
      openShoppingNames: ['raincoat'],
    })
    expect(p.todos.map((x) => x.title)).toEqual(['Check date: Farm visit (someday)', 'Due: Consent form'])
    expect(p.shopping).toEqual([])
  })

  it('puts the reminder tonight for tomorrow, and on the event day when the evening before has passed', () => {
    const p = planKidsnote({
      extraction: { events: [{ ...extraction.events[0], dateText: TOMORROW }], deadlines: [], notes: [] },
      written: W, today: W, rules: [], existingTodoKeys: new Set(), openShoppingNames: [], batchId: 'b', now: 1, t,
    })
    expect(p.todos[0].date).toBe('2026-10-29')
    expect(p.todos[1]).toMatchObject({ date: W, time: '20:00' })
    const late = planKidsnote({
      extraction: { events: [{ ...extraction.events[0], dateText: '', isoDate: W }], deadlines: [], notes: [] },
      written: W, today: W, rules: [], existingTodoKeys: new Set(), openShoppingNames: [], batchId: 'b', now: 1, t,
    })
    expect(late.todos[1]).toMatchObject({ date: W, time: null })
  })
})

function seed(db: FakeFirestore, tokens: KidsnoteTokens = { accessToken: 'acc', refreshToken: 'ref', expiresAt: null }) {
  db.put(H, { memberUids: ['uH', 'uW'] })
  db.put(`${H}/members/uH`, { uid: 'uH', displayName: 'H', role: 'husband', email: 'h@x' })
  db.put(`${H}/members/uW`, { uid: 'uW', displayName: 'W', role: 'wife', email: 'w@x' })
  db.put(`${H}/devices/a`, { uid: 'uH', platform: 'android', token: 'a' })
  db.put(`${H}/devices/w`, { uid: 'uW', platform: 'web', token: 'w' })
  db.put(`${H}/prepRules/r`, { keyword: 'Picnic', items: ['Mat', 'Hat'] })
  db.put(KIDSNOTE_SECRET_PATH, { tokens, children: [{ id: 'c1', name: 'kid' }], childId: 'c1', connectedAt: 1, connectedBy: 'uH' })
}

function fakes() {
  const db = new FakeFirestore()
  seed(db)
  const kidsnote = new FakeKidsnote()
  kidsnote.reports = [{ id: 'r1', written: W, createdAt: '2026-10-28T01:00:00.000Z', text: 'notice', url: null }]
  const claude = new FakeClaude(undefined, extraction)
  const messaging = new FakeMessaging()
  return { db, kidsnote, claude, messaging, deps: { db: db.asAdmin, kidsnote, claude, messaging, t } }
}

describe('pollKidsnote', () => {
  it('imports a new notice once, pushes a summary with undo info, and can be undone', async () => {
    const { db, claude, messaging, deps } = fakes()
    const r = await pollKidsnote(deps, NOW)
    expect(r).toEqual({ status: 'ok', processed: 1, batches: ['kn-r1'] })
    expect(claude.extractCalls[0]).toEqual({ text: 'notice', written: W, ruleKeywords: ['Picnic'] })
    expect(db.list(`${H}/todos`)).toHaveLength(4)
    expect(db.list(`${H}/shopping`)).toHaveLength(1)
    expect(db.list(`${H}/todos`).every((x) => x.kidsnoteBatchId === 'kn-r1')).toBe(true)
    expect(db.read(`${H}/kidsnote/r1`)).toMatchObject({ batchId: 'kn-r1', written: W, undoneAt: null })
    expect(messaging.tokens().sort()).toEqual(['a', 'w'])
    expect(messaging.sent[0]).toMatchObject({
      notification: { title: 'Kids Note', body: '2 events, 4 items, 1 to check' },
      data: { type: 'kidsnote-batch', batchId: 'kn-r1', undo: 'undoKidsnoteBatch' },
    })
    expect(db.read(KIDSNOTE_SECRET_PATH)?.lastPolledAt).toBe(NOW.toISOString())

    // Same notice again: not re-imported, Claude not called.
    expect(await pollKidsnote(deps, new Date(NOW.getTime() + 3600_000))).toMatchObject({ processed: 0 })
    expect(claude.extractCalls).toHaveLength(1)
    expect(db.list(`${H}/todos`)).toHaveLength(4)

    expect(await undoKidsnoteBatch(db.asAdmin, 'kn-r1', 99)).toEqual({ todos: 4, shopping: 1 })
    expect(db.list(`${H}/todos`)).toHaveLength(0)
    expect(db.list(`${H}/shopping`)).toHaveLength(0)
    expect(db.read(`${H}/kidsnote/r1`)?.undoneAt).toBe(99)
    // Undone notices stay processed.
    expect(await pollKidsnote(deps, new Date(NOW.getTime() + 7200_000))).toMatchObject({ processed: 0 })
  })

  it('leaves the notice for the next run when Claude fails', async () => {
    const { db, claude, deps } = fakes()
    claude.extraction = new Error('overloaded')
    expect(await pollKidsnote(deps, NOW)).toEqual({ status: 'ok', processed: 0, batches: [] })
    expect(db.read(`${H}/kidsnote/r1`)).toBeUndefined()
    expect(db.read(KIDSNOTE_SECRET_PATH)?.lastPolledAt).toBeUndefined()
    expect(db.read(`${H}/integrations/claude`)).toMatchObject({ consecutiveFailures: 1 })
    expect(db.read(`${H}/integrations/kidsnote`)).toMatchObject({ consecutiveFailures: 0 })

    claude.extraction = extraction
    expect(await pollKidsnote(deps, NOW)).toMatchObject({ processed: 1 })
  })

  it('alerts the husband once after three failures in a row', async () => {
    const { kidsnote, messaging, deps, db } = fakes()
    kidsnote.failWith = new Error('HTTP 500')
    for (let i = 0; i < 4; i++) expect((await pollKidsnote(deps, NOW)).status).toBe('failed')
    expect(messaging.sent).toHaveLength(1)
    expect(messaging.sent[0]).toMatchObject({ token: 'a', notification: { title: 'down', body: 'reconnect' } })
    expect(db.read(`${H}/integrations/kidsnote`)).toMatchObject({ consecutiveFailures: 4, lastError: 'HTTP 500' })
  })

  it('refreshes the tokens once on an auth error', async () => {
    const { kidsnote, deps, db } = fakes()
    let calls = 0
    const orig = kidsnote.listReports.bind(kidsnote)
    kidsnote.listReports = async (tk, c, s) => {
      if (calls++ === 0) throw new KidsnoteAuthError('401')
      expect(tk.accessToken).toBe('acc+')
      return orig(tk, c, s)
    }
    expect(await pollKidsnote(deps, NOW)).toMatchObject({ status: 'ok', processed: 1 })
    expect(db.read(KIDSNOTE_SECRET_PATH)?.tokens).toMatchObject({ accessToken: 'acc+' })
  })

  it('does nothing until connected', async () => {
    const { db, deps } = fakes()
    await db.doc(KIDSNOTE_SECRET_PATH).delete()
    expect(await pollKidsnote(deps, NOW)).toEqual({ status: 'not-connected', processed: 0, batches: [] })
  })
})

describe('connectKidsnote', () => {
  it('stores tokens and children but never the password', async () => {
    const db = new FakeFirestore()
    const port = new FakeKidsnote()
    const out = await connectKidsnote(db.asAdmin, port, 'uH', { id: 'dad', password: 'pw-SECRET-1' }, 7)
    expect(out).toEqual({ children: [{ id: 'c1', name: 'child' }] })
    expect(db.read(KIDSNOTE_SECRET_PATH)).toMatchObject({ childId: 'c1', connectedBy: 'uH', tokens: { accessToken: 'fake-access' } })
    expect(JSON.stringify([...db.store.docs])).not.toContain('pw-SECRET-1')
    await expect(connectKidsnote(db.asAdmin, port, 'uH', { id: 'dad' })).rejects.toThrow()
  })
})

describe('HttpKidsnote (fake fetch)', () => {
  it('pages through reports with the session cookie and stops at the since date', async () => {
    const urls: string[] = []
    const auth: string[] = []
    const pages: Record<string, unknown> = {
      '': {
        next: 'https://kapi.kidsnote.com/v1_2/children/c1/reports/?page=CUR2',
        results: [{ id: 12, content: 'new', created: '2026-10-28T01:00:00Z', date_written: '2026-10-28' }],
      },
      CUR2: {
        next: 'https://kapi.kidsnote.com/v1_2/children/c1/reports/?page=CUR3',
        results: [
          { id: 11, content: 'mid', created: '2026-10-27T16:00:00Z' },
          { id: 10, content: 'old', created: '2026-10-01T00:00:00Z' },
        ],
      },
    }
    const fetchFn = (async (url: string, init?: RequestInit) => {
      urls.push(url)
      auth.push(String((init?.headers as Record<string, string>)?.Cookie))
      const page = new URL(url).searchParams.get('page') ?? ''
      return new Response(JSON.stringify(pages[page]), { status: 200 })
    }) as typeof fetch
    const k = new HttpKidsnote(fetchFn)
    const reps = await k.listReports({ accessToken: 'sessionid=AT', refreshToken: null, expiresAt: null }, 'c1', '2026-10-20T00:00:00Z')
    expect(reps.map((r) => [r.id, r.written, r.text])).toEqual([
      ['11', '2026-10-28', 'mid'], // 16:00 UTC = 01:00 KST next day
      ['12', '2026-10-28', 'new'],
    ])
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('https://www.kidsnote.com/api/v1_2/children/c1/reports/?page_size=20&tz=Asia%2FSeoul&child=c1')
    expect(auth.every((a) => a === 'sessionid=AT')).toBe(true)
  })

  it('maps 401 to KidsnoteAuthError and parses unknown shapes defensively', async () => {
    const k = new HttpKidsnote((async () => new Response('{}', { status: 401 })) as typeof fetch)
    await expect(k.listReports({ accessToken: 'x', refreshToken: null, expiresAt: null }, 'c1', W)).rejects.toBeInstanceOf(KidsnoteAuthError)
    expect(parseReport({ content: 'no id' }, 'c1')).toBeNull()
  })
})
