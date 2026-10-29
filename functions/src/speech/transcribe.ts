// transcribe callable: a short voice memo for the quick add field → text (Google Cloud Speech-to-Text v1, ko-KR).
// The app records 16-bit mono PCM itself (LINEAR16), so every device sends the same format; Safari's AAC recordings
// are not accepted by v1. Nothing is stored: the text goes back to the field and the user presses 「정리」.
import { GoogleAuth } from 'google-auth-library'

export class SpeechInputError extends Error {}

/** 30 seconds of 16 kHz 16-bit mono is 960 000 bytes; v1 sync recognize accepts up to 60 s. */
export const SPEECH_LIMITS = { maxSeconds: 30, minRate: 8000, maxRate: 48000 } as const

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
  /** Best transcript of the audio, '' when nothing was recognised. */
  recognize(audio: SpeechAudio): Promise<string>
}

interface RecognizeResponse {
  results?: { alternatives?: { transcript?: string }[] }[]
}

/** Joins the top alternative of each result (v1 splits longer speech into several results). */
export function transcriptOf(res: RecognizeResponse): string {
  return (res.results ?? [])
    .map((r) => (r.alternatives?.[0]?.transcript ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const SPEECH_ENDPOINT = 'https://speech.googleapis.com/v1/speech:recognize'

/** Speech-to-Text through the function's own service account (no key file). */
export class GoogleSpeech implements SpeechPort {
  private auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })

  async recognize(audio: SpeechAudio): Promise<string> {
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
        },
        audio: { content: audio.bytes.toString('base64') },
      },
    })
    return transcriptOf(res.data)
  }
}

export async function runTranscribe(speech: SpeechPort, data: unknown): Promise<{ text: string }> {
  return { text: await speech.recognize(parseSpeechInput(data)) }
}
