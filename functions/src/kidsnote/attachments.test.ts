import { describe, expect, it } from 'vitest'
import { makeT } from '../../../shared/copy'
import { FakeClaude } from '../claude/client'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeMessaging } from '../testing/fakeMessaging'
import { ATTACHMENT_LIMITS, downloadAttachments } from './attachments'
import {
  collectAttachments, FakeKidsnote, HttpKidsnote, parseChildren, parseClassInfo, parseNotice, parseReport, sniffMediaType, type KidsnoteTokens,
} from './client'
import { KIDSNOTE_SECRET_PATH } from './connect'
import { pollKidsnote } from './poll'

const H = 'households/home'
const W = '2026-10-28'
const NOW = new Date('2026-10-28T03:00:00Z')
const TOKENS: KidsnoteTokens = { accessToken: 'sessionid=AT', refreshToken: null, expiresAt: null }

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const PDF = new Uint8Array([...Buffer.from('%PDF-1.4\n')])

// A report as the web viewer reads it (field names from the Kids Note bundle), plus variants seen in other APIs.
const REPORT_FIXTURE = {
  id: 77,
  content: 'Today we went to the park.',
  created: '2026-10-28T01:00:00Z',
  attached_images: [
    { id: 1, large: 'https://kidsnote.s3.amazonaws.com/l/1.jpg', original: 'https://kidsnote.s3.amazonaws.com/o/1.jpg', original_file_name: '1.jpg' },
    { id: 2, original: 'https://img.kidsnote.com/o/2.png' },
    { id: 3, url: 'https://img.kidsnote.com/u/3.jpg' },
    { id: 4, large: 'not-a-url' },
  ],
  images: ['https://img.kidsnote.com/plain.jpg', { large: 'https://kidsnote.s3.amazonaws.com/l/1.jpg' }],
  attached_files: [
    { id: 9, original_file_name: 'November newsletter.PDF', original: 'https://files.kidsnote.com/f/9?sig=abc' },
    { id: 10, original_file_name: 'photo.hwp', original: 'https://files.kidsnote.com/f/10' },
    { id: 11, url: 'https://files.kidsnote.com/menu.pdf?x=1' },
  ],
  attachments: ['https://files.kidsnote.com/plain.pdf', 'https://files.kidsnote.com/plain.zip'],
  attached_video: { preview: 'https://v.kidsnote.com/p.jpg' },
}

describe('collectAttachments', () => {
  it('collects image URLs (large first) and PDF files from every known field, without duplicates', () => {
    expect(collectAttachments(REPORT_FIXTURE)).toEqual([
      { kind: 'image', urls: ['https://kidsnote.s3.amazonaws.com/l/1.jpg', 'https://kidsnote.s3.amazonaws.com/o/1.jpg'], name: '1.jpg' },
      { kind: 'image', urls: ['https://img.kidsnote.com/o/2.png'], name: null },
      { kind: 'image', urls: ['https://img.kidsnote.com/u/3.jpg'], name: null },
      { kind: 'image', urls: ['https://img.kidsnote.com/plain.jpg'], name: null },
      { kind: 'pdf', urls: ['https://files.kidsnote.com/f/9?sig=abc'], name: 'November newsletter.PDF' },
      { kind: 'pdf', urls: ['https://files.kidsnote.com/menu.pdf?x=1'], name: null },
      { kind: 'pdf', urls: ['https://files.kidsnote.com/plain.pdf'], name: null },
    ])
  })

  it('returns nothing for reports without attachments, and parseReport carries them only when present', () => {
    expect(collectAttachments({ id: 1, attached_images: [], attached_files: null })).toEqual([])
    expect(parseReport({ id: 1, content: 'x', created: '2026-10-28T01:00:00Z' }, 'c1')).not.toHaveProperty('attachments')
    expect(parseReport(REPORT_FIXTURE, 'c1')?.attachments).toHaveLength(7)
  })
})

describe('sniffMediaType', () => {
  it('recognises the formats Claude reads', () => {
    expect(sniffMediaType(JPEG)).toBe('image/jpeg')
    expect(sniffMediaType(PNG)).toBe('image/png')
    expect(sniffMediaType(new Uint8Array([...Buffer.from('GIF89a')]))).toBe('image/gif')
    expect(sniffMediaType(new Uint8Array([...Buffer.from('RIFF\0\0\0\0WEBPVP8 ')]))).toBe('image/webp')
    expect(sniffMediaType(PDF)).toBe('application/pdf')
    expect(sniffMediaType(new Uint8Array([...Buffer.from('<html>')]))).toBeNull()
  })
})

