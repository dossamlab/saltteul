// Pantry write trigger: when an item drops to or below its minimum, the other member gets one push. It is not sent again
// until the count has gone back above the minimum (lowNotifiedAt is cleared then).
import type { Firestore } from 'firebase-admin/firestore'
import { isLow, qtyLabel } from '../../../shared/pantry'
import type { PantryItem } from '../../../shared/types'
import type { T } from '../copy'
import { HID } from '../household'
import { listMembers } from '../members'
import { sendToMembers, type MessagingLike } from './send'

export type PantryLowResult = 'sent' | 'cleared' | 'none'

export async function handlePantryWrite(
  deps: { db: Firestore; messaging: MessagingLike; t: T },
  id: string,
  before: PantryItem | null,
  after: PantryItem | null,
  now: number = Date.now(),
): Promise<PantryLowResult> {
  if (!after) return 'none'
  const ref = deps.db.doc(`households/${HID}/pantry/${id}`)
  if (!isLow(after)) {
    if (after.lowNotifiedAt) {
      await ref.update({ lowNotifiedAt: null })
      return 'cleared'
    }
    return 'none'
  }
  // Only the moment it becomes low; a new item that starts low, or one already alerted, stays quiet.
  if (!before || isLow(before) || after.lowNotifiedAt) return 'none'

  const members = await listMembers(deps.db)
  const by = after.updatedBy ?? null
  const to = members.filter((m) => m.uid !== by).map((m) => m.uid)
  if (!to.length) return 'none'
  const who = members.find((m) => m.uid === by)?.displayName ?? ''
  const qty = qtyLabel(after)
  await sendToMembers(deps.db, deps.messaging, to, {
    title: deps.t('push.pantryLow.title', { name: after.name }),
    body: who ? deps.t('push.pantryLow.body', { who, qty }) : deps.t('push.pantryLow.bodyNoName', { qty }),
    data: { type: 'pantry-low', pantryId: id },
  })
  await ref.update({ lowNotifiedAt: now })
  return 'sent'
}
