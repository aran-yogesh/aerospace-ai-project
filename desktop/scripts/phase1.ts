/**
 * Phase 1 end-to-end run through the real UI against the real backend:
 *
 *   npm run phase1              production build (out/), run `npm run build` first
 *   npm run phase1 -- --dev     renderer from the Vite dev server
 *   --no-shots                  golden-file flow + console/CSP audit only
 *   --golden=<dir>              golden STEP files (default ../evals/golden)
 *
 * 1. Creates projects through the NEW PROJECT dialog.
 * 2. Uploads every golden STEP file through the BROWSE input (01 via a synthetic
 *    drag-and-drop) and waits for parsed/failed; compares the component count with
 *    NN_name.expected.json and prints a table.
 * 3. Shoots the 9 Phase 1 screenshots into ../docs/screenshots/phase1/ at 1440x900.
 * 4. Runs the console/CSP audit. Exits non-zero on any mismatch, error or violation.
 *
 * The backend must be running (`make up`) at VITE_API_URL (default http://localhost:8000).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { Page, Route } from 'playwright'
import { audit, desktop, go, launch, settle, setTheme, type Session } from './harness.ts'

const args = process.argv.slice(2)
const devMode = args.includes('--dev')
const takeShots = !args.includes('--no-shots')
const goldenDir = resolve(
  desktop,
  args.find((a) => a.startsWith('--golden='))?.slice(9) ?? '../evals/golden'
)
const outDir = resolve(desktop, '../docs/screenshots/phase1')
const API = (process.env['VITE_API_URL'] ?? 'http://localhost:8000').replace(/\/+$/, '')

type Stage = 'empty' | 'uploading' | 'parsing' | 'failed' | 'model'

interface Expected {
  components?: unknown[]
  topology?: string
}

function golden(name: string): string {
  const file = readdirSync(goldenDir).find((f) => f.startsWith(name) && /\.step$/i.test(f))
  if (!file) throw new Error(`golden file ${name}*.step not found in ${goldenDir}`)
  return join(goldenDir, file)
}

function expectedFor(stepPath: string): Expected | null {
  const p = stepPath.replace(/\.step$/i, '.expected.json')
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as Expected
}

async function stage(page: Page): Promise<Stage> {
  return (await page.getAttribute('[data-testid="workspace"]', 'data-stage')) as Stage
}

async function waitStage(page: Page, want: Stage[], timeout = 90_000): Promise<Stage> {
  await page.waitForFunction(
    (w) =>
      (w as string[]).includes(
        document.querySelector('[data-testid="workspace"]')?.getAttribute('data-stage') ?? ''
      ),
    want,
    { timeout }
  )
  return stage(page)
}

async function shot(page: Page, name: string, ms?: number): Promise<void> {
  if (!takeShots) return
  await settle(page, ms)
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  saved ${file}`)
}

async function newProject(page: Page, name: string): Promise<void> {
  await go(page, '/')
  await page.waitForSelector('[data-testid="new-project"]', { timeout: 15_000 })
  await page.locator('[data-testid="new-project"]').first().click()
  await page.waitForSelector('[data-testid="new-project-dialog"]')
  await page.fill('[data-testid="project-name-input"]', name)
  await page.click('[data-testid="create-project"]')
  await page.waitForSelector('[data-testid="workspace"]', { timeout: 15_000 })
}

async function activeFile(page: Page): Promise<string> {
  return (await page.getAttribute('[data-testid="workspace"]', 'data-file-id')) ?? ''
}

/**
 * Uploads through the BROWSE input (or a synthetic drop) and waits until the upload has
 * either produced a new active file or failed validation.
 */
async function upload(page: Page, file: string, via: 'browse' | 'drop' = 'browse'): Promise<void> {
  const prev = await activeFile(page)
  if (via === 'drop') await dropFile(page, file)
  else await page.setInputFiles('[data-testid="browse-input"]', file)
  await page.waitForFunction(
    (p) => {
      const ws = document.querySelector('[data-testid="workspace"]')
      return (
        (ws?.getAttribute('data-file-id') ?? '') !== p ||
        ws?.getAttribute('data-upload') === 'error'
      )
    },
    prev,
    { timeout: 60_000 }
  )
}

