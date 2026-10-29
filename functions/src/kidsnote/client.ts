import { seoulDate } from '../../../shared/householdDate'
import type { Ymd } from '../../../shared/types'

/*
 * Kids Note has no public API. The web app (www.kidsnote.com, Next.js) logs in with
 *   POST https://www.kidsnote.com/api/web/login/  {username, password, remember_me}
 * (verified 2026-10-28: wrong credentials -> 400 {"err_code":"invalid_password"}) and then calls
 * the same-origin API with the session cookie it receives:
 *   GET /api/v1/me/info/, /api/v1/me/children/, /api/v1_2/children/{id}/reports/ (all 401 without a session).
 * The shape of a successful login response and of the children list is not verified yet; parsing is tolerant.
 * Accounts with two-factor login are not supported (the web asks for a code by phone/e-mail).
 *
 * Report attachments (verified 2026-10-28 from the web report viewer bundle, chunk 1062): a report has
 * `attached_images[]` ({id, large, original?, original_file_name}), `attached_files[]` ({id, original_file_name, ...url field
 * not shown}) and `attached_video`. URL fields other than `large` are guessed, so collection is tolerant.
 *
 * Center notices (verified 2026-10-29 with a parent session): GET /api/v1/centers/{centerId}/notices/ lists the notices the
 * parent can see, newest first, with cursor paging (`next` is a bare cursor passed back as ?page=). Items have id, created,
 * title, content, is_center_notice, cls, attached_images, attached_files. Newsletters (가정통신문) are posted here.
 * The daycare menu board (/v1/centers/{id}/menu/) only carries a photo per day, so it is not read; the family uploads the
 * monthly menu sheet instead.
 */
export const KIDSNOTE_API = {
  base: 'https://www.kidsnote.com/api',
  loginPath: '/web/login/',
  meInfoPath: '/v1/me/info/',
  childrenPath: '/v1/me/children/',
  reportsPath: (childId: string) => `/v1_2/children/${encodeURIComponent(childId)}/reports/`,
  noticesPath: (centerId: string) => `/v1/centers/${encodeURIComponent(centerId)}/notices/`,
  pageSize: 20,
  maxPages: 5,
} as const

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Origin: 'https://www.kidsnote.com',
  Referer: 'https://www.kidsnote.com/login',
  Accept: 'application/json',
}

export interface KidsnoteTokens {
  /** Cookie header value of the logged-in web session ("name=value; name2=value2"). */
  accessToken: string
  refreshToken: string | null
  /** epoch millis of the session cookie expiry; null when unknown */
  expiresAt: number | null
}

/** The account needs a second-factor code, which an unattended server cannot provide. */
export class KidsnoteTwoFactorError extends Error {}

export interface KidsnoteChild {
  id: string
  name: string
  /** Daycare (center) id, needed for the notices; field name not verified, so it may be missing. */
  centerId?: string | null
}

/** A file attached to a report. `urls` are download candidates, best first. */
export interface KidsnoteAttachmentRef {
  kind: 'image' | 'pdf'
  urls: string[]
  name: string | null
}

export interface KidsnoteReport {
  id: string
  written: Ymd
  createdAt: string // ISO
  text: string
  url: string | null
  attachments?: KidsnoteAttachmentRef[]
}

export interface DownloadedFile {
  bytes: Uint8Array
  contentType: string | null
}

export class KidsnoteAuthError extends Error {}
export class AttachmentTooLargeError extends Error {}

export interface KidsnotePort {
  login(id: string, password: string): Promise<KidsnoteTokens>
  refresh(tokens: KidsnoteTokens): Promise<KidsnoteTokens>
  listChildren(tokens: KidsnoteTokens): Promise<KidsnoteChild[]>
  /** Reports written at or after `sinceIso`, oldest first. */
  listReports(tokens: KidsnoteTokens, childId: string, sinceIso: string): Promise<KidsnoteReport[]>
  /** One attachment; throws AttachmentTooLargeError above `maxBytes`. */
  download(tokens: KidsnoteTokens, url: string, maxBytes: number): Promise<DownloadedFile>
  /** Center notices created at or after `sinceIso`, oldest first. */
  listNotices(tokens: KidsnoteTokens, centerId: string, sinceIso: string): Promise<KidsnoteReport[]>
}

type FetchFn = typeof fetch
type Json = Record<string, unknown>

