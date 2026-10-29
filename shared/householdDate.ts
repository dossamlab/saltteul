import type { Ymd } from './types'

// Seoul has no DST, so a fixed +9h offset is exact.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_START_HOUR = 4
const DAY_MS = 24 * 60 * 60 * 1000

function ymdFromUtcFields(d: Date): Ymd {
  return d.toISOString().slice(0, 10)
}

/** Calendar date in Asia/Seoul. */
export function seoulDate(now: Date): Ymd {
  return ymdFromUtcFields(new Date(now.getTime() + KST_OFFSET_MS))
}

/** 'HH:mm' in Asia/Seoul. */
export function seoulTime(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(11, 16)
}

/** Household day: a day runs from 04:00 to 03:59 KST, so 02:00 counts toward the previous day. */
export function householdDate(now: Date): Ymd {
  return seoulDate(new Date(now.getTime() - DAY_START_HOUR * 60 * 60 * 1000))
}

function toUtcMidnight(ymd: Ymd): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addDays(ymd: Ymd, n: number): Ymd {
  return ymdFromUtcFields(new Date(toUtcMidnight(ymd) + n * DAY_MS))
}

/** b - a in days. */
export function diffDays(a: Ymd, b: Ymd): number {
  return Math.round((toUtcMidnight(b) - toUtcMidnight(a)) / DAY_MS)
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(ymd: Ymd): number {
  return new Date(toUtcMidnight(ymd)).getUTCDay()
}

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

export function makeYmd(y: number, m: number, d: number): Ymd {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
