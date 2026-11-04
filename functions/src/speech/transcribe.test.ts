import { describe, expect, it } from 'vitest'
import type { SpeechFixInput } from '../claude/inputs'
import {
  acceptFix, GoogleSpeech, parseSpeechInput, runTranscribe, SPEECH_ALTERNATIVES, SPEECH_BOOST, SpeechInputError, transcriptsOf,
  type SpeechAudio, type SpeechPort, type TranscribeDeps,
} from './transcribe'
import { cleanPhrases, nameForms, VOCAB_LIMITS } from './vocabulary'

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

  it('joins the k-th alternative of every result into candidate k, best first', () => {
    expect(transcriptsOf({
      results: [
        { alternatives: [{ transcript: ' 우유랑 계란 사고 ' }, { transcript: '우유랑 계란 사구' }] },
        { alternatives: [{ transcript: '내일 3시 소아과' }] },
      ],
    })).toEqual(['우유랑 계란 사고 내일 3시 소아과', '우유랑 계란 사구 내일 3시 소아과'])
    expect(transcriptsOf({ results: [{ alternatives: [{ transcript: '햇반' }, { transcript: '햇반' }, { transcript: '햇빛' }] }] }))
      .toEqual(['햇반', '햇빛'])
    expect(transcriptsOf({})).toEqual([])
    expect(transcriptsOf({ results: [{}] })).toEqual([])
  })

  it('passes the audio and household words to the recogniser and returns the best candidate', async () => {
    const seen: { audio: SpeechAudio; phrases: string[] }[] = []
    const speech: SpeechPort = { recognize: async (audio, phrases) => (seen.push({ audio, phrases }), ['영양제 먹었어', '영양재 먹었어']) }
    expect(await runTranscribe({ speech, vocabulary: async () => ['영양제'] }, { audioBase64: pcm(800), sampleRate: 16000 }))
      .toEqual({ text: '영양제 먹었어' })
    expect(seen[0].audio.sampleRate).toBe(16000)
    expect(seen[0].phrases).toEqual(['영양제'])
  })

  it('still recognises without hints when the household words cannot be read', async () => {
    const warnings: string[] = []
    const seen: string[][] = []
    const speech: SpeechPort = { recognize: async (_a, phrases) => (seen.push(phrases), []) }
    const out = await runTranscribe({
      speech,
      vocabulary: async () => { throw new Error('firestore down') },
      warn: (m) => warnings.push(m),
    }, { audioBase64: pcm(800), sampleRate: 16000 })
    expect(out).toEqual({ text: '' })
    expect(seen).toEqual([[]])
    expect(warnings[0]).toContain('firestore down')
  })

  it('sends hints and alternatives, and retries without hints when Google rejects them', async () => {
    const bodies: { config: Record<string, unknown> }[] = []
    const google = new GoogleSpeech(() => undefined)
    let calls = 0
    ;(google as unknown as { auth: unknown }).auth = {
      getClient: async () => ({
        request: async ({ data }: { data: { config: Record<string, unknown> } }) => {
          bodies.push(data)
          if (calls++ === 0) throw Object.assign(new Error('bad hints'), { response: { status: 400 } })
          return { data: { results: [{ alternatives: [{ transcript: '물티슈 썼어' }] }] } }
        },
      }),
    }
    const audio = { bytes: Buffer.alloc(4), sampleRate: 16000 }
    expect(await google.recognize(audio, ['물티슈'])).toEqual(['물티슈 썼어'])
    expect(bodies[0].config).toMatchObject({ maxAlternatives: SPEECH_ALTERNATIVES, speechContexts: [{ phrases: ['물티슈'], boost: SPEECH_BOOST }] })
    expect(bodies[1].config.speechContexts).toBeUndefined()
  })
})

describe('transcript correction', () => {
  const audio = { audioBase64: pcm(800), sampleRate: 16000 }
  const heard = (...candidates: string[]): SpeechPort => ({ recognize: async () => candidates })

  it('puts the corrected sentence in the field and keeps what was heard for 「원래대로」', async () => {
    const calls: SpeechFixInput[] = []
    const out = await runTranscribe({
      speech: heard('햇빛 3개 남았어', '햇반 3개 남았어'),
      vocabulary: async () => ['햇반'],
      fix: async (i) => (calls.push(i), { text: '햇반 3개 남았어' }),
    }, audio)
    expect(out).toEqual({ text: '햇반 3개 남았어', heard: '햇빛 3개 남았어' })
    expect(calls[0]).toEqual({ candidates: ['햇빛 3개 남았어', '햇반 3개 남았어'], words: ['햇반'] })
  })

  it('sends no `heard` when nothing changed, and skips Claude when nothing was heard', async () => {
    let called = 0
    const fix = async (i: SpeechFixInput) => (called++, { text: ` ${i.candidates[0]} ` })
    expect(await runTranscribe({ speech: heard('우유 사야 해'), fix }, audio)).toEqual({ text: '우유 사야 해' })
    expect(await runTranscribe({ speech: heard(), fix }, audio)).toEqual({ text: '' })
    expect(called).toBe(1)
  })

  it('falls back to the best candidate when Claude fails, is slow or answers something doubtful', async () => {
    const warnings: string[] = []
    const run = (fix: TranscribeDeps['fix']) =>
      runTranscribe({ speech: heard('물티슈 3개 썼어'), fix, warn: (m) => warnings.push(m), fixTimeoutMs: 20 }, audio)
    expect(await run(async () => { throw new Error('overloaded') })).toEqual({ text: '물티슈 3개 썼어' })
    expect(await run(() => new Promise((r) => setTimeout(() => r({ text: '물티슈 3개 샀어' }), 200)))).toEqual({ text: '물티슈 3개 썼어' })
    expect(await run(async () => ({ text: '물티슈 5개 썼어' }))).toEqual({ text: '물티슈 3개 썼어' })
    expect(warnings).toHaveLength(3)
  })

  it('accepts only sentences with known numbers and a similar length', () => {
    expect(acceptFix(['내일 3시 소아가 예약'], ' 내일 3시  소아과 예약 ')).toBe('내일 3시 소아과 예약')
    expect(acceptFix(['내일 세 시 소아과'], '내일 3시 소아과')).toBeNull()
    expect(acceptFix(['우유 사기'], '우유 사기 그리고 계란 두 판과 휴지 한 묶음도 사기')).toBeNull()
    expect(acceptFix(['기저귀 주문하고 물티슈 사기'], '기저귀')).toBeNull()
    expect(acceptFix(['햇빛 2개', '햇반 2개 남았어'], '햇반 2개 남았어')).toBe('햇반 2개 남았어')
    expect(acceptFix([], '아무 말')).toBeNull()
    expect(acceptFix(['아무 말'], '  ')).toBeNull()
  })
})

describe('speech vocabulary', () => {
  it('trims, drops duplicates and overlong words, and caps the list', () => {
    expect(cleanPhrases([' 물티슈 ', '물 티슈', '', null, undefined, 'x'.repeat(101), '햇반'])).toEqual(['물티슈', '햇반'])
    expect(cleanPhrases(Array.from({ length: 600 }, (_, i) => `w${i}`))).toHaveLength(VOCAB_LIMITS.maxPhrases)
  })

  it('adds the given name of a three-syllable Korean name', () => {
    expect(nameForms('홍길동')).toEqual(['홍길동', '길동'])
    expect(nameForms('하늘')).toEqual(['하늘'])
    expect(nameForms('Alex')).toEqual(['Alex'])
  })
})
