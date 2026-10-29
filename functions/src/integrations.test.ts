import { describe, expect, it } from 'vitest'
import { recordIntegration, scrubError } from './integrations'
import { FakeFirestore } from './testing/fakeFirestore'

describe('recordIntegration', () => {
  it('counts consecutive failures and resets on success', async () => {
    const db = new FakeFirestore()
    const path = 'households/home/integrations/weather'
    expect(await recordIntegration(db.asAdmin, 'weather', false, new Error('boom'), 1)).toEqual({ consecutiveFailures: 1 })
    expect(await recordIntegration(db.asAdmin, 'weather', false, 'again', 2)).toEqual({ consecutiveFailures: 2 })
    expect(db.read(path)).toMatchObject({ name: 'weather', consecutiveFailures: 2, lastError: 'again' })
    expect(db.read(path)?.lastSuccessAt).toBeUndefined()

    await recordIntegration(db.asAdmin, 'weather', true, undefined, 3)
    expect(db.read(path)).toEqual({ name: 'weather', consecutiveFailures: 0, lastSuccessAt: 3, lastError: null })

    await recordIntegration(db.asAdmin, 'weather', false, new Error('x'), 4)
    expect(db.read(path)).toMatchObject({ consecutiveFailures: 1, lastSuccessAt: 3, lastError: 'x' })
  })
})

describe('scrubError', () => {
  it('masks keys, tokens and passwords', () => {
    const msg = scrubError(
      new Error(
        'GET https://x/api?serviceKey=abcDEF123%2B%3D&nx=60 failed; Authorization: Bearer eyJhbGciOi.payload.sig; ' +
          'key sk-ant-api03-SECRETSECRET; password=hunter2 token: "tok_123"',
      ),
    )
    expect(msg).not.toMatch(/abcDEF123|eyJhbGciOi|SECRETSECRET|hunter2|tok_123/)
    expect(msg).toContain('nx=60')
  })
  it('masks long opaque strings and limits length', () => {
    expect(scrubError(`token blob ${'A'.repeat(40)} end`)).toBe('token blob *** end')
    expect(scrubError('e'.repeat(1000)).length).toBeLessThanOrEqual(300)
  })
})
