import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
const DEFAULT_API_URL = 'http://localhost:8000'

/**
 * The dev CSP has no 'unsafe-inline' for scripts, which blocks the inline React Refresh
 * preamble that @vitejs/plugin-react injects into index.html. Serve the same code as an
 * external module instead (dev server only; production builds have no preamble).
 */
function externalReactPreamble(): Plugin {
  const path = '/@lemma/react-refresh-preamble.js'
  const inline = /<script type="module">\s*(import \{ injectIntoGlobalHook \}[\s\S]*?)<\/script>/
  let code = ''
  return {
    name: 'lemma:external-react-preamble',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const match = inline.exec(html)
        if (!match?.[1]) return html
        code = match[1]
        return html.replace(match[0], `<script type="module" src="${path}"></script>`)
      }
    },
    configureServer(server) {
      server.middlewares.use(path, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(code)
      })
    }
  }
}

export default defineConfig(({ mode }) => {
  // VITE_API_URL may come from the shell or a .env file in desktop/.
  const env = loadEnv(mode, root, 'VITE_')
  const apiUrl = process.env['VITE_API_URL'] ?? env['VITE_API_URL'] ?? DEFAULT_API_URL

  return {
    main: {
      // package.json has "type": "module", so main is emitted as ESM. This lets the
      // ESM-only electron-store load natively (it is externalized, not bundled).
      define: { __LEMMA_API_URL__: JSON.stringify(apiUrl) },
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
      envDir: root,
      define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
        'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl)
      },
      resolve: {
        // shadcn's "@/..." alias points at the renderer source root.
        alias: { '@': resolve(root, 'src/renderer/src') }
      },
      build: {
        rollupOptions: {
          input: { index: resolve(root, 'src/renderer/index.html') }
        }
      },
      plugins: [react(), externalReactPreamble(), tailwindcss()]
    }
  }
})
