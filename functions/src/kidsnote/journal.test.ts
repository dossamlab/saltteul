import { describe, expect, it } from 'vitest'
import { FakeClaude } from '../claude/client'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeKidsnote } from './client'
import { KIDSNOTE_SECRET_PATH } from './connect'
import { runJournal, weekStartOf } from './journal'

const H = 'households/home'
// Sunday 2026-11-01 20:00 KST → week 2026-10-26 (Mon) .. 2026-11-01 (Sun)
const SUNDAY_EVENING = new Date('2026-11-01T11:00:00Z')

function setup() {
  const db = new FakeFirestore()
  db.put(KIDSNOTE_SECRET_PATH, {
    tokens: { accessToken: 'acc', refreshToken: null, expiresAt: null },
    children: [{ id: 'c1', name: 'Haneul' }, { id: 'c2', name: 'Other' }],
    childId: 'c1', connectedAt: 1, connectedBy: 'uH',
  })
  const kidsnote = new FakeKidsnote()
  const claude = new FakeClaude()
  claude.journalReply = { title: 'A week of leaves', lines: ['l1', 'l2', 'l3', 'l4', 'l5'] }
  return { db, kidsnote, claude, deps: { db: db.asAdmin, kidsnote, claude } }
}

describe('weekStartOf', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26') // Sunday
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26') // Monday
    expect(weekStartOf('2026-10-28')).toBe('2026-10-26')
  })
})

describe('runJournal', () => {
  it('writes the journal from this week\'s stored notices, in date order', async () => {
    const { db, claude, deps } = setup()
    db.put(`${H}/kidsnote/r2`, { reportId: 'r2', written: '2026-10-29', text: 'Painted leaves' })
    db.put(`${H}/kidsnote/r1`, { reportId: 'r1', written: '2026-10-26', text: 'Ate all lunch' })
    db.put(`${H}/kidsnote/r0`, { reportId: 'r0', written: '2026-10-25', text: 'Last week' })
    db.put(`${H}/kidsnote/r3`, { reportId: 'r3', written: '2026-10-30', text: '  ' })
    const out = await runJournal(deps, SUNDAY_EVENING)
    expect(out.status).toBe('written')
    expect(claude.journalCalls[0]).toEqual({
      childName: 'Haneul', weekStart: '2026-10-26', weekEnd: '2026-11-01',
      reports: [{ written: '2026-10-26', text: 'Ate all lunch' }, { written: '2026-10-29', text: 'Painted leaves' }],
    })
    expect(db.read(`${H}/journal/2026-10-26`)).toEqual({
      id: '2026-10-26', weekStart: '2026-10-26', weekEnd: '2026-11-01', childName: 'Haneul', title: 'A week of leaves',
      lines: ['l1', 'l2', 'l3', 'l4', 'l5'], reportCount: 2, createdAt: SUNDAY_EVENING.getTime(), model: 'fake',
    })
    // Runs once per week.
    expect((await runJournal(deps, SUNDAY_EVENING)).status).toBe('exists')
    expect(claude.journalCalls).toHaveLength(1)
  })

  it('refetches the week with the stored session when older docs have no text, and saves the text', async () => {
    const { db, kidsnote, claude, deps } = setup()
    db.put(`${H}/kidsnote/r1`, { reportId: 'r1', written: '2026-10-27' }) // processed before texts were stored
    kidsnote.reports = [
      { id: 'r1', written: '2026-10-27', createdAt: '2026-10-27T01:00:00.000Z', text: 'Sang a song', url: null },
      { id: 'r9', written: '2026-10-31', createdAt: '2026-10-31T01:00:00.000Z', text: 'Saturday trip', url: null },
    ]
    const out = await runJournal(deps, SUNDAY_EVENING)
    expect(out.status).toBe('written')
    expect(claude.journalCalls[0].reports).toEqual([
      { written: '2026-10-27', text: 'Sang a song' },
      { written: '2026-10-31', text: 'Saturday trip' },
    ])
    expect(db.read(`${H}/kidsnote/r1`)).toMatchObject({ text: 'Sang a song', written: '2026-10-27' })
  })

  it('skips the week when there are no notices with text', async () => {
    const { db, kidsnote, claude, deps } = setup()
    expect((await runJournal(deps, SUNDAY_EVENING)).status).toBe('no-reports')
    db.put(`${H}/kidsnote/r1`, { reportId: 'r1', written: '2026-10-27' })
    kidsnote.failWith = new Error('HTTP 500')
    expect((await runJournal(deps, SUNDAY_EVENING)).status).toBe('no-reports')
    expect(claude.journalCalls).toHaveLength(0)
    expect(db.read(`${H}/journal/2026-10-26`)).toBeUndefined()
  })

  it('records a Claude failure and writes nothing', async () => {
    const { db, claude, deps } = setup()
    db.put(`${H}/kidsnote/r1`, { reportId: 'r1', written: '2026-10-27', text: 'x' })
    claude.journalReply = new Error('overloaded')
    expect((await runJournal(deps, SUNDAY_EVENING)).status).toBe('failed')
    expect(db.read(`${H}/journal/2026-10-26`)).toBeUndefined()
    expect(db.read(`${H}/integrations/claude`)).toMatchObject({ consecutiveFailures: 1 })
  })
})
