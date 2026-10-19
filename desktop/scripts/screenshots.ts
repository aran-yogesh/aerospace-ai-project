/**
 * Phase 0 screenshots + console/CSP audit, driven by Playwright's Electron support.
 *
 *   npm run screenshots          production build (out/), run `npm run build` first
 *   npm run screenshots -- --dev renderer from the Vite dev server (started here)
 *   add --no-shots to only run the console/CSP audit
 *
 * Writes ../docs/screenshots/phase0/*.png at a 1440x900 window. Theme is set through the
 * app's own API (window.lemma.theme.set), and an isolated userData dir is used so the
 * user's saved settings are never touched. Exits non-zero on any console error or CSP
 * violation.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import type { InlineConfig } from 'vite'

interface DevServer {
  url: string
  close: () => Promise<void>
}

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(desktop, '../docs/screenshots/phase0')
const mainEntry = join(desktop, 'out/main/index.js')
const WIDTH = 1440
const HEIGHT = 900

const argv = new Set(process.argv.slice(2))
const devMode = argv.has('--dev')
const takeShots = !argv.has('--no-shots')

interface ConsoleEntry {
  level: string
  message: string
}

const consoleEntries: ConsoleEntry[] = []

/**
 * Starts the renderer dev server in-process with Vite's API, using the renderer section
 * of electron.vite.config.ts. (`electron-vite dev --rendererOnly` would also launch its
 * own Electron window.)
 */
const DEV_URL = 'http://localhost:5173'

/** Reuse an `npm run dev` server already serving this app on 5173, if there is one. */
async function reuseRunningDevServer(): Promise<DevServer | undefined> {
  try {
    const res = await fetch(DEV_URL, { signal: AbortSignal.timeout(1500) })
    const html = await res.text()
    if (!html.includes('<title>LemmaLab</title>')) return undefined
    console.log('reusing the dev server already running on 5173')
    return { url: DEV_URL, close: () => Promise.resolve() }
  } catch {
    return undefined
  }
}

async function startDevServer(): Promise<DevServer> {
  const { createServer } = await import('vite')
  const configModule = (await import(
    pathToFileURL(join(desktop, 'electron.vite.config.ts')).href
  )) as {
    default: unknown
  }
  const exported = configModule.default
  const config = (
    typeof exported === 'function'
      ? await (exported as (env: object) => unknown)({ mode: 'development', command: 'serve' })
      : exported
  ) as { renderer: InlineConfig }
  const server = await createServer({
    ...config.renderer,
    configFile: false,
    mode: 'development',
    logLevel: 'warn',
    // Prefer 5173 (the dev origin in the backend's CORS allow-list) but take any free
    // port. On another port, /health is CORS-blocked and the audit reports it as an error.
    server: { port: 5173, strictPort: false }
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!url) throw new Error('dev server has no local URL')
  return { url, close: () => server.close() }
}

function captureMainStdout(app: ElectronApplication): void {
  let pending = ''
  app.process().stdout?.on('data', (chunk: Buffer) => {
    pending += chunk.toString()
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      const at = line.indexOf('[lemma:console] ')
      if (at === -1) continue
      try {
        consoleEntries.push(JSON.parse(line.slice(at + 16)) as ConsoleEntry)
      } catch {
        consoleEntries.push({ level: 'unknown', message: line })
      }
    }
  })
}

