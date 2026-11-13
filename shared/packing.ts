// Trip packing list rules shared by the app and the evening briefing: counting from the base list, recounting when the
// trip changes, the return check, the review after the trip, the forecast suggestions and when a trip shows on home.
import type { T } from './copy'
import { addDays, diffDays } from './householdDate'
import type { PackRule, PackTab, PackingBaseItem, Trip, TripItem, Ymd } from './types'

export const PACK_TABS: PackTab[] = ['kid', 'wife', 'husband', 'both']

/** The home card shows a trip from this many days before it starts through the return day. */
export const HOME_DAYS_BEFORE = 7
/** Open-Meteo forecasts 16 days: today and the next 15. */
export const FORECAST_DAYS = 16
/** Rain chance (%) at or above this suggests an umbrella and a raincoat. */
export const RAIN_TIP_POP = 60
/** A low (°C) at or below this suggests a jacket. */
export const COLD_TIP_C = 10
/** Unreviewed trips stay at the top of the trip section for this many days after the return day. */
export const REVIEW_OFFER_DAYS = 14

/** A day trip is 0 nights and 1 day. */
export const tripDays = (nights: number) => nights + 1

/** The last day of the trip, the day the family comes home. */
export const returnDay = (trip: Pick<Trip, 'start' | 'nights'>): Ymd => addDays(trip.start, trip.nights)

export type TripPhase = 'upcoming' | 'ongoing' | 'past'

export function tripPhase(trip: Pick<Trip, 'start' | 'nights'>, today: Ymd): TripPhase {
  if (today < trip.start) return 'upcoming'
  return today <= returnDay(trip) ? 'ongoing' : 'past'
}

/** Upcoming and ongoing trips soonest first, then past trips latest first. */
export function sortTrips<X extends Pick<Trip, 'start' | 'nights' | 'createdAt'>>(trips: X[], today: Ymd): X[] {
  const past = (x: X) => tripPhase(x, today) === 'past'
  return [...trips].sort((a, b) => {
    if (past(a) !== past(b)) return past(a) ? 1 : -1
    const byStart = past(a) ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)
    return byStart || a.createdAt - b.createdAt
  })
}

/**
 * How many to pack: fixed n, n for each day or n for each night, plus extra. perPerson multiplies by the number of
 * children (kid tab only; the wife, husband and shared tabs pack one share). overnightOnly is 0 on a day trip.
 */
export function packCount(rule: PackRule, nights: number, kids: number, tab: PackTab): number {
  if (rule.overnightOnly && nights <= 0) return 0
  const times = rule.kind === 'perDay' ? tripDays(nights) : rule.kind === 'perNight' ? nights : 1
  const one = Math.max(0, Math.round(rule.n)) * times + Math.max(0, Math.round(rule.extra))
  return tab === 'kid' && rule.perPerson ? one * Math.max(1, Math.round(kids)) : one
}

export const ruleOf = (b: PackRule): PackRule => ({
  kind: b.kind, n: b.n, extra: b.extra, overnightOnly: b.overnightOnly, perPerson: b.perPerson,
})

export type TripItemDraft = Omit<TripItem, 'id' | 'tripId'>

/** The trip's own copy of the base list, counted for this trip. Lines counted to 0 are kept (hidden) for a recount. */
export function itemsFromBase(base: PackingBaseItem[], nights: number, kids: number): TripItemDraft[] {
  return [...base].sort((a, b) => a.order - b.order).map((b) => ({
    name: b.name, category: b.category, tab: b.tab, qty: packCount(b, nights, kids, b.tab), auto: true, rule: ruleOf(b),
    baseId: b.id, order: b.order, packed: false, packedBy: null, returned: false, review: null,
  }))
}

/** New counts after the nights or the number of children changed. Only lines still counted by rule change. */
export function recount(items: TripItem[], nights: number, kids: number): { id: string; qty: number }[] {
  return items.flatMap((x) => {
    if (!x.auto || !x.rule) return []
    const qty = packCount(x.rule, nights, kids, x.tab)
    return qty === x.qty ? [] : [{ id: x.id, qty }]
  })
}

/** Lines counted to 0 (overnight-only things on a day trip) are not shown or counted. */
export const isShown = (x: Pick<TripItem, 'qty'>) => x.qty > 0

export function tabItems<X extends Pick<TripItem, 'tab' | 'qty'>>(items: X[], tab: PackTab): X[] {
  return items.filter((x) => x.tab === tab && isShown(x))
}

/** Packed / shown lines, for a tab or for the whole trip. */
export function progress(items: Pick<TripItem, 'tab' | 'qty' | 'packed'>[], tab?: PackTab): { packed: number; total: number } {
  const shown = items.filter((x) => isShown(x) && (!tab || x.tab === tab))
  return { packed: shown.filter((x) => x.packed).length, total: shown.length }
}