/** Turns Set-Cookie headers into a Cookie header and the latest expiry among them. */
export function sessionFromSetCookies(setCookies: string[], now: number): KidsnoteTokens {
  const pairs: string[] = []
  let expiresAt: number | null = null
  for (const sc of setCookies) {
    const [pair, ...attrs] = sc.split(';').map((s) => s.trim())
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const value = pair.slice(eq + 1)
    if (!value || value === '""') continue
    pairs.push(pair)
    for (const a of attrs) {
      const [k, v] = a.split('=')
      if (/^max-age$/i.test(k) && Number(v) > 0) expiresAt = Math.max(expiresAt ?? 0, now + Number(v) * 1000)
      else if (/^expires$/i.test(k) && Number.isFinite(Date.parse(v))) expiresAt = Math.max(expiresAt ?? 0, Date.parse(v))
    }
  }
  if (!pairs.length) throw new KidsnoteAuthError('login returned no session cookie')
  return { accessToken: pairs.join('; '), refreshToken: null, expiresAt }
}

function getSetCookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof h.getSetCookie === 'function') return h.getSetCookie()
  const one = res.headers.get('set-cookie')
  return one ? one.split(/,(?=\s*[A-Za-z0-9_-]+=)/) : []
}

/** Pulls a child list out of either /me/info/ or /me/children/ (field names not verified). */
export function parseChildren(j: unknown): KidsnoteChild[] {
  const o = (j ?? {}) as Json
  const list = (Array.isArray(j) ? j : Array.isArray(o.children) ? o.children : Array.isArray(o.results) ? o.results : []) as Json[]
  return list
    .map((c) => {
      const child: KidsnoteChild = { id: String(c.id ?? c.child_id ?? ''), name: String(c.name ?? c.child_name ?? c.nickname ?? '') }
      const centerId = centerIdOf(c)
      if (centerId) child.centerId = centerId
      return child
    })
    .filter((c) => c.id)
}

const idString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null
const asObj = (v: unknown): Json | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null)

/** center_id / center.id / enrollment[0].center(_id) / belong_to.center ... whichever exists. */
function centerIdOf(c: Json): string | null {
  const direct = idString(c.center_id) ?? idString(c.centerId) ?? idString(asObj(c.center)?.id) ?? idString(c.center)
  if (direct) return direct
  for (const key of ['enrollment', 'enrollments', 'belongs', 'belong_to']) {
    const v = c[key]
    const list = Array.isArray(v) ? v : v ? [v] : []
    for (const e of list) {
      const o = asObj(e)
      if (!o) continue
      const id = idString(o.center_id) ?? idString(asObj(o.center)?.id) ?? idString(o.center)
      if (id) return id
    }
  }
  return null
}

