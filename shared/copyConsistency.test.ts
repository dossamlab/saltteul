import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// copy/ko.json is built from copy/copy-spec*.json (fixed text as written, generated text otherwise, overrides last).
// These checks keep the three in step and catch a t('key') in code that ko.json does not have.
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
type Entry = { key: string; fixed?: string; vars?: string[] }
const main: Entry[] = read('copy/copy-spec.json').entries
const server: Entry[] = read('copy/copy-spec.functions.json')
const ko: Record<string, string> = read('copy/ko.json')
const overrides: Record<string, string> = read('copy/overrides.json')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' || name === 'lib' ? [] : sources(p)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

describe('copy', () => {
  it('has every spec key in ko.json, with fixed text as written', () => {
    const byKey = new Map<string, Entry>()
    for (const e of [...server, ...main]) byKey.set(e.key, e)
    for (const e of byKey.values()) {
      expect(ko[e.key], e.key).toBeTypeOf('string')
      if (e.fixed !== undefined) expect(ko[e.key], e.key).toBe(overrides[e.key] ?? e.fixed)
    }
    expect(Object.keys(ko).filter((k) => !byKey.has(k))).toEqual([])
  })

  it('keeps placeholders of fixed text to the declared vars (when declared) and has no em dash', () => {
    for (const e of [...main, ...server].filter((x) => x.fixed !== undefined)) {
      const used = [...new Set([...e.fixed!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
      if (e.vars) expect(used, e.key).toEqual([...e.vars].sort())
      expect(e.fixed, e.key).not.toMatch(/—/)
    }
  })

  it('has a text for every literal key the code asks for', () => {
    const missing = new Set<string>()
    for (const file of [...sources('src'), ...sources('shared'), ...sources('functions/src')]) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) if (!(m[1] in ko)) missing.add(`${file}: ${m[1]}`)
    }
    expect([...missing]).toEqual([])
  })
})