/** On the way home: lines packed back / lines that were packed. */
export function returnProgress(items: Pick<TripItem, 'tab' | 'qty' | 'packed' | 'returned'>[], tab?: PackTab) {
  const taken = items.filter((x) => isShown(x) && x.packed && (!tab || x.tab === tab))
  return { returned: taken.filter((x) => x.returned).length, total: taken.length }
}

/** Lines grouped by category, groups and lines in list order. */
export function groupByCategory<X extends Pick<TripItem, 'category' | 'order'>>(items: X[]): { category: string; items: X[] }[] {
  const groups = new Map<string, X[]>()
  for (const x of [...items].sort((a, b) => a.order - b.order)) {
    const g = groups.get(x.category)
    if (g) g.push(x)
    else groups.set(x.category, [x])
  }
  return [...groups].map(([category, list]) => ({ category, items: list }))
}

/** Order for a line added at the end. */
export const nextOrder = (items: { order: number }[]) => items.reduce((m, x) => Math.max(m, x.order), 0) + 1

/** The 「돌아갈 짐 챙기기」 button shows from the last day of the trip. */
export const canReturnCheck = (trip: Pick<Trip, 'start' | 'nights'>, today: Ymd) => today >= returnDay(trip)

/** The review after the trip is offered from the day after the return day until it is finished. */
export const canReview = (trip: Pick<Trip, 'start' | 'nights' | 'reviewedAt'>, today: Ymd) =>
  today > returnDay(trip) && !trip.reviewedAt

/** Unreviewed trips stay near the top for a while after coming home; later they wait under past trips. */
export const reviewOffered = (trip: Pick<Trip, 'start' | 'nights' | 'reviewedAt'>, today: Ymd) =>
  canReview(trip, today) && diffDays(returnDay(trip), today) <= REVIEW_OFFER_DAYS

/** The home card shows from 7 days before the start through the return day, soonest first. */
export function homeTrips<X extends Pick<Trip, 'start' | 'nights' | 'createdAt'>>(trips: X[], today: Ymd): X[] {
  return sortTrips(trips.filter((x) => diffDays(today, x.start) <= HOME_DAYS_BEFORE && today <= returnDay(x)), today)
}

/** Days until the start (0 on the day, negative once the trip has started). */
export const daysToStart = (trip: Pick<Trip, 'start'>, today: Ymd) => diffDays(today, trip.start)

export type ReviewProposal =
  | { kind: 'more'; baseId: string; name: string; from: number; to: number }
  | { kind: 'remove'; baseId: string; name: string }

/**
 * Changes to the base list after the trip: one more of each line marked short, and removing a line marked unused for
 * the second trip in a row. Lines added by hand or removed from the base list since are left out.
 */
export function reviewProposals(items: TripItem[], base: PackingBaseItem[]): ReviewProposal[] {
  const out: ReviewProposal[] = []
  const seen = new Set<string>()
  for (const x of [...items].sort((a, b) => a.order - b.order)) {
    const b = x.baseId ? base.find((y) => y.id === x.baseId) : undefined
    if (!b || !x.review || seen.has(b.id)) continue
    seen.add(b.id)
    if (x.review === 'short') out.push({ kind: 'more', baseId: b.id, name: b.name, from: b.n, to: b.n + 1 })
    else if ((b.unusedStreak ?? 0) + 1 >= 2) out.push({ kind: 'remove', baseId: b.id, name: b.name })
  }
  return out
}

/** Unused streaks after the review: +1 when marked unused, back to 0 when packed and used, unchanged otherwise. */
export function streakUpdates(items: TripItem[], base: PackingBaseItem[]): { id: string; unusedStreak: number }[] {
  const next = new Map<string, number>()
  for (const x of items) {
    const b = x.baseId ? base.find((y) => y.id === x.baseId) : undefined
    if (!b || next.has(b.id)) continue
    if (x.review === 'unused') next.set(b.id, (b.unusedStreak ?? 0) + 1)
    else if (x.packed && isShown(x)) next.set(b.id, 0)
  }
  return [...next]
    .filter(([id, n]) => (base.find((b) => b.id === id)!.unusedStreak ?? 0) !== n)
    .map(([id, unusedStreak]) => ({ id, unusedStreak }))
}

/** The trip days the forecast can see, or null (no place, already over, or starting more than 15 days out). */
export function forecastRange(trip: Pick<Trip, 'start' | 'nights' | 'place'>, today: Ymd): { from: Ymd; to: Ymd } | null {
  if (!trip.place) return null
  const last = addDays(today, FORECAST_DAYS - 1)
  const end = returnDay(trip)
  if (trip.start > last || end < today) return null
  return { from: trip.start > today ? trip.start : today, to: end < last ? end : last }
}

export interface TripForecastDay {
  day: Ymd
  popMax: number | null
  minC: number | null
}

export type WeatherTip = { kind: 'rain'; pop: number; items: string[] } | { kind: 'cold'; minC: number; items: string[] }

