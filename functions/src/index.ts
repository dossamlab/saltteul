import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import * as logger from 'firebase-functions/logger'
import { defineSecret, defineString } from 'firebase-functions/params'
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { dueJobs, isDinnerTime, type Job } from './schedule'
import type { Nudge, PantryItem } from '../../shared/types'
import { handlePantryWrite } from './notify/pantryLow'
import { GoogleCalendar } from './calendar/client'
import type { TodoDoc } from './calendar/mapping'
import { pullCalendar } from './calendar/pull'
import { pushTodoChange } from './calendar/push'
import { runBriefing } from './claude/briefing'
import { AnthropicClaude } from './claude/client'
import { dinnerExists, runDinner } from './claude/dinner'
import { runWeeklyPreview } from './claude/weekly'
import { t } from './copy'
import { HID, joinHousehold as join, NotAllowedError } from './household'
import { recordIntegration } from './integrations'
import { HttpKidsnote, KidsnoteAuthError, KidsnoteTwoFactorError } from './kidsnote/client'
import { BadInputError, connectKidsnote as connect } from './kidsnote/connect'
import { runJournal } from './kidsnote/journal'
import { pollKidsnote as poll } from './kidsnote/poll'
import { undoKidsnoteBatch as undo } from './kidsnote/undo'
import { NotMemberError, requireMember } from './members'
import { handleNudgeCreated } from './notify/nudge'
import { maybePingWidgets } from './notify/widgetPing'
import { runExtractMenu } from './menu/menu'
import { runExtractFromFile } from './quickadd/fromFile'
import { QuickInputError, runQuickAdd } from './quickadd/quickAdd'
import { GoogleSpeech, runTranscribe, SpeechInputError } from './speech/transcribe'
import { householdDate } from '../../shared/householdDate'
import { KmaWeather } from './weather/kma'
import { pollWeather as pollKma } from './weather/poll'

if (getApps().length === 0) initializeApp()

const REGION = 'asia-northeast3'
const TZ = 'Asia/Seoul'

const HUSBAND_EMAIL = defineString('HUSBAND_EMAIL')
const WIFE_EMAIL = defineString('WIFE_EMAIL')
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')
const KMA_SERVICE_KEY = defineSecret('KMA_SERVICE_KEY')

const db = () => getFirestore()
const messaging = () => getMessaging()
const claude = () => new AnthropicClaude({ apiKey: ANTHROPIC_API_KEY.value() })
const log = (msg: string, extra?: unknown) => logger.warn(msg, extra)

let calendarClient: GoogleCalendar | null = null
const cal = () => (calendarClient ??= new GoogleCalendar())

async function memberOrThrow(uid: string | undefined) {
  try {
    return await requireMember(db(), uid)
  } catch (e) {
    if (e instanceof NotMemberError) throw new HttpsError('permission-denied', 'not a household member')
    throw e
  }
}

// ── Household ───────────────────────────────────────────────────────────────

export const joinHousehold = onCall({ region: REGION }, async (req) => {
  const auth = req.auth
  if (!auth) throw new HttpsError('unauthenticated', 'sign in first')
  const email = String(auth.token.email ?? '')
  if (!email || auth.token.email_verified === false) throw new HttpsError('permission-denied', 'verified email required')
  try {
    return await join(
      db(),
      { uid: auth.uid, email, displayName: String(auth.token.name ?? '') },
      { husbandEmail: HUSBAND_EMAIL.value(), wifeEmail: WIFE_EMAIL.value() },
    )
  } catch (e) {
    if (e instanceof NotAllowedError) throw new HttpsError('permission-denied', 'this account is not allowed')
    throw e
  }
})

// ── Notifications (Task 13) ─────────────────────────────────────────────────

export const onNudgeCreated = onDocumentCreated({ document: 'households/{hid}/nudges/{id}', region: REGION }, async (event) => {
  if (event.params.hid !== HID || !event.data) return
  const nudge = { ...(event.data.data() as Nudge), id: event.data.id }
  await handleNudgeCreated(db(), messaging(), nudge, t)
})

const widgetPing = (coll: string) =>
  onDocumentWritten({ document: `households/{hid}/${coll}/{id}`, region: REGION }, async (event) => {
    if (event.params.hid !== HID) return
    await maybePingWidgets(db(), messaging())
  })

export const widgetPingTodos = widgetPing('todos')
export const widgetPingShopping = widgetPing('shopping')
export const widgetPingRoutineLogs = widgetPing('routineLogs')
export const widgetPingChores = widgetPing('chores')

