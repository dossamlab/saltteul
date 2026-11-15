import { describe, expect, it } from 'vitest'
import { todoDisplayTitle } from './todoTitle'

describe('todoDisplayTitle', () => {
  it('drops the leading [..] of a Kids Note todo', () => {
    expect(todoDisplayTitle({ title: '[키즈노트] 별내 팜스쿨 견학', source: 'kidsnote' })).toBe('별내 팜스쿨 견학')
  })
  it('keeps other sources and titles with nothing after the prefix', () => {
    expect(todoDisplayTitle({ title: '[메모] 장보기', source: 'manual' })).toBe('[메모] 장보기')
    expect(todoDisplayTitle({ title: '[키즈노트]', source: 'kidsnote' })).toBe('[키즈노트]')
    expect(todoDisplayTitle({ title: '상담 질문지 제출 마감', source: 'kidsnote' })).toBe('상담 질문지 제출 마감')
  })
})