describe('downloadAttachments', () => {
  it('takes PDFs first, falls back to the next URL, skips failures and stops at 5 files', async () => {
    const k = new FakeKidsnote()
    k.files = {
      'https://a/large.jpg': new Uint8Array(ATTACHMENT_LIMITS.maxImageBytes + 1).fill(0xff), // too big for Claude as an image
      'https://a/original.jpg': JPEG,
      'https://a/doc.pdf': PDF,
      'https://a/html.png': new Uint8Array([...Buffer.from('<html>')]),
      'https://a/2.png': PNG,
      'https://a/3.png': PNG,
      'https://a/4.png': PNG,
      'https://a/5.png': PNG,
    }
    const logs: string[] = []
    const out = await downloadAttachments(k, TOKENS, [
      { kind: 'image', urls: ['https://a/large.jpg', 'https://a/original.jpg'], name: 'one.jpg' },
      { kind: 'image', urls: ['https://a/missing.jpg'], name: null },
      { kind: 'image', urls: ['https://a/html.png'], name: null },
      { kind: 'image', urls: ['https://a/2.png'], name: null },
      { kind: 'image', urls: ['https://a/3.png'], name: null },
      { kind: 'image', urls: ['https://a/4.png'], name: null },
      { kind: 'image', urls: ['https://a/5.png'], name: null },
      { kind: 'pdf', urls: ['https://a/doc.pdf'], name: 'doc.pdf' },
    ], (m) => logs.push(m))
    expect(out.map((a) => a.mediaType)).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/png', 'image/png'])
    expect(out[0]).toEqual({ mediaType: 'application/pdf', dataBase64: Buffer.from(PDF).toString('base64'), name: 'doc.pdf' })
    expect(out[1].name).toBe('one.jpg')
    expect(k.downloads).not.toContain('https://a/5.png')
    expect(logs.length).toBe(3) // large.jpg too big, missing.jpg, html.png
  })
})

describe('HttpKidsnote.download', () => {
  it('sends the session cookie only to Kids Note hosts and enforces the size limit', async () => {
    const seen: { url: string; cookie?: string }[] = []
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen.push({ url, cookie: (init?.headers as Record<string, string>)?.Cookie })
      if (url.includes('big')) return new Response(new Uint8Array(10), { status: 200, headers: { 'content-length': '10' } })
      return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } })
    }) as typeof fetch
    const k = new HttpKidsnote(fetchFn)
    expect((await k.download(TOKENS, 'https://files.kidsnote.com/a.pdf', 100)).bytes).toEqual(PDF)
    await k.download(TOKENS, 'https://kidsnote-cdn.s3.amazonaws.com/a.pdf', 100)
    expect(seen.map((s) => s.cookie)).toEqual(['sessionid=AT', undefined])
    await expect(k.download(TOKENS, 'https://files.kidsnote.com/big.pdf', 5)).rejects.toThrow(/10 bytes/)
    await expect(k.download(TOKENS, 'http://files.kidsnote.com/a.pdf', 100)).rejects.toThrow(/https/)
  })
})

describe('pollKidsnote with attachments', () => {
  const t = makeT({})
  function setup() {
    const db = new FakeFirestore()
    db.put(H, { memberUids: ['uH'] })
    db.put(`${H}/members/uH`, { uid: 'uH', displayName: 'H', role: 'husband', email: 'h@x' })
    db.put(KIDSNOTE_SECRET_PATH, { tokens: TOKENS, children: [{ id: 'c1', name: 'kid' }], childId: 'c1', connectedAt: 1, connectedBy: 'uH' })
    const kidsnote = new FakeKidsnote()
    const claude = new FakeClaude()
    return { db, kidsnote, claude, deps: { db: db.asAdmin, kidsnote, claude, messaging: new FakeMessaging(), t } }
  }

  it('passes downloaded files to the extraction and stores the notice text', async () => {
    const { db, kidsnote, claude, deps } = setup()
    kidsnote.reports = [{
      id: 'r1', written: W, createdAt: '2026-10-28T01:00:00.000Z', text: 'See the newsletter', url: null,
      attachments: [{ kind: 'pdf', urls: ['https://f/news.pdf'], name: 'news.pdf' }, { kind: 'image', urls: ['https://f/gone.jpg'], name: null }],
    }]
    kidsnote.files = { 'https://f/news.pdf': PDF }
    await pollKidsnote(deps, NOW)
    expect(claude.extractCalls[0]).toMatchObject({ text: 'See the newsletter', written: W })
    expect(claude.extractCalls[0].attachments).toEqual([{ mediaType: 'application/pdf', dataBase64: Buffer.from(PDF).toString('base64'), name: 'news.pdf' }])
    expect(db.read(`${H}/kidsnote/r1`)).toMatchObject({ text: 'See the newsletter', written: W, createdAt: '2026-10-28T01:00:00.000Z', attachmentCount: 1 })
  })

  it('reads a notice that has only photos', async () => {
    const { kidsnote, claude, deps } = setup()
    kidsnote.reports = [{
      id: 'r2', written: W, createdAt: '2026-10-28T01:00:00.000Z', text: '', url: null,
      attachments: [{ kind: 'image', urls: ['https://f/a.jpg'], name: null }],
    }]
    kidsnote.files = { 'https://f/a.jpg': JPEG }
    await pollKidsnote(deps, NOW)
    expect(claude.extractCalls).toHaveLength(1)
    expect(claude.extractCalls[0].attachments?.[0].mediaType).toBe('image/jpeg')
  })
})

