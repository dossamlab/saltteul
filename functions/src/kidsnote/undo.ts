import type { Firestore } from 'firebase-admin/firestore'
import { HID } from '../household'

/**
 * Deletes every todo and shopping item created by one Kids Note batch and marks the report as undone
 * (it stays recorded, so the same notice is not imported again). Calendar events of deleted todos are
 * removed by the todo delete trigger.
 */
export async function undoKidsnoteBatch(
  db: Firestore,
  batchId: string,
  now: number = Date.now(),
): Promise<{ todos: number; shopping: number }> {
  if (!batchId) return { todos: 0, shopping: 0 }
  const h = `households/${HID}`
  const [todos, shopping, reports] = await Promise.all([
    db.collection(`${h}/todos`).where('kidsnoteBatchId', '==', batchId).get(),
    db.collection(`${h}/shopping`).where('kidsnoteBatchId', '==', batchId).get(),
    db.collection(`${h}/kidsnote`).where('batchId', '==', batchId).get(),
  ])
  const batch = db.batch()
  todos.docs.forEach((d) => batch.delete(d.ref))
  shopping.docs.forEach((d) => batch.delete(d.ref))
  reports.docs.forEach((d) => batch.update(d.ref, { undoneAt: now }))
  await batch.commit()
  return { todos: todos.size, shopping: shopping.size }
}
