// The app↔widget contract (design 2026-11-14, section 6). The Android app calls window.saltteulOpen(target) when a
// widget opened it; when the web was not ready yet it leaves window.__saltteulPendingOpen = target instead.
// A capture opened this way reports back with window.SaltteulNative.captureDone() so the app can go to the background.

export type OpenTarget = 'capture' | 'capture-mic' | 'todos-month' | 'todos' | 'shopping' | `trip:${string}`

export interface OpenWindow {
  saltteulOpen?: (target: string) => void
  __saltteulPendingOpen?: string | null
  SaltteulNative?: { captureDone?: () => void }
}

declare global {
  interface Window extends OpenWindow {}
}

const FIXED = ['capture', 'capture-mic', 'todos-month', 'todos', 'shopping']

export function parseOpenTarget(v: unknown): OpenTarget | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (FIXED.includes(s)) return s as OpenTarget
  return /^trip:[\w-]+$/.test(s) ? (s as OpenTarget) : null
}

/** Holds the last target until the screen subscribes (the household may still be loading or signing in). */
export function createOpenBus() {
  let pending: OpenTarget | null = null
  let listener: ((t: OpenTarget) => void) | null = null
  return {
    push(t: OpenTarget) {
      if (listener) listener(t)
      else pending = t
    },
    subscribe(fn: (t: OpenTarget) => void) {
      listener = fn
      if (pending) {
        const t = pending
        pending = null
        fn(t)
      }
      return () => {
        if (listener === fn) listener = null
      }
    },
  }
}

export const openBus = createOpenBus()

/** Run once at start-up, before the first render. */
export function installNativeOpen(w: OpenWindow = window, bus = openBus) {
  w.saltteulOpen = (target: string) => {
    const t = parseOpenTarget(target)
    if (t) bus.push(t)
  }
  const pending = w.__saltteulPendingOpen
  delete w.__saltteulPendingOpen
  if (pending) w.saltteulOpen(pending)
}

/** Tells the Android app a capture opened from a widget was saved or cancelled. */
export function captureDone(w: OpenWindow = window) {
  w.SaltteulNative?.captureDone?.()
}