// Pantry: redraw widgets on every change, and tell the other member once when an item becomes low.
export const onPantryWritten = onDocumentWritten({ document: 'households/{hid}/pantry/{id}', region: REGION }, async (event) => {
  if (event.params.hid !== HID || !event.data) return
  const before = event.data.before.exists ? ({ ...(event.data.before.data() as PantryItem), id: event.params.id }) : null
  const after = event.data.after.exists ? ({ ...(event.data.after.data() as PantryItem), id: event.params.id }) : null
  await Promise.all([
    handlePantryWrite({ db: db(), messaging: messaging(), t }, event.params.id, before, after),
    // The low-alert bookkeeping write (lowNotifiedAt) does not change what the widget shows.
    before?.qty === after?.qty && before?.name === after?.name && before?.expiry === after?.expiry && before?.minQty === after?.minQty
      ? Promise.resolve()
      : maybePingWidgets(db(), messaging()),
  ])
})

// ── Google Calendar (Task 14) ───────────────────────────────────────────────

export const calendarPush = onDocumentWritten({ document: 'households/{hid}/todos/{id}', region: REGION }, async (event) => {
  if (event.params.hid !== HID || !event.data) return
  const before = event.data.before.exists ? ({ ...(event.data.before.data() as TodoDoc), id: event.params.id }) : null
  const after = event.data.after.exists ? ({ ...(event.data.after.data() as TodoDoc), id: event.params.id }) : null
  try {
    await pushTodoChange(db(), cal(), event.params.id, before, after)
  } catch (e) {
    logger.error('calendar push failed', e instanceof Error ? e.message : e)
    await recordIntegration(db(), 'calendar', false, e)
  }
})

async function runCalendarPull() {
  try {
    const sum = await pullCalendar(db(), cal())
    if (sum) await recordIntegration(db(), 'calendar', true)
  } catch (e) {
    logger.error('calendar pull failed', e instanceof Error ? e.message : e)
    await recordIntegration(db(), 'calendar', false, e)
  }
}

// ── Claude briefings (Task 15) ──────────────────────────────────────────────

const runBriefingSlot = (slot: 'morning' | 'evening') =>
  runBriefing({ db: db(), messaging: messaging(), claude: claude(), t, log }, slot)

const runWeekly = () => runWeeklyPreview({ db: db(), messaging: messaging(), claude: claude(), t, log })

async function runJournalJob() {
  const r = await runJournal({ db: db(), kidsnote: new HttpKidsnote(), claude: claude(), log })
  if (r.status === 'failed') throw new Error('journal: claude failed')
  return r
}

async function runDinnerJob() {
  const r = await runDinner({ db: db(), claude: claude(), log })
  if (r.status === 'failed') throw new Error('dinner: claude failed')
  return r
}

// ── Quick add and newsletter files: proposals only, the app writes what the user keeps ──

async function proposal<T>(run: () => Promise<T>): Promise<T> {
  try {
    const out = await run()
    await recordIntegration(db(), 'claude', true)
    return out
  } catch (e) {
    if (e instanceof QuickInputError) throw new HttpsError('invalid-argument', e.message)
    logger.error('claude proposal failed', e instanceof Error ? e.message : e)
    await recordIntegration(db(), 'claude', false, e)
    throw new HttpsError('unavailable', 'could not read the input right now')
  }
}

/** quickAdd({ text }) → QuickAddResult. text: 1–500 characters. */
export const quickAdd = onCall({ region: REGION, timeoutSeconds: 60, secrets: [ANTHROPIC_API_KEY] }, async (req) => {
  const uid = await memberOrThrow(req.auth?.uid)
  return proposal(() => runQuickAdd({ db: db(), claude: claude() }, uid, req.data))
})

/** extractFromFile({ fileName, mimeType, dataBase64 }) → QuickAddResult. Image ≤ 3.75 MB, PDF ≤ 8 MB. */
export const extractFromFile = onCall(
  { region: REGION, timeoutSeconds: 180, memory: '512MiB', secrets: [ANTHROPIC_API_KEY] },
  async (req) => {
    await memberOrThrow(req.auth?.uid)
    return proposal(() => runExtractFromFile({ db: db(), claude: claude(), t }, req.data))
  },
)

