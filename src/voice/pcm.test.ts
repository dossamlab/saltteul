import { describe, expect, it } from 'vitest'
import { downsample, peak, pcmToBase64 } from './pcm'

describe('pcm', () => {
  it('downsamples 48 kHz to 16 kHz by averaging and clamps to 16-bit', () => {
    const a = new Float32Array([1, 1, 1, -1, -1, -1])
    const b = new Float32Array([0.5, 0.5, 0.5, 2, 2, 2])
    expect([...downsample([a, b], 48000)]).toEqual([32767, -32768, 16384, 32767])
  })

  it('keeps samples as they are when the device already records at 16 kHz or lower', () => {
    expect([...downsample([new Float32Array([0, 0.5])], 16000)]).toEqual([0, 16384])
  })

  it('encodes little-endian base64', () => {
    expect(pcmToBase64(new Int16Array([1, -2]))).toBe(Buffer.from([1, 0, 0xfe, 0xff]).toString('base64'))
  })

  it('measures the peak level', () => {
    expect(peak(new Float32Array([0.1, -0.6, 0.3]))).toBeCloseTo(0.6)
  })
})