/** Drops a file on the viewer with a synthetic DragEvent (exercises the drop path). */
async function dropFile(page: Page, file: string): Promise<void> {
  const b64 = readFileSync(file).toString('base64')
  await page.evaluate(
    ({ b64, name }) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], name, { type: 'application/step' }))
      const target = document.querySelector('[data-testid="viewer-pane"]')
      if (!target) throw new Error('viewer pane missing')
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })
        )
      }
    },
    { b64, name: basename(file) }
  )
}

async function parserStatus(page: Page): Promise<string> {
  return (await page.textContent('[data-testid="parser-status"]').catch(() => null)) ?? ''
}

async function waitModelRendered(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="viewer-canvas"]')
  await page.waitForTimeout(400) // 120 ms fade-in + a few frames
}

/**
 * Holds the file in the PARSING state: WebSocket replaced by a silent stub and
 * GET /files/{id} polling parked, so the screenshot is deterministic however fast
 * the parser is. release() restores both.
 */
async function freezeParsing(page: Page): Promise<() => Promise<void>> {
  const parked: Route[] = []
  const handler = (route: Route): void => {
    parked.push(route)
  }
  await page.route(/\/files\/[0-9a-f-]+$/, handler)
  await page.evaluate(() => {
    const w = window as unknown as {
      __RealWebSocket?: typeof WebSocket
      WebSocket: typeof WebSocket
    }
    w.__RealWebSocket = w.WebSocket
    w.WebSocket = class SilentSocket extends EventTarget {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSING = 2
      static readonly CLOSED = 3
      readyState = 0
      onopen = null
      onmessage = null
      onerror = null
      onclose = null
      close(): void {}
      send(): void {}
    } as unknown as typeof WebSocket
  })
  return async () => {
    await page.evaluate(() => {
      const w = window as unknown as {
        __RealWebSocket?: typeof WebSocket
        WebSocket: typeof WebSocket
      }
      if (w.__RealWebSocket) w.WebSocket = w.__RealWebSocket
    })
    await page.unroute(/\/files\/[0-9a-f-]+$/, handler)
    for (const r of parked) await r.continue().catch(() => undefined)
  }
}

async function selectFirst(page: Page, type: string): Promise<void> {
  const rows = page.locator('[data-testid="component-row"]')
  const n = await rows.count()
  for (let i = 0; i < n; i++) {
    const text = (await rows.nth(i).textContent()) ?? ''
    if (text.toLowerCase().startsWith(type)) {
      await rows.nth(i).click()
      return
    }
  }
  throw new Error(`no ${type} row`)
}

interface GoldenRow {
  file: string
  stage: Stage
  expected: number | null
  found: number | null
  status: string
  ok: boolean
}

async function goldenFlow(s: Session): Promise<GoldenRow[]> {
  const { page } = s
  const files = readdirSync(goldenDir)
    .filter((f) => /\.step$/i.test(f))
    .sort()
  await newProject(page, 'Test · Golden set')
  const rows: GoldenRow[] = []
  for (const [i, f] of files.entries()) {
    const path = join(goldenDir, f)
    await upload(page, path, i === 0 ? 'drop' : 'browse')
    const st = await waitStage(page, ['model', 'failed'])
    const exp = expectedFor(path)
    const expected = Array.isArray(exp?.components) ? exp.components.length : null
    const countText =
      st === 'model' ? await page.textContent('[data-testid="component-count"]') : null
    const found = countText ? Number(countText) : null
    const status = await parserStatus(page)
    rows.push({
      file: f,
      stage: st,
      expected,
      found,
      status,
      ok: st === 'model' && found === expected
    })
  }
  return rows
}

