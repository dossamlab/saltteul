// One Cloud Scheduler job (every 15 minutes) drives every periodic task, so the project stays
// within the 3 free scheduler jobs. This decides which tasks are due at a given tick.

export type Job =
  | 'calendar' | 'weather' | 'kidsnote' | 'morningBriefing' | 'eveningBriefing' | 'weeklyPreview' | 'journal' | 'dinner'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
/** Weekday dinner ideas are made at 07:00 (07:15 retries) so the 07:30 morning briefing can carry them. */
export const DINNER_HOUR = 7
/**
 * Kids Note reads, KST, kept few because Kids Note has no public API: before the 07:30 briefing, midday, after the
 * afternoon reports, before the 20:00 briefing and once late for "bring this tomorrow". Weekends have far fewer posts.
 * Claude only reads new posts, so the number of reads does not change Claude usage. Settings can read at once.
 */
export const KIDSNOTE_HOURS = { weekday: [7, 12, 16, 19, 22], weekend: [9, 19] } as const

/** KST hour, the quarter-hour slot (0/15/30/45) the tick belongs to, and the weekday (0 = Sunday); tolerates a late trigger. */
export function kstSlot(now: Date): { hour: number; quarter: number; weekday: number } {
  const k = new Date(now.getTime() + KST_OFFSET_MS)
  return { hour: k.getUTCHours(), quarter: Math.floor(k.getUTCMinutes() / 15) * 15, weekday: k.getUTCDay() }
}

const isWeekday = (wd: number) => wd >= 1 && wd <= 5

/** Weekday (Mon–Fri) from 07:00 KST to the end of the KST day: when today's dinner suggestions may be made. */
export function isDinnerTime(now: Date): boolean {
  const { hour, weekday } = kstSlot(now)
  return isWeekday(weekday) && hour >= DINNER_HOUR
}

export function dueJobs(now: Date): Job[] {
  const { hour, quarter, weekday } = kstSlot(now)
  const jobs: Job[] = ['calendar']
  if (quarter === 15) jobs.push('weather')
  const kidsnoteHours: readonly number[] = KIDSNOTE_HOURS[isWeekday(weekday) ? 'weekday' : 'weekend']
  if (quarter === 0 && kidsnoteHours.includes(hour)) jobs.push('kidsnote')
  if (hour === 7 && quarter === 30) jobs.push('morningBriefing')
  if (hour === DINNER_HOUR && (quarter === 0 || quarter === 15) && isWeekday(weekday)) jobs.push('dinner')
  if (hour === 20 && quarter === 0) {
    // Sunday evening: a preview of the coming week and the growth journal instead of the evening briefing.
    if (weekday === 0) jobs.push('weeklyPreview', 'journal')
    else jobs.push('eveningBriefing')
  }
  return jobs
}
