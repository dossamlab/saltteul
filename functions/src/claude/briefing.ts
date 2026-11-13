import type { Firestore } from 'firebase-admin/firestore'
import { buildBriefingInput, isEmptyBriefing } from '../../../shared/briefingInput'
import { fallbackBriefing } from '../../../shared/fallbackBriefing'
import { addDays } from '../../../shared/householdDate'
import { packingBriefLines } from '../../../shared/packing'
import type { Briefing, Trip, TripItem, Ymd } from '../../../shared/types'
import type { T } from '../copy'
import { HID } from '../household'
import { recordIntegration } from '../integrations'
import { memberUids } from '../members'
import { sendToMembers, type MessagingLike } from '../notify/send'
import { loadSnapshot } from '../snapshot'
import type { ClaudePort } from './client'

export interface BriefingDeps {
  db: Firestore
  messaging: MessagingLike
  claude: ClaudePort
  t: T
  log?: (msg: string, extra?: unknown) => void
}

/** Evening only: 「아직 안 챙긴 짐 n개(아이 5, 엄마 2)」 for trips leaving tomorrow, counted here without Claude. */
async function packingLines(db: Firestore, day: Ymd, t: T): Promise<string[]> {
  const trips = await db.collection(`households/${HID}/trips`).where('start', '==', addDays(day, 1)).get()
  if (trips.empty) return []
  const list = trips.docs.map((d) => ({ ...(d.data() as Trip), id: d.id }))
  const items = await db.collection(`households/${HID}/tripItems`).where('tripId', 'in', list.map((x) => x.id).slice(0, 30)).get()
  return packingBriefLines(list, items.docs.map((d) => ({ ...(d.data() as TripItem), id: d.id })), day, t)
}

/**
 * Builds the morning/evening briefing: snapshot → BriefingInput → Claude (or the plain fallback)
 * → briefings/{day}_{slot} → push the headline to both members. The evening packing line is added after Claude.
 */
export async function runBriefing(deps: BriefingDeps, slot: 'morning' | 'evening', now: Date = new Date()): Promise<Briefing> {
  const { db, messaging, claude, t } = deps
  const snapshot = await loadSnapshot(db, now)
  const input = buildBriefingInput(snapshot, now, slot)
  const packing = slot === 'evening' ? await packingLines(db, input.day, t) : []

  let result: { headline: string; lines: string[] }
  let model: string | null = null
  let failed = false

  if (isEmptyBriefing(input)) {
    // Nothing worth a model call. The packing line, if any, replaces the "nothing today" line.
    result = fallbackBriefing(input, t)
    if (packing.length) result = { ...result, lines: [] }
  } else {
    try {
      const r = await claude.writeBriefing(input)
      result = { headline: r.headline, lines: r.lines }
      model = r.model
      await recordIntegration(db, 'claude', true, undefined, now.getTime())
    } catch (e) {
      deps.log?.('briefing: claude failed, using fallback', e instanceof Error ? e.message : e)
      result = fallbackBriefing(input, t)
      failed = true
      await recordIntegration(db, 'claude', false, e, now.getTime())
    }
  }

  result = { ...result, lines: [...result.lines, ...packing] }

  const id = `${input.day}_${slot}`
  const doc: Briefing = {
    id,
    day: input.day,
    slot,
    headline: result.headline,
    lines: result.lines,
    createdAt: now.getTime(),
    model,
    failed,
  }
  await db.doc(`households/${HID}/briefings/${id}`).set(doc)

  await sendToMembers(db, messaging, await memberUids(db), {
    title: t(slot === 'morning' ? 'push.briefing.titleMorning' : 'push.briefing.titleEvening'),
    body: result.headline,
    data: { type: 'briefing', briefingId: id },
  })
  return doc
}
