import { describe, expect, it } from 'vitest'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeCalendar, type CalEvent } from './client'
import { decidePull, DONE_PREFIX, eventToFields, ownerFromColor, todoToEvent, type TodoDoc } from './mapping'
import { pullCalendar } from './pull'
import { pushTodoChange } from './push'

const H = 'households/home'
const NOW = new Date('2026-10-28T03:00:00Z') // 12:00 KST

const todo = (over: Partial<TodoDoc> = {}): TodoDoc => ({
  id: 't1', title: 'Dentist', owner: 'both', done: false, source: 'manual', updatedAt: 1000, date: '2026-10-30', time: null, ...over,
})

function setup(calendarId: string | null = 'cal@group') {
  const db = new FakeFirestore()
  db.put(`${H}/settings/main`, { calendarId })
  return { db, cal: new FakeCalendar() }
}

describe('todoToEvent / eventToFields', () => {
  it('maps undated todos to nothing, all-day and timed todos to KST events', () => {
    expect(todoToEvent(todo({ date: null }))).toBeNull()
    expect(todoToEvent(todo())).toEqual({
      summary: 'Dentist', description: null, start: { date: '2026-10-30' }, end: { date: '2026-10-31' }, colorId: '7', saltteulId: 't1',
    })
    const timed = todoToEvent(todo({ time: '23:30', done: true, note: 'bring card' }))!
    expect(timed.summary).toBe(`${DONE_PREFIX}Dentist`)
    expect(timed.description).toBe('bring card')
    expect(timed.start).toEqual({ dateTime: '2026-10-30T23:30:00', timeZone: 'Asia/Seoul' })
    expect(timed.end).toEqual({ dateTime: '2026-10-31T00:30:00', timeZone: 'Asia/Seoul' })
  })

  it('reads all-day events as date only and timed events in KST', () => {
    expect(eventToFields({ id: 'e', status: 'confirmed', summary: 'Trip', start: { date: '2026-11-02' } })).toEqual({
      title: 'Trip', date: '2026-11-02', time: null, done: false, note: null, endDate: null, endTime: null,
    })
    // 23:30 UTC on the 1st is 08:30 KST on the 2nd
    expect(
      eventToFields({ id: 'e', status: 'confirmed', summary: `${DONE_PREFIX}Call`, start: { dateTime: '2026-11-01T23:30:00Z' } }),
    ).toEqual({ title: 'Call', date: '2026-11-02', time: '08:30', done: true, note: null, endDate: null, endTime: null })
    expect(eventToFields({ id: 'e', status: 'cancelled', start: { date: '2026-11-02' } })).toBeNull()
  })
})

