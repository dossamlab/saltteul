import type { Firestore } from 'firebase-admin/firestore'
import { householdDate } from '../../../shared/householdDate'
import type { PrepRule, ShoppingItem } from '../../../shared/types'
import type { TodoDoc } from '../calendar/mapping'
import type { ClaudePort } from '../claude/client'
import type { KidsnoteExtraction } from '../claude/schemas'
import type { T } from '../copy'
import { HID } from '../household'
import { recordIntegration } from '../integrations'
import { memberUids, uidForRole } from '../members'
import { sendToMembers, type MessagingLike } from '../notify/send'
import { applyPlan, planKidsnote, todoKey } from './apply'
import { downloadAttachments } from './attachments'
import { KidsnoteAuthError, type KidsnotePort, type KidsnoteReport, type KidsnoteTokens } from './client'
import { KIDSNOTE_SECRET_PATH, resolveCenterId, type KidsnoteSecret } from './connect'

export const DOWN_ALERT_AFTER = 3
const REFRESH_MARGIN_MS = 5 * 60 * 1000
const FIRST_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
/** Re-read a day of overlap each run; processed report ids are skipped anyway. */
const OVERLAP_MS = 24 * 60 * 60 * 1000

export interface PollDeps {
  db: Firestore
  messaging: MessagingLike
  kidsnote: KidsnotePort
  claude: ClaudePort
  t: T
  log?: (msg: string, extra?: unknown) => void
}

export interface PollResult {
  status: 'not-connected' | 'failed' | 'ok'
  processed: number
  batches: string[]
}

/** Reports (알림장) and center notices (공지사항, where newsletters are posted) go through the same reading. */
export type KidsnoteSourceKind = 'report' | 'notice'

export const batchIdFor = (reportId: string, kind: KidsnoteSourceKind = 'report') =>
  kind === 'notice' ? `kn-notice-${reportId}` : `kn-${reportId}`
const safeId = (id: string) => id.replace(/[/\s]/g, '_')
/** Notice ids live in their own range, so their docs get a prefix; report docs keep the bare id. */
export const kidsnoteDocId = (id: string, kind: KidsnoteSourceKind = 'report') =>
  kind === 'notice' ? `notice-${safeId(id)}` : safeId(id)

const sinceFor = (polledAt: string | null | undefined, now: Date) =>
  new Date(polledAt ? Date.parse(polledAt) - OVERLAP_MS : now.getTime() - FIRST_LOOKBACK_MS).toISOString()

/**
 * Center notices since the last notice read. Null (and logged) when the center id is unknown or the read fails;
 * reports are still imported, and the notice window is kept for the next run.
 */
export async function fetchNotices(
  deps: Pick<PollDeps, 'db' | 'kidsnote' | 'log'>,
  secret: KidsnoteSecret,
  tokens: KidsnoteTokens,
  now: Date,
): Promise<KidsnoteReport[] | null> {
  try {
    const centerId = await resolveCenterId(deps.db, deps.kidsnote, { ...secret, tokens })
    if (!centerId) {
      deps.log?.('kidsnote: center id unknown, notices skipped')
      return null
    }
    return await deps.kidsnote.listNotices(tokens, centerId, sinceFor(secret.noticesPolledAt, now))
  } catch (e) {
    deps.log?.('kidsnote: notices unavailable', e instanceof Error ? e.message : e)
    return null
  }
}

export async function fetchReports(deps: Pick<PollDeps, 'db' | 'kidsnote'>, secret: KidsnoteSecret, now: Date): Promise<{ reports: KidsnoteReport[]; tokens: KidsnoteTokens }> {
  const { db, kidsnote } = deps
  const ref = db.doc(KIDSNOTE_SECRET_PATH)
  let tokens = secret.tokens
  const saveTokens = (tk: KidsnoteTokens) => ref.set({ tokens: tk }, { merge: true })

  if (tokens.expiresAt && tokens.expiresAt - now.getTime() < REFRESH_MARGIN_MS && tokens.refreshToken) {
    tokens = await kidsnote.refresh(tokens)
    await saveTokens(tokens)
  }
  const sinceIso = sinceFor(secret.lastPolledAt, now)
  try {
    return { reports: await kidsnote.listReports(tokens, secret.childId!, sinceIso), tokens }
  } catch (e) {
    if (!(e instanceof KidsnoteAuthError) || !tokens.refreshToken) throw e
    tokens = await kidsnote.refresh(tokens)
    await saveTokens(tokens)
    return { reports: await kidsnote.listReports(tokens, secret.childId!, sinceIso), tokens }
  }
}

