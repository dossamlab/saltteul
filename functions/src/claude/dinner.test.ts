import { describe, expect, it } from 'vitest'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeClaude } from './client'
import { runDinner } from './dinner'

const H = 'households/home'
// Wednesday 2026-10-28 15:00 KST
const WED_15 = new Date('2026-10-28T06:00:00Z')
const DAY = '2026-10-28'

function setup() {
  const db = new FakeFirestore()
  db.put(`${H}/menus/2026-10`, {
    id: '2026-10', month: '2026-10', updatedAt: 1, updatedBy: 'uH',
    days: {
      '2026-10-27': { lunch: ['beef soup'], morningSnack: [], afternoonSnack: [] },
      [DAY]: { lunch: ['rice', 'pork stir-fry'], morningSnack: ['banana'], afternoonSnack: ['milk'] },
      '2026-10-29': { lunch: ['mackerel'], morningSnack: [], afternoonSnack: ['yogurt'] },
    },
  })
  const claude = new FakeClaude()
  claude.dinnerReply = {
    options: [
      { name: 'Fish stew', why: 'lunch was pork', ingredients: ['cod', 'radish'] },
      { name: 'Tofu', why: 'light', ingredients: ['tofu'] },
      { name: 'Egg rice', why: 'quick', ingredients: ['egg'] },
    ],
  }
  return { db, claude, deps: { db: db.asAdmin, claude } }
}

describe('runDinner', () => {
  it('reads the uploaded menu, avoids recent dishes and stores three options', async () => {
    const { db, claude, deps } = setup()
    db.put(`${H}/dinner/2026-10-27`, { id: '2026-10-27', options: [{ name: 'Bulgogi' }, { name: 'Soup' }] })
    db.put(`${H}/dinner/2026-10-24`, { id: '2026-10-24', options: [{ name: 'Too old' }] })
    const out = await runDinner(deps, WED_15)
    expect(out.status).toBe('written')
    const menu = { lunch: ['rice', 'pork stir-fry'], snack: ['banana', 'milk'] }
    expect(claude.dinnerCalls[0]).toEqual({
      day: DAY, weekday: 3, daycareMenu: menu, recent: ['Bulgogi', 'Soup'],
      nearbyMenus: [
        { day: '2026-10-27', weekday: 2, lunch: ['beef soup'], snack: [] },
        { day: '2026-10-29', weekday: 4, lunch: ['mackerel'], snack: ['yogurt'] },
      ],
    })
    expect(db.read(`${H}/dinner/${DAY}`)).toEqual({
      id: DAY, day: DAY, daycareMenu: menu,
      options: [
        { name: 'Fish stew', why: 'lunch was pork', ingredients: ['cod', 'radish'] },
        { name: 'Tofu', why: 'light', ingredients: ['tofu'] },
        { name: 'Egg rice', why: 'quick', ingredients: ['egg'] },
      ],
      createdAt: WED_15.getTime(), model: 'fake',
    })
    expect((await runDinner(deps, WED_15)).status).toBe('exists')
    expect(claude.dinnerCalls).toHaveLength(1)
  })

  it('still suggests dinner when no menu sheet covers the day', async () => {
    const { db, claude, deps } = setup()
    await db.doc(`${H}/menus/2026-10`).delete()
    expect((await runDinner(deps, WED_15)).status).toBe('written')
    expect(claude.dinnerCalls[0].daycareMenu).toBeNull()
    expect(claude.dinnerCalls[0].nearbyMenus).toEqual([])
    expect(db.read(`${H}/dinner/${DAY}`)?.daycareMenu).toBeNull()
  })

  it('records a Claude failure without writing', async () => {
    const { db, claude, deps } = setup()
    claude.dinnerReply = new Error('overloaded')
    expect((await runDinner(deps, WED_15)).status).toBe('failed')
    expect(db.read(`${H}/dinner/${DAY}`)).toBeUndefined()
    expect(db.read(`${H}/integrations/claude`)).toMatchObject({ consecutiveFailures: 1 })
  })
})
