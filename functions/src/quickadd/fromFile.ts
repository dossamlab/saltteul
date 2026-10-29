// extractFromFile callable: a newsletter photo or PDF → proposed todos / shopping, read with the Kids Note prompt.
// Nothing is written here; the app shows the proposal and saves what the user keeps.
import type { Firestore } from 'firebase-admin/firestore'
import { diffDays, householdDate } from '../../../shared/householdDate'
import { applyPrepRules } from '../../../shared/prepRules'
import type { PrepItem, PrepRule, QuickAddResult, QuickItem, ShoppingItem, Ymd } from '../../../shared/types'
import type { ClaudePort } from '../claude/client'
import { IMAGE_TYPES, type AttachmentType } from '../claude/inputs'
import type { KidsnoteExtraction } from '../claude/schemas'
import type { T } from '../copy'
import { HID } from '../household'
import { ATTACHMENT_LIMITS } from '../kidsnote/attachments'
import { deadlineTitle, mergePrepItems, resolveEventDate } from '../kidsnote/apply'
import { sniffMediaType } from '../kidsnote/client'
import { QuickInputError } from './quickAdd'

export const FILE_TYPES: readonly AttachmentType[] = [...IMAGE_TYPES, 'application/pdf']
export const FILE_MAX_BYTES = 8 * 1024 * 1024
/** Claude's own per-image limit (5 MB of base64). */
export const IMAGE_MAX_BYTES = ATTACHMENT_LIMITS.maxImageBytes

export interface FileInput {
  fileName: string
  mediaType: AttachmentType
  dataBase64: string
  bytes: number
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

/** Checks the callable payload. The declared type must be allowed; the file's own first bytes decide the final type. */
export function parseFileInput(data: unknown): FileInput {
  const d = (data ?? {}) as { fileName?: unknown; mimeType?: unknown; dataBase64?: unknown }
  const fileName = typeof d.fileName === 'string' ? d.fileName.trim().slice(0, 200) : ''
  const mimeType = typeof d.mimeType === 'string' ? d.mimeType.trim().toLowerCase() : ''
  if (!FILE_TYPES.includes(mimeType as AttachmentType)) throw new QuickInputError('mimeType must be image/jpeg|png|webp|gif or application/pdf')
  let b64 = typeof d.dataBase64 === 'string' ? d.dataBase64 : ''
  b64 = b64.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '')
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new QuickInputError('dataBase64 is not base64')
  // Decoded size without decoding twice: 3 bytes per 4 characters minus padding.
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
  if (bytes > FILE_MAX_BYTES) throw new QuickInputError('file is larger than 8 MB')
  const head = Buffer.from(b64.slice(0, 64), 'base64')
  const sniffed = sniffMediaType(new Uint8Array(head))
  if (!sniffed) throw new QuickInputError('file is not a readable image or PDF')
  if (sniffed !== 'application/pdf' && bytes > IMAGE_MAX_BYTES) throw new QuickInputError('image is larger than 3.75 MB')
  return { fileName, mediaType: sniffed, dataBase64: b64, bytes }
}

export interface FileConvertInput {
  extraction: KidsnoteExtraction
  /** Household day of the upload; relative dates in the file are read against it. */
  today: Ymd
  rules: PrepRule[]
  openShoppingNames: string[]
  t: T
}

/**
 * Same reading as a Kids Note notice, but as a proposal: events and deadlines become todos (title as written,
 * owner both), items to buy become shopping, dateless notes are returned as unparsed lines.
 * Past dates are dropped; a date that cannot be resolved leaves the todo undated with the date phrase as its note.
 */
export function extractionToQuickItems(p: FileConvertInput): Pick<QuickAddResult, 'items' | 'unparsed'> {
  const items: QuickItem[] = []
  const todoKeys = new Set<string>()
  const shoppingSeen = new Set(p.openShoppingNames.map(norm))
  const isPast = (date: Ymd) => diffDays(p.today, date) < 0

  const pushTodo = (title: string, date: Ymd | null, time: string | null, dateText: string, prepItems: PrepItem[]) => {
    const key = `${norm(title)}|${date ?? ''}`
    if (todoKeys.has(key)) return
    todoKeys.add(key)
    items.push({
      kind: 'todo',
      title,
      date,
      time: date ? time : null,
      owner: 'both',
      note: date ? null : dateText || null,
      ...(prepItems.length ? { prepItems } : {}),
    })
  }

  for (const ev of p.extraction.events) {
    const date = resolveEventDate(ev.dateText, ev.isoDate, p.today)
    if (date && isPast(date)) continue
    pushTodo(ev.title, date, ev.time, ev.dateText, mergePrepItems(applyPrepRules(ev.title, p.rules), ev.prepItems))
    for (const it of ev.prepItems) {
      const name = it.name.trim()
      if (!it.needsPurchase || !name || shoppingSeen.has(norm(name))) continue
      shoppingSeen.add(norm(name))
      items.push({ kind: 'shopping', name, qty: null, note: ev.title })
    }
  }

  for (const dl of p.extraction.deadlines) {
    const date = resolveEventDate(dl.dateText, dl.isoDate, p.today)
    if (date && isPast(date)) continue
    pushTodo(deadlineTitle(dl.title, p.t), date, null, dl.dateText, [])
  }

  return { items: items.slice(0, 20), unparsed: p.extraction.notes.slice(0, 10) }
}

export async function runExtractFromFile(
  deps: { db: Firestore; claude: ClaudePort; t: T },
  data: unknown,
  now: Date = new Date(),
): Promise<QuickAddResult> {
  const file = parseFileInput(data)
  const h = `households/${HID}`
  const [rulesSnap, shoppingSnap] = await Promise.all([
    deps.db.collection(`${h}/prepRules`).get(),
    deps.db.collection(`${h}/shopping`).where('bought', '==', false).get(),
  ])
  const rules = rulesSnap.docs.map((d) => ({ ...(d.data() as PrepRule), id: d.id }))
  const today = householdDate(now)
  const extraction = await deps.claude.extractKidsnote({
    text: '',
    written: today,
    ruleKeywords: rules.map((r) => r.keyword).filter((k) => k?.trim()),
    attachments: [{ mediaType: file.mediaType, dataBase64: file.dataBase64, ...(file.fileName ? { name: file.fileName } : {}) }],
  })
  const out = extractionToQuickItems({
    extraction,
    today,
    rules,
    openShoppingNames: shoppingSnap.docs.map((d) => (d.data() as ShoppingItem).name),
    t: deps.t,
  })
  return { ...out, model: extraction.model }
}