/** Item keys (trip.tip.item.*) each tip suggests. */
export const TIP_ITEMS = { rain: ['umbrella', 'raincoat'], cold: ['jacket'] } as const

/** Rain chance 60% or more on any trip day: umbrella and raincoat; a low of 10°C or less: a jacket. */
export function weatherTips(days: TripForecastDay[]): WeatherTip[] {
  const tips: WeatherTip[] = []
  const pops = days.map((d) => d.popMax).filter((v): v is number => typeof v === 'number')
  const mins = days.map((d) => d.minC).filter((v): v is number => typeof v === 'number')
  const pop = pops.length ? Math.max(...pops) : null
  const minC = mins.length ? Math.min(...mins) : null
  if (pop !== null && pop >= RAIN_TIP_POP) tips.push({ kind: 'rain', pop, items: [...TIP_ITEMS.rain] })
  if (minC !== null && minC <= COLD_TIP_C) tips.push({ kind: 'cold', minC, items: [...TIP_ITEMS.cold] })
  return tips
}

/** Lines not packed yet, in all and per tab (tabs with none left out). */
export function unpackedSummary(items: Pick<TripItem, 'tab' | 'qty' | 'packed'>[]): { total: number; byTab: { tab: PackTab; n: number }[] } {
  const open = items.filter((x) => isShown(x) && !x.packed)
  return {
    total: open.length,
    byTab: PACK_TABS.map((tab) => ({ tab, n: open.filter((x) => x.tab === tab).length })).filter((x) => x.n > 0),
  }
}

/**
 * Evening briefing lines for trips leaving tomorrow, e.g. 「아직 안 챙긴 짐 7개(아이 5, 엄마 2)」. Written without Claude.
 * The trip name is added only when more than one trip leaves tomorrow.
 */
export function packingBriefLines(trips: Trip[], items: TripItem[], day: Ymd, t: T): string[] {
  const leaving = trips.filter((x) => x.start === addDays(day, 1)).sort((a, b) => a.createdAt - b.createdAt)
  return leaving.flatMap((trip) => {
    const s = unpackedSummary(items.filter((x) => x.tripId === trip.id))
    if (!s.total) return []
    const vars = { n: s.total, tabs: s.byTab.map((x) => `${t(`trip.tab.${x.tab}`)} ${x.n}`).join(', '), name: trip.name }
    return [t(leaving.length > 1 ? 'brief.fb.packingLeftNamed' : 'brief.fb.packingLeft', vars)]
  })
}

/** Categories offered when adding a line, in this order; categories already used in the list come first. */
export const DEFAULT_CATEGORIES = ['위생', '잠자리', '씻기', '상비약', '먹을 것', '식기', '옷·소품', '기타']
/** Category a line typed by hand starts in until another is picked. */
export const OTHER_CATEGORY = '기타'

export function categoryChoices(used: { category: string; order: number }[]): string[] {
  const inUse = groupByCategory(used).map((g) => g.category)
  return [...new Set([...inUse, ...DEFAULT_CATEGORIES])]
}

type DefaultLine = [category: string, names: string[], rule: Partial<PackRule>]

const fixed1: Partial<PackRule> = { kind: 'fixed', n: 1 }
const overnight: Partial<PackRule> = { kind: 'fixed', n: 1, overnightOnly: true }

/** The kid tab's list the first time packing is used. The wife, husband and shared tabs start empty. */
const DEFAULT_KID_LINES: DefaultLine[] = [
  ['위생', ['물티슈', '건티슈', '소독티슈'], fixed1],
  ['위생', ['기저귀'], { kind: 'perDay', n: 6, perPerson: true }],
  ['잠자리', ['인형'], fixed1],
  ['잠자리', ['베개', '담요', '백색소음기'], overnight],
  ['씻기', ['로션', '칫솔', '치약', '손세정제', '수건'], fixed1],
  ['씻기', ['워시', '샴푸'], overnight],
  ['상비약', ['챔프 빨강', '맥시부펜', '비판텐', '밴드', '백초시럽', '약병'], fixed1],
  ['먹을 것', ['보리차', '우유', '주스', '카레', '두부'], fixed1],
  ['식기', ['일회용 빨대', '일회용 턱받이', '수저', '포크', '젓가락'], fixed1],
  ['옷·소품', ['머리끈', '빗'], fixed1],
  ['옷·소품', ['양말', '나시'], { kind: 'perDay', n: 1, extra: 1, perPerson: true }],
]

/** The default kid list with fixed ids, so two phones seeding at the same moment write the same documents. */
export function defaultBase(): PackingBaseItem[] {
  let order = 0
  return DEFAULT_KID_LINES.flatMap(([category, names, rule]) => names.map((name) => {
    order++
    return {
      id: `default-kid-${String(order).padStart(2, '0')}`, name, category, tab: 'kid' as const, order,
      kind: 'fixed' as const, n: 1, extra: 0, overnightOnly: false, perPerson: false, ...rule,
    }
  }))
}
