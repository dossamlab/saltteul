import { describe, expect, it } from 'vitest'
import { makeT } from '../../../shared/copy'
import { FakeClaude } from '../claude/client'
import type { KidsnoteExtraction, RawQuickItem } from '../claude/schemas'
import { FakeFirestore } from '../testing/fakeFirestore'
import { extractionToQuickItems, parseFileInput, runExtractFromFile } from './fromFile'
import { finalizeQuickAdd, parseQuickText, QuickInputError, runQuickAdd } from './quickAdd'

const H = 'households/home'
const NOW = new Date('2026-10-28T03:00:00Z') // Wednesday 12:00 KST
const TODAY = '2026-10-28'
// Korean strings below are notice data that resolveRelativeDate / the deadline rule read, not UI copy.
const NEXT_WED = '다음 주 수요일'
const NOV_2 = '11월 2일'
const ALREADY_DEADLINE = '참가비 납부 마감'

const t = makeT({ 'kidsnote.deadlineTitle': 'Due: {title}' })

const item = (p: Partial<RawQuickItem>): RawQuickItem => ({
  kind: 'todo', title: 'x', date: null, time: null, owner: null, note: null, qty: null, refId: null, prepItems: [], amount: null, ...p,
})

function seed() {
  const db = new FakeFirestore()
  db.put(H, { memberUids: ['uH', 'uW'] })
  db.put(`${H}/members/uH`, { uid: 'uH', displayName: 'Minu', role: 'husband', email: 'h@x' })
  db.put(`${H}/members/uW`, { uid: 'uW', displayName: 'Jieun', role: 'wife', email: 'w@x' })
  db.put(`${H}/routines/r1`, { title: 'Vitamins', owner: 'both', weekdays: null, order: 1, active: true })
  db.put(`${H}/routines/r2`, { title: 'Saturday only', owner: 'both', weekdays: [6], order: 2, active: true })
  db.put(`${H}/routines/r3`, { title: 'Walk', owner: 'wife', weekdays: [], order: 3, active: true })
  db.put(`${H}/routineLogs/r3_${TODAY}`, { routineId: 'r3', day: TODAY, doneBy: 'uW', doneAt: 1 })
  db.put(`${H}/chores/c1`, { title: 'Bathroom', owner: 'husband', cycleDays: 7, createdDay: '2026-10-01' })
  db.put(`${H}/shopping/s1`, { name: 'Milk', bought: false })
  db.put(`${H}/shopping/s2`, { name: 'Eggs', bought: true })
  db.put(`${H}/prepRules/p1`, { keyword: 'Picnic', items: ['Mat'] })
  return db
}

