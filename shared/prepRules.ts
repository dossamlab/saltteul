import type { PrepRule } from './types'

const squash = (s: string) => s.replace(/\s+/g, '')

/** Items from every rule whose keyword appears in the title, in rule order, without duplicates. */
export function applyPrepRules(title: string, rules: PrepRule[]): string[] {
  const t = squash(title)
  const out: string[] = []
  for (const r of rules) {
    if (!r.keyword.trim() || !t.includes(squash(r.keyword))) continue
    for (const item of r.items) if (!out.includes(item)) out.push(item)
  }
  return out
}
