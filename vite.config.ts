import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

function serviceWorker(): Plugin {
  let outDir = ''
  let shell: string[] = []
  let hash = createHash('sha256')
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir) },
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => f !== 'index.html').sort()
      shell = ['/', '/favicon.svg', '/manifest.webmanifest', '/icon-192.png', ...files.map((f) => `/${f}`)]
      const html = bundle['index.html']
      hash = createHash('sha256').update(files.join()).update(html?.type === 'asset' ? html.source : '')
    },
    closeBundle() {
      for (const f of shell.filter((f) => !f.startsWith('/assets/') && f !== '/')) hash.update(readFileSync(resolve(outDir, f.slice(1))))
      const version = hash.digest('hex').slice(0, 12)
      const file = resolve(outDir, 'sw.js')
      const src = readFileSync(file, 'utf8')
      const out = src.replace("const VERSION = 'dev'", `const VERSION = '${version}'`).replace("const SHELL = ['/']", `const SHELL = ${JSON.stringify(shell)}`)
      if (!out.includes(version) || !out.includes('/manifest.webmanifest')) throw new Error('sw.js placeholders not found')
      writeFileSync(file, out)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],
  test: { environment: 'jsdom' },
})
