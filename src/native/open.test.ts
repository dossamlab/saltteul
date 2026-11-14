import { describe, expect, it, vi } from 'vitest'
import { captureDone, createOpenBus, installNativeOpen, parseOpenTarget, type OpenWindow } from './open'

describe('parseOpenTarget', () => {
  it('accepts the widget targets and rejects anything else', () => {
    for (const t of ['capture', 'capture-mic', 'todos-month', 'todos', 'shopping', 'trip:abc123']) expect(parseOpenTarget(t)).toBe(t)
    expect(parseOpenTarget(' todos ')).toBe('todos')
    for (const t of ['trip:', 'home', '', null, 42, 'trip:a/b']) expect(parseOpenTarget(t)).toBeNull()
  })
})

describe('installNativeOpen', () => {
  it('defines window.saltteulOpen and consumes the pending target the app left before the web was ready', () => {
    const w: OpenWindow = { __saltteulPendingOpen: 'capture-mic' }
    const bus = createOpenBus()
    installNativeOpen(w, bus)
    expect(typeof w.saltteulOpen).toBe('function')
    expect('__saltteulPendingOpen' in w).toBe(false)
    const seen: string[] = []
    bus.subscribe((t) => seen.push(t))
    expect(seen).toEqual(['capture-mic'])
  })

  it('delivers later calls straight to the listener, keeps only the last one while nobody listens', () => {
    const w: OpenWindow = {}
    const bus = createOpenBus()
    installNativeOpen(w, bus)
    w.saltteulOpen!('todos')
    w.saltteulOpen!('shopping')
    w.saltteulOpen!('nonsense')
    const seen: string[] = []
    const off = bus.subscribe((t) => seen.push(t))
    w.saltteulOpen!('trip:t1')
    off()
    w.saltteulOpen!('todos-month')
    expect(seen).toEqual(['shopping', 'trip:t1'])
    bus.subscribe((t) => seen.push(t))
    expect(seen).toEqual(['shopping', 'trip:t1', 'todos-month'])
  })
})

describe('captureDone', () => {
  it('calls the native bridge when there is one and does nothing otherwise', () => {
    const fn = vi.fn()
    captureDone({ SaltteulNative: { captureDone: fn } })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(() => captureDone({})).not.toThrow()
  })
})