describe('finalizeQuickAdd', () => {
  const ctx = {
    today: TODAY,
    routines: [{ id: 'r1', title: 'Vitamins', owner: 'both' as const, doneToday: false }, { id: 'r3', title: 'Walk', owner: 'wife' as const, doneToday: true }],
    chores: [{ id: 'c1', title: 'Bathroom', owner: 'husband' as const }],
    pantry: [
      { id: 'p1', name: 'Wet wipes', unit: 'pack', qty: 8, aliases: [], restockQty: 10 },
      { id: 'p2', name: 'Rice bowl', unit: 'ea', qty: 3, aliases: ['instant rice'], restockQty: 12 },
    ],
  }

  it('turns pantry sentences into count changes, chaining changes on one item', () => {
    const out = finalizeQuickAdd({
      items: [
        item({ kind: 'pantryUse', refId: 'p1', title: 'Wet wipes', amount: 3 }),
        item({ kind: 'pantryAdd', refId: 'p1', title: 'Wet wipes', amount: 2 }),
        item({ kind: 'pantrySet', refId: 'p2', title: 'Rice bowl', amount: 5 }),
        item({ kind: 'pantryAdd', refId: 'p2', title: 'Rice bowl', amount: null }),
        item({ kind: 'pantryUse', refId: 'p2', title: 'Rice bowl', amount: null }),
        item({ kind: 'pantryUse', refId: 'p1', title: 'Wet wipes', amount: 50 }),
        item({ kind: 'pantrySet', refId: null, title: 'Diapers', amount: 20 }),
        item({ kind: 'pantryUse', refId: null, title: 'Tissue', amount: 2 }),
        item({ kind: 'pantrySet', refId: 'p1', title: 'Wet wipes', amount: null }),
      ],
      unparsed: [],
    }, ctx)
    expect(out.items).toEqual([
      { kind: 'pantry', pantryId: 'p1', name: 'Wet wipes', unit: 'pack', op: 'use', amount: 3, before: 8, after: 5 },
      { kind: 'pantry', pantryId: 'p1', name: 'Wet wipes', unit: 'pack', op: 'add', amount: 2, before: 5, after: 7 },
      { kind: 'pantry', pantryId: 'p2', name: 'Rice bowl', unit: 'ea', op: 'set', amount: 5, before: 3, after: 5 },
      { kind: 'pantry', pantryId: 'p2', name: 'Rice bowl', unit: 'ea', op: 'add', amount: 12, before: 5, after: 17 },
      { kind: 'pantry', pantryId: 'p2', name: 'Rice bowl', unit: 'ea', op: 'use', amount: 1, before: 17, after: 16 },
      { kind: 'pantry', pantryId: 'p1', name: 'Wet wipes', unit: 'pack', op: 'use', amount: 50, before: 7, after: 0 },
      { kind: 'pantryNew', name: 'Diapers', unit: '개', qty: 20 },
    ])
    expect(out.unparsed).toEqual(['Tissue 2', 'Wet wipes'])
  })

  it('keeps valid fields, clears bad ones and drops unknown or finished routines and chores', () => {
    const out = finalizeQuickAdd({
      items: [
        item({ title: 'Dentist', date: '2026-10-29', time: '15:00', owner: 'wife', note: 'bring card', prepItems: ['Card', 'card'] }),
        item({ title: 'Yesterday', date: '2026-10-27' }),
        item({ title: 'Too old', date: '2026-10-26', time: '25:00', owner: 'boss' }),
        item({ title: 'Next year', date: '2027-10-28' }),
        item({ title: 'Too far', date: '2027-10-29' }),
        item({ title: 'Bad date', date: '2026-02-30' }),
        item({ title: '' }),
        item({ kind: 'shopping', title: 'Bread', qty: '2', owner: 'wife' }),
        item({ kind: 'shopping', title: 'bread ' }),
        item({ kind: 'routineDone', refId: 'r1', title: 'whatever' }),
        item({ kind: 'routineDone', refId: 'r3' }),
        item({ kind: 'routineDone', refId: 'nope' }),
        item({ kind: 'choreDone', refId: 'c1' }),
        item({ kind: 'choreDone', refId: 'c1' }),
      ],
      unparsed: ['what is this'],
    }, ctx)
    expect(out.items).toEqual([
      { kind: 'todo', title: 'Dentist', date: '2026-10-29', time: '15:00', owner: 'wife', note: 'bring card', prepItems: [{ name: 'Card', source: 'stated' }] },
      { kind: 'todo', title: 'Yesterday', date: '2026-10-27', time: null, owner: 'both', note: null },
      { kind: 'todo', title: 'Too old', date: null, time: null, owner: 'both', note: null },
      { kind: 'todo', title: 'Next year', date: '2027-10-28', time: null, owner: 'both', note: null },
      { kind: 'todo', title: 'Too far', date: null, time: null, owner: 'both', note: null },
      { kind: 'todo', title: 'Bad date', date: null, time: null, owner: 'both', note: null },
      { kind: 'shopping', name: 'Bread', qty: '2', note: null },
      { kind: 'routineDone', routineId: 'r1', title: 'Vitamins' },
      { kind: 'choreDone', choreId: 'c1', title: 'Bathroom' },
    ])
    expect(out.unparsed).toEqual(['what is this'])
  })

  it('returns at most 20 items', () => {
    const items = Array.from({ length: 30 }, (_, i) => item({ title: `t${i}` }))
    expect(finalizeQuickAdd({ items, unparsed: [] }, ctx).items).toHaveLength(20)
  })
})

