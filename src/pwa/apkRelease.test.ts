import { describe, expect, it } from 'vitest'
import { parseRelease, shouldOffer } from './apkRelease'

const asset = { name: 'saltteul-0.5.0.apk', browser_download_url: 'https://github.com/dossamlab/saltteul/releases/download/v0.5.0/saltteul-0.5.0.apk' }

describe('APK release banner', () => {
  it('reads the tag and the APK asset of the latest release', () => {
    expect(parseRelease({ tag_name: 'v0.5.0', assets: [{ name: 'notes.txt', browser_download_url: 'https://github.com/x' }, asset] }))
      .toEqual({ version: '0.5.0', url: asset.browser_download_url })
    expect(parseRelease({ tag_name: 'v0.5.0', assets: [] })).toBeNull()
    expect(parseRelease({ tag_name: 'nightly', assets: [asset] })).toBeNull()
    expect(parseRelease({ tag_name: 'v0.5.0', prerelease: true, assets: [asset] })).toBeNull()
    expect(parseRelease({ tag_name: 'v0.5.0', assets: [{ ...asset, browser_download_url: 'https://evil.example/x.apk' }] })).toBeNull()
    expect(parseRelease(null)).toBeNull()
  })

  it('offers only newer versions that were not put off', () => {
    const r = { version: '0.5.0', url: asset.browser_download_url }
    expect(shouldOffer(r, '0.4.0', null)).toBe(true)
    expect(shouldOffer(r, '0.5.0', null)).toBe(false)
    expect(shouldOffer(r, '0.10.0', null)).toBe(false)
    expect(shouldOffer(r, '0.4.0', '0.5.0')).toBe(false)
    expect(shouldOffer(r, '0.4.0', '0.4.1')).toBe(true)
  })
})
