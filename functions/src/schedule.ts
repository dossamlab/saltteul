// One Cloud Scheduler job (every 15 minutes) drives every periodic task, so the project stays
// within the 3 free scheduler jobs. This decides which tasks are due at a given tick.

export type Job =
  | 'calendar' | 'weather' | 'kidsnote' | 'morningBriefing' | 'eveningBriefing' | 'weeklyPreview' | 'journal' | 'dinner'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
export const DINNER_HOUR = 15
/**
 * Kids Note reads, KST: 07:00 just before the 07:30 briefing, 19:00 before the 20:00 one, and three in between for
 * newsletters and the afternoon reports. 「지금 가져오기」 in settings still reads on demand.
 */
export const KIDSNOTE_HOURS = [7, 10, 13, 16, 19] as const

/** KST hour, the quarter-hour slot (0/15/30/45) the tick belongs to, and the weekday (0 = Sunday); tolerates a late trigger. */
export function kstSlot(now: Date): { hour: number; quarter: number; weekday: number } {
  const k = new Date(now.getTime() + KST_OFFSET_MS)
  return { hour: k.getUTCHours(), quarter: Math.floor(k.getUTCMinutes() / 15) * 15, weekday: k.getUTCDay() }
}

const isWeekday = (wd: number) => wd >= 1 && wd <= 5

/** Weekday (Mon–Fri) from 15:00 KST to the end of the KST day: when today's dinner suggestions may be made. */
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
  if (hour === DINNER_HOUR && quarter === 0 && isWeekday(weekday)) jobs.push('dinner')
  if (hour === 20 && quarter === 0) {
    // Sunday evening: a preview of the coming week and the growth journal instead of the evening briefing.
    if (weekday === 0) jobs.push('weeklyPreview', 'journal')
    else jobs.push('eveningBriefing')
  }
  return jobs
}