describe('runQuickAdd', () => {
  it('gives Claude the household context and returns the checked proposal without writing', async () => {
    const db = seed()
    const before = JSON.stringify([...db.store.docs])
    const claude = new FakeClaude()
    claude.quickAddReply = (input) => ({
      items: [item({ title: 'Pediatrician', date: input.today, time: '15:00' }), item({ kind: 'routineDone', refId: 'r1' })],
      unparsed: [],
    })
    const out = await runQuickAdd({ db: db.asAdmin, claude }, 'uW', { text: '  call the pediatrician at 3  ' }, NOW)
    expect(out).toEqual({
      items: [
        { kind: 'todo', title: 'Pediatrician', date: TODAY, time: '15:00', owner: 'both', note: null },
        { kind: 'routineDone', routineId: 'r1', title: 'Vitamins' },
      ],
      unparsed: [],
      model: 'fake',
    })
    expect(claude.quickAddCalls[0]).toEqual({
      today: TODAY,
      weekday: 3,
      nowTime: '12:00',
      speaker: { role: 'wife', name: 'Jieun' },
      names: { husband: 'Minu', wife: 'Jieun' },
      routines: [
        { id: 'r1', title: 'Vitamins', owner: 'both', doneToday: false },
        { id: 'r3', title: 'Walk', owner: 'wife', doneToday: true },
      ],
      chores: [{ id: 'c1', title: 'Bathroom', owner: 'husband' }],
      openShopping: ['Milk'],
      pantry: [],
      text: 'call the pediatrician at 3',
    })
    expect(JSON.stringify([...db.store.docs])).toBe(before)
  })

  it('rejects empty or too long text before calling Claude', async () => {
    expect(() => parseQuickText({ text: '   ' })).toThrow(QuickInputError)
    expect(() => parseQuickText({ text: 'a'.repeat(501) })).toThrow(QuickInputError)
    expect(() => parseQuickText(null)).toThrow(QuickInputError)
    expect(parseQuickText({ text: 'a'.repeat(500) })).toHaveLength(500)
    const claude = new FakeClaude()
    await expect(runQuickAdd({ db: seed().asAdmin, claude }, 'uW', { text: '' }, NOW)).rejects.toBeInstanceOf(QuickInputError)
    expect(claude.quickAddCalls).toHaveLength(0)
  })
})

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PDF_HEAD = [...Buffer.from('%PDF-1.7\n')]
const b64 = (head: number[], size: number) => {
  const buf = Buffer.alloc(size)
  Buffer.from(head).copy(buf)
  return buf.toString('base64')
}

describe('parseFileInput', () => {
  it('accepts an image or PDF and trusts the file bytes over the declared type', () => {
    const png = parseFileInput({ fileName: 'letter.jpg', mimeType: 'image/jpeg', dataBase64: `data:image/jpeg;base64,${b64(PNG_HEAD, 1000)}` })
    expect(png).toMatchObject({ fileName: 'letter.jpg', mediaType: 'image/png', bytes: 1000 })
    expect(parseFileInput({ fileName: 'a.pdf', mimeType: 'application/pdf', dataBase64: b64(PDF_HEAD, 5 * 1024 * 1024) })).toMatchObject({
      mediaType: 'application/pdf', bytes: 5 * 1024 * 1024,
    })
  })

  it('rejects other types, broken base64, unknown bytes and oversized files', () => {
    const bad = (d: unknown) => expect(() => parseFileInput(d)).toThrow(QuickInputError)
    bad({ fileName: 'a.heic', mimeType: 'image/heic', dataBase64: b64(PNG_HEAD, 10) })
    bad({ fileName: 'a.png', mimeType: 'image/png', dataBase64: 'not base64!' })
    bad({ fileName: 'a.png', mimeType: 'image/png', dataBase64: b64([1, 2, 3, 4], 100) })
    bad({ fileName: 'a.pdf', mimeType: 'application/pdf', dataBase64: b64(PDF_HEAD, 8 * 1024 * 1024 + 1) })
    bad({ fileName: 'a.png', mimeType: 'image/png', dataBase64: b64(PNG_HEAD, 4 * 1024 * 1024) })
  })
})

