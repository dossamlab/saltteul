// Copies the Firebase compat scripts used by public/firebase-messaging-sw.js into public/fb (no CDN at runtime).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'

mkdirSync('public/fb', { recursive: true })
for (const f of ['firebase-app-compat.js', 'firebase-messaging-compat.js']) {
  const src = `node_modules/firebase/${f}`
  if (!existsSync(src)) throw new Error(`missing ${src}`)
  copyFileSync(src, `public/fb/${f}`)
}
console.log('copied firebase compat scripts to public/fb')
