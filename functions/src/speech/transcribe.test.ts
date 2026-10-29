import { describe, expect, it } from 'vitest'
import { parseSpeechInput, runTranscribe, SpeechInputError, transcriptOf, type SpeechAudio, type SpeechPort } from './transcribe'

const pcm = (samples: number) => Buffer.alloc(samples * 2).toString('base64')

describe('transcribe', () => {
  it('accepts 16-bit PCM up to 30 seconds', () => {
    expect(parseSpeechInput({ audioBase64: pcm(16000), sampleRate: 16000 }).bytes.length).toBe(32000)
    expect(() => parseSpeechInput({ audioBase64: pcm(16000 * 31), sampleRate: 16000 })).toThrow(SpeechInputError)
    expect(() => parseSpeechInput({ audioBase64: pcm(10), sampleRate: 100 })).toThrow(SpeechInputError)
    expect(() => parseSpeechInput({ audioBase64: 'not base64!', sampleRate: 16000 })).toThrow(SpeechInputError)
    expect(() => parseSpeechInput({ sampleRate: 16000 })).toThrow(SpeechInputError)
    expect(() => parseSpeechInput(null)).toThrow(SpeechInputError)
  })

  it('joins the best alternative of every result', () => {
    expect(transcriptOf({ results: [{ alternatives: [{ transcript: ' 우유랑 계란 사고 ' }, { transcript: 'x' }] }, { alternatives: [{ transcript: '내일 3시 소아과' }] }] }))
      .toBe('우유랑 계란 사고 내일 3시 소아과')
    expect(transcriptOf({})).toBe('')
    expect(transcriptOf({ results: [{}] })).toBe('')
  })

  it('passes the audio to the recogniser and returns its text', async () => {
    const seen: SpeechAudio[] = []
    const speech: SpeechPort = { recognize: async (a) => (seen.push(a), '영양제 먹었어') }
    expect(await runTranscribe(speech, { audioBase64: pcm(800), sampleRate: 16000 })).toEqual({ text: '영양제 먹었어' })
    expect(seen[0].sampleRate).toBe(16000)
  })
})
