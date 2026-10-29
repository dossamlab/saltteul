// Pure rules for the Android live update (screens only; native changes still need a new APK from GitHub Releases).

/** app-update/latest.json, written by scripts/make-update-bundle.mjs next to the zip on the web host. */
export interface UpdateManifest {
  /** Web build id, UTC yyyyMMddHHmmss: newer ids sort later. */
  version: string
  /** Zip of the built screens, relative to the manifest or absolute. */
  url: string
  /** sha256 of the zip, hex. */
  checksum: string
  /** Lowest native versionName (x.y.z) these screens run on, e.g. after a new permission or plugin. */
  minNative: string
}

const BUILD_ID = /^\d{14}$/

export function isManifest(v: unknown): v is UpdateManifest {
  const m = v as Partial<UpdateManifest> | null
  return !!m && typeof m === 'object' && typeof m.version === 'string' && BUILD_ID.test(m.version)
    && typeof m.url === 'string' && !!m.url && typeof m.checksum === 'string' && /^[0-9a-f]{64}$/.test(m.checksum)
    && typeof m.minNative === 'string'
}

/** Compares x.y.z versions numerically; missing parts count as 0, anything after a "-" or "+" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (s: string) => s.split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}

/** Download when the manifest is a newer build than the running screens and the installed app is new enough for it. */
export function shouldDownload(m: UpdateManifest, running: { buildId: string; native: string }): boolean {
  return m.version > running.buildId && compareVersions(running.native, m.minNative) >= 0
}
