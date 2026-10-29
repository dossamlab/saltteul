// Turns microphone samples (Float32, device rate) into 16 kHz 16-bit mono PCM for Speech-to-Text.

export const TARGET_RATE = 16000

/** Averages the samples that fall into each output slot (simple low-pass), so 48 kHz speech stays clear at 16 kHz. */
export function downsample(chunks: Float32Array[], fromRate: number, toRate: number = TARGET_RATE): Int16Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const input = new Float32Array(total)
  let at = 0
  for (const c of chunks) {
    input.set(c, at)
    at += c.length
  }
  const ratio = fromRate / toRate
  const outLen = ratio <= 1 ? total : Math.floor(total / ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    let v: number
    if (ratio <= 1) {
      v = input[i]
    } else {
      const start = Math.floor(i * ratio)
      const end = Math.min(total, Math.floor((i + 1) * ratio))
      let sum = 0
      for (let j = start; j < end; j++) sum += input[j]
      v = end > start ? sum / (end - start) : 0
    }
    const s = Math.max(-1, Math.min(1, v))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/** Little-endian bytes of the samples as base64. */
export function pcmToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((s, i) => view.setInt16(i * 2, s, true))
  let bin = ''
  const STEP = 0x8000
  for (let i = 0; i < bytes.length; i += STEP) bin += String.fromCharCode(...bytes.subarray(i, i + STEP))
  return btoa(bin)
}

/** Peak level 0–1 of a chunk, for the "listening" indicator and for skipping silent recordings. */
export function peak(chunk: Float32Array): number {
  let m = 0
  for (const v of chunk) m = Math.max(m, Math.abs(v))
  return m
}
