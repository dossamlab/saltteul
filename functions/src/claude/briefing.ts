import type { Firestore } from 'firebase-admin/firestore'
import { buildBriefingInput, isEmptyBriefing } from '../../../shared/briefingInput'
import { fallbackBriefing } from '../../../shared/fallbackBriefing'
import type { Briefing } from '../../../shared/types'
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

/**
 * Builds the morning/evening briefing: snapshot → BriefingInput → Claude (or the plain fallback)
 * → briefings/{day}_{slot} → push the headline to both members.
 */
export async function runBriefing(deps: BriefingDeps, slot: 'morning' | 'evening', now: Date = new Date()): Promise<Briefing> {
  const { db, messaging, claude, t } = deps
  const snapshot = await loadSnapshot(db, now)
  const input = buildBriefingInput(snapshot, now, slot)

  let result: { headline: string; lines: string[] }
  let model: string | null = null
  let failed = false

  if (isEmptyBriefing(input)) {
    // Nothing worth a model call.
    result = fallbackBriefing(input, t)
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
