import { describe, expect, it } from 'vitest'
import { canUndo, foundItems, recordStatus, recordTitle, type KidsnoteRecord } from './kidsnoteHistory'

const base: KidsnoteRecord = { id: 'r1', written: '2026-10-30', batchId: 'kn-r1' }

describe('kids note history', () => {
  it('tells what each record did', () => {
    const added = { ...base, todoIds: ['t1', 't2'], shoppingIds: ['s1'], counts: { events: 1, deadlines: 1, prepItems: 2, shopping: 1, dateChecks: 0 } }
    expect(recordStatus(added)).toEqual({ kind: 'added', events: 2, items: 2, checks: 0 })
    expect(canUndo(added)).toBe(true)
    expect(recordStatus({ ...added, undoneAt: 5 })).toEqual({ kind: 'undone' })
    expect(canUndo({ ...added, undoneAt: 5 })).toBe(false)
    expect(recordStatus({ ...base, todoIds: [], shoppingIds: [] })).toEqual({ kind: 'nothing' })
    expect(recordStatus({ ...base, skipped: 'otherClass', todoIds: [] })).toEqual({ kind: 'otherClass' })
    expect(canUndo({ ...base, todoIds: [] })).toBe(false)
  })

  it('uses the first text line as the title', () => {
    expect(recordTitle({ ...base, text: '\n  Field trip helpers \nPlease join' })).toBe('Field trip helpers')
    expect(recordTitle({ ...base, text: 'x'.repeat(80) }, 10)).toBe('xxxxxxxxx…')
    expect(recordTitle(base)).toBe('')
  })

  it('lists the events and deadlines that were found', () => {
    expect(foundItems({
      ...base,
      extraction: {
        events: [{ title: 'Picnic', dateText: 'next Wed', isoDate: '2026-11-04' }, { title: '', isoDate: null }],
        deadlines: [{ title: 'Consent form', dateText: 'Nov 2', isoDate: null }],
      },
    })).toEqual([{ title: 'Picnic', when: '2026-11-04' }, { title: 'Consent form', when: 'Nov 2' }])
    expect(foundItems(base)).toEqual([])
  })
})
