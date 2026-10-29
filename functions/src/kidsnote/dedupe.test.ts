import { describe, expect, it } from 'vitest'
import { makeT } from '../../../shared/copy'
import { planKidsnote, similarTitles, todoKey } from './apply'

const t = makeT({ 'kidsnote.eventPrefix': '[키즈노트]', 'kidsnote.deadlineTitle': '{title} 마감', 'kidsnote.prepTodoTitle': '{title}: {items}' })
const P = '[키즈노트]'

describe('similarTitles', () => {
  it('treats reworded notices about the same event as one', () => {
    expect(similarTitles('[키즈노트] 2학기 학부모 방문상담', '[키즈노트] 학부모 방문상담', P)).toBe(true)
    expect(similarTitles('[키즈노트] 가을 소풍', '[키즈노트] 소풍', P)).toBe(true)
    expect(similarTitles('[키즈노트] 학부모 상담 주간', '[키즈노트] 학부모상담', P)).toBe(true)
  })
  it('keeps different events apart', () => {
    expect(similarTitles('[키즈노트] 학부모 방문상담', '[키즈노트] 체육 활동', P)).toBe(false)
    expect(similarTitles('[키즈노트] 생일 파티', '[키즈노트] 할로윈 파티', P)).toBe(false)
  })
})

describe('planKidsnote across notices', () => {
  const base = { rules: [], openShoppingNames: [], batchId: 'b', now: 1, t }
  const ev = (title: string, isoDate: string) => ({ title, kind: 'event' as const, dateText: '', isoDate, time: '17:30', prepItems: [] })

  it('skips an event another notice already registered under a different wording', () => {
    const existing = new Set([todoKey('[키즈노트] 2학기 학부모 방문상담', '2026-10-28')])
    const p = planKidsnote({
      ...base, written: '2026-10-27', today: '2026-10-27', existingTodoKeys: existing,
      extraction: { events: [ev('학부모 방문상담', '2026-10-28')], deadlines: [], notes: [] },
    })
    expect(p.todos).toEqual([])
  })

  it('does not add events or deadlines that are already past', () => {
    const p = planKidsnote({
      ...base, written: '2026-10-22', today: '2026-10-28', existingTodoKeys: new Set(),
      extraction: {
        events: [ev('작품 전시회', '2026-10-23')],
        deadlines: [{ title: '상담 질문지 제출', dateText: '', isoDate: '2026-10-23' }],
        notes: [],
      },
    })
    expect(p.todos).toEqual([])
  })

  it('does not repeat 마감 in deadline titles', () => {
    const p = planKidsnote({
      ...base, written: '2026-10-28', today: '2026-10-28', existingTodoKeys: new Set(),
      extraction: {
        events: [],
        deadlines: [
          { title: '상담 질문지 제출', dateText: '', isoDate: '2026-11-02' },
          { title: '동의서 회신 마감', dateText: '', isoDate: '2026-11-03' },
        ],
        notes: [],
      },
    })
    expect(p.todos.map((x) => x.title)).toEqual(['상담 질문지 제출 마감', '동의서 회신 마감'])
  })
})
