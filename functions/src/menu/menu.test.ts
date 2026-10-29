import { describe, expect, it } from 'vitest'
import { FakeClaude } from '../claude/client'
import { QuickInputError } from '../quickadd/quickAdd'
import { FakeFirestore } from '../testing/fakeFirestore'
import { finalizeMenu, parseMonth, readDayMenu, readMenusAround, runExtractMenu } from './menu'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')

describe('monthly menu', () => {
  it('checks the month', () => {
    expect(parseMonth('2026-11')).toBe('2026-11')
    for (const bad of ['2026-13', '2026-1', '', null, 202611]) expect(() => parseMonth(bad)).toThrow(QuickInputError)
  })

  it('keeps days of the month only, merges repeats and drops empty days', () => {
    const days = finalizeMenu({
      days: [
        { date: '2026-11-03', lunch: ['rice', 'soup'], morningSnack: [], afternoonSnack: ['milk'] },
        { date: '2026-11-02', lunch: ['noodles'], morningSnack: ['banana'], afternoonSnack: [] },
        { date: '2026-11-03', lunch: ['soup', 'kimchi'], morningSnack: [], afternoonSnack: [] },
        { date: '2026-10-31', lunch: ['x'], morningSnack: [], afternoonSnack: [] },
        { date: '2026-11-31', lunch: ['x'], morningSnack: [], afternoonSnack: [] },
        { date: '11월 4일', lunch: ['x'], morningSnack: [], afternoonSnack: [] },
        { date: '2026-11-07', lunch: [], morningSnack: [], afternoonSnack: [] },
      ],
    }, '2026-11')
    expect(days).toEqual([
      { date: '2026-11-02', lunch: ['noodles'], morningSnack: ['banana'], afternoonSnack: [] },
      { date: '2026-11-03', lunch: ['rice', 'soup', 'kimchi'], morningSnack: [], afternoonSnack: ['milk'] },
    ])
  })

  it('sends the sheet and the month to Claude', async () => {
    const claude = new FakeClaude()
    claude.menuReply = { days: [{ date: '2026-11-02', lunch: ['rice'], morningSnack: [], afternoonSnack: [] }] }
    const out = await runExtractMenu({ claude }, { month: '2026-11', fileName: 'menu.png', mimeType: 'image/png', dataBase64: PNG })
    expect(out).toEqual({ month: '2026-11', days: [{ date: '2026-11-02', lunch: ['rice'], morningSnack: [], afternoonSnack: [] }], model: 'fake' })
    expect(claude.menuCalls[0]).toMatchObject({ month: '2026-11', file: { mediaType: 'image/png', name: 'menu.png' } })
    await expect(runExtractMenu({ claude }, { month: 'x', mimeType: 'image/png', dataBase64: PNG })).rejects.toBeInstanceOf(QuickInputError)
  })

  it('reads one day for the dinner prompt', async () => {
    const db = new FakeFirestore()
    db.put('households/home/menus/2026-11', {
      id: '2026-11', month: '2026-11', updatedAt: 1, updatedBy: 'u',
      days: {
        '2026-11-02': { lunch: ['rice', 'pork'], morningSnack: ['banana'], afternoonSnack: ['milk'] },
        '2026-11-03': { lunch: [], morningSnack: [], afternoonSnack: [] },
      },
    })
    expect(await readDayMenu(db.asAdmin, '2026-11-02')).toEqual({ lunch: ['rice', 'pork'], snack: ['banana', 'milk'] })
    expect(await readDayMenu(db.asAdmin, '2026-11-03')).toBeNull()
    expect(await readDayMenu(db.asAdmin, '2026-11-04')).toBeNull()
    expect(await readDayMenu(db.asAdmin, '2026-12-01')).toBeNull()
  })

  it('reads the days around a day across a month boundary, skipping today and empty days', async () => {
    const db = new FakeFirestore()
    const sheet = (month: string, days: object) => db.put(`households/home/menus/${month}`, { id: month, month, updatedAt: 1, updatedBy: 'u', days })
    sheet('2026-10', {
      '2026-10-29': { lunch: ['fish'], morningSnack: [], afternoonSnack: [] },
      '2026-10-30': { lunch: ['tofu'], morningSnack: ['pear'], afternoonSnack: [] },
    })
    sheet('2026-11', {
      '2026-11-02': { lunch: ['rice', 'pork'], morningSnack: [], afternoonSnack: ['milk'] },
      '2026-11-03': { lunch: ['egg'], morningSnack: [], afternoonSnack: [] },
      '2026-11-04': { lunch: [], morningSnack: [], afternoonSnack: [] },
      '2026-11-06': { lunch: ['too far'], morningSnack: [], afternoonSnack: [] },
    })
    // Monday 2026-11-02: four days back reaches Thursday 10-29, three ahead reaches Thursday 11-05.
    expect(await readMenusAround(db.asAdmin, '2026-11-02')).toEqual([
      { day: '2026-10-29', weekday: 4, lunch: ['fish'], snack: [] },
      { day: '2026-10-30', weekday: 5, lunch: ['tofu'], snack: ['pear'] },
      { day: '2026-11-03', weekday: 2, lunch: ['egg'], snack: [] },
    ])
    expect(await readMenusAround(db.asAdmin, '2027-03-02')).toEqual([])
  })
})
