import { describe, expect, it } from 'vitest'
import {
  GoogleSpeech, parseSpeechInput, runTranscribe, SPEECH_ALTERNATIVES, SPEECH_BOOST, SpeechInputError, transcriptsOf,
  type SpeechAudio, type SpeechPort,
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
    expect(await runTranscribe(speech, { audioBase64: pcm(800), sampleRate: 16000 }, async () => ['영양제']))
      .toEqual({ text: '영양제 먹었어' })
    expect(seen[0].audio.sampleRate).toBe(16000)
    expect(seen[0].phrases).toEqual(['영양제'])
  })

  it('still recognises without hints when the household words cannot be read', async () => {
    const warnings: string[] = []
    const seen: string[][] = []
    const speech: SpeechPort = { recognize: async (_a, phrases) => (seen.push(phrases), []) }
    const out = await runTranscribe(speech, { audioBase64: pcm(800), sampleRate: 16000 }, async () => {
      throw new Error('firestore down')
    }, (m) => warnings.push(m))
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
