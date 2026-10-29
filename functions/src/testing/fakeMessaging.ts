import type { BatchResponse, Message } from 'firebase-admin/messaging'
import type { MessagingLike } from '../notify/send'

/** Records messages; tokens listed in `invalid` fail with registration-token-not-registered. */
export class FakeMessaging implements MessagingLike {
  sent: Message[] = []
  invalid = new Set<string>()

  async sendEach(messages: Message[]): Promise<BatchResponse> {
    this.sent.push(...messages)
    const responses = messages.map((m) => {
      const token = (m as { token?: string }).token ?? ''
      return this.invalid.has(token)
        ? { success: false, error: { code: 'messaging/registration-token-not-registered', message: 'gone' } }
        : { success: true, messageId: `m-${token}` }
    })
    const ok = responses.filter((r) => r.success).length
    return { responses, successCount: ok, failureCount: responses.length - ok } as unknown as BatchResponse
  }

  tokens() {
    return this.sent.map((m) => (m as { token?: string }).token)
  }
}
