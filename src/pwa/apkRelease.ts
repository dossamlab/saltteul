// New Android app versions (widgets, permissions, native plugins) are published as GitHub Releases by
// .github/workflows/android-release.yml. The app reads the latest release and offers it in a banner.
import { compareVersions } from './updateRule'

/** Change to your own repository when you fork this project. */
export const RELEASES_API = 'https://api.github.com/repos/dossamlab/saltteul/releases/latest'

export interface ApkRelease {
  /** x.y.z, from the tag v x.y.z */
  version: string
  /** Direct download of the signed APK */
  url: string
}

/** The latest release as GitHub's API returns it, or null when it has no APK or no x.y.z tag. */
export function parseRelease(j: unknown): ApkRelease | null {
  const r = (j ?? {}) as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown }
  if (r.draft || r.prerelease || typeof r.tag_name !== 'string') return null
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(r.tag_name.trim())
  if (!m) return null
  const assets = Array.isArray(r.assets) ? (r.assets as { name?: unknown; browser_download_url?: unknown }[]) : []
  const apk = assets.find((a) => typeof a.name === 'string' && /\.apk$/i.test(a.name) && typeof a.browser_download_url === 'string')
  if (!apk || !/^https:\/\/github\.com\//.test(apk.browser_download_url as string)) return null
  return { version: m[1], url: apk.browser_download_url as string }
}

/** Offer the release when it is newer than the installed app and the user has not put this version off. */
export function shouldOffer(release: ApkRelease, installed: string, dismissed: string | null): boolean {
  return compareVersions(release.version, installed) > 0 && release.version !== dismissed
}
