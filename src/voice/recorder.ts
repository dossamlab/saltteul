// Microphone → PCM chunks with the Web Audio API. Works the same in the Android app (WebView), iPhone PWA and PC.
// ScriptProcessorNode is deprecated but is the one capture path every target browser still runs without a worklet file.
import { downsample, pcmToBase64, peak, TARGET_RATE } from './pcm'

export const MAX_SECONDS = 30
/** Below this peak level the whole recording is treated as silence and not sent. */
const SILENCE_PEAK = 0.02

type AudioCtor = typeof AudioContext

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext ?? null
}

export function voiceSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!audioCtor()
}

export class VoiceError extends Error {
  constructor(public code: 'denied' | 'unavailable' | 'silent') {
    super(code)
  }
}

export interface Recording {
  /** Stops and returns 16 kHz PCM as base64, or throws VoiceError('silent'). */
  stop(): Promise<{ audioBase64: string; sampleRate: number }>
  cancel(): void
}

/**
 * Starts recording right away. `onLevel` gets the peak of each chunk (0–1); `onLimit` fires once when MAX_SECONDS is
 * reached, and the caller should then call stop().
 */
export async function startRecording(opts: { onLevel?: (v: number) => void; onLimit?: () => void } = {}): Promise<Recording> {
  const Ctor = audioCtor()
  if (!Ctor || !navigator.mediaDevices?.getUserMedia) throw new VoiceError('unavailable')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  } catch (e) {
    const name = (e as { name?: string }).name ?? ''
    throw new VoiceError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
  }
  const ctx = new Ctor()
  if (ctx.state === 'suspended') await ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let samples = 0
  let loudest = 0
  let limited = false
  node.onaudioprocess = (ev) => {
    if (limited) return
    const data = new Float32Array(ev.inputBuffer.getChannelData(0))
    chunks.push(data)
    samples += data.length
    const p = peak(data)
    loudest = Math.max(loudest, p)
    opts.onLevel?.(p)
    if (samples >= ctx.sampleRate * MAX_SECONDS) {
      limited = true
      opts.onLimit?.()
    }
  }
  source.connect(node)
  // Some browsers only run onaudioprocess while the node reaches the destination; its output stays silent.
  node.connect(ctx.destination)

  const release = () => {
    node.onaudioprocess = null
    try { source.disconnect(); node.disconnect() } catch { /* already disconnected */ }
    stream.getTracks().forEach((tr) => tr.stop())
    void ctx.close().catch(() => undefined)
  }

  return {
    async stop() {
      const rate = ctx.sampleRate
      release()
      if (loudest < SILENCE_PEAK || !samples) throw new VoiceError('silent')
      const maxIn = Math.floor(rate * MAX_SECONDS)
      let kept = 0
      const trimmed = chunks.filter((c) => (kept += c.length) - c.length < maxIn)
      const outRate = Math.min(rate, TARGET_RATE)
      const pcm = downsample(trimmed, rate).subarray(0, outRate * MAX_SECONDS)
      return { audioBase64: pcmToBase64(pcm), sampleRate: outRate }
    },
    cancel: release,
  }
}