describe('ranges and owner colours', () => {
  const end = (over: Partial<TodoDoc>) => todoToEvent(todo(over))!.end
  it('ends a multi-day all-day event the day after the last day (Google end is exclusive)', () => {
    expect(todoToEvent(todo({ date: '2026-11-18', endDate: '2026-11-20' }))).toMatchObject({
      start: { date: '2026-11-18' }, end: { date: '2026-11-21' },
    })
    // An end day that is not after the start is ignored.
    expect(end({ date: '2026-11-18', endDate: '2026-11-17' })).toEqual({ date: '2026-11-19' })
  })

  it('ends a timed event at endTime on endDate ?? date, else 60 minutes after the start on the last day', () => {
    const at = (date: string, time: string) => ({ dateTime: `${date}T${time}:00`, timeZone: 'Asia/Seoul' })
    expect(end({ time: '15:00', endTime: '17:00' })).toEqual(at('2026-10-30', '17:00'))
    expect(end({ time: '22:00', endDate: '2026-10-31', endTime: '02:00' })).toEqual(at('2026-10-31', '02:00'))
    expect(end({ time: '09:00', endDate: '2026-11-01' })).toEqual(at('2026-11-01', '10:00'))
    expect(end({ time: '15:00' })).toEqual(at('2026-10-30', '16:00'))
    expect(end({ time: '15:00', endTime: '14:00' })).toEqual(at('2026-10-30', '16:00'))
  })

  it('colours events by owner and reads the owner back from the colour', () => {
    expect(['wife', 'husband', 'both'].map((owner) => todoToEvent(todo({ owner: owner as TodoDoc['owner'] }))!.colorId)).toEqual(['6', '2', '7'])
    expect(['6', '2', '7', '11', null, undefined].map(ownerFromColor)).toEqual(['wife', 'husband', 'both', 'both', 'both', 'both'])
  })

  it('reads end days and times back, treating the default 60 minutes as no end time', () => {
    const read = (start: CalEvent['start'], endAt: CalEvent['end']) => {
      const f = eventToFields({ id: 'e', status: 'confirmed', summary: 'x', start, end: endAt })!
      return [f.date, f.time, f.endDate, f.endTime]
    }
    const kst = (s: string) => ({ dateTime: `${s}:00+09:00` })
    expect(read({ date: '2026-11-18' }, { date: '2026-11-21' })).toEqual(['2026-11-18', null, '2026-11-20', null])
    expect(read({ date: '2026-11-18' }, { date: '2026-11-19' })).toEqual(['2026-11-18', null, null, null])
    expect(read(kst('2026-11-18T15:00'), kst('2026-11-18T17:00'))).toEqual(['2026-11-18', '15:00', null, '17:00'])
    expect(read(kst('2026-11-18T15:00'), kst('2026-11-18T16:00'))).toEqual(['2026-11-18', '15:00', null, null])
    expect(read(kst('2026-11-18T23:30'), kst('2026-11-19T00:30'))).toEqual(['2026-11-18', '23:30', null, null])
    expect(read(kst('2026-11-18T09:00'), kst('2026-11-20T10:00'))).toEqual(['2026-11-18', '09:00', '2026-11-20', null])
    expect(read(kst('2026-11-18T22:00'), kst('2026-11-19T02:00'))).toEqual(['2026-11-18', '22:00', '2026-11-19', '02:00'])
    expect(read(kst('2026-11-18T15:00'), null)).toEqual(['2026-11-18', '15:00', null, null])
  })
})

describe('decidePull (last write wins)', () => {
  const ev = (over: Partial<CalEvent> = {}): CalEvent => ({
    id: 'e1', status: 'confirmed', summary: 'Dentist', start: { date: '2026-10-31' }, updated: new Date(5000).toISOString(), ...over,
  })
  it('creates todos for new events, but not for orphans or far-away dates', () => {
    expect(decidePull(ev(), null, '2026-10-28').kind).toBe('create')
    expect(decidePull(ev({ saltteulId: 'gone' }), null, '2026-10-28')).toEqual({ kind: 'skip', reason: 'orphan' })
    expect(decidePull(ev({ start: { date: '2025-01-01' } }), null, '2026-10-28')).toEqual({ kind: 'skip', reason: 'out-of-window' })
  })
  it('updates only when the event is newer and actually different', () => {
    expect(decidePull(ev(), todo({ updatedAt: 1000 }), '2026-10-28')).toMatchObject({ kind: 'update', todoId: 't1', updatedAt: 5000 })
    expect(decidePull(ev(), todo({ updatedAt: 9000 }), '2026-10-28')).toEqual({ kind: 'skip', reason: 'app-newer' })
    expect(decidePull(ev({ start: { date: '2026-10-30' } }), todo(), '2026-10-28')).toEqual({ kind: 'skip', reason: 'unchanged' })
  })
  it('deletes the linked todo when the event is cancelled', () => {
    expect(decidePull(ev({ status: 'cancelled' }), todo(), '2026-10-28')).toEqual({ kind: 'delete', todoId: 't1' })
    expect(decidePull(ev({ status: 'cancelled' }), null, '2026-10-28').kind).toBe('skip')
  })
})

