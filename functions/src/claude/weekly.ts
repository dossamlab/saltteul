// Sunday 20:00: a preview of the coming Monday–Sunday instead of the evening briefing.
import { upcoming } from '../../../shared/anniversaries'
import type { BriefTodo, HouseholdSnapshot } from '../../../shared/briefingInput'
import { choreNextDue } from '../../../shared/chores'
import { dueSoon } from '../../../shared/consumables'
import { addDays, diffDays, householdDate, weekdayOf } from '../../../shared/householdDate'
import type { Briefing, Todo } from '../../../shared/types'
import type { T } from '../copy'
import { HID } from '../household'
import { recordIntegration } from '../integrations'
import { memberUids } from '../members'
import { sendToMembers } from '../notify/send'
import { loadSnapshot } from '../snapshot'
import type { BriefingDeps } from './briefing'
import type { WeeklyInput } from './inputs'
import { MAX_BRIEFING_LINES } from './schemas'

export const WEEK_DAYS = 7

const brief = (t: Todo): BriefTodo => ({
  title: t.title,
  time: t.time ?? null,
  owner: t.owner,
  fromKidsnote: t.source === 'kidsnote',
  prepItems: t.prepItems ?? [],
})
const byTime = (a: BriefTodo, b: BriefTodo) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99')

/** The next 7 household days after `now` (Monday..Sunday when run on Sunday evening). */
export function buildWeeklyInput(s: HouseholdSnapshot, now: Date): WeeklyInput {
  const today = householdDate(now)
  const from = addDays(today, 1)
  const to = addDays(today, WEEK_DAYS)
  const open = s.todos.filter((t) => !t.done)

  const days = Array.from({ length: WEEK_DAYS }, (_, i) => {
    const day = addDays(from, i)
    return {
      day,
      weekday: weekdayOf(day),
      todos: open.filter((t) => t.date === day).map(brief).sort(byTime),
      weather: s.settings.weather?.days.find((w) => w.day === day) ?? null,
    }
  })

  // A chore already due counts from Monday; later turns follow its cycle.
  const chores = s.chores
    .map((c) => {
      const due = choreNextDue(c)
      const dates: string[] = []
      let d = diffDays(due, from) > 0 ? from : due
      while (diffDays(d, to) >= 0 && dates.length < WEEK_DAYS) {
        dates.push(d)
        d = addDays(d, Math.max(1, c.cycleDays))
      }
      return { title: c.title, owner: c.owner, dates, overdueDays: Math.max(0, diffDays(due, today)) }
    })
    .filter((c) => c.dates.length)

  return {
    from,
    to,
    names: {
      husband: s.members.find((m) => m.role === 'husband')?.displayName ?? '',
      wife: s.members.find((m) => m.role === 'wife')?.displayName ?? '',
      both: '',
    },
    days,
    chores,
    anniversaries: upcoming(s.anniversaries, today, s.anniversaries.length).filter((a) => a.daysLeft >= 1 && a.daysLeft <= WEEK_DAYS),
    consumablesDue: dueSoon(s.consumables, today, WEEK_DAYS).map((c) => ({ name: c.name, daysLeft: c.daysLeft })),
    undatedOpenCount: open.filter((t) => !t.date).length,
  }
}

export function isEmptyWeekly(i: WeeklyInput): boolean {
  return i.days.every((d) => d.todos.length === 0) && !i.chores.length && !i.anniversaries.length && !i.consumablesDue.length
}

/** Plain preview from copy keys, used when Claude fails or there is nothing to say. */
export function fallbackWeekly(i: WeeklyInput, t: T): { headline: string; lines: string[] } {
  const lines: string[] = []
  const wd = (day: string) => t(`weekday.${weekdayOf(day)}`)
  for (const d of i.days) {
    if (!d.todos.length) continue
    lines.push(t('brief.fb.weekDay', { weekday: wd(d.day), count: d.todos.length, titles: d.todos.slice(0, 3).map((x) => x.title).join(', ') }))
  }
  for (const a of i.anniversaries) lines.push(t('brief.fb.annivSoon', { title: a.title, days: a.daysLeft }))
  for (const c of i.chores) lines.push(t('brief.fb.weekChore', { title: c.title, weekday: wd(c.dates[0]) }))
  for (const c of i.consumablesDue) lines.push(t('brief.fb.consumable', { name: c.name, days: Math.max(0, c.daysLeft) }))
  if (!lines.length) lines.push(t('brief.fb.weekEmpty'))
  return { headline: t('brief.fb.headlineWeekly'), lines: lines.slice(0, MAX_BRIEFING_LINES) }
}

/** snapshot → WeeklyInput → Claude (or the plain fallback) → briefings/{day}_weekly → push to both members. */
export async function runWeeklyPreview(deps: BriefingDeps, now: Date = new Date()): Promise<Briefing> {
  const { db, messaging, claude, t } = deps
  const input = buildWeeklyInput(await loadSnapshot(db, now), now)
  const day = householdDate(now)

  let result: { headline: string; lines: string[] }
  let model: string | null = null
  let failed = false
  if (isEmptyWeekly(input)) {
    result = fallbackWeekly(input, t)
  } else {
    try {
      const r = await claude.writeWeekly(input)
      result = { headline: r.headline, lines: r.lines }
      model = r.model
      await recordIntegration(db, 'claude', true, undefined, now.getTime())
    } catch (e) {
      deps.log?.('weekly: claude failed, using fallback', e instanceof Error ? e.message : e)
      result = fallbackWeekly(input, t)
      failed = true
      await recordIntegration(db, 'claude', false, e, now.getTime())
    }
  }

  const id = `${day}_weekly`
  const doc: Briefing = { id, day, slot: 'weekly', headline: result.headline, lines: result.lines, createdAt: now.getTime(), model, failed }
  await db.doc(`households/${HID}/briefings/${id}`).set(doc)
  await sendToMembers(db, messaging, await memberUids(db), {
    title: t('push.briefing.titleWeekly'),
    body: result.headline,
    data: { type: 'briefing', briefingId: id },
  })
  return doc
}