async function setTheme(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (m) => {
    if (!window.lemma) throw new Error('window.lemma missing')
    await window.lemma.theme.set(m)
  }, mode)
  await page.waitForFunction((m) => document.documentElement.dataset['theme'] === m, mode)
}

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  // Wait (briefly) for the first /health answer so the status bar is not mid-poll.
  await page
    .waitForFunction(
      () => document.querySelector('[data-status]')?.getAttribute('data-status') !== 'connecting',
      undefined,
      { timeout: 8_000 }
    )
    .catch(() => undefined)
  // Park the pointer on the status bar so nothing is in a hover state.
  await page.mouse.move(WIDTH / 2, HEIGHT - 6)
  await page.waitForTimeout(400)
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page)
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  saved ${file}`)
}

async function ensureSize(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      // Size only; LEMMA_AUTOMATION keeps the window unfocused and parked aside.
      win?.setContentSize(size.w, size.h)
    },
    { w: WIDTH, h: HEIGHT }
  )
  await page.waitForFunction(
    (size) => window.innerWidth === size.w && window.innerHeight === size.h,
    { w: WIDTH, h: HEIGHT }
  )
}

async function main(): Promise<void> {
  if (!existsSync(mainEntry)) throw new Error('out/main/index.js missing: run `npm run build`')
  mkdirSync(outDir, { recursive: true })

  let dev: DevServer | undefined
  if (devMode) {
    dev = (await reuseRunningDevServer()) ?? (await startDevServer())
    console.log(`dev server: ${dev.url}`)
  }

  const userData = mkdtempSync(join(tmpdir(), 'lemmalab-shots-'))
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env['ELECTRON_RENDERER_URL']
  env['LEMMA_USER_DATA_DIR'] = userData
  env['LEMMA_CAPTURE_CONSOLE'] = '1'
  env['LEMMA_AUTOMATION'] = '1'
  if (dev) env['ELECTRON_RENDERER_URL'] = dev.url

  const app = await electron.launch({ args: [mainEntry], cwd: desktop, env })
  captureMainStdout(app)
  const pageErrors: string[] = []

  try {
    const page = await app.firstWindow()
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    await page.waitForLoadState('load')
    await page.waitForSelector('header')
    await ensureSize(app, page)

    const mode = devMode ? 'dev' : 'prod'
    console.log(`mode: ${mode}, url: ${page.url()}`)

    // Projects now come from the API: make sure there is at least one card to open.
    const api = (process.env['VITE_API_URL'] ?? 'http://localhost:8000').replace(/\/+$/, '')
    const listed = (await fetch(`${api}/projects`)
      .then((r) => r.json())
      .catch(() => ({ items: [] }))) as { items?: unknown[] }
    if (!listed.items?.length) {
      await fetch(`${api}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Coolant Loop A' })
      }).catch(() => undefined)
    }

    // Exercise every screen (and the dialog + tooltip) so the audit covers them all.
    if (takeShots) console.log('screenshots:')
    await setTheme(page, 'dark')
    await go(page, '/')
    await page.waitForSelector(
      '[data-testid="project-card"], [data-testid="projects-empty"], [data-testid="projects-error"]'
    )
    if (takeShots) await shot(page, 'projects-dark')
    else await settle(page)

    await setTheme(page, 'light')
    if (takeShots) await shot(page, 'projects-light')

    await setTheme(page, 'dark')
    await go(page, '/?empty=1')
    await page.waitForSelector('[data-testid="projects-empty"]')
    if (takeShots) await shot(page, 'projects-empty-dark')

    await go(page, '/')
    await page.locator('[data-testid="project-card"]').first().click()
    await page.waitForSelector('[data-testid="workspace"]')
    if (takeShots) await shot(page, 'workspace-dark')

    await setTheme(page, 'light')
    if (takeShots) await shot(page, 'workspace-light')

    // Tooltip on the disabled chat input (not photographed; exercised for the audit).
    await page.locator('[data-testid="chat-input"]').hover()
    await page.getByRole('tooltip').first().waitFor({ timeout: 3_000 })

    await setTheme(page, 'dark')
    await page.locator('[data-testid="open-settings"]').click()
    await page.waitForSelector('[data-testid="settings-dialog"]')
    if (takeShots) await shot(page, 'settings-dark')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    const before = consoleEntries.length
    const cspBefore = consoleEntries.filter((e) => e.message.startsWith('[CSP]')).length

    // Probe: prove the CSP is enforced. Inline <style> is allowed in dev, blocked in prod.
    const probe = await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = '.csp-probe { color: inherit }'
      document.head.append(style)
      const applied = style.sheet !== null && style.sheet.cssRules.length > 0
      style.remove()
      return { inlineStyleApplied: applied }
    })
    await page.waitForTimeout(300)
    const probeViolations = consoleEntries
      .slice(before)
      .filter((e) => e.message.startsWith('[CSP]')).length

    const audited = consoleEntries.slice(0, before)
    const errors = audited.filter((e) => e.level === 'error')
    const warnings = audited.filter((e) => e.level === 'warning')
    const csp = audited.filter(
      (e) => e.message.startsWith('[CSP]') || /Content Security Policy/i.test(e.message)
    )

    console.log('\naudit:')
    console.log(`  console messages: ${audited.length}`)
    console.log(`  console errors:   ${errors.length}`)
    console.log(`  console warnings: ${warnings.length}`)
    console.log(`  page errors:      ${pageErrors.length}`)
    console.log(`  CSP violations:   ${csp.length} (preload listener: ${cspBefore})`)
    console.log(
      `  CSP probe:        inline <style> ${probe.inlineStyleApplied ? 'applied' : 'blocked'}, ` +
        `${probeViolations} violation(s) reported (expected: ${devMode ? 'applied, 0' : 'blocked, 1'})`
    )
    for (const e of audited) console.log(`    [${e.level}] ${e.message}`)
    for (const e of pageErrors) console.log(`    [pageerror] ${e}`)

    const probeOk = devMode
      ? probe.inlineStyleApplied && probeViolations === 0
      : !probe.inlineStyleApplied && probeViolations >= 1
    if (errors.length || pageErrors.length || csp.length || !probeOk) process.exitCode = 1
  } finally {
    await app.close()
    await dev?.close()
    rmSync(userData, { recursive: true, force: true })
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