/** extractMenu({ month, fileName, mimeType, dataBase64 }) → MenuExtractResult. Same file limits as extractFromFile. */
export const extractMenu = onCall(
  { region: REGION, timeoutSeconds: 180, memory: '512MiB', secrets: [ANTHROPIC_API_KEY] },
  async (req) => {
    await memberOrThrow(req.auth?.uid)
    return proposal(() => runExtractMenu({ claude: claude() }, req.data))
  },
)

let speechClient: GoogleSpeech | null = null

/** transcribe({ audioBase64, sampleRate }) → { text }. 16-bit mono PCM, at most 30 seconds. */
export const transcribe = onCall({ region: REGION, timeoutSeconds: 60 }, async (req) => {
  await memberOrThrow(req.auth?.uid)
  try {
    return await runTranscribe((speechClient ??= new GoogleSpeech()), req.data)
  } catch (e) {
    if (e instanceof SpeechInputError) throw new HttpsError('invalid-argument', e.message)
    logger.error('speech failed', e instanceof Error ? e.message : e)
    throw new HttpsError('unavailable', 'could not transcribe right now')
  }
})

// ── Kids Note (Task 16) ─────────────────────────────────────────────────────

export const connectKidsnote = onCall({ region: REGION }, async (req) => {
  const uid = await memberOrThrow(req.auth?.uid)
  const data = (req.data ?? {}) as { id?: unknown; password?: unknown }
  try {
    return await connect(db(), new HttpKidsnote(), uid, data)
  } catch (e) {
    if (e instanceof BadInputError) throw new HttpsError('invalid-argument', 'id and password are required')
    if (e instanceof KidsnoteTwoFactorError) throw new HttpsError('failed-precondition', 'kidsnote two-factor login')
    if (e instanceof KidsnoteAuthError) throw new HttpsError('unauthenticated', 'kidsnote login failed')
    await recordIntegration(db(), 'kidsnote', false, e)
    throw new HttpsError('unavailable', 'kidsnote is not reachable')
  }
})

export const undoKidsnoteBatch = onCall({ region: REGION }, async (req) => {
  await memberOrThrow(req.auth?.uid)
  const batchId = typeof req.data?.batchId === 'string' ? req.data.batchId : ''
  if (!batchId) throw new HttpsError('invalid-argument', 'batchId is required')
  return undo(db(), batchId)
})

const runKidsnotePoll = () =>
  poll({ db: db(), messaging: messaging(), kidsnote: new HttpKidsnote(), claude: claude(), t, log })

// ── Weather (Task 17) ───────────────────────────────────────────────────────

const runWeatherPoll = () => pollKma(db(), new KmaWeather(KMA_SERVICE_KEY.value()))

// ── One scheduler job for all periodic work (stays within the 3 free Cloud Scheduler jobs) ──

const JOB_RUNNERS: Record<Job, () => Promise<unknown>> = {
  calendar: runCalendarPull,
  weather: runWeatherPoll,
  kidsnote: runKidsnotePoll,
  morningBriefing: () => runBriefingSlot('morning'),
  eveningBriefing: () => runBriefingSlot('evening'),
  weeklyPreview: runWeekly,
  journal: runJournalJob,
  dinner: runDinnerJob,
}

export const tick = onSchedule(
  {
    schedule: '*/15 * * * *', timeZone: TZ, region: REGION, timeoutSeconds: 540,
    secrets: [ANTHROPIC_API_KEY, KMA_SERVICE_KEY],
  },
  async () => {
    for (const job of dueJobs(new Date())) {
      try {
        await JOB_RUNNERS[job]()
      } catch (e) {
        logger.error(`tick job ${job} failed`, e instanceof Error ? e.message : e)
      }
    }
  },
)

// Members can run the periodic jobs right away from settings (weather, calendar, kids note), plus today's
// dinner suggestions when it is a weekday after 15:00 and they have not been made yet.
export const refreshNow = onCall(
  { region: REGION, timeoutSeconds: 300, secrets: [ANTHROPIC_API_KEY, KMA_SERVICE_KEY] },
  async (req) => {
    await memberOrThrow(req.auth?.uid)
    const now = new Date()
    const jobs: Job[] = ['weather', 'calendar', 'kidsnote']
    if (isDinnerTime(now) && !(await dinnerExists(db(), householdDate(now)))) jobs.push('dinner')
    const result: Record<string, 'ok' | 'failed'> = {}
    for (const job of jobs) {
      try {
        await JOB_RUNNERS[job]()
        result[job] = 'ok'
      } catch (e) {
        logger.error(`refreshNow ${job} failed`, e instanceof Error ? e.message : e)
        result[job] = 'failed'
      }
    }
    return result
  },
)