describe('pushTodoChange', () => {
  it('does nothing without a calendar id', async () => {
    const { db, cal } = setup(null)
    expect(await pushTodoChange(db.asAdmin, cal, 't1', null, todo())).toBe('no-calendar')
    expect(cal.calls).toEqual([])
  })

  it('inserts, stores the event id, ignores its own write-back, patches done, deletes on date removal', async () => {
    const { db, cal } = setup()
    db.put(`${H}/todos/t1`, todo())
    expect(await pushTodoChange(db.asAdmin, cal, 't1', null, todo())).toBe('inserted')
    const linked = db.read(`${H}/todos/t1`) as TodoDoc
    expect(linked.calendarEventId).toBe('ev1')
    expect(cal.events.get('ev1')).toMatchObject({ summary: 'Dentist', saltteulId: 't1', start: { date: '2026-10-30' } })

    // The write-back of calendarEventId re-triggers the function: nothing to send.
    expect(await pushTodoChange(db.asAdmin, cal, 't1', todo(), linked)).toBe('skipped')

    const done = { ...linked, done: true, updatedAt: 2000 }
    expect(await pushTodoChange(db.asAdmin, cal, 't1', linked, done)).toBe('patched')
    expect(cal.events.get('ev1')?.summary).toBe(`${DONE_PREFIX}Dentist`)

    const undated = { ...done, date: null, updatedAt: 3000 }
    db.put(`${H}/todos/t1`, undated)
    expect(await pushTodoChange(db.asAdmin, cal, 't1', done, undated)).toBe('removed')
    expect(cal.events.get('ev1')?.status).toBe('cancelled')
    expect(db.read(`${H}/todos/t1`)?.calendarEventId).toBeNull()
  })

  it('removes the event when the todo is deleted and skips writes that came from the pull', async () => {
    const { db, cal } = setup()
    const pulled = todo({ calendarEventId: 'ev9', syncOrigin: 'calendar', updatedAt: 7000, calendarUpdated: 7000 })
    expect(await pushTodoChange(db.asAdmin, cal, 't1', null, pulled)).toBe('skipped')
    // Edited in the app afterwards (UI bumps updatedAt even if it leaves syncOrigin alone): pushed.
    cal.external({ id: 'ev9', status: 'confirmed', summary: 'x', start: { date: '2026-10-30' } })
    expect(await pushTodoChange(db.asAdmin, cal, 't1', pulled, { ...pulled, title: 'New', updatedAt: 8000 })).toBe('patched')
    expect(await pushTodoChange(db.asAdmin, cal, 't1', pulled, null)).toBe('removed')
    expect(cal.calls).toContain('remove:ev9')
  })

  it('re-creates the event when it was deleted on the calendar side', async () => {
    const { db, cal } = setup()
    const before = todo({ calendarEventId: 'missing' })
    const t = { ...before, title: 'Dentist 3pm', updatedAt: 2000 }
    db.put(`${H}/todos/t1`, t)
    expect(await pushTodoChange(db.asAdmin, cal, 't1', before, t)).toBe('inserted')
    expect(cal.calls).toEqual(['insert:ev1'])
    expect(db.read(`${H}/todos/t1`)?.calendarEventId).toBe('ev1')
  })
})