const isPdfName = (s: string | null) => !!s && /\.pdf$/i.test(s.split(/[?#]/)[0])
const httpsUrl = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null)

/**
 * Image and PDF attachments of one report. Images come from `attached_images[]` (also `images[]`), preferring
 * `large` (what the web viewer shows, smaller than `original`). PDFs come from `attached_files[]` / `attachments[]`
 * entries whose file name or URL ends in .pdf.
 */
export function collectAttachments(r: Json): KidsnoteAttachmentRef[] {
  const out: KidsnoteAttachmentRef[] = []
  const seen = new Set<string>()
  const add = (kind: KidsnoteAttachmentRef['kind'], urls: (string | null)[], name: string | null) => {
    const uniq = [...new Set(urls.filter((u): u is string => !!u))].filter((u) => !seen.has(u))
    if (!uniq.length) return
    uniq.forEach((u) => seen.add(u))
    out.push({ kind, urls: uniq, name })
  }
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

  for (const img of [...list(r.attached_images), ...list(r.images)]) {
    if (typeof img === 'string') {
      add('image', [httpsUrl(img)], null)
      continue
    }
    const o = asObj(img)
    if (!o) continue
    add('image', [httpsUrl(o.large), httpsUrl(o.original), httpsUrl(o.url), httpsUrl(o.image)], (o.original_file_name as string) ?? null)
  }

  for (const f of [...list(r.attached_files), ...list(r.attachments)]) {
    const o = asObj(f)
    const urls = o
      ? [httpsUrl(o.original), httpsUrl(o.url), httpsUrl(o.file), httpsUrl(o.download_url), httpsUrl(o.large)]
      : [httpsUrl(f)]
    const name = o ? ((o.original_file_name ?? o.file_name ?? o.name ?? null) as string | null) : null
    if (isPdfName(name) || urls.some((u) => isPdfName(u))) add('pdf', urls, name)
  }
  return out
}

/** Media type from the first bytes; null for anything Claude cannot read as an image or document. */
export function sniffMediaType(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf' | null {
  const at = (i: number) => b[i]
  const ascii = (from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len))
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (b.length >= 8 && at(0) === 0x89 && ascii(1, 3) === 'PNG') return 'image/png'
  if (b.length >= 6 && ascii(0, 4) === 'GIF8') return 'image/gif'
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  if (b.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf'
  return null
}

/** Tolerant parsing of one report object (field names to be confirmed). */
export function parseReport(r: Json, childId: string): KidsnoteReport | null {
  const id = r.id ?? r.report_id
  if (id === undefined || id === null) return null
  const created = String(r.created ?? r.created_at ?? r.date_written ?? '')
  const createdMs = Date.parse(created)
  const dateWritten = typeof r.date_written === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date_written) ? r.date_written.slice(0, 10) : null
  const written = dateWritten ?? (Number.isFinite(createdMs) ? seoulDate(new Date(createdMs)) : null)
  if (!written) return null
  const text = String(r.content ?? r.text ?? r.body ?? '').trim()
  const attachments = collectAttachments(r)
  return {
    id: String(id),
    written,
    createdAt: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : `${written}T00:00:00+09:00`,
    text,
    url: `https://www.kidsnote.com/reports/${encodeURIComponent(String(id))}?child=${encodeURIComponent(childId)}`,
    ...(attachments.length ? { attachments } : {}),
  }
}

/** A center notice read like a report: the title leads the text, the link opens the web notice viewer. */
export function parseNotice(r: Json): KidsnoteReport | null {
  const base = parseReport(r, '')
  if (!base) return null
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  const text = title && !base.text.startsWith(title) ? `${title}\n${base.text}`.trim() : base.text
  return { ...base, text, url: `https://www.kidsnote.com/notice/${encodeURIComponent(base.id)}` }
}

/** `next` is either a URL with ?page= or, as the live API sends it (2026-10-29), a bare cursor such as "cD03MzQ4Nzk5Mg==". */
function nextPage(next: unknown): string | null {
  if (typeof next !== 'string' || !next) return null
  // A base64 cursor may itself contain "/", so only a leading scheme or slash, or a "?", marks a URL.
  if (!/^(https?:|\/)|\?/.test(next)) return next
  try {
    return new URL(next, KIDSNOTE_API.base).searchParams.get('page')
  } catch {
    return next
  }
}

export class HttpKidsnote implements KidsnotePort {
  constructor(private fetchFn: FetchFn = fetch, private now: () => number = Date.now) {}

  async login(id: string, password: string): Promise<KidsnoteTokens> {
    const res = await this.fetchFn(`${KIDSNOTE_API.base}${KIDSNOTE_API.loginPath}`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: id, password, remember_me: true }),
      redirect: 'manual',
    })
    let body: Json = {}
    try { body = (await res.json()) as Json } catch { /* empty body */ }
    const code = typeof body.err_code === 'string' ? body.err_code : ''
    if (/second|2fa|two_factor/i.test(code) || Array.isArray(body.second_factors)) throw new KidsnoteTwoFactorError(code || 'second factor required')
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new KidsnoteAuthError(`login rejected (${res.status} ${code})`)
    if (res.status >= 400) throw new Error(`kidsnote login HTTP ${res.status} ${code}`)
    return sessionFromSetCookies(getSetCookies(res), this.now())
  }

  /** The web session cannot be renewed without the password; the user reconnects when it expires. */
  refresh(_tokens: KidsnoteTokens): Promise<KidsnoteTokens> {
    return Promise.reject(new KidsnoteAuthError('session expired; reconnect in settings'))
  }

  private async get(tokens: KidsnoteTokens, pathAndQuery: string): Promise<unknown> {
    const res = await this.fetchFn(`${KIDSNOTE_API.base}${pathAndQuery}`, {
      headers: { ...BROWSER_HEADERS, Cookie: tokens.accessToken },
    })
    if (res.status === 401 || res.status === 403) throw new KidsnoteAuthError(`unauthorized (${res.status})`)
    if (!res.ok) throw new Error(`kidsnote HTTP ${res.status} for ${pathAndQuery.split('?')[0]}`)
    return res.json()
  }

  async listChildren(tokens: KidsnoteTokens): Promise<KidsnoteChild[]> {
    const fromInfo = parseChildren(await this.get(tokens, KIDSNOTE_API.meInfoPath))
    if (fromInfo.length) return fromInfo
    return parseChildren(await this.get(tokens, KIDSNOTE_API.childrenPath))
  }

  async listReports(tokens: KidsnoteTokens, childId: string, sinceIso: string): Promise<KidsnoteReport[]> {
    return this.listSince(tokens, KIDSNOTE_API.reportsPath(childId), { child: childId }, (r) => parseReport(r, childId), sinceIso)
  }

  async listNotices(tokens: KidsnoteTokens, centerId: string, sinceIso: string): Promise<KidsnoteReport[]> {
    return this.listSince(tokens, KIDSNOTE_API.noticesPath(centerId), {}, parseNotice, sinceIso)
  }

  /** Newest-first list endpoint → items created at or after `sinceIso`, oldest first. */
  private async listSince(
    tokens: KidsnoteTokens,
    path: string,
    params: Record<string, string>,
    parse: (r: Json) => KidsnoteReport | null,
    sinceIso: string,
  ): Promise<KidsnoteReport[]> {
    const since = Date.parse(sinceIso)
    const out: KidsnoteReport[] = []
    let page: string | null = null
    for (let i = 0; i < KIDSNOTE_API.maxPages; i++) {
      const q = new URLSearchParams({ page_size: String(KIDSNOTE_API.pageSize), tz: 'Asia/Seoul', ...params })
      if (page) q.set('page', page)
      const j = (await this.get(tokens, `${path}?${q.toString()}`)) as Json
      const results = (Array.isArray(j.results) ? j.results : []) as Json[]
      let reachedOld = false
      for (const r of results) {
        const rep = parse(r)
        if (!rep) continue
        if (Date.parse(rep.createdAt) < since) {
          reachedOld = true
          continue
        }
        out.push(rep)
      }
      page = nextPage(j.next)
      if (reachedOld || !page) break
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /**
   * Downloads one attachment. The session cookie goes only to Kids Note's own hosts (kidsnote.com / kidsnote.net);
   * files on other hosts (e.g. a signed CDN URL) are fetched without it.
   */
  async download(tokens: KidsnoteTokens, url: string, maxBytes: number): Promise<DownloadedFile> {
    const u = new URL(url)
    if (u.protocol !== 'https:') throw new Error('attachment URL is not https')
    const ownHost = /(^|\.)kidsnote\.(com|net)$/i.test(u.hostname)
    const res = await this.fetchFn(u.toString(), {
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Referer: BROWSER_HEADERS.Referer,
        Accept: '*/*',
        ...(ownHost ? { Cookie: tokens.accessToken } : {}),
      },
    })
    if (res.status === 401 || res.status === 403) throw new KidsnoteAuthError(`attachment unauthorized (${res.status})`)
    if (!res.ok) throw new Error(`attachment HTTP ${res.status}`)
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new AttachmentTooLargeError(`attachment ${declared} bytes`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length > maxBytes) throw new AttachmentTooLargeError(`attachment ${bytes.length} bytes`)
    return { bytes, contentType: res.headers.get('content-type') }
  }
}

