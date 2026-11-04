import { describe, expect, it } from 'vitest'
import { joinVoice, undoVoiceFix } from './fix'

describe('voice fix', () => {
  it('appends spoken words after what was typed', () => {
    expect(joinVoice('', '햇반 3개 남았어')).toBe('햇반 3개 남았어')
    expect(joinVoice('  ', '햇반')).toBe('햇반')
    expect(joinVoice('우유 사고 ', '햇반 3개 남았어')).toBe('우유 사고 햇반 3개 남았어')
  })

  it('puts back only the spoken part, and only while the field is unchanged', () => {
    const fix = { base: '우유 사고', fixed: '햇반 3개 남았어', heard: '햇빛 3개 남았어' }
    expect(undoVoiceFix('우유 사고 햇반 3개 남았어', fix)).toBe('우유 사고 햇빛 3개 남았어')
    expect(undoVoiceFix('우유 사고 햇반 3개 남았어!', fix)).toBeNull()
    expect(undoVoiceFix('햇반', { base: '', fixed: '햇반', heard: '햇빛' })).toBe('햇빛')
  })
})
