import { describe, expect, it } from 'vitest'
import { makeT } from '../../../shared/copy'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeMessaging } from '../testing/fakeMessaging'
import { FakeClaude } from './client'
import { buildWeeklyInput, runWeeklyPreview } from './weekly'
import { loadSnapshot } from '../snapshot'

const H = 'households/home'
// Sunday 2026-11-01 20:00 KST
const SUNDAY_EVENING = new Date('2026-11-01T11:00:00Z')

const t = makeT({
  'push.briefing.titleWeekly': 'Weekly',
  'brief.fb.headlineWeekly': 'Next week',
  'brief.fb.weekDay': '{weekday}: {count} - {titles}',
  'brief.fb.weekChore': '{title} on {weekday}',
  'brief.fb.annivSoon': '{title} in {days}',
  'brief.fb.consumable': '{name} {days}d',
  'brief.fb.weekEmpty': 'Quiet week',
  'weekday.1': 'Mon',
  'weekday.2': 'Tue',
})

function seed(db: FakeFirestore) {
  db.put(H, { memberUids: ['uH', 'uW'] })
  db.put(`${H}/members/uH`, { uid: 'uH', displayName: 'Minu', role: 'husband', email: 'h@x' })
  db.put(`${H}/members/uW`, { uid: 'uW', displayName: 'Jieun', role: 'wife', email: 'w@x' })
  db.put(`${H}/devices/a`, { uid: 'uH', platform: 'android', token: 'a' })
  db.put(`${H}/devices/w`, { uid: 'uW', platform: 'web', token: 'w' })
  db.put(`${H}/settings/main`, {
    familyName: '',
    briefingTimes: { morning: '07:30', evening: '20:00' },
    weather: { updatedAt: 1, days: [{ day: '2026-11-02', minC: 3, maxC: 12, popMax: 70, sky: 'rain' }] },
  })
  db.put(`${H}/todos/t1`, {
    title: 'Picnic', date: '2026-11-03', time: '09:00', owner: 'both', done: false, source: 'kidsnote', updatedAt: 1,
    prepItems: [{ name: 'Lunch box', source: 'stated' }],
  })
  db.put(`${H}/todos/t2`, { title: 'Dentist', date: '2026-11-03', time: null, owner: 'wife', done: false, source: 'manual', updatedAt: 1 })
  db.put(`${H}/todos/t3`, { title: 'Done already', date: '2026-11-05', owner: 'both', done: true, source: 'manual', updatedAt: 1 })
  db.put(`${H}/todos/t4`, { title: 'Later', date: '2026-11-10', owner: 'both', done: false, source: 'manual', updatedAt: 1 })
  db.put(`${H}/todos/t5`, { title: 'Someday', date: null, owner: 'both', done: false, source: 'manual', updatedAt: 1 })
}

function seedExtras(db: FakeFirestore) {
  db.put(`${H}/chores/c1`, { title: 'Sheets', owner: 'wife', cycleDays: 7, lastDone: '2026-10-26', createdDay: '2026-10-01' })
  db.put(`${H}/chores/c2`, { title: 'Bathroom', owner: 'husband', cycleDays: 3, lastDone: '2026-10-20', createdDay: '2026-10-01' })
  db.put(`${H}/chores/c3`, { title: 'Fridge', owner: 'both', cycleDays: 30, lastDone: '2026-10-20', createdDay: '2026-10-01' })
  db.put(`${H}/anniversaries/a1`, { kind: 'birthday', title: 'Mom birthday', date: '1960-11-04' })
  db.put(`${H}/anniversaries/a2`, { kind: 'wedding', title: 'Wedding', date: '2019-12-25' })
  db.put(`${H}/anniversaries/a3`, { kind: 'together', title: 'Together', date: '2015-11-03' })
  db.put(`${H}/consumables/k1`, { name: 'Diapers', initialCycleDays: 30, purchases: ['2026-10-05'] })
}

