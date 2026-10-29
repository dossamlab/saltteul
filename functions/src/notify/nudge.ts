import type { Firestore } from 'firebase-admin/firestore'
import type { Member, Nudge } from '../../../shared/types'
import type { T } from '../copy'
import { HID } from '../household'
import { sendToMembers, type MessagingLike, type PushPayload, type SendResult } from './send'

export function nudgePayload(nudge: Nudge, senderName: string, t: T): PushPayload {
  const title = t('push.nudge.title', { name: senderName })
  const target = nudge.targetTitle?.trim() ?? ''
  const message = nudge.message?.trim() ?? ''
  const body =
    target && message
      ? t('push.nudge.bodyTargetMessage', { title: target, message })
      : target
        ? t('push.nudge.bodyTarget', { title: target })
        : message
          ? t('push.nudge.bodyMessage', { message })
          : t('push.nudge.bodyEmpty')
  return {
    title,
    body,
    data: {
      type: 'nudge',
      nudgeId: nudge.id,
      targetType: nudge.targetType ?? '',
      targetId: nudge.targetId ?? '',
    },
  }
}

export async function senderName(db: Firestore, uid: string, t: T): Promise<string> {
  const snap = await db.doc(`households/${HID}/members/${uid}`).get()
  const m = snap.exists ? (snap.data() as Member) : null
  if (m?.displayName) return m.displayName
  if (m?.role) return t(`owner.${m.role}`)
  return t('push.nudge.someone')
}

export async function handleNudgeCreated(
  db: Firestore,
  messaging: MessagingLike,
  nudge: Nudge,
  t: T,
): Promise<SendResult | null> {
  if (!nudge.to) return null
  const name = await senderName(db, nudge.from, t)
  return sendToMembers(db, messaging, [nudge.to], nudgePayload(nudge, name, t))
}
