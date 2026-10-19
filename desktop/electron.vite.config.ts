import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    // package.json has "type": "module", so main is emitted as ESM. This lets
    // the ESM-only electron-store load natively (it is externalized, not bundled).
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    // Sandboxed preloads must be CommonJS; force .cjs regardless of "type": "module".
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
