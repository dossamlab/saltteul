import { addDays, diffDays, isValidYmd, makeYmd, weekdayOf } from './householdDate'
import type { Ymd } from './types'

const WEEKDAYS: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 }

/** Monday of the week containing `day` (weeks run Mon–Sun). */
function mondayOf(day: Ymd): Ymd {
  const wd = weekdayOf(day)
  return addDays(day, wd === 0 ? -6 : 1 - wd)
}

function fromMonday(monday: Ymd, wd: number): Ymd {
  return addDays(monday, wd === 0 ? 6 : wd - 1)
}

/** First date on or after `from` (strictly after when `strict`) with the given month/day. */
function nextMonthDay(m: number, d: number, from: Ymd): Ymd | null {
  const y = Number(from.slice(0, 4))
  for (const year of [y, y + 1]) {
    if (!isValidYmd(year, m, d)) continue
    const cand = makeYmd(year, m, d)
    if (diffDays(from, cand) >= 0) return cand
  }
  return null
}

/**
 * Resolves Korean date phrases relative to the day a notice was written.
 * Returns null when the phrase is not understood, so callers can fall back.
 */
export function resolveRelativeDate(text: string, written: Ymd): Ymd | null {
  const s = text.replace(/\([^)]*\)/g, '').replace(/\s+/g, '').trim()
  if (!s) return null
  if (s === '오늘' || s === '당일') return written
  if (s === '내일') return addDays(written, 1)
  if (s === '모레') return addDays(written, 2)

  let m = s.match(/^(이번주|다음주|다다음주)?([일월화수목금토])요일$/)
  if (m) {
    const wd = WEEKDAYS[m[2]]
    if (m[1] === '이번주') return fromMonday(mondayOf(written), wd)
    if (m[1] === '다음주') return fromMonday(addDays(mondayOf(written), 7), wd)
    if (m[1] === '다다음주') return fromMonday(addDays(mondayOf(written), 14), wd)
    const ahead = (wd - weekdayOf(written) + 7) % 7 || 7
    return addDays(written, ahead)
  }

  m = s.match(/^(\d{1,2})월(\d{1,2})일$/) ?? s.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (m) return nextMonthDay(Number(m[1]), Number(m[2]), written)

  m = s.match(/^(\d{1,2})일$/)
  if (m) {
    const d = Number(m[1])
    let y = Number(written.slice(0, 4))
    let mo = Number(written.slice(5, 7))
    for (let i = 0; i < 2; i++) {
      if (isValidYmd(y, mo, d)) {
        const cand = makeYmd(y, mo, d)
        if (diffDays(written, cand) >= 0) return cand
      }
      mo += 1
      if (mo > 12) { mo = 1; y += 1 }
    }
    return null
  }
  return null
}
