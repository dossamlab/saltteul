import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { makeT } from '../../../shared/copy'
import { FakeFirestore } from '../testing/fakeFirestore'
import { FakeMessaging } from '../testing/fakeMessaging'
import { runBriefing } from './briefing'
import { AnthropicClaude, ClaudeRefusalError, FakeClaude, type BetaMessagesLike } from './client'
import { InvalidOutputError, validateExtraction } from './schemas'

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming
type Msg = Anthropic.Beta.Messages.BetaMessage

function fakeSdk(reply: Partial<Msg> & { text?: string }) {
  const calls: Params[] = []
  const messages: BetaMessagesLike = {
    async create(p) {
      calls.push(p)
      return {
        id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
        content: reply.text !== undefined ? [{ type: 'text', text: reply.text, citations: null }] : [],
        ...reply,
      } as unknown as Msg
    },
  }
  return { calls, messages }
}

const H = 'households/home'
// 07:30 KST on 2026-10-28
const MORNING = new Date('2026-10-27T22:30:00Z')

function seedHousehold(db: FakeFirestore) {
  db.put(H, { memberUids: ['uH', 'uW'] })
  db.put(`${H}/members/uH`, { uid: 'uH', displayName: 'Minu', role: 'husband', email: 'h@x' })
  db.put(`${H}/members/uW`, { uid: 'uW', displayName: 'Jieun', role: 'wife', email: 'w@x' })
  db.put(`${H}/devices/a`, { uid: 'uH', platform: 'android', token: 'a' })
  db.put(`${H}/devices/w`, { uid: 'uW', platform: 'web', token: 'w' })
  db.put(`${H}/settings/main`, { familyName: '', briefingTimes: { morning: '07:30', evening: '20:00' } })
  db.put(`${H}/todos/t1`, {
    title: 'Field trip', date: '2026-10-28', time: '09:00', owner: 'both', done: false, source: 'kidsnote', updatedAt: 1,
    prepItems: [{ name: 'Lunch box', source: 'stated' }],
  })
}

const t = makeT({
  'push.briefing.titleMorning': 'Morning',
  'push.briefing.titleEvening': 'Evening',
  'brief.fb.headlineMorning': 'Today',
  'brief.fb.todoTimed': '{time} {title} ({owner})',
  'brief.fb.prep': '{title}: {items}',
  'brief.fb.empty': 'Nothing today',
  'owner.both': 'together',
})