describe('buildWeeklyInput', () => {
  it('collects the coming Monday..Sunday', async () => {
    const db = new FakeFirestore()
    seed(db)
    seedExtras(db)
    const input = buildWeeklyInput(await loadSnapshot(db.asAdmin, SUNDAY_EVENING), SUNDAY_EVENING)
    expect(input).toMatchObject({ from: '2026-11-02', to: '2026-11-08', names: { husband: 'Minu', wife: 'Jieun', both: '' }, undatedOpenCount: 1 })
    expect(input.days.map((d) => [d.day, d.weekday, d.todos.map((x) => x.title)])).toEqual([
      ['2026-11-02', 1, []],
      ['2026-11-03', 2, ['Picnic', 'Dentist']],
      ['2026-11-04', 3, []],
      ['2026-11-05', 4, []],
      ['2026-11-06', 5, []],
      ['2026-11-07', 6, []],
      ['2026-11-08', 0, []],
    ])
    expect(input.days[0].weather).toMatchObject({ popMax: 70 })
    expect(input.days[1].todos[0]).toEqual({
      title: 'Picnic', time: '09:00', owner: 'both', fromKidsnote: true, prepItems: [{ name: 'Lunch box', source: 'stated' }],
    })
    expect(input.chores).toEqual([
      { title: 'Sheets', owner: 'wife', dates: ['2026-11-02'], overdueDays: 0 },
      { title: 'Bathroom', owner: 'husband', dates: ['2026-11-02', '2026-11-05', '2026-11-08'], overdueDays: 9 },
    ])
    expect(input.anniversaries.map((a) => [a.title, a.daysLeft])).toEqual([['Mom birthday', 3]])
    expect(input.consumablesDue).toEqual([{ name: 'Diapers', daysLeft: 3 }])
  })
})

describe('runWeeklyPreview', () => {
  it('stores the Claude preview as the weekly briefing and pushes it', async () => {
    const db = new FakeFirestore()
    seed(db)
    const fcm = new FakeMessaging()
    const claude = new FakeClaude()
    claude.weeklyReply = { headline: 'A busy Tuesday', lines: ['Tue picnic'] }
    const b = await runWeeklyPreview({ db: db.asAdmin, messaging: fcm, claude, t }, SUNDAY_EVENING)
    expect(b).toMatchObject({ id: '2026-11-01_weekly', day: '2026-11-01', slot: 'weekly', model: 'fake', failed: false })
    expect(db.read(`${H}/briefings/2026-11-01_weekly`)).toMatchObject({ headline: 'A busy Tuesday', lines: ['Tue picnic'] })
    expect(claude.weeklyCalls[0].from).toBe('2026-11-02')
    expect(fcm.tokens().sort()).toEqual(['a', 'w'])
    expect(fcm.sent[0]).toMatchObject({
      notification: { title: 'Weekly', body: 'A busy Tuesday' },
      data: { type: 'briefing', briefingId: '2026-11-01_weekly' },
    })
  })

  it('falls back to copy-key lines when Claude fails', async () => {
    const db = new FakeFirestore()
    seed(db)
    seedExtras(db)
    const claude = new FakeClaude()
    claude.weeklyReply = new Error('529 overloaded')
    const b = await runWeeklyPreview({ db: db.asAdmin, messaging: new FakeMessaging(), claude, t }, SUNDAY_EVENING)
    expect(b).toMatchObject({ model: null, failed: true, headline: 'Next week' })
    expect(b.lines).toEqual([
      'Tue: 2 - Picnic, Dentist',
      'Mom birthday in 3',
      'Sheets on Mon',
      'Bathroom on Mon',
      'Diapers 3d',
    ])
    expect(db.read(`${H}/integrations/claude`)).toMatchObject({ consecutiveFailures: 1 })
  })

  it('skips Claude for an empty week', async () => {
    const db = new FakeFirestore()
    seed(db)
    for (const id of ['t1', 't2']) await db.doc(`${H}/todos/${id}`).delete()
    const claude = new FakeClaude()
    const b = await runWeeklyPreview({ db: db.asAdmin, messaging: new FakeMessaging(), claude, t }, SUNDAY_EVENING)
    expect(claude.weeklyCalls).toHaveLength(0)
    expect(b).toMatchObject({ headline: 'Next week', lines: ['Quiet week'], model: null, failed: false })
  })
})
