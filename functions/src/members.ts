import type { Firestore } from 'firebase-admin/firestore'
import type { Member, Role } from '../../shared/types'
import { HID } from './household'

export class NotMemberError extends Error {}

export async function memberUids(db: Firestore): Promise<string[]> {
  const h = await db.doc(`households/${HID}`).get()
  return ((h.exists ? h.get('memberUids') : null) as string[] | null) ?? []
}

export async function listMembers(db: Firestore): Promise<Member[]> {
  const snap = await db.collection(`households/${HID}/members`).get()
  return snap.docs.map((d) => ({ ...(d.data() as Member), uid: d.id }))
}

export async function uidForRole(db: Firestore, role: Role): Promise<string | null> {
  return (await listMembers(db)).find((m) => m.role === role)?.uid ?? null
}

export async function requireMember(db: Firestore, uid: string | undefined): Promise<string> {
  if (!uid || !(await memberUids(db)).includes(uid)) throw new NotMemberError(uid ?? 'anonymous')
  return uid
}
