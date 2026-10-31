// What each Claude call receives. Kept apart from client.ts so feature modules and the client share them.
import type { UpcomingAnniversary } from '../../../shared/anniversaries'
import type { BriefTodo } from '../../../shared/briefingInput'
import type { Owner, Role, WeatherDay, Ymd } from '../../../shared/types'

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type ImageType = (typeof IMAGE_TYPES)[number]
export type AttachmentType = ImageType | 'application/pdf'

/** A file sent to Claude as an image or document block. */
export interface Attachment {
  mediaType: AttachmentType
  dataBase64: string
  name?: string
}

export interface QuickAddInput {
  today: Ymd
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number
  /** 'HH:mm' KST, so phrases like "this evening" can be placed */
  nowTime: string
  /** null when the caller's member document is missing */
  speaker: { role: Role; name: string } | null
  names: { husband: string; wife: string }
  /** Routines shown today, with whether they are already checked */
  routines: { id: string; title: string; owner: Owner; doneToday: boolean }[]
  chores: { id: string; title: string; owner: Owner }[]
  openShopping: string[]
  /** Pantry items (상비품) with their current count */
  pantry: { id: string; name: string; unit: string; qty: number; aliases: string[] }[]
  text: string
}

export interface WeeklyDay {
  day: Ymd
  weekday: number
  todos: BriefTodo[]
  weather: WeatherDay | null
}

export interface WeeklyInput {
  /** First and last household day of the preview (Monday..Sunday when run on Sunday evening) */
  from: Ymd
  to: Ymd
  names: Record<Owner, string>
  days: WeeklyDay[]
  /** Chores whose turn falls inside the week; overdueDays > 0 when the turn has already passed */
  chores: { title: string; owner: Owner; dates: Ymd[]; overdueDays: number }[]
  anniversaries: UpcomingAnniversary[]
  consumablesDue: { name: string; daysLeft: number }[]
  undatedOpenCount: number
}

export interface JournalInput {
  childName: string
  weekStart: Ymd
  weekEnd: Ymd
  reports: { written: Ymd; text: string }[]
}

export interface MenuInput {
  month: string // YYYY-MM
  file: Attachment
}

export interface DinnerInput {
  day: Ymd
  weekday: number
  daycareMenu: { lunch: string[]; snack: string[] } | null
  /** Daycare menus of the days before and after (not today), oldest first; empty when no sheet covers them */
  nearbyMenus: { day: Ymd; weekday: number; lunch: string[]; snack: string[] }[]
  /** Dish names suggested on the last few days, to avoid repeats */
  recent: string[]
}
