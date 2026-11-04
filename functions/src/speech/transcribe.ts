// transcribe callable: a short voice memo for the quick add field → text (Google Cloud Speech-to-Text v1, ko-KR).
// The app records 16-bit mono PCM itself (LINEAR16), so every device sends the same format; Safari's AAC recordings
// are not accepted by v1. Nothing is stored: the text goes back to the field and the user presses 「정리」.
// Household words (speech/vocabulary.ts) go along as phrase hints, and up to SPEECH_ALTERNATIVES candidate sentences
// come back, best first.
import { GoogleAuth } from 'google-auth-library'

export class SpeechInputError extends Error {}

/** 30 seconds of 16 kHz 16-bit mono is 960 000 bytes; v1 sync recognize accepts up to 60 s. */
export const SPEECH_LIMITS = { maxSeconds: 30, minRate: 8000, maxRate: 48000 } as const
export const SPEECH_ALTERNATIVES = 3
/** Google suggests 0–20; a middle value favours household words without forcing them onto similar-sounding speech. */
export const SPEECH_BOOST = 10

export interface SpeechAudio {
  bytes: Buffer
  sampleRate: number
}

export function parseSpeechInput(data: unknown): SpeechAudio {
  const d = (data ?? {}) as { audioBase64?: unknown; sampleRate?: unknown }
  const rate = Number(d.sampleRate)
  if (!Number.isInteger(rate) || rate < SPEECH_LIMITS.minRate || rate > SPEECH_LIMITS.maxRate) {
    throw new SpeechInputError('sampleRate must be an integer between 8000 and 48000')
  }
  const b64 = typeof d.audioBase64 === 'string' ? d.audioBase64 : ''
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new SpeechInputError('audioBase64 is required')
  const bytes = Buffer.from(b64, 'base64')
  const maxBytes = rate * 2 * SPEECH_LIMITS.maxSeconds
  if (bytes.length < 2 || bytes.length % 2 !== 0) throw new SpeechInputError('audio must be 16-bit PCM')
  if (bytes.length > maxBytes) throw new SpeechInputError(`audio longer than ${SPEECH_LIMITS.maxSeconds} seconds`)
  return { bytes, sampleRate: rate }
}

export interface SpeechPort {
  /** Candidate transcripts, best first; [] when nothing was recognised. `phrases` are hints the recogniser favours. */
  recognize(audio: SpeechAudio, phrases: string[]): Promise<string[]>
}

interface RecognizeResponse {
  results?: { alternatives?: { transcript?: string }[] }[]
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * v1 splits longer speech into several results, each with its own alternatives. Candidate k joins the k-th alternative
 * of every result (the best one where a result has fewer); duplicates and empty sentences are dropped.
 */
export function transcriptsOf(res: RecognizeResponse): string[] {
  const results = res.results ?? []
  const depth = Math.max(0, ...results.map((r) => r.alternatives?.length ?? 0))
  const out: string[] = []
  for (let k = 0; k < depth; k++) {
    const sentence = tidy(results
      .map((r) => (r.alternatives?.[k] ?? r.alternatives?.[0])?.transcript ?? '')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' '))
    if (sentence && !out.includes(sentence)) out.push(sentence)
  }
  return out
}

export const SPEECH_ENDPOINT = 'https://speech.googleapis.com/v1/speech:recognize'

/** Speech-to-Text through the function's own service account (no key file). */
export class GoogleSpeech implements SpeechPort {
  private auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })

  constructor(private warn: (msg: string) => void = () => undefined) {}

  async recognize(audio: SpeechAudio, phrases: string[]): Promise<string[]> {
    try {
      return await this.request(audio, phrases)
    } catch (e) {
      // A rejected hint list must not cost the user their recording: try once more without it.
      const status = (e as { response?: { status?: number } }).response?.status
      if (status !== 400 || !phrases.length) throw e
      this.warn(`speech hints rejected, retrying without them: ${e instanceof Error ? e.message : e}`)
      return this.request(audio, [])
    }
  }

  private async request(audio: SpeechAudio, phrases: string[]): Promise<string[]> {
    const client = await this.auth.getClient()
    const res = await client.request<RecognizeResponse>({
      url: SPEECH_ENDPOINT,
      method: 'POST',
      data: {
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: audio.sampleRate,
          audioChannelCount: 1,
          languageCode: 'ko-KR',
          enableAutomaticPunctuation: true,
          maxAlternatives: SPEECH_ALTERNATIVES,
          ...(phrases.length ? { speechContexts: [{ phrases, boost: SPEECH_BOOST }] } : {}),
        },
        audio: { content: audio.bytes.toString('base64') },
      },
    })
    return transcriptsOf(res.data)
  }
}

/**
 * `vocabulary` loads the household words; when it fails the recording is still recognised, only without hints.
 * Returns the best candidate as `text`.
 */
export async function runTranscribe(
  speech: SpeechPort,
  data: unknown,
  vocabulary: () => Promise<string[]> = async () => [],
  warn: (msg: string) => void = () => undefined,
): Promise<{ text: string }> {
  const audio = parseSpeechInput(data)
  const phrases = await vocabulary().catch((e: unknown) => {
    warn(`speech vocabulary unavailable: ${e instanceof Error ? e.message : e}`)
    return [] as string[]
  })
  const candidates = await speech.recognize(audio, phrases)
  return { text: candidates[0] ?? '' }
}
