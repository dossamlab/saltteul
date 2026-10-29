// Generates copy/ko.json from copy/copy-spec*.json with Gemini 3.8 Flash through the Antigravity CLI (agy).
// - "fixed" entries are copied as-is.
// - Generated text is cached per entry (copy/.cache/gen.json) so unchanged entries are not regenerated.
// - copy/overrides.json (human review fixes) is applied last and always wins.
// Usage: node copy/gen-copy.mjs [--force]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const MODEL = 'gemini-3.8-flash-high'
const BATCH = 35
const force = process.argv.includes('--force')
const read = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback)

const main = read('copy/copy-spec.json')
const extra = read('copy/copy-spec.functions.json', [])
const extraEntries = Array.isArray(extra) ? extra : extra.entries ?? []
const byKey = new Map()
for (const e of [...extraEntries, ...main.entries]) byKey.set(e.key, e) // main spec wins on duplicates
const entries = [...byKey.values()]

mkdirSync('copy/.cache/agy-ws', { recursive: true })
const cache = read('copy/.cache/gen.json', {})
const hash = (e) => createHash('sha1').update(JSON.stringify([e.where, e.meaning, e.maxChars, e.vars, main.app.tone])).digest('hex').slice(0, 12)

const varsOf = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

function check(e, text) {
  if (typeof text !== 'string' || !text.trim()) return 'empty'
  const want = [...(e.vars ?? [])].sort()
  const got = varsOf(text)
  if (JSON.stringify(want) !== JSON.stringify([...new Set(got)].sort())) return `placeholders must be exactly ${want.map((v) => `{${v}}`).join(' ') || '(none)'}`
  const visible = text.replace(/\{\w+\}/g, 'xx')
  if (e.maxChars && visible.length > e.maxChars) return `too long (${visible.length} > ${e.maxChars})`
  if (/—/.test(text)) return 'no em dash'
  return null
}

function prompt(batch, feedback) {
  const items = batch.map((e) => ({ key: e.key, where: e.where, meaning: e.meaning, maxChars: e.maxChars, placeholders: (e.vars ?? []).map((v) => `{${v}}`) }))
  return [
    '도구나 명령, 파일을 쓰지 말고 텍스트로만 바로 답하세요.',
    `앱: ${main.app.name}. ${main.app.description}`,
    `문체 규칙: ${main.app.tone}`,
    '아래 각 항목에 대해 앱 화면에 그대로 들어갈 한국어 문구를 하나씩 쓰세요.',
    '- meaning은 전할 뜻이지 그대로 옮길 문장이 아닙니다. 자연스러운 한국어 앱 문구로 쓰세요.',
    '- placeholders에 있는 {이름} 자리표시자는 빠짐없이 그대로 넣고, 없는 자리표시자는 만들지 마세요.',
    '- maxChars(자리표시자는 2글자로 계산)를 넘지 마세요.',
    '- {name}, {title}, {item} 같은 자리표시자 바로 뒤에는 받침에 따라 달라지는 조사(이/가, 을/를, 은/는, 과/와, 으로/로)를 붙이지 마세요. 「에게」「의」「도」처럼 받침과 상관없는 조사를 쓰거나 「담은 사람: {name}」처럼 문장 구조를 바꾸세요.',
    feedback ? `이전 답의 문제: ${feedback}` : '',
    '출력은 {"key": "문구", ...} 형태의 JSON 객체 하나만. 설명이나 코드 블록 표시는 쓰지 마세요.',
    JSON.stringify(items, null, 1),
  ].filter(Boolean).join('\n')
}

function callGemini(text) {
  const r = spawnSync('agy', ['-p', text, '--model', MODEL, '--disable-slash-commands', '--print-timeout', '300s'], {
    cwd: 'copy/.cache/agy-ws', encoding: 'utf8', shell: false, maxBuffer: 10 * 1024 * 1024,
  })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const s = out.indexOf('{')
  const e = out.lastIndexOf('}')
  if (s < 0 || e < s) throw new Error(`no JSON in agy output: ${out.slice(0, 300)}`)
  return JSON.parse(out.slice(s, e + 1))
}

const todo = entries.filter((e) => !e.fixed && (force || cache[e.key]?.hash !== hash(e) || check(e, cache[e.key]?.text)))
console.log(`entries ${entries.length}, fixed ${entries.filter((e) => e.fixed).length}, to generate ${todo.length}`)

for (let i = 0; i < todo.length; i += BATCH) {
  let batch = todo.slice(i, i + BATCH)
  let feedback = ''
  for (let attempt = 0; attempt < 3 && batch.length; attempt++) {
    console.log(`batch ${i / BATCH + 1}: ${batch.length} items (attempt ${attempt + 1})`)
    let res
    try { res = callGemini(prompt(batch, feedback)) } catch (err) { console.warn(String(err)); continue }
    const failed = []
    for (const e of batch) {
      const problem = check(e, res[e.key])
      if (problem) failed.push({ e, problem, text: res[e.key] })
      else cache[e.key] = { hash: hash(e), text: res[e.key] }
    }
    writeFileSync('copy/.cache/gen.json', JSON.stringify(cache, null, 1))
    batch = failed.map((f) => f.e)
    feedback = failed.map((f) => `${f.e.key}: ${f.problem} (was: ${JSON.stringify(f.text)})`).join('; ')
  }
  if (batch.length) console.warn('still failing:', batch.map((e) => e.key).join(', '))
}

const overrides = read('copy/overrides.json', {})
const out = {}
for (const e of entries.sort((a, b) => a.key.localeCompare(b.key))) {
  out[e.key] = overrides[e.key] ?? e.fixed ?? cache[e.key]?.text ?? e.key
}
writeFileSync('copy/ko.json', JSON.stringify(out, null, 2) + '\n')
const missing = Object.entries(out).filter(([k, v]) => k === v).map(([k]) => k)
console.log(`wrote copy/ko.json (${Object.keys(out).length} keys)${missing.length ? `, missing: ${missing.join(', ')}` : ''}`)
