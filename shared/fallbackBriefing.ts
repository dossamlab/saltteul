import type { BriefingInput } from './briefingInput'
import type { T } from './copy'

/** Plain briefing built from the same input when Claude is unavailable. Text comes from copy keys. */
export function fallbackBriefing(i: BriefingInput, t: T): { headline: string; lines: string[] } {
  const lines: string[] = []
  const ownerName = (o: 'husband' | 'wife' | 'both') => (o === 'both' ? t('owner.both') : i.names[o] || t(`owner.${o}`))

  if (i.weather) {
    lines.push(
      t('brief.fb.weather', {
        min: i.weather.minC ?? '-',
        max: i.weather.maxC ?? '-',
        pop: i.weather.popMax ?? 0,
      }),
    )
  }
  for (const td of i.focusTodos) {
    const key = td.time ? 'brief.fb.todoTimed' : 'brief.fb.todo'
    lines.push(t(key, { title: td.title, time: td.time ?? '', owner: ownerName(td.owner) }))
    const items = td.prepItems.map((p) => p.name)
    if (items.length) lines.push(t('brief.fb.prep', { title: td.title, items: items.join(', ') }))
  }
  if (i.todayLeft.length) lines.push(t('brief.fb.todayLeft', { count: i.todayLeft.length }))
  if (i.routinesLeft.length) {
    lines.push(t('brief.fb.routinesLeft', { count: i.routinesLeft.length, titles: i.routinesLeft.map((r) => r.title).join(', ') }))
  }
  for (const c of i.chores) {
    lines.push(
      c.status.kind === 'today'
        ? t('brief.fb.choreToday', { title: c.title })
        : t('brief.fb.choreOverdue', { title: c.title, days: c.status.days }),
    )
  }
  for (const a of i.anniversaries) {
    lines.push(a.daysLeft === 0 ? t('brief.fb.annivToday', { title: a.title }) : t('brief.fb.annivSoon', { title: a.title, days: a.daysLeft }))
  }
  for (const c of i.consumablesDue) {
    lines.push(t('brief.fb.consumable', { name: c.name, days: Math.max(c.daysLeft, 0) }))
  }
  if (lines.length === 0) lines.push(t('brief.fb.empty'))

  return { headline: t(i.slot === 'morning' ? 'brief.fb.headlineMorning' : 'brief.fb.headlineEvening'), lines }
}
