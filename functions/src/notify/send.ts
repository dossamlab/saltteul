import type { Firestore } from 'firebase-admin/firestore'
import type { BatchResponse, Message } from 'firebase-admin/messaging'
import { HID } from '../household'

/** The part of firebase-admin Messaging we use (lets tests pass a fake). */
export interface MessagingLike {
  sendEach(messages: Message[]): Promise<BatchResponse>
}

export type Platform = 'android' | 'web'

export interface Device {
  uid: string
  platform: Platform
  token: string
}

export interface PushPayload {
  title?: string
  body?: string
  /** FCM data values must be strings. */
  data?: Record<string, string>
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

const WEB_ICON = '/icons/icon-192.png'

export function buildMessage(device: Device, payload: PushPayload): Message {
  const notification = payload.title || payload.body ? { title: payload.title ?? '', body: payload.body ?? '' } : undefined
  const data = payload.data ?? {}
  if (device.platform === 'android') {
    return {
      token: device.token,
      ...(notification ? { notification } : {}),
      data,
      android: { priority: 'high' },
    }
  }
  return {
    token: device.token,
    ...(notification ? { notification } : {}),
    data,
    webpush: {
      headers: { Urgency: 'high' },
      ...(notification ? { notification: { icon: WEB_ICON } } : {}),
      fcmOptions: { link: '/' },
    },
  }
}

export interface SendResult {
  sent: number
  failed: number
  removed: number
}

/**
 * Sends `payload` to every registered device that passes `filter`.
 * Tokens FCM reports as invalid are deleted from households/{HID}/devices.
 */
export async function sendToDevices(
  db: Firestore,
  messaging: MessagingLike,
  filter: (d: Device) => boolean,
  payload: PushPayload,
): Promise<SendResult> {
  const snap = await db.collection(`households/${HID}/devices`).get()
  const targets = snap.docs
    .map((d) => ({ ref: d.ref, device: d.data() as Device }))
    .filter(({ device }) => device?.token && filter(device))
  if (targets.length === 0) return { sent: 0, failed: 0, removed: 0 }

  const res = await messaging.sendEach(targets.map(({ device }) => buildMessage(device, payload)))
  let removed = 0
  let failed = 0
  await Promise.all(
    res.responses.map(async (r, i) => {
      if (r.success) return
      failed++
      if (r.error && INVALID_TOKEN_CODES.has(r.error.code)) {
        removed++
        await targets[i].ref.delete()
      }
    }),
  )
  return { sent: targets.length - failed, failed, removed }
}

export function sendToMembers(
  db: Firestore,
  messaging: MessagingLike,
  uids: string[],
  payload: PushPayload,
): Promise<SendResult> {
  const set = new Set(uids)
  return sendToDevices(db, messaging, (d) => set.has(d.uid), payload)
}
