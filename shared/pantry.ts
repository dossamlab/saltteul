// Pantry (상비품) rules shared by the app and the server. The Android widget repeats isLow / expiresSoon / sortPantry in
// WidgetLogic.java, so keep the two in step.
import { diffDays } from './householdDate'
import type { PantryItem, PantryOp, Ymd } from './types'

/** Expiry within this many days (or already past) shows in the briefing and as a badge. */
export const EXPIRY_SOON_DAYS = 7

export const isLow = (p: Pick<PantryItem, 'qty' | 'minQty'>) => p.qty <= p.minQty

/** Days until expiry (negative when past), or null when the item has no expiry. */
export function daysToExpiry(p: Pick<PantryItem, 'expiry'>, today: Ymd): number | null {
  return p.expiry ? diffDays(today, p.expiry) : null
}

export function expiresSoon(p: Pick<PantryItem, 'expiry'>, today: Ymd): boolean {
  const d = daysToExpiry(p, today)
  return d !== null && d <= EXPIRY_SOON_DAYS
}

/** Low items first, then items expiring soon, then by name. */
export function sortPantry<T extends PantryItem>(list: T[], today: Ymd): T[] {
  const rank = (p: T) => (isLow(p) ? 0 : expiresSoon(p, today) ? 1 : 2)
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ko'))
}

/** New count after an operation; never below zero, whole numbers only. */
export function applyPantryOp(before: number, op: PantryOp, amount: number): number {
  const n = Math.max(0, Math.round(amount))
  const after = op === 'set' ? n : op === 'use' ? before - n : before + n
  return Math.max(0, after)
}

/** "3개", "2 팩" style label: units made of letters attach directly. */
export const qtyLabel = (p: Pick<PantryItem, 'qty' | 'unit'>) => `${p.qty}${p.unit || '개'}`

/** Normalised name for matching spoken names to items (spaces and case ignored). */
export const pantryKey = (s: string) => s.replace(/\s+/g, '').toLowerCase()

/** The item whose name or alias matches `name`, if any. */
export function findPantryItem<T extends Pick<PantryItem, 'name' | 'aliases'>>(list: T[], name: string): T | undefined {
  const k = pantryKey(name)
  return list.find((p) => pantryKey(p.name) === k || (p.aliases ?? []).some((a) => pantryKey(a) === k))
}