describe('pullCalendar', () => {
  it('creates, updates and deletes todos incrementally and keeps the sync token', async () => {
    const { db, cal } = setup()
    cal.external({ id: 'g1', status: 'confirmed', summary: 'Parents meeting', start: { dateTime: '2026-11-03T09:00:00+09:00' } })
    cal.external({ id: 'g2', status: 'confirmed', summary: 'Holiday', start: { date: '2026-11-05' } })

    const first = await pullCalendar(db.asAdmin, cal, NOW)
    expect(first).toMatchObject({ created: 2, fullSync: true })
    const todos = db.list(`${H}/todos`)
    const meeting = todos.find((x) => x.calendarEventId === 'g1')!
    expect(meeting).toMatchObject({
      title: 'Parents meeting', date: '2026-11-03', time: '09:00', source: 'calendar', syncOrigin: 'calendar', owner: 'both',
    })
    expect(meeting.calendarUpdated).toBe(meeting.updatedAt)
    expect(db.read(`${H}/integrations/calendar`)).toMatchObject({ syncToken: 'tok1', syncCalendarId: 'cal@group' })

    // Calendar edit is newer than the todo → todo follows.
    cal.external({ id: 'g1', status: 'confirmed', summary: 'Parents meeting', start: { dateTime: '2026-11-03T10:00:00+09:00' } })
    // Event cancelled → linked todo deleted.
    cal.external({ id: 'g2', status: 'cancelled', summary: 'Holiday', start: { date: '2026-11-05' } })
    const second = await pullCalendar(db.asAdmin, cal, NOW)
    expect(second).toMatchObject({ updated: 1, deleted: 1, fullSync: false })
    expect(cal.calls).toContain('list:tok1')
    expect(db.read(`${H}/todos/${meeting._id}`)).toMatchObject({ time: '10:00' })
    expect(db.list(`${H}/todos`)).toHaveLength(1)
  })

  it('keeps the app version when the todo was edited after the event', async () => {
    const { db, cal } = setup()
    const ev = cal.external({ id: 'g1', status: 'confirmed', summary: 'Old', start: { date: '2026-11-03' } })
    db.put(`${H}/todos/t1`, todo({ title: 'New', date: '2026-11-03', calendarEventId: 'g1', updatedAt: Date.parse(ev.updated!) + 1 }))
    const sum = await pullCalendar(db.asAdmin, cal, NOW)
    expect(sum).toMatchObject({ updated: 0, skipped: 1 })
    expect(db.read(`${H}/todos/t1`)?.title).toBe('New')
  })

  it('falls back to a full sync when the token expired', async () => {
    const { db, cal } = setup()
    db.put(`${H}/integrations/calendar`, { syncToken: 'old', syncCalendarId: 'cal@group' })
    cal.expireNextToken = true
    cal.external({ id: 'g1', status: 'confirmed', summary: 'A', start: { date: '2026-11-03' } })
    const sum = await pullCalendar(db.asAdmin, cal, NOW)
    expect(sum).toMatchObject({ created: 1, fullSync: true })
    expect(cal.calls).toEqual(['list:old', 'list:full'])
  })

  it('sets the owner from the colour on new todos only, and reads the end day', async () => {
    const { db, cal } = setup()
    cal.external({ id: 'g1', status: 'confirmed', summary: 'Trip', colorId: '2', start: { date: '2026-11-03' }, end: { date: '2026-11-06' } })
    cal.external({
      id: 'g2', status: 'confirmed', summary: 'Yoga', colorId: '6',
      start: { dateTime: '2026-11-04T10:00:00+09:00' }, end: { dateTime: '2026-11-04T11:30:00+09:00' },
    })
    cal.external({ id: 'g3', status: 'confirmed', summary: 'Plain', start: { date: '2026-11-04' }, end: { date: '2026-11-05' } })
    await pullCalendar(db.asAdmin, cal, NOW)
    const by = (id: string) => db.list(`${H}/todos`).find((x) => x.calendarEventId === id)!
    expect(by('g1')).toMatchObject({ owner: 'husband', date: '2026-11-03', endDate: '2026-11-05', endTime: null })
    expect(by('g2')).toMatchObject({ owner: 'wife', time: '10:00', endDate: null, endTime: '11:30' })
    expect(by('g3')).toMatchObject({ owner: 'both', endDate: null })

    // Edited on the calendar (new colour, one day shorter): the end follows, the owner set in the app stays.
    const { _id, ...g1 } = by('g1')
    db.put(`${H}/todos/${_id}`, { ...g1, owner: 'both' })
    cal.external({ id: 'g1', status: 'confirmed', summary: 'Trip', colorId: '6', start: { date: '2026-11-03' }, end: { date: '2026-11-05' } })
    expect(await pullCalendar(db.asAdmin, cal, NOW)).toMatchObject({ updated: 1 })
    expect(by('g1')).toMatchObject({ owner: 'both', endDate: '2026-11-04' })
  })

  it('round trip: a multi-day timed todo comes back from the calendar unchanged', async () => {
    const { db, cal } = setup()
    const trip = todo({ owner: 'wife', time: '09:00', endDate: '2026-11-01' })
    db.put(`${H}/todos/t1`, trip)
    await pushTodoChange(db.asAdmin, cal, 't1', null, trip)
    expect(cal.events.get('ev1')).toMatchObject({ colorId: '6', end: { dateTime: '2026-11-01T10:00:00' } })
    expect(await pullCalendar(db.asAdmin, cal, NOW)).toMatchObject({ created: 0, updated: 0 })
    expect(db.read(`${H}/todos/t1`)).toMatchObject({ endDate: '2026-11-01', owner: 'wife' })
  })

  it('round trip: an app todo pushed to the calendar is not duplicated by the next pull', async () => {
    const { db, cal } = setup()
    db.put(`${H}/todos/t1`, todo())
    await pushTodoChange(db.asAdmin, cal, 't1', null, todo())
    const sum = await pullCalendar(db.asAdmin, cal, NOW)
    expect(sum).toMatchObject({ created: 0, updated: 0 })
    expect(db.list(`${H}/todos`)).toHaveLength(1)
  })
})