describe('AnthropicClaude', () => {
  it('sends the model, adaptive thinking, structured output and default fallbacks', async () => {
    const sdk = fakeSdk({ text: JSON.stringify({ headline: ' Hi ', lines: ['a', '', 'b'] }) })
    const c = new AnthropicClaude({ messages: sdk.messages })
    const out = await c.writeBriefing({ slot: 'morning' } as never)
    expect(out).toEqual({ headline: 'Hi', lines: ['a', 'b'], model: 'claude-sonnet-5-5' })
    const p = sdk.calls[0]
    expect(p.model).toBe('claude-sonnet-5-5')
    expect(p.output_config?.effort).toBe('medium')
    expect(p.thinking).toEqual({ type: 'adaptive' })
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(p.fallbacks).toBe('default')
    expect(p.output_config?.format?.type).toBe('json_schema')
    expect(p.output_config?.format?.schema).toMatchObject({ required: ['headline', 'lines'] })
  })

  it('turns a refusal or broken output into errors', async () => {
    const refused = new AnthropicClaude({ messages: fakeSdk({ stop_reason: 'refusal', text: '' }).messages })
    await expect(refused.writeBriefing({} as never)).rejects.toBeInstanceOf(ClaudeRefusalError)
    const garbage = new AnthropicClaude({ messages: fakeSdk({ text: 'not json' }).messages })
    await expect(garbage.writeBriefing({} as never)).rejects.toBeInstanceOf(InvalidOutputError)
    const truncated = new AnthropicClaude({ messages: fakeSdk({ stop_reason: 'max_tokens', text: '{' }).messages })
    await expect(truncated.extractKidsnote({ text: 'x', written: '2026-10-28', ruleKeywords: [] })).rejects.toBeInstanceOf(InvalidOutputError)
  })

  it('sends quick add and dinner to Haiku without fallbacks, and fails their refusals', async () => {
    const q = fakeSdk({ text: JSON.stringify({ items: [], unparsed: [] }) })
    await new AnthropicClaude({ messages: q.messages }).quickAdd({ text: 'x' } as never)
    const d = fakeSdk({ text: JSON.stringify({ options: [{ name: 'n', why: 'w', ingredients: ['a'] }] }) })
    await new AnthropicClaude({ messages: d.messages }).suggestDinner({} as never)
    for (const p of [q.calls[0], d.calls[0]]) {
      expect(p.model).toBe('claude-haiku-5-5')
      expect(p.thinking).toEqual({ type: 'adaptive' })
      expect('fallbacks' in p).toBe(false)
      expect('betas' in p).toBe(false)
    }
    expect(d.calls[0].output_config?.effort).toBe('medium')

    const j = fakeSdk({ text: JSON.stringify({ title: 'Week', lines: ['a'] }) })
    await new AnthropicClaude({ messages: j.messages }).writeJournal({} as never)
    expect(j.calls[0].model).toBe('claude-sonnet-5-5')
    expect(j.calls[0].fallbacks).toBe('default')

    const refused = fakeSdk({ stop_reason: 'refusal', text: '' })
    await expect(new AnthropicClaude({ messages: refused.messages }).quickAdd({ text: 'x' } as never)).rejects.toBeInstanceOf(ClaudeRefusalError)
    await expect(new AnthropicClaude({ messages: refused.messages }).suggestDinner({} as never)).rejects.toBeInstanceOf(ClaudeRefusalError)
  })

  it('runs quick add at low effort and the other new calls at medium', async () => {
    const sdk = fakeSdk({
      text: JSON.stringify({
        items: [
          { kind: 'todo', title: ' Dentist ', date: '2026-10-29', time: '15:00', owner: 'wife', note: null, qty: null, refId: null, prepItems: [' card ', ''] },
          { kind: 'nonsense', title: 'x' },
          'not an object',
        ],
        unparsed: [' hmm ', ''],
      }),
    })
    const c = new AnthropicClaude({ messages: sdk.messages })
    const out = await c.quickAdd({ text: 'x' } as never)
    expect(out).toEqual({
      items: [{ kind: 'todo', title: 'Dentist', date: '2026-10-29', time: '15:00', owner: 'wife', note: null, qty: null, refId: null, prepItems: ['card'] }],
      unparsed: ['hmm'],
      model: 'claude-sonnet-5-5',
    })
    expect(sdk.calls[0].output_config?.effort).toBe('low')
    expect(sdk.calls[0].thinking).toEqual({ type: 'adaptive' })
    expect(sdk.calls[0].output_config?.format?.schema).toMatchObject({ required: ['items', 'unparsed'] })

    const j = fakeSdk({ text: JSON.stringify({ title: 'Week', lines: ['a', ' ', 'b'] }) })
    expect(await new AnthropicClaude({ messages: j.messages }).writeJournal({} as never)).toMatchObject({ title: 'Week', lines: ['a', 'b'] })
    expect(j.calls[0].output_config?.effort).toBe('medium')

    const d = fakeSdk({
      text: JSON.stringify({ options: [1, 2, 3, 4].map((i) => ({ name: `n${i}`, why: 'w', ingredients: ['a', ''] })) }),
    })
    const dinner = await new AnthropicClaude({ messages: d.messages }).suggestDinner({} as never)
    expect(dinner.options).toHaveLength(3)
    expect(dinner.options[0]).toEqual({ name: 'n1', why: 'w', ingredients: ['a'] })
    const empty = fakeSdk({ text: JSON.stringify({ options: [] }) })
    await expect(new AnthropicClaude({ messages: empty.messages }).suggestDinner({} as never)).rejects.toBeInstanceOf(InvalidOutputError)

    const w = fakeSdk({ text: JSON.stringify({ headline: 'H', lines: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }) })
    expect((await new AnthropicClaude({ messages: w.messages }).writeWeekly({} as never)).lines).toHaveLength(8)
  })

  it('sends attachments as image / document blocks before the notice text', async () => {
    const sdk = fakeSdk({ text: JSON.stringify({ events: [], deadlines: [], notes: [] }) })
    const c = new AnthropicClaude({ messages: sdk.messages })
    await c.extractKidsnote({
      text: 'notice', written: '2026-10-28', ruleKeywords: [],
      attachments: [
        { mediaType: 'application/pdf', dataBase64: 'UERG' },
        { mediaType: 'image/png', dataBase64: 'UE5H' },
      ],
    })
    const content = sdk.calls[0].messages[0].content as { type: string; source?: { media_type: string; data: string }; text?: string }[]
    expect(content.map((b) => b.type)).toEqual(['document', 'image', 'text'])
    expect(content[0].source).toMatchObject({ media_type: 'application/pdf', data: 'UERG' })
    expect(content[1].source).toMatchObject({ media_type: 'image/png', data: 'UE5H' })
    expect(JSON.parse(content[2].text!)).toEqual({ written: '2026-10-28', ruleKeywords: [], text: 'notice' })

    // Without attachments the user content stays a plain string.
    await c.extractKidsnote({ text: 'n', written: '2026-10-28', ruleKeywords: [] })
    expect(typeof sdk.calls[1].messages[0].content).toBe('string')
  })

  it('validates and normalises the extraction', () => {
    const v = validateExtraction({
      events: [
        { title: 'Trip', kind: 'weird', dateText: 'next Wed', isoDate: '2026-13-01x', time: '9:00', prepItems: [{ name: 'Hat', source: 'x', needsPurchase: 'yes' }] },
        { title: ' ', kind: 'event', dateText: '', isoDate: null, time: null, prepItems: [] },
      ],
      deadlines: [{ title: 'Form', dateText: '', isoDate: '2026-11-01' }],
      notes: ['n'],
    })
    expect(v.events).toEqual([
      { title: 'Trip', kind: 'other', dateText: 'next Wed', isoDate: null, time: null, prepItems: [{ name: 'Hat', source: 'inferred', needsPurchase: false }] },
    ])
    expect(v.deadlines[0].isoDate).toBe('2026-11-01')
    expect(() => validateExtraction({ events: 'x' })).toThrow(InvalidOutputError)
  })
})