/** In-memory Kids Note for tests. */
export class FakeKidsnote implements KidsnotePort {
  reports: KidsnoteReport[] = []
  children: KidsnoteChild[] = [{ id: 'c1', name: 'child' }]
  failWith: Error | null = null
  logins: string[] = []
  /** url → file; a missing url fails like a 404 */
  files: Record<string, Uint8Array> = {}
  downloads: string[] = []
  notices: KidsnoteReport[] = []
  noticeCalls: string[] = []
  noticesFailWith: Error | null = null

  async download(_t: KidsnoteTokens, url: string, maxBytes: number) {
    this.downloads.push(url)
    const bytes = this.files[url]
    if (!bytes) throw new Error('attachment HTTP 404')
    if (bytes.length > maxBytes) throw new AttachmentTooLargeError(`attachment ${bytes.length} bytes`)
    return { bytes, contentType: null }
  }

  async login(id: string, _password: string) {
    if (this.failWith) throw this.failWith
    this.logins.push(id)
    return { accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt: null }
  }
  async refresh(tokens: KidsnoteTokens) {
    return { ...tokens, accessToken: `${tokens.accessToken}+` }
  }
  async listChildren() {
    return this.children
  }
  async listNotices(_t: KidsnoteTokens, centerId: string, sinceIso: string) {
    this.noticeCalls.push(centerId)
    if (this.noticesFailWith) throw this.noticesFailWith
    return this.notices.filter((r) => r.createdAt >= sinceIso).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  async listReports(_t: KidsnoteTokens, _childId: string, sinceIso: string) {
    if (this.failWith) throw this.failWith
    return this.reports.filter((r) => r.createdAt >= sinceIso).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}
