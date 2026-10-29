import type { Firestore } from 'firebase-admin/firestore'
import type { Role, Settings } from '../../shared/types'

/** There is one family, so the household id is fixed. */
export const HID = 'home'

export interface JoinConfig {
  husbandEmail: string
  wifeEmail: string
}

export class NotAllowedError extends Error {}

export function roleForEmail(email: string, cfg: JoinConfig): Role | null {
  const e = email.trim().toLowerCase()
  if (e && e === cfg.husbandEmail.trim().toLowerCase()) return 'husband'
  if (e && e === cfg.wifeEmail.trim().toLowerCase()) return 'wife'
  return null
}

export const DEFAULT_SETTINGS: Settings = {
  familyName: '',
  location: null,
  briefingTimes: { morning: '07:30', evening: '20:00' },
  calendarId: null,
  weather: null,
}

/**
 * Adds the signed-in user to the household if their email is one of the two allowed addresses.
 * Creates the household on first join. Idempotent.
 */
export async function joinHousehold(
  db: Firestore,
  user: { uid: string; email: string; displayName: string },
  cfg: JoinConfig,
): Promise<{ hid: string; role: Role }> {
  const role = roleForEmail(user.email, cfg)
  if (!role) throw new NotAllowedError(user.email)

  const hRef = db.doc(`households/${HID}`)
  await db.runTransaction(async (tx) => {
    const h = await tx.get(hRef)
    const settingsRef = hRef.collection('settings').doc('main')
    const settings = await tx.get(settingsRef)
    const memberRef = hRef.collection('members').doc(user.uid)
    const member = await tx.get(memberRef)
    if (!h.exists) {
      tx.set(hRef, {
        memberUids: [user.uid],
        allowedEmails: [cfg.husbandEmail, cfg.wifeEmail],
        createdAt: Date.now(),
      })
    } else {
      const uids: string[] = h.get('memberUids') ?? []
      if (!uids.includes(user.uid)) tx.update(hRef, { memberUids: [...uids, user.uid] })
    }
    if (!settings.exists) tx.set(settingsRef, DEFAULT_SETTINGS)
    // Runs on every app start: the Google name is only a first value, a name changed in settings is kept.
    const savedName = member.exists ? String(member.get('displayName') ?? '').trim() : ''
    tx.set(
      memberRef,
      { uid: user.uid, email: user.email, displayName: savedName || user.displayName, role },
      { merge: true },
    )
    tx.set(db.doc(`users/${user.uid}`), { hid: HID })
  })
  return { hid: HID, role }
}
