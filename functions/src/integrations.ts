import type { Firestore } from 'firebase-admin/firestore'
import type { IntegrationState } from '../../shared/types'
import { HID } from './household'

export type IntegrationName = IntegrationState['name']

const MAX_ERROR_LEN = 300

/** Error text that is safe to store: anything that looks like a key, token or password is masked. */
export function scrubError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err ?? null)
  return (raw ?? '')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '***')
    .replace(/\b(Bearer|Basic)\s+[^\s"',]+/gi, '$1 ***')
    .replace(
      /\b(api[_-]?key|x-api-key|key|token|access_token|refresh_token|id_token|password|passwd|pw|secret|serviceKey|client_secret|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi,
      '$1$2***',
    )
    .replace(/[A-Za-z0-9_\-+/%]{32,}={0,2}/g, '***')
    .slice(0, MAX_ERROR_LEN)
}

/**
 * Records the outcome of one integration run in households/{HID}/integrations/{name}.
 * Returns the updated failure count so callers can alert on a threshold.
 */
export async function recordIntegration(
  db: Firestore,
  name: IntegrationName,
  ok: boolean,
  error?: unknown,
  now: number = Date.now(),
): Promise<{ consecutiveFailures: number }> {
  const ref = db.doc(`households/${HID}/integrations/${name}`)
  const snap = await ref.get()
  const prev = (snap.exists ? snap.get('consecutiveFailures') : 0) as number | undefined
  const consecutiveFailures = ok ? 0 : (prev ?? 0) + 1
  const update: Partial<IntegrationState> = ok
    ? { name, lastSuccessAt: now, consecutiveFailures, lastError: null }
    : { name, consecutiveFailures, lastError: scrubError(error) }
  await ref.set(update, { merge: true })
  return { consecutiveFailures }
}
