import { diffDays, isValidYmd, makeYmd } from './householdDate'
import type { Anniversary, Ymd } from './types'

function onYear(original: Ymd, year: number): Ymd {
  const [, m, d] = original.split('-').map(Number)
  if (m === 2 && d === 29 && !isValidYmd(year, 2, 29)) return makeYmd(year, 2, 28)
  return makeYmd(year, m, d)
}

/** Next yearly occurrence on or after today. */
export function nextOccurrence(original: Ymd, today: Ymd): Ymd {
  const year = Number(today.slice(0, 4))
  const thisYear = onYear(original, year)
  return diffDays(today, thisYear) >= 0 ? thisYear : onYear(original, year + 1)
}

export function dDay(target: Ymd, today: Ymd): number {
  return diffDays(today, target)
}

/** Korean-style count: the start day is day 1. */
export function togetherDays(start: Ymd, today: Ymd): number {
  return diffDays(start, today) + 1
}

export interface UpcomingAnniversary {
  id: string
  title: string
  kind: Anniversary['kind']
  person?: string
  next: Ymd
  daysLeft: number
  years: number // how many years it will be on `next`
}

/** Yearly anniversaries sorted by days left. The 'together' kind is a day counter, so it is excluded. */
export function upcoming(list: Anniversary[], today: Ymd, limit: number): UpcomingAnniversary[] {
  return list
    .filter((a) => a.kind !== 'together')
    .map((a) => {
      const next = nextOccurrence(a.date, today)
      return {
        id: a.id,
        title: a.title,
        kind: a.kind,
        person: a.person,
        next,
        daysLeft: diffDays(today, next),
        years: Number(next.slice(0, 4)) - Number(a.date.slice(0, 4)),
      }
    })
    .sort((x, y) => x.daysLeft - y.daysLeft)
    .slice(0, limit)
}

/** Anniversaries whose reminder day (default 7 and 1 days before, plus the day itself) is today. */
export function remindersForToday(list: Anniversary[], today: Ymd): UpcomingAnniversary[] {
  return upcoming(list, today, list.length).filter((u) => {
    const a = list.find((x) => x.id === u.id)
    const days = a?.remindDays ?? [7, 1]
    return u.daysLeft === 0 || days.includes(u.daysLeft)
  })
}
