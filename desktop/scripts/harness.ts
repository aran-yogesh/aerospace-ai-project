/**
 * Shared Playwright/_electron harness for scripts/screenshots.ts (Phase 0) and
 * scripts/phase1.ts: launch the app (production build or Vite dev server), mirror the
 * renderer console through main's stdout, set the theme, and run the console/CSP audit.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import type { InlineConfig } from 'vite'

export const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const WIDTH = 1440
export const HEIGHT = 900
const mainEntry = join(desktop, 'out/main/index.js')
const DEV_URL = 'http://localhost:5173'

export interface ConsoleEntry {
  level: string
  message: string
}

export interface Session {
  app: ElectronApplication
  page: Page
  mode: 'dev' | 'prod'
  console: ConsoleEntry[]
  pageErrors: string[]
  close: () => Promise<void>
}

interface DevServer {
  url: string
  close: () => Promise<void>
}

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

/** Renderer dev server in-process, from the renderer section of electron.vite.config.ts. */
async function startDevServer(): Promise<DevServer> {
  const { createServer } = await import('vite')
  const configModule = (await import(
    pathToFileURL(join(desktop, 'electron.vite.config.ts')).href
  )) as { default: unknown }
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
    // 5173 is the dev origin in the backend's CORS allow-list.
    server: { port: 5173, strictPort: false }
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!url) throw new Error('dev server has no local URL')
  return { url, close: () => server.close() }
}

function captureMainStdout(app: ElectronApplication, sink: ConsoleEntry[]): void {
  let pending = ''
  app.process().stdout?.on('data', (chunk: Buffer) => {
    pending += chunk.toString()
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      const at = line.indexOf('[lemma:console] ')
      if (at === -1) continue
      try {
        sink.push(JSON.parse(line.slice(at + 16)) as ConsoleEntry)
      } catch {
        sink.push({ level: 'unknown', message: line })
      }
    }
  })
}

async function ensureSize(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.w, size.h)
    },
    { w: WIDTH, h: HEIGHT }
  )
  await page.waitForFunction(
    (size) => window.innerWidth === size.w && window.innerHeight === size.h,
    { w: WIDTH, h: HEIGHT }
  )
}

export async function launch(devMode: boolean): Promise<Session> {
  if (!existsSync(mainEntry)) throw new Error('out/main/index.js missing: run `npm run build`')
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

  // Fixed 1x so screenshots are 1440x900 on every display (Retina would give 2x).
  const app = await electron.launch({
    args: ['--force-device-scale-factor=1', mainEntry],
    cwd: desktop,
    env
  })
  const entries: ConsoleEntry[] = []
  captureMainStdout(app, entries)
  const pageErrors: string[] = []
  const page = await app.firstWindow()
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  await page.waitForLoadState('load')
  await page.waitForSelector('header')
  await ensureSize(app, page)
  return {
    app,
    page,
    mode: devMode ? 'dev' : 'prod',
    console: entries,
    pageErrors,
    close: async () => {
      await app.close()
      await dev?.close()
      rmSync(userData, { recursive: true, force: true })
    }
  }
}

export async function setTheme(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (m) => {
    if (!window.lemma) throw new Error('window.lemma missing')
    await window.lemma.theme.set(m)
  }, mode)
  await page.waitForFunction((m) => document.documentElement.dataset['theme'] === m, mode)
  await page.waitForTimeout(150)
}

export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

/** Fonts loaded, backend status settled, pointer parked on the status bar. */
export async function settle(page: Page, ms = 400): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page
    .waitForFunction(
      () => document.querySelector('[data-status]')?.getAttribute('data-status') !== 'connecting',
      undefined,
      { timeout: 8_000 }
    )
    .catch(() => undefined)
  await page.mouse.move(WIDTH / 2, HEIGHT - 6)
  // No keyboard focus ring in the shot (Escape presses switch Chromium to focus-visible).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.waitForTimeout(ms)
}

export interface AuditResult {
  ok: boolean
  lines: string[]
}

/**
 * Console/CSP audit over everything logged so far, plus a probe proving the CSP is
 * enforced (inline <style> applied in dev, blocked in prod).
 */
export async function audit(s: Session): Promise<AuditResult> {
  const { page } = s
  const before = s.console.length
  const cspBefore = s.console.filter((e) => e.message.startsWith('[CSP]')).length
  const probe = await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = '.csp-probe { color: inherit }'
    document.head.append(style)
    const applied = style.sheet !== null && style.sheet.cssRules.length > 0
    style.remove()
    return { inlineStyleApplied: applied }
  })
  await page.waitForTimeout(300)
  const probeViolations = s.console
    .slice(before)
    .filter((e) => e.message.startsWith('[CSP]')).length

  const audited = s.console.slice(0, before)
  const errors = audited.filter((e) => e.level === 'error')
  const warnings = audited.filter((e) => e.level === 'warning')
  const csp = audited.filter(
    (e) => e.message.startsWith('[CSP]') || /Content Security Policy/i.test(e.message)
  )
  const dev = s.mode === 'dev'
  const lines = [
    `mode:             ${s.mode}`,
    `console messages: ${audited.length}`,
    `console errors:   ${errors.length}`,
    `console warnings: ${warnings.length}`,
    `page errors:      ${s.pageErrors.length}`,
    `CSP violations:   ${csp.length} (preload listener: ${cspBefore})`,
    `CSP probe:        inline <style> ${probe.inlineStyleApplied ? 'applied' : 'blocked'}, ` +
      `${probeViolations} violation(s) reported (expected: ${dev ? 'applied, 0' : 'blocked, 1'})`,
    ...audited.map((e) => `  [${e.level}] ${e.message}`),
    ...s.pageErrors.map((e) => `  [pageerror] ${e}`)
  ]
  const probeOk = dev
    ? probe.inlineStyleApplied && probeViolations === 0
    : !probe.inlineStyleApplied && probeViolations >= 1
  return {
    ok: errors.length === 0 && s.pageErrors.length === 0 && csp.length === 0 && probeOk,
    lines
  }
}
