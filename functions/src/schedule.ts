// One Cloud Scheduler job (every 15 minutes) drives every periodic task, so the project stays
// within the 3 free scheduler jobs. This decides which tasks are due at a given tick.

export type Job =
  | 'calendar' | 'weather' | 'kidsnote' | 'morningBriefing' | 'eveningBriefing' | 'weeklyPreview' | 'journal' | 'dinner'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
/** Weekday dinner ideas are made at 07:00 (07:15 retries) so the 07:30 morning briefing can carry them. */
export const DINNER_HOUR = 7
/**
 * Kids Note reads, KST: on the hour from 07:00 (before the 07:30 briefing) to 22:00, so late-evening posts still land
 * the same night. Claude only reads new posts, so the number of reads does not change Claude usage.
 */
export const KIDSNOTE_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] as const

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
  if (quarter === 0 && (KIDSNOTE_HOURS as readonly number[]).includes(hour)) jobs.push('kidsnote')
  if (hour === 7 && quarter === 30) jobs.push('morningBriefing')
  if (hour === DINNER_HOUR && (quarter === 0 || quarter === 15) && isWeekday(weekday)) jobs.push('dinner')
  if (hour === 20 && quarter === 0) {
    // Sunday evening: a preview of the coming week and the growth journal instead of the evening briefing.
    if (weekday === 0) jobs.push('weeklyPreview', 'journal')
    else jobs.push('eveningBriefing')
  }
  return jobs
}