async function screenshots(s: Session): Promise<void> {
  const { page } = s
  await setTheme(page, 'dark')

  // Feed line: model, light/dark, selection, schematic.
  await newProject(page, 'Test · Feed line 07')
  await upload(page, golden('07'))
  if ((await waitStage(page, ['model', 'failed'])) !== 'model') throw new Error('07 did not parse')
  await waitModelRendered(page)
  await shot(page, 'feedline-dark')
  await setTheme(page, 'light')
  await shot(page, 'feedline-light')
  await setTheme(page, 'dark')

  await selectFirst(page, 'bend')
  await page.click('[data-testid="viewer-tool-fit"]')
  await page.waitForSelector('[data-testid="viewer-callout"]:visible')
  await shot(page, 'feedline-selected-bend-dark')

  await page.click('[data-testid="tab-schematic"]')
  await page.waitForSelector('[data-testid="schematic"]')
  await shot(page, 'schematic-dark')
  await setTheme(page, 'light')
  await shot(page, 'schematic-light')
  await setTheme(page, 'dark')
  await page.click('[data-testid="tab-dp"]')
  await page.waitForSelector('[data-testid="dp-placeholder"]')
  await page.click('[data-testid="tab-3d"]')
  await page.keyboard.press('Escape')

  // Parsing (held deterministically), then let it finish.
  const release = await freezeParsing(page)
  await upload(page, golden('07'))
  await waitStage(page, ['parsing'])
  await shot(page, 'parsing-dark', 600)
  await release()
  await waitStage(page, ['model', 'failed'])

  // Failed: passes upload validation (ISO-10303-21 header) but is not a valid model.
  const dir = mkdtempSync(join(tmpdir(), 'lemma-bad-'))
  const bad = join(dir, 'corrupt_assembly.step')
  writeFileSync(
    bad,
    "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('broken'),'2;1');\nENDSEC;\nDATA;\n#1=GARBAGE(;\nENDSEC;\nEND-ISO-10303-21;\n"
  )
  await upload(page, bad)
  if ((await waitStage(page, ['model', 'failed'])) !== 'failed')
    console.warn('  corrupt file did not fail?')
  await shot(page, 'failed-dark')

  // Unclassified part (06): click the warning, which selects the part. Then the tee (08).
  await newProject(page, 'Test · Unnamed part 06')
  await upload(page, golden('06'))
  await waitStage(page, ['model', 'failed'])
  await waitModelRendered(page)
  await page.locator('[data-testid="warnings"] button', { hasText: /unclassified/i }).click()
  await page.click('[data-testid="viewer-tool-fit"]')
  await page.waitForSelector('[data-testid="viewer-callout"]:visible')
  await shot(page, 'unclassified-warning-dark')

  await newProject(page, 'Test · Tee 08')
  await upload(page, golden('08'))
  await waitStage(page, ['model', 'failed'])
  await waitModelRendered(page)
  await shot(page, 'tee-network-dark')
}

async function main(): Promise<void> {
  const health = await fetch(`${API}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`backend not reachable at ${API} (run \`make up\`)`)
  mkdirSync(outDir, { recursive: true })

  const s = await launch(devMode)
  let failed = false
  try {
    console.log(`mode: ${s.mode}, url: ${s.page.url()}`)
    await setTheme(s.page, 'dark')

    console.log('\ngolden files through the UI:')
    const rows = await goldenFlow(s)
    console.log('  file                     stage    expected  found  status')
    for (const r of rows) {
      console.log(
        `  ${r.file.padEnd(24)} ${r.stage.padEnd(8)} ${String(r.expected ?? '-').padStart(8)}  ${String(r.found ?? '-').padStart(5)}  ${r.status}${r.ok ? '' : '   <-- MISMATCH'}`
      )
      if (!r.ok) failed = true
    }

    if (takeShots) console.log('\nscreenshots:')
    await screenshots(s)

    const result = await audit(s)
    console.log('\naudit:')
    for (const l of result.lines) console.log(`  ${l}`)
    if (!result.ok) failed = true
  } finally {
    await s.close()
  }
  if (failed) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
