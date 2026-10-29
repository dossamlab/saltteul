import { describe, expect, it } from 'vitest'
import { compareVersions, isManifest, shouldDownload } from './updateRule'

const M = { version: '20261029120000', url: '20261029120000.zip', checksum: 'a'.repeat(64), minNative: '0.3.0' }

describe('live update rule', () => {
  it('checks the manifest shape', () => {
    expect(isManifest(M)).toBe(true)
    expect(isManifest({ ...M, version: '2026-10-29' })).toBe(false)
    expect(isManifest({ ...M, checksum: 'xyz' })).toBe(false)
    expect(isManifest({ ...M, url: '' })).toBe(false)
    expect(isManifest(null)).toBe(false)
  })

  it('compares native versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.3', '0.3.0')).toBe(0)
    expect(compareVersions('0.3.0-debug', '0.3.1')).toBe(-1)
    expect(compareVersions('1.0', '0.3.0')).toBe(1)
  })

  it('downloads only newer screens that the installed app can run', () => {
    expect(shouldDownload(M, { buildId: '20261028090000', native: '0.3.0' })).toBe(true)
    expect(shouldDownload(M, { buildId: '20261029120000', native: '0.3.0' })).toBe(false)
    expect(shouldDownload(M, { buildId: '20261030000000', native: '0.3.0' })).toBe(false)
    expect(shouldDownload({ ...M, minNative: '0.4.0' }, { buildId: '20261028090000', native: '0.3.0' })).toBe(false)
  })
})
