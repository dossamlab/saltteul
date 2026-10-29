import type { Firestore } from 'firebase-admin/firestore'
import { HID } from '../household'
import { recordIntegration } from '../integrations'
import type { KidsnoteChild, KidsnotePort, KidsnoteTokens } from './client'

export const KIDSNOTE_SECRET_PATH = `households/${HID}/secrets/kidsnote`

/** Stored in households/{HID}/secrets/kidsnote (clients can never read `secrets`). No password. */
export interface KidsnoteSecret {
  tokens: KidsnoteTokens
  children: KidsnoteChild[]
  childId: string | null
  connectedAt: number
  connectedBy: string
  lastPolledAt?: string | null
  /** Separate from lastPolledAt so a failed notice read does not skip notices once reports move on. */
  noticesPolledAt?: string | null
}

/**
 * Center id of the connected child. Older connections stored children without it, so the child list is fetched once
 * more and saved when it is missing. Null when it cannot be found.
 */
export async function resolveCenterId(db: Firestore, port: KidsnotePort, secret: KidsnoteSecret): Promise<string | null> {
  const known = secret.children?.find((c) => c.id === secret.childId)?.centerId
  if (known) return known
  const children = await port.listChildren(secret.tokens)
  const found = children.find((c) => c.id === secret.childId)?.centerId ?? null
  if (found) await db.doc(KIDSNOTE_SECRET_PATH).set({ children }, { merge: true })
  return found
}

export class BadInputError extends Error {}

/**
 * Logs in once with the id/password typed by a member, keeps only the tokens and child list,
 * and drops the password. The caller must already have checked membership.
 */
export async function connectKidsnote(
  db: Firestore,
  port: KidsnotePort,
  uid: string,
  input: { id?: unknown; password?: unknown },
  now: number = Date.now(),
): Promise<{ children: KidsnoteChild[] }> {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (!id || !password) throw new BadInputError('id and password are required')

  const tokens = await port.login(id, password)
  const children = await port.listChildren(tokens)
  const secret: KidsnoteSecret = {
    tokens,
    children,
    childId: children[0]?.id ?? null,
    connectedAt: now,
    connectedBy: uid,
    lastPolledAt: null,
  }
  await db.doc(KIDSNOTE_SECRET_PATH).set(secret)
  await recordIntegration(db, 'kidsnote', true, undefined, now)
  return { children }
}
