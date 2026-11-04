// Household words for the speech recogniser. Speech-to-Text does not know the names this family uses (pantry items and
// their aliases, routines, chores, people), so they are sent as phrase hints and the recogniser favours them.
import type { Firestore } from 'firebase-admin/firestore'
import type { Chore, PantryItem, Routine, ShoppingItem } from '../../../shared/types'
import { HID } from '../household'
import { KIDSNOTE_SECRET_PATH, type KidsnoteSecret } from '../kidsnote/connect'
import { listMembers } from '../members'

/** Speech-to-Text allows 5000 phrases of 100 characters per request; a household needs far fewer. */
export const VOCAB_LIMITS = { maxPhrases: 500, maxChars: 100 } as const

/** Trimmed, de-duplicated (ignoring spaces), at most VOCAB_LIMITS. */
export function cleanPhrases(words: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    const p = (w ?? '').replace(/\s+/g, ' ').trim()
    const key = p.replace(/\s/g, '')
    if (!p || p.length > VOCAB_LIMITS.maxChars || seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= VOCAB_LIMITS.maxPhrases) break
  }
  return out
}

/** A three-syllable Korean name is also said without the family name (홍길동 → 길동). */
export function nameForms(name: string): string[] {
  const n = name.trim()
  return /^[가-힣]{3}$/.test(n) ? [n, n.slice(1)] : [n]
}

export async function loadSpeechVocabulary(db: Firestore): Promise<string[]> {
  const h = `households/${HID}`
  const [members, pantrySnap, routinesSnap, choresSnap, shoppingSnap, kidsnoteSnap] = await Promise.all([
    listMembers(db),
    db.collection(`${h}/pantry`).get(),
    db.collection(`${h}/routines`).get(),
    db.collection(`${h}/chores`).get(),
    db.collection(`${h}/shopping`).where('bought', '==', false).get(),
    db.doc(KIDSNOTE_SECRET_PATH).get(),
  ])
  const secret = kidsnoteSnap.exists ? (kidsnoteSnap.data() as KidsnoteSecret) : null
  const child = secret?.children?.find((c) => c.id === secret.childId)?.name ?? ''
  return cleanPhrases([
    ...pantrySnap.docs.flatMap((d) => {
      const p = d.data() as PantryItem
      return [p.name, ...(p.aliases ?? [])]
    }),
    ...routinesSnap.docs.map((d) => (d.data() as Routine).title),
    ...choresSnap.docs.map((d) => (d.data() as Chore).title),
    ...shoppingSnap.docs.map((d) => (d.data() as ShoppingItem).name),
    ...members.flatMap((m) => (m.displayName ? nameForms(m.displayName) : [])),
    ...(child ? nameForms(child) : []),
  ])
}