describe('runBriefing', () => {
  it('stores the Claude briefing and pushes the headline to both members', async () => {
    const db = new FakeFirestore()
    seedHousehold(db)
    const fcm = new FakeMessaging()
    const claude = new FakeClaude({ headline: 'Trip day', lines: ['Lunch box'] })
    const b = await runBriefing({ db: db.asAdmin, messaging: fcm, claude, t }, 'morning', MORNING)

    expect(claude.briefingCalls[0]).toMatchObject({ day: '2026-10-28', names: { husband: 'Minu', wife: 'Jieun' } })
    expect(b).toMatchObject({ id: '2026-10-28_morning', model: 'fake', failed: false, headline: 'Trip day' })
    expect(db.read(`${H}/briefings/2026-10-28_morning`)).toMatchObject({ lines: ['Lunch box'], slot: 'morning' })
    expect(fcm.tokens().sort()).toEqual(['a', 'w'])
    expect(fcm.sent[0]).toMatchObject({ notification: { title: 'Morning', body: 'Trip day' }, data: { type: 'briefing' } })
    expect(db.read(`${H}/integrations/claude`)).toMatchObject({ consecutiveFailures: 0 })
  })

  it('falls back to the plain briefing when Claude fails', async () => {
    const db = new FakeFirestore()
    seedHousehold(db)
    const fcm = new FakeMessaging()
    const b = await runBriefing({ db: db.asAdmin, messaging: fcm, claude: new FakeClaude(new Error('529 overloaded')), t }, 'morning', MORNING)
    expect(b).toMatchObject({ model: null, failed: true, headline: 'Today' })
    expect(b.lines).toEqual(['09:00 Field trip (together)', 'Field trip: Lunch box'])
    expect(db.read(`${H}/integrations/claude`)).toMatchObject({ consecutiveFailures: 1, lastError: '529 overloaded' })
    expect(fcm.sent).toHaveLength(2)
  })

  it('skips Claude when there is nothing to say', async () => {
    const db = new FakeFirestore()
    seedHousehold(db)
    await db.doc(`${H}/todos/t1`).delete()
    const claude = new FakeClaude()
    const b = await runBriefing({ db: db.asAdmin, messaging: new FakeMessaging(), claude, t }, 'morning', MORNING)
    expect(claude.briefingCalls).toHaveLength(0)
    expect(b).toMatchObject({ model: null, failed: false, lines: ['Nothing today'] })
  })
})