const extraction: KidsnoteExtraction = {
  events: [
    {
      title: 'Picnic', kind: 'field_trip', dateText: NEXT_WED, isoDate: null, time: '09:30',
      prepItems: [
        { name: 'Lunch box', source: 'stated', needsPurchase: false },
        { name: 'Raincoat', source: 'inferred', needsPurchase: true },
      ],
    },
    { title: 'Farm visit', kind: 'event', dateText: 'someday', isoDate: null, time: '10:00', prepItems: [] },
    { title: 'Past show', kind: 'event', dateText: '', isoDate: '2026-10-25', time: null, prepItems: [] },
  ],
  deadlines: [
    { title: 'Consent form', dateText: NOV_2, isoDate: null },
    { title: ALREADY_DEADLINE, dateText: '', isoDate: '2026-11-05' },
  ],
  notes: ['Wear name tags'],
}

describe('extractionToQuickItems', () => {
  it('turns events, deadlines and items to buy into proposals and drops past dates', () => {
    const out = extractionToQuickItems({ extraction, today: TODAY, rules: [{ id: 'p', keyword: 'Picnic', items: ['Mat'] }], openShoppingNames: [], t })
    expect(out.items).toEqual([
      {
        kind: 'todo', title: 'Picnic', date: '2026-11-04', time: '09:30', owner: 'both', note: null,
        prepItems: [{ name: 'Mat', source: 'rule' }, { name: 'Lunch box', source: 'stated' }, { name: 'Raincoat', source: 'inferred' }],
      },
      { kind: 'shopping', name: 'Raincoat', qty: null, note: 'Picnic' },
      { kind: 'todo', title: 'Farm visit', date: null, time: null, owner: 'both', note: 'someday' },
      { kind: 'todo', title: 'Due: Consent form', date: '2026-11-02', time: null, owner: 'both', note: null },
      { kind: 'todo', title: ALREADY_DEADLINE, date: '2026-11-05', time: null, owner: 'both', note: null },
    ])
    expect(out.unparsed).toEqual(['Wear name tags'])
  })

  it('skips items already on the shopping list', () => {
    const out = extractionToQuickItems({ extraction, today: TODAY, rules: [], openShoppingNames: ['raincoat'], t })
    expect(out.items.filter((i) => i.kind === 'shopping')).toEqual([])
  })
})

describe('runExtractFromFile', () => {
  it('reads the file with the kids note prompt (written = today) and writes nothing', async () => {
    const db = seed()
    const before = JSON.stringify([...db.store.docs])
    const claude = new FakeClaude(undefined, extraction)
    const out = await runExtractFromFile(
      { db: db.asAdmin, claude, t },
      { fileName: 'newsletter.pdf', mimeType: 'application/pdf', dataBase64: b64(PDF_HEAD, 2000) },
      NOW,
    )
    expect(claude.extractCalls[0]).toMatchObject({ text: '', written: TODAY, ruleKeywords: ['Picnic'] })
    expect(claude.extractCalls[0].attachments).toEqual([{ mediaType: 'application/pdf', dataBase64: b64(PDF_HEAD, 2000), name: 'newsletter.pdf' }])
    expect(out.model).toBe('fake')
    expect(out.items[0]).toMatchObject({ kind: 'todo', title: 'Picnic', date: '2026-11-04' })
    expect(out.items[0].kind === 'todo' && out.items[0].prepItems?.[0]).toEqual({ name: 'Mat', source: 'rule' })
    expect(JSON.stringify([...db.store.docs])).toBe(before)
  })
})
