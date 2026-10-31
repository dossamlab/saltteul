import { remindersForToday, togetherDays, type UpcomingAnniversary } from './anniversaries'
import { choreStatus, sortChores, type ChoreStatus } from './chores'
import { dueSoon } from './consumables'
import { addDays, householdDate } from './householdDate'
import { daysToExpiry, expiresSoon, isLow, qtyLabel, sortPantry } from './pantry'
import { isRoutineDone, routinesForDay } from './routines'
import type {
  Anniversary, Chore, Consumable, Member, Owner, PantryItem, PrepItem, Routine, RoutineLog, Settings, ShoppingItem, Todo, WeatherDay, Ymd,
} from './types'

export interface HouseholdSnapshot {
  members: Member[]
  todos: Todo[]
  shopping: ShoppingItem[]
  routines: Routine[]
  routineLogs: RoutineLog[]
  chores: Chore[]
  anniversaries: Anniversary[]
  consumables: Consumable[]
  /** Pantry (상비품); optional so older snapshots and tests stay valid. */
  pantry?: PantryItem[]
  settings: Settings
}

export interface BriefTodo {
  title: string
  time: string | null
  owner: Owner
  fromKidsnote: boolean
  prepItems: PrepItem[]
}

export interface BriefingInput {
  slot: 'morning' | 'evening'
  day: Ymd // the household day the briefing is about ("today")
  focusDay: Ymd // morning: today, evening: tomorrow
  names: Record<Owner, string>
  weather: WeatherDay | null // for focusDay
  focusTodos: BriefTodo[] // todos dated focusDay, not done
  todayLeft: BriefTodo[] // evening only: today's todos still open
  undatedOpenCount: number
  routinesLeft: { title: string; owner: Owner }[] // evening only
  chores: { title: string; owner: Owner; status: ChoreStatus }[] // morning only: today + overdue
  anniversaries: UpcomingAnniversary[]
  togetherDays: number | null
  consumablesDue: { name: string; daysLeft: number }[]
  /** Pantry items at or below their minimum, with the count left (e.g. "2팩"). */
  pantryLow: { name: string; left: string }[]
  /** morning only: pantry items whose expiry is within 7 days (days < 0 = past). */
  pantryExpiring: { name: string; days: number }[]
  shoppingLeft: string[]
}

function brief(t: Todo): BriefTodo {
  return {
    title: t.title,
    time: t.time ?? null,
    owner: t.owner,
    fromKidsnote: t.source === 'kidsnote',
    prepItems: t.prepItems ?? [],
  }
}

const byTime = (a: BriefTodo, b: BriefTodo) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99')

export function buildBriefingInput(s: HouseholdSnapshot, now: Date, slot: 'morning' | 'evening'): BriefingInput {
  const day = householdDate(now)
  const focusDay = slot === 'morning' ? day : addDays(day, 1)
  const open = s.todos.filter((t) => !t.done)
  const husband = s.members.find((m) => m.role === 'husband')?.displayName ?? ''
  const wife = s.members.find((m) => m.role === 'wife')?.displayName ?? ''
  const together = s.anniversaries.find((a) => a.kind === 'together')

  return {
    slot,
    day,
    focusDay,
    names: { husband, wife, both: '' },
    weather: s.settings.weather?.days.find((d) => d.day === focusDay) ?? null,
    focusTodos: open.filter((t) => t.date === focusDay).map(brief).sort(byTime),
    todayLeft: slot === 'evening' ? open.filter((t) => t.date === day).map(brief).sort(byTime) : [],
    undatedOpenCount: open.filter((t) => !t.date).length,
    routinesLeft:
      slot === 'evening'
        ? routinesForDay(s.routines, day)
            .filter((r) => !isRoutineDone(s.routineLogs, r.id, day))
            .map((r) => ({ title: r.title, owner: r.owner }))
        : [],
    chores:
      slot === 'morning'
        ? sortChores(s.chores, day)
            .map((c) => ({ title: c.title, owner: c.owner, status: choreStatus(c, day) }))
            .filter((c) => c.status.kind !== 'left')
        : [],
    anniversaries: remindersForToday(s.anniversaries, focusDay),
    togetherDays: together ? togetherDays(together.date, day) : null,
    consumablesDue: dueSoon(s.consumables, day, 5).map((c) => ({ name: c.name, daysLeft: c.daysLeft })),
    pantryLow: sortPantry(s.pantry ?? [], day).filter(isLow).map((p) => ({ name: p.name, left: qtyLabel(p) })),
    pantryExpiring:
      slot === 'morning'
        ? sortPantry(s.pantry ?? [], day).filter((p) => expiresSoon(p, day)).map((p) => ({ name: p.name, days: daysToExpiry(p, day)! }))
        : [],
    shoppingLeft: s.shopping.filter((i) => !i.bought).map((i) => i.name),
  }
}

/** True when there is nothing worth saying. */
export function isEmptyBriefing(i: BriefingInput): boolean {
  return (
    i.focusTodos.length === 0 && i.todayLeft.length === 0 && i.routinesLeft.length === 0 &&
    i.chores.length === 0 && i.anniversaries.length === 0 && i.consumablesDue.length === 0 &&
    i.pantryLow.length === 0 && i.pantryExpiring.length === 0 && !i.weather
  )
}
