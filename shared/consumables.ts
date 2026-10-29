import { addDays, diffDays } from './householdDate'
import type { Consumable, Ymd } from './types'

/** Average of the last three purchase gaps once two or more gaps exist; otherwise the cycle the user entered. */
export function effectiveCycle(c: Consumable): number {
  const p = [...c.purchases].sort()
  const gaps: number[] = []
  for (let i = 1; i < p.length; i++) gaps.push(diffDays(p[i - 1], p[i]))
  if (gaps.length < 2) return c.initialCycleDays
  const recent = gaps.slice(-3)
  return Math.round(recent.reduce((s, g) => s + g, 0) / recent.length)
}

export function lastPurchase(c: Consumable): Ymd | null {
  if (c.purchases.length === 0) return null
  return [...c.purchases].sort()[c.purchases.length - 1]
}

export function nextDue(c: Consumable): Ymd | null {
  const last = lastPurchase(c)
  return last ? addDays(last, effectiveCycle(c)) : null
}

export interface DueConsumable extends Consumable {
  due: Ymd
  daysLeft: number
}

export function dueSoon(list: Consumable[], today: Ymd, withinDays = 5): DueConsumable[] {
  return list
    .map((c) => {
      const due = nextDue(c)
      return due ? { ...c, due, daysLeft: diffDays(today, due) } : null
    })
    .filter((x): x is DueConsumable => x !== null && x.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}
