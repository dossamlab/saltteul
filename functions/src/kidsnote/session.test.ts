import { describe, expect, it } from 'vitest'
import { HttpKidsnote, KidsnoteAuthError, KidsnoteTwoFactorError, parseChildren, sessionFromSetCookies } from './client'

const NOW = Date.parse('2026-10-28T00:00:00Z')

function res(status: number, body: unknown, setCookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const c of setCookies) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}

describe('sessionFromSetCookies', () => {
  it('joins cookie pairs and keeps the latest expiry', () => {
    const s = sessionFromSetCookies([
      'csrftoken=abc; Max-Age=31449600; Path=/; SameSite=Lax',
      'sessionid=xyz; expires=Wed, 11 Nov 2026 00:00:00 GMT; HttpOnly; Path=/',
    ], NOW)
    expect(s.accessToken).toBe('csrftoken=abc; sessionid=xyz')
    expect(s.refreshToken).toBeNull()
    expect(s.expiresAt).toBe(NOW + 31449600 * 1000)
  })
  it('rejects a response without cookies', () => {
    expect(() => sessionFromSetCookies([], NOW)).toThrow(KidsnoteAuthError)
  })
})

describe('parseChildren', () => {
  it('reads children from several shapes', () => {
    expect(parseChildren({ children: [{ id: 7, name: '하늘' }] })).toEqual([{ id: '7', name: '하늘' }])
    expect(parseChildren({ results: [{ child_id: 8, child_name: '바다' }] })).toEqual([{ id: '8', name: '바다' }])
    expect(parseChildren([{ id: 9, nickname: '별' }])).toEqual([{ id: '9', name: '별' }])
    expect(parseChildren({ user: {} })).toEqual([])
  })
})

describe('HttpKidsnote.login', () => {
  const call = (r: Response) => new HttpKidsnote((async () => r) as unknown as typeof fetch, () => NOW)
  it('returns the session cookie on success', async () => {
    const t = await call(res(200, {}, ['sessionid=s1; Path=/; HttpOnly'])).login('id', 'pw')
    expect(t.accessToken).toBe('sessionid=s1')
  })
  it('maps a wrong password to KidsnoteAuthError', async () => {
    await expect(call(res(400, { err_code: 'invalid_password' })).login('id', 'pw')).rejects.toBeInstanceOf(KidsnoteAuthError)
  })
  it('detects a two-factor account', async () => {
    await expect(call(res(200, { second_factors: [{ id: 1 }] })).login('id', 'pw')).rejects.toBeInstanceOf(KidsnoteTwoFactorError)
  })
  it('sends the session cookie on API calls', async () => {
    let seen = ''
    const k = new HttpKidsnote((async (_u: string, init: RequestInit) => {
      seen = (init.headers as Record<string, string>).Cookie
      return res(200, { children: [{ id: 1, name: 'a' }] })
    }) as unknown as typeof fetch)
    expect(await k.listChildren({ accessToken: 'sessionid=s1', refreshToken: null, expiresAt: null })).toEqual([{ id: '1', name: 'a' }])
    expect(seen).toBe('sessionid=s1')
  })
})
