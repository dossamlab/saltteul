import { diffDays, weekdayOf } from '../shared/householdDate'
import type { Ymd } from '../shared/types'
import { t } from './copy'

export const weekdayShort = (wd: number) => t(`weekday.${wd}`)

/** e.g. "10월 28일 (수)" via copy key date.md */
export function formatDay(ymd: Ymd): string {
  const [, m, d] = ymd.split('-').map(Number)
  return t('date.md', { m, d, w: weekdayShort(weekdayOf(ymd)) })
}

/** "오늘", "내일", "어제" or the formatted day. */
export function relativeDay(ymd: Ymd, today: Ymd): string {
  const n = diffDays(today, ymd)
  if (n === 0) return t('date.today')
  if (n === 1) return t('date.tomorrow')
  if (n === -1) return t('date.yesterday')
  return formatDay(ymd)
}

export function dDayLabel(days: number): string {
  return days === 0 ? t('dday.today') : t('dday.left', { n: days })
}

export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const key = h < 12 ? 'time.am' : 'time.pm'
  const hh = h % 12 === 0 ? 12 : h % 12
  return t(key, { h: hh, m: String(m).padStart(2, '0') })
}
