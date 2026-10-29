import type { Attachment } from '../claude/inputs'
import { sniffMediaType, type KidsnoteAttachmentRef, type KidsnotePort, type KidsnoteTokens } from './client'

export const ATTACHMENT_LIMITS = {
  maxFiles: 5,
  /** Per PDF (and the spec's per-file cap). */
  maxBytes: 5 * 1024 * 1024,
  /** Claude rejects an image whose base64 is over 5 MB, i.e. about 3.75 MB of raw bytes. */
  maxImageBytes: Math.floor((5 * 1024 * 1024 * 3) / 4),
  /** Keeps the whole request well under Claude's 32 MB body limit after base64. */
  maxTotalBytes: 18 * 1024 * 1024,
} as const

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')

/**
 * Downloads up to 5 attachments of one notice (PDFs first, they are usually the newsletter), trying each file's
 * candidate URLs in order. Failures and oversized files are skipped; the notice is still read without them.
 */
export async function downloadAttachments(
  port: KidsnotePort,
  tokens: KidsnoteTokens,
  refs: KidsnoteAttachmentRef[] | undefined,
  log?: (msg: string, extra?: unknown) => void,
): Promise<Attachment[]> {
  const ordered = [...(refs ?? [])].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pdf' ? -1 : 1))
  const out: Attachment[] = []
  let total = 0
  for (const ref of ordered) {
    if (out.length >= ATTACHMENT_LIMITS.maxFiles) break
    const limit = ref.kind === 'image' ? ATTACHMENT_LIMITS.maxImageBytes : ATTACHMENT_LIMITS.maxBytes
    for (const url of ref.urls) {
      try {
        const file = await port.download(tokens, url, Math.min(limit, ATTACHMENT_LIMITS.maxTotalBytes - total))
        const mediaType = sniffMediaType(file.bytes)
        if (!mediaType) throw new Error('not an image or PDF')
        if (mediaType !== 'application/pdf' && file.bytes.length > ATTACHMENT_LIMITS.maxImageBytes) throw new Error('image too large')
        out.push({ mediaType, dataBase64: toBase64(file.bytes), ...(ref.name ? { name: ref.name } : {}) })
        total += file.bytes.length
        break
      } catch (e) {
        log?.('kidsnote: attachment skipped', e instanceof Error ? e.message : e)
      }
    }
  }
  return out
}