describe('parseChildren center id', () => {
  it('finds the center id in the usual places', () => {
    expect(parseChildren({
      children: [
        { id: 1, name: 'A', center_id: 501 },
        { id: 2, name: 'B', center: { id: 502, name: 'x' } },
        { id: 3, name: 'C', enrollment: [{ center_id: '503', class_id: 9 }] },
        { id: 4, name: 'D' },
      ],
    })).toEqual([
      { id: '1', name: 'A', centerId: '501' },
      { id: '2', name: 'B', centerId: '502' },
      { id: '3', name: 'C', centerId: '503' },
      { id: '4', name: 'D' },
    ])
  })
})

describe('notices', () => {
  it('reads a center notice with its title first and a link to the web viewer', () => {
    expect(parseNotice({
      id: 73524733, created: '2026-10-26T08:23:47.000000Z', title: 'Field trip helpers', content: 'Please sign up by 11/3.',
      is_center_notice: true, cls: null, attached_images: [{ id: 9, large: 'https://kidsnote.s3.amazonaws.com/l/9.jpg' }], attached_files: [],
    })).toEqual({
      id: '73524733', written: '2026-10-26', createdAt: '2026-10-26T08:23:47.000Z',
      text: 'Field trip helpers\nPlease sign up by 11/3.', url: 'https://www.kidsnote.com/notice/73524733',
      attachments: [{ kind: 'image', urls: ['https://kidsnote.s3.amazonaws.com/l/9.jpg'], name: null }],
      classId: null,
    })
    expect(parseNotice({ id: 2, created: '2026-10-26T00:00:00Z', title: 't', content: '', cls: 5551234 })?.classId).toBe('5551234')
    expect(parseNotice({ id: 3, created: '2026-10-26T00:00:00Z', title: 't', content: '', cls: { id: 77, name: 'x' } })?.classId).toBe('77')
    expect(parseNotice({ id: 1, created: '2026-10-26T00:00:00Z', title: 'Only a title', content: '' })?.text).toBe('Only a title')
    expect(parseNotice({ title: 'no id' })).toBeNull()
  })

  it('reads the class list and the child\'s enrolled class', () => {
    const center = { id: 501, classes: [{ id: 11, name: 'Sun' }, { id: 12, name: 'Moon ' }, { id: 13, name: '' }, { name: 'no id' }] }
    const child = { id: 9, enrollment: [{ center_id: 400, belong_to_class: 99 }, { center_id: 501, belong_to_class: 12 }] }
    expect(parseClassInfo(center, child, '501')).toEqual({ classes: [{ id: '11', name: 'Sun' }, { id: '12', name: 'Moon' }], childClassId: '12' })
    expect(parseClassInfo({}, {}, '501')).toEqual({ classes: [], childClassId: null })
  })

  it('pages the center notices with the cursor and stops at older items', async () => {
    const urls: string[] = []
    const pages = [
      { next: 'cD03MzQ4Nzk5Mg==', results: [{ id: 3, created: '2026-10-28T01:00:00Z', title: 'c', content: '' }, { id: 2, created: '2026-10-27T01:00:00Z', title: 'b', content: '' }] },
      { next: 'cD0x', results: [{ id: 1, created: '2026-10-20T01:00:00Z', title: 'a', content: '' }] },
    ]
    const fetchFn = (async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 })
    }) as typeof fetch
    const out = await new HttpKidsnote(fetchFn).listNotices(TOKENS, '501', '2026-10-25T00:00:00Z')
    expect(out.map((n) => n.id)).toEqual(['2', '3'])
    expect(urls).toEqual([
      'https://www.kidsnote.com/api/v1/centers/501/notices/?page_size=20&tz=Asia%2FSeoul',
      'https://www.kidsnote.com/api/v1/centers/501/notices/?page_size=20&tz=Asia%2FSeoul&page=cD03MzQ4Nzk5Mg%3D%3D',
    ])
  })
})
