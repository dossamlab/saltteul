// Data types shared by the web app and Cloud Functions.
// Dates are 'YYYY-MM-DD' strings (Asia/Seoul calendar), timestamps are epoch millis.

export type Ymd = string
export type Owner = 'husband' | 'wife' | 'both'
export type Role = 'husband' | 'wife'
export type Source = 'manual' | 'calendar' | 'kidsnote' | 'consumable'

export interface Member {
  uid: string
  email: string
  displayName: string
  role: Role
}

export interface Todo {
  id: string
  title: string
  note?: string
  date?: Ymd | null
  time?: string | null // 'HH:mm'
  owner: Owner
  done: boolean
  doneBy?: string | null
  doneAt?: number | null
  source: Source
  calendarEventId?: string | null
  kidsnoteBatchId?: string | null
  prepItems?: PrepItem[]
  updatedAt: number
  syncOrigin?: 'app' | 'calendar'
}

export interface PrepItem {
  name: string
  source: 'stated' | 'inferred' | 'rule'
}

export interface ShoppingItem {
  id: string
  name: string
  qty?: string
  note?: string
  addedBy: string
  bought: boolean
  boughtBy?: string | null
  boughtAt?: number | null
  source: Source
  consumableId?: string | null
  kidsnoteBatchId?: string | null
  createdAt: number
}

export type AnniversaryKind = 'together' | 'wedding' | 'birthday' | 'other'

export interface Anniversary {
  id: string
  kind: AnniversaryKind
  title: string
  date: Ymd // original date (year matters for 'together' and age counts)
  person?: string
  remindDays?: number[] // default [7, 1]
}

export interface Consumable {
  id: string
  name: string
  initialCycleDays: number
  purchases: Ymd[] // ascending
}

export interface PrepRule {
  id: string
  keyword: string
  items: string[]
}

export interface Routine {
  id: string
  title: string
  owner: Owner
  weekdays?: number[] | null // 0=Sun..6=Sat; empty/null = every day
  order: number
  active: boolean
}

export interface RoutineLog {
  routineId: string
  day: Ymd
  doneBy: string
  doneAt: number
}

export interface Chore {
  id: string
  title: string
  owner: Owner
  cycleDays: number
  lastDone?: Ymd | null
  createdDay: Ymd
  history?: { day: Ymd; by: string; at: number }[]
}

export interface Briefing {
  id: string
  day: Ymd
  slot: 'morning' | 'evening' | 'weekly'
  headline: string
  lines: string[]
  createdAt: number
  model: string | null // null = fallback
  failed?: boolean
}

export interface Nudge {
  id: string
  from: string
  to: string
  targetType?: 'todo' | 'shopping' | 'routine' | 'chore' | null
  targetId?: string | null
  targetTitle?: string | null
  message?: string
  read: boolean
  createdAt: number
}

export interface WeatherDay {
  day: Ymd
  minC: number | null
  maxC: number | null
  popMax: number | null // precipitation probability %
  sky: 'clear' | 'partly' | 'cloudy' | 'rain' | 'snow' | 'rainsnow' | 'shower' | null
  rainFrom?: string | null // 'HH:00' first hour with PoP >= 60
}

export interface Settings {
  familyName: string
  location?: { label: string; lat: number; lon: number } | null
  briefingTimes: { morning: string; evening: string }
  calendarId?: string | null
  weather?: { updatedAt: number; days: WeatherDay[] } | null
  /** The child's Kids Note class chosen in settings; null/absent = the class Kids Note has on record. */
  kidsnoteClassId?: string | null
}

/** One class of the daycare as Kids Note lists it. */
export interface KidsnoteClass {
  id: string
  name: string
}

/**
 * One proposed change from quick add or a newsletter photo/PDF. The server only proposes;
 * the app shows a confirmation list and writes the items the user keeps.
 */
export type QuickItem =
  | { kind: 'todo'; title: string; date: Ymd | null; time: string | null; owner: Owner; note?: string | null; prepItems?: PrepItem[] }
  | { kind: 'shopping'; name: string; qty: string | null; note: string | null }
  | { kind: 'routineDone'; routineId: string; title: string }
  | { kind: 'choreDone'; choreId: string; title: string }

export interface QuickAddResult {
  items: QuickItem[]
  /** Parts of the text Claude could not turn into an item (shown to the user as-is). */
  unparsed: string[]
  model: string
}

/** households/{hid}/journal/{weekStart}: weekly growth journal written from the week's Kids Note notices. */
export interface JournalEntry {
  id: string
  weekStart: Ymd // Monday
  weekEnd: Ymd // Sunday
  childName: string
  title: string
  lines: string[]
  reportCount: number
  createdAt: number
  model: string
}

export interface DinnerOption {
  name: string
  why: string
  ingredients: string[]
}

/** households/{hid}/dinner/{day}: weekday dinner suggestions that avoid the daycare menu. */
export interface DinnerSuggestion {
  id: string
  day: Ymd
  daycareMenu: { lunch: string[]; snack: string[] } | null
  options: DinnerOption[]
  createdAt: number
  model: string
}

/** One day of the daycare's monthly menu. Empty lists where the menu has nothing (weekends, holidays). */
export interface DayMenu {
  lunch: string[]
  morningSnack: string[]
  afternoonSnack: string[]
}

/** households/{hid}/menus/{YYYY-MM}: the monthly menu sheet a member uploaded and checked. */
export interface MonthlyMenu {
  id: string
  month: string // YYYY-MM
  days: Record<Ymd, DayMenu>
  updatedAt: number
  updatedBy: string
}

/** extractMenu callable result: a proposal only, the app saves what the user checked. */
export interface MenuExtractResult {
  month: string
  days: ({ date: Ymd } & DayMenu)[]
  model: string
}

export interface IntegrationState {
  name: 'calendar' | 'kidsnote' | 'weather' | 'claude'
  lastSuccessAt?: number | null
  consecutiveFailures: number
  lastError?: string | null
  /** kidsnote only: the daycare's classes and the child's class on record, refreshed by each poll. */
  classes?: KidsnoteClass[]
  detectedClassId?: string | null
}