/** Hourly Kids Note poll: new reports and center notices → Claude extraction → todos/shopping (one undoable batch each). */
export async function pollKidsnote(deps: PollDeps, now: Date = new Date()): Promise<PollResult> {
  const { db, messaging, claude, t } = deps
  const snap = await db.doc(KIDSNOTE_SECRET_PATH).get()
  const secret = (snap.exists ? snap.data() : null) as KidsnoteSecret | null
  if (!secret?.tokens?.accessToken || !secret.childId) return { status: 'not-connected', processed: 0, batches: [] }

  let reports: KidsnoteReport[]
  let tokens: KidsnoteTokens
  try {
    ;({ reports, tokens } = await fetchReports(deps, secret, now))
  } catch (e) {
    const { consecutiveFailures } = await recordIntegration(db, 'kidsnote', false, e, now.getTime())
    if (consecutiveFailures === DOWN_ALERT_AFTER) {
      const husband = await uidForRole(db, 'husband')
      if (husband) {
        await sendToMembers(db, messaging, [husband], {
          title: t('push.kidsnoteDown.title'),
          body: t('push.kidsnoteDown.body'),
          data: { type: 'kidsnote-down' },
        })
      }
    }
    return { status: 'failed', processed: 0, batches: [] }
  }
  await recordIntegration(db, 'kidsnote', true, undefined, now.getTime())
  const notices = await fetchNotices(deps, secret, tokens, now)

  const h = `households/${HID}`
  const [rulesSnap, todosSnap, shoppingSnap] = await Promise.all([
    db.collection(`${h}/prepRules`).get(),
    db.collection(`${h}/todos`).where('source', '==', 'kidsnote').get(),
    db.collection(`${h}/shopping`).where('bought', '==', false).get(),
  ])
  const rules = rulesSnap.docs.map((d) => ({ ...(d.data() as PrepRule), id: d.id }))
  const existingTodoKeys = new Set(todosSnap.docs.map((d) => d.data() as TodoDoc).map((td) => todoKey(td.title, td.date)))
  const openShoppingNames = shoppingSnap.docs.map((d) => (d.data() as ShoppingItem).name)
  const ruleKeywords = rules.map((r) => r.keyword).filter((k) => k?.trim())
  const today = householdDate(now)

  const batches: string[] = []
  let processed = 0
  let stoppedEarly = false

  const items: { report: KidsnoteReport; kind: KidsnoteSourceKind }[] = [
    ...reports.map((report) => ({ report, kind: 'report' as const })),
    ...(notices ?? []).map((report) => ({ report, kind: 'notice' as const })),
  ]
  let noticesStopped = false
  for (const { report, kind } of items) {
    const docRef = db.doc(`${h}/kidsnote/${kidsnoteDocId(report.id, kind)}`)
    if ((await docRef.get()).exists) continue

    const batchId = batchIdFor(report.id, kind)
    const attachments = await downloadAttachments(deps.kidsnote, tokens, report.attachments, deps.log)
    const readable = !!report.text || attachments.length > 0
    let extraction: KidsnoteExtraction & { model: string | null }
    try {
      extraction = readable
        ? await claude.extractKidsnote({
          text: report.text, written: report.written, ruleKeywords, ...(attachments.length ? { attachments } : {}),
        })
        : { events: [], deadlines: [], notes: [], model: null }
      if (readable) await recordIntegration(db, 'claude', true, undefined, now.getTime())
    } catch (e) {
      deps.log?.('kidsnote: extraction failed, will retry next run', e instanceof Error ? e.message : e)
      await recordIntegration(db, 'claude', false, e, now.getTime())
      if (kind === 'report') stoppedEarly = true
      noticesStopped = true
      break
    }

    const plan = planKidsnote({
      extraction, written: report.written, today, rules, existingTodoKeys, openShoppingNames, batchId, now: now.getTime(), t,
    })
    for (const td of plan.todos) existingTodoKeys.add(todoKey(td.title, td.date))
    for (const s of plan.shopping) openShoppingNames.push(s.name)
    const ids = await applyPlan(db, plan)

    await docRef.set({
      kind,
      reportId: report.id,
      written: report.written,
      createdAt: report.createdAt,
      url: report.url,
      // Kept for the weekly growth journal (reports only; the journal skips notices).
      text: report.text,
      attachmentCount: attachments.length,
      extraction: { events: extraction.events, deadlines: extraction.deadlines, notes: extraction.notes },
      model: extraction.model,
      batchId,
      counts: plan.counts,
      todoIds: ids.todoIds,
      shoppingIds: ids.shoppingIds,
      processedAt: now.getTime(),
      undoneAt: null,
    })
    processed++

    if (ids.todoIds.length || ids.shoppingIds.length) {
      batches.push(batchId)
      const events = plan.counts.events + plan.counts.deadlines
      const items = plan.counts.prepItems
      const checks = plan.counts.dateChecks
      await sendToMembers(db, messaging, await memberUids(db), {
        title: t(kind === 'notice' ? 'push.kidsnoteNotice.title' : 'push.kidsnote.title'),
        body: checks
          ? t('push.kidsnote.bodyWithCheck', { events, items, checks })
          : t('push.kidsnote.body', { events, items }),
        data: { type: 'kidsnote-batch', batchId, reportId: report.id, source: kind, undo: 'undoKidsnoteBatch' },
      })
    }
  }

  const polled: Partial<KidsnoteSecret> = {}
  if (!stoppedEarly) polled.lastPolledAt = now.toISOString()
  if (notices && !noticesStopped) polled.noticesPolledAt = now.toISOString()
  if (Object.keys(polled).length) await db.doc(KIDSNOTE_SECRET_PATH).set(polled, { merge: true })
  return { status: 'ok', processed, batches }
}
