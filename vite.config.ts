import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// One id per web build (UTC yyyyMMddHHmmss). The Android app compares it with app-update/latest.json to decide whether
// to download the newer screens; scripts/make-update-bundle.mjs reads it back from dist/build-id.txt.
const BUILD_ID = process.env.SALTTEUL_BUILD_ID ?? new Date().toISOString().replace(/\D/g, '').slice(0, 14)

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'saltteul-build-id',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-id.txt', source: BUILD_ID })
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { port: 5180, host: true },
})
