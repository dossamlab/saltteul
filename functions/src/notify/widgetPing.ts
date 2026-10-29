import type { Firestore } from 'firebase-admin/firestore'
import { HID } from '../household'
import { sendToDevices, type MessagingLike } from './send'

export const WIDGET_PING_MIN_GAP_MS = 5_000
export const WIDGET_REFRESH = { type: 'widget-refresh' } as const

/**
 * Tells Android widgets to redraw after a data change. A ping sent less than 5 s ago covers this
 * change too (widgets re-read everything), so bursts of writes produce one message.
 * Returns true when a message was sent.
 */
export async function maybePingWidgets(db: Firestore, messaging: MessagingLike, now: number = Date.now()): Promise<boolean> {
  const ref = db.doc(`households/${HID}/integrations/widgetPing`)
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const last = (snap.exists ? snap.get('lastSentAt') : 0) as number | undefined
    if (last && now - last < WIDGET_PING_MIN_GAP_MS) return false
    tx.set(ref, { lastSentAt: now }, { merge: true })
    return true
  })
  if (!claimed) return false
  await sendToDevices(db, messaging, (d) => d.platform === 'android', { data: { ...WIDGET_REFRESH } })
  return true
}
