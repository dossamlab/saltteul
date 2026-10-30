import type { Firestore } from 'firebase-admin/firestore'
import { householdDate } from '../../../shared/householdDate'
import type { IntegrationState, KidsnoteClass, PrepRule, Settings, ShoppingItem } from '../../../shared/types'
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

export interface NoticeAudience {
  /** The child's class: chosen in settings, else the one Kids Note has on record; null when unknown. */
  classId: string | null
  /** For the extraction prompt; null when the class names are unknown (then nothing is filtered by class). */
  prompt: { myClass: string; otherClasses: string[] } | null
}

/**
 * Refreshes the class list on integrations/kidsnote (the settings screen offers it) and works out the child's class.
 * Failures only mean notices are read without a class filter.
 */
export async function noticeAudience(
  deps: Pick<PollDeps, 'db' | 'kidsnote' | 'log'>,
  secret: KidsnoteSecret,
  tokens: KidsnoteTokens,
): Promise<NoticeAudience> {
  const { db } = deps
  let classes: KidsnoteClass[] = []
  let detected: string | null = null
  try {
    const centerId = await resolveCenterId(db, deps.kidsnote, { ...secret, tokens })
    if (centerId && secret.childId) {
      const info = await deps.kidsnote.getClassInfo(tokens, centerId, secret.childId)
      classes = info.classes
      detected = info.childClassId
      await db.doc(`households/${HID}/integrations/kidsnote`).set({ classes, detectedClassId: detected }, { merge: true })
    }
  } catch (e) {
    deps.log?.('kidsnote: class list unavailable', e instanceof Error ? e.message : e)
    const prev = (await db.doc(`households/${HID}/integrations/kidsnote`).get()).data() as IntegrationState | undefined
    classes = prev?.classes ?? []
    detected = prev?.detectedClassId ?? null
  }
  const settings = (await db.doc(`households/${HID}/settings/main`).get()).data() as Settings | undefined
  const classId = settings?.kidsnoteClassId || detected
  const mine = classes.find((c) => c.id === classId)
  return {
    classId: classId ?? null,
    prompt: mine ? { myClass: mine.name, otherClasses: classes.filter((c) => c.id !== mine.id).map((c) => c.name) } : null,
  }
}

/** Kids Note poll (5 times a day): new reports and center notices → Claude extraction → todos/shopping (one undoable batch each). */
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

  // Only items not seen before go further: no attachment download, Claude call or household reads otherwise.
  const items: { report: KidsnoteReport; kind: KidsnoteSourceKind }[] = []
  for (const it of [
    ...reports.map((report) => ({ report, kind: 'report' as const })),
    ...(notices ?? []).map((report) => ({ report, kind: 'notice' as const })),
  ]) {
    if (!(await db.doc(`${h}/kidsnote/${kidsnoteDocId(it.report.id, it.kind)}`).get()).exists) items.push(it)
  }
  const polled: Partial<KidsnoteSecret> = {}
  const finish = async (result: PollResult, stopped: { reports: boolean; notices: boolean }) => {
    if (!stopped.reports) polled.lastPolledAt = now.toISOString()
    if (notices && !stopped.notices) polled.noticesPolledAt = now.toISOString()
    if (Object.keys(polled).length) await db.doc(KIDSNOTE_SECRET_PATH).set(polled, { merge: true })
    return result
  }
  // The class list is read when a new notice needs it, and once after connecting so settings can offer it.
  const hasClasses = !!((await db.doc(`${h}/integrations/kidsnote`).get()).data() as IntegrationState | undefined)?.classes?.length
  const needsAudience = items.some((it) => it.kind === 'notice') || (notices !== null && !hasClasses)
  const audience = needsAudience ? await noticeAudience(deps, secret, tokens) : null
  if (!items.length) return finish({ status: 'ok', processed: 0, batches: [] }, { reports: false, notices: false })

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

  let noticesStopped = false
  for (const { report, kind } of items) {
    const docRef = db.doc(`${h}/kidsnote/${kidsnoteDocId(report.id, kind)}`)
    const batchId = batchIdFor(report.id, kind)

    // A notice posted to another class is recorded as seen and never read.
    if (kind === 'notice' && report.classId && audience?.classId && report.classId !== audience.classId) {
      await docRef.set({
        kind, reportId: report.id, written: report.written, createdAt: report.createdAt, url: report.url,
        classId: report.classId, skipped: 'otherClass', batchId, todoIds: [], shoppingIds: [],
        processedAt: now.getTime(), undoneAt: null,
      })
      processed++
      continue
    }

    const attachments = await downloadAttachments(deps.kidsnote, tokens, report.attachments, deps.log)
    const readable = !!report.text || attachments.length > 0
    let extraction: KidsnoteExtraction & { model: string | null }
    try {
      extraction = readable
        ? await claude.extractKidsnote({
          text: report.text, written: report.written, ruleKeywords, ...(attachments.length ? { attachments } : {}),
          ...(kind === 'notice' && audience?.prompt ? { audience: audience.prompt } : {}),
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
      ...(kind === 'notice' ? { classId: report.classId ?? null } : {}),
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

  return finish({ status: 'ok', processed, batches }, { reports: stoppedEarly, notices: noticesStopped })
}
