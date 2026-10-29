// After `vite build`: zips dist/ into dist/app-update/{buildId}.zip and writes dist/app-update/latest.json, which the
// Android app reads to update its screens without a new APK (src/pwa/liveUpdate.ts).
// minNative comes from scripts/update-config.json: raise it when the screens need something only a newer APK has
// (a new permission or native plugin), so older installs keep their current screens until the APK is updated.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { zipSync } from 'fflate'

const DIST = 'dist'
const OUT = join(DIST, 'app-update')
const buildId = readFileSync(join(DIST, 'build-id.txt'), 'utf8').trim()
if (!/^\d{14}$/.test(buildId)) throw new Error(`bad build id: ${buildId}`)
const { minNative } = JSON.parse(readFileSync('scripts/update-config.json', 'utf8'))

const files = {}
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (p === OUT) continue
    if (statSync(p).isDirectory()) walk(p)
    else files[relative(DIST, p).split(sep).join('/')] = readFileSync(p)
  }
}
walk(DIST)
if (!files['index.html']) throw new Error('dist/index.html missing')

// Fixed timestamps keep the zip identical for identical files.
const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { mtime: new Date('2026-01-01T00:00:00Z') }]])), { level: 9 })
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, `${buildId}.zip`), zip)
const manifest = {
  version: buildId,
  url: `${buildId}.zip`,
  checksum: createHash('sha256').update(zip).digest('hex'),
  minNative,
}
writeFileSync(join(OUT, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`app-update: ${buildId}.zip (${Object.keys(files).length} files, ${(zip.length / 1024).toFixed(0)} KB), minNative ${minNative}`)
