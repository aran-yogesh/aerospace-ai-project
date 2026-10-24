/**
 * Phase 2 end-to-end run through the real UI against the real backend (use `make e2e`,
 * which starts an isolated backend and throwaway database):
 *
 *   npm run phase2              production build (out/), run `npm run build` first
 *   npm run phase2 -- --dev     renderer from the Vite dev server
 *   --no-shots                  flow + console/CSP audit only
 *
 * 06_unnamed_part: Part1 is unclassified, so its K is missing; the confirm sheet blocks,
 *   a K is entered inline and the dataset is confirmed.
 * 07_feed_line: setup Water 20 °C, resolve, confirm, solve 0.2 kg/s, re-solve 0.3 kg/s
 *   on the same dataset, FLOW FROM ΔP, ΔP plot, PRESSURE coloring, units, stale dataset,
 *   setup error. Shoots the 11 Phase 2 screenshots into ../docs/screenshots/phase2/.
 *
 * incomplete-dark: no real path produces an incomplete solve (CONFIRM refuses a dataset
 * with a missing K and the API returns 409 unresolved), so this ONE shot rewrites a real
 * solve response in Playwright (page.route) into the solver's incomplete shape (valve K
 * missing, no total). The app has no test-only code for it.
 */
import { mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { pressureBins } from '../src/renderer/src/workspace/pressure.ts'
import { audit, desktop, go, launch, settle, setTheme, type Session } from './harness.ts'

const args = process.argv.slice(2)
const devMode = args.includes('--dev')
const takeShots = !args.includes('--no-shots')
const goldenDir = resolve(desktop, '../evals/golden')
const outDir = resolve(desktop, '../docs/screenshots/phase2')
const API = (process.env['VITE_API_URL'] ?? 'http://localhost:8000').replace(/\/+$/, '')

const results: { step: string; ok: boolean; detail: string }[] = []
function check(step: string, ok: boolean, detail = ''): void {
  results.push({ step, ok, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? `: ${detail}` : ''}`)
}

/** Self-check of the quantile bins used for PRESSURE coloring. */
function checkBins(): void {
  const seg = (id: string, dp: number | null): { component_id: string; dp_pa: number | null } => ({
    component_id: id,
    dp_pa: dp
  })
  const b = pressureBins([seg('a', 10), seg('b', 0), seg('c', 30), seg('d', null), seg('e', 20)])
  assert.ok(b)
  assert.deepEqual(b.colors, { a: '--pressure-1', e: '--pressure-3', c: '--pressure-5' })
  assert.equal(b.min, 10)
  assert.equal(b.max, 30)
  assert.equal(pressureBins([seg('a', 0)]), null)
  assert.deepEqual(pressureBins([seg('a', 5)])?.colors, { a: '--pressure-5' })
  const six = pressureBins([1, 2, 3, 4, 5, 6].map((v) => seg(`s${v}`, v)))
  assert.deepEqual(Object.values(six?.colors ?? {}), [
    '--pressure-1',
    '--pressure-2',
    '--pressure-3',
    '--pressure-3',
    '--pressure-4',
    '--pressure-5'
  ])
  check('pressureBins self-check', true)
}

function golden(name: string): string {
  const file = readdirSync(goldenDir).find((f) => f.startsWith(name) && /\.step$/i.test(f))
  if (!file) throw new Error(`golden file ${name}*.step not found in ${goldenDir}`)
  return join(goldenDir, file)
}

async function shot(page: Page, name: string, ms?: number): Promise<void> {
  if (!takeShots) return
  await settle(page, ms)
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  saved ${file}`)
}

/** Re-frame the model once the canvas has its final size (tab switch, strip resize). */
async function fit(page: Page): Promise<void> {
  await page.waitForTimeout(300)
  await page.click('[data-testid="viewer-tool-fit"]')
  await page.waitForTimeout(150)
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

/** Upload through BROWSE and wait for the parsed model to render. */
async function uploadParsed(page: Page, file: string): Promise<void> {
  await page.setInputFiles('[data-testid="browse-input"]', file)
  await page.waitForSelector('[data-testid="workspace"][data-stage="model"]', { timeout: 90_000 })
  await page.waitForSelector('[data-testid="viewer-canvas"]')
  await page.waitForTimeout(400)
}

const text = async (page: Page, testId: string): Promise<string> =>
  ((await page.textContent(`[data-testid="${testId}"]`)) ?? '').trim()

async function waitText(page: Page, testId: string, re: RegExp, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    ({ id, src }) =>
      new RegExp(src, 'i').test(document.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''),
    { id: testId, src: re.source },
    { timeout }
  )
}

/** Type into a commit-on-Enter field and wait for the PUT to land. */
async function commitField(page: Page, testId: string, value: string): Promise<void> {
  const put = page.waitForResponse(
    (r) => r.url().endsWith('/setup') && r.request().method() === 'PUT'
  )
  await page.fill(`[data-testid="${testId}"]`, value)
  await page.press(`[data-testid="${testId}"]`, 'Enter')
  await put
  await page.waitForTimeout(150)
}

async function setTempUnit(page: Page, unit: 'K' | '°C' | '°F'): Promise<void> {
  await page.getByRole('radio', { name: unit, exact: true }).click()
}

async function solve(page: Page, value: string): Promise<void> {
  const res = page.waitForResponse(
    (r) => /\/datasets\/[^/]+\/solve$/.test(r.url()) && r.request().method() === 'POST'
  )
  await page.fill('[data-testid="solve-value"]', value)
  await page.press('[data-testid="solve-value"]', 'Enter')
  await res
  await page.waitForSelector('[data-testid="results-total"]')
  await page.waitForTimeout(200)
}

async function missingKFlow(page: Page): Promise<void> {
  console.log('\n06_unnamed_part: missing K')
  await newProject(page, 'Test · Phase 2 · 06 unnamed part')
  await uploadParsed(page, golden('06'))
  await page.click('[data-testid="tab-setup"]')
  await page.waitForSelector('[data-testid="setup-tab"]')
  await page.click('[data-testid="review-confirm"]')
  await page.waitForSelector('[data-testid="confirm-row"][data-match="missing"]')
  const rows = await page.locator('[data-testid="confirm-row"]').count()
  const blocked = await page.isDisabled('[data-testid="confirm"]')
  check('06 confirm sheet blocks on the missing K', rows === 3 && blocked, `${rows} rows`)
  await page.hover('[data-testid="confirm-row"][data-match="missing"]')
  await shot(page, 'confirm-missing-dark')

  const put = page.waitForResponse(
    (r) => r.url().endsWith('/setup') && r.request().method() === 'PUT'
  )
  await page.fill('[data-testid="k-input"]', '1.5')
  await page.press('[data-testid="k-input"]', 'Enter')
  await put
  await page.waitForSelector('[data-testid="confirm-row"][data-match="user"]')
  await page.waitForSelector('[data-testid="confirm"]:not([disabled])')
  check('06 user K accepted', true, await text(page, 'confirm-counts'))
  await page.click('[data-testid="confirm"]')
  await page.waitForSelector('[data-testid="confirm-sheet"]', { state: 'detached' })
  await waitText(page, 'dataset-status', /confirmed/)
  check('06 confirmed', true, await text(page, 'dataset-status'))
}

async function feedLineFlow(page: Page): Promise<void> {
  console.log('\n07_feed_line: setup, confirm, solve')
  let datasetPosts = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/files\/[^/]+\/datasets$/.test(r.url())) datasetPosts++
  })
  await newProject(page, 'Test · Phase 2 · 07 feed line')
  await uploadParsed(page, golden('07'))
  await page.click('[data-testid="tab-setup"]')
  await page.waitForSelector('[data-testid="setup-tab"]')
  await page.selectOption('[data-testid="setup-fluid"]', 'Water')
  await setTempUnit(page, '°C')
  await commitField(page, 'setup-temperature', '21')
  await commitField(page, 'setup-temperature', '20')
  await waitText(page, 'prop-density', /998\.2/)
  check('setup Water 20 °C', true, (await text(page, 'prop-density')).replace(/\s+/g, ' '))
  await page.click('[data-testid="resolve"]')
  await waitText(page, 'resolve-counts', /computed/)
  check('resolve', true, await text(page, 'resolve-counts'))
  await shot(page, 'setup-dark')

  await page.click('[data-testid="review-confirm"]')
  await page.waitForSelector('[data-testid="confirm"]:not([disabled])')
  const n = await page.locator('[data-testid="confirm-row"]').count()
  check('07 confirm sheet ready', n === 6, `${n} rows, ${await text(page, 'confirm-counts')}`)
  await setTheme(page, 'light')
  await shot(page, 'confirm-ready-light')
  await setTheme(page, 'dark')
  await page.click('[data-testid="confirm"]')
  await page.waitForSelector('[data-testid="confirm-sheet"]', { state: 'detached' })
  await waitText(page, 'dataset-status', /confirmed/)
  const dsStatus = await text(page, 'dataset-status')
  check('07 confirmed', true, dsStatus)

  await solve(page, '0.2')
  const t02 = await text(page, 'results-total')
  check('solve 0.2 kg/s', /^4\.15/.test(t02), `${t02} kPa (API agent: 4150.45 Pa)`)
  await page.click('[data-testid="tab-components"]')
  await fit(page)
  await shot(page, 'results-dark')
  await setTheme(page, 'light')
  await shot(page, 'results-light')
  await setTheme(page, 'dark')

  const postsBefore = datasetPosts
  await solve(page, '0.3')
  const t03 = await text(page, 'results-total')
  check(
    're-solve 0.3 kg/s without reconfirm',
    datasetPosts === postsBefore &&
      (await text(page, 'dataset-status')) === dsStatus &&
      Number(t03) > Number(t02),
    `${t03} kPa, dataset POSTs ${datasetPosts}`
  )

  await page.getByRole('radio', { name: /flow from/i }).click()
  await page.getByRole('radio', { name: 'kPa', exact: true }).click()
  await solve(page, t02)
  const mdot = await text(page, 'results-total')
  check('flow from ΔP recovers 0.2 kg/s', Math.abs(Number(mdot) - 0.2) < 0.0005, `${mdot} kg/s`)

  await page.click('[data-testid="sort-dp"]')
  const firstId = await page.getAttribute('[data-testid="results-row"]', 'data-component-id')
  const largest = await page.getAttribute(
    '[data-testid="results-row"][data-largest]',
    'data-component-id'
  )
  check('sort by ΔP puts the largest loss first', firstId === largest, `${firstId}`)
  await page.click('[data-testid="sort-dp"]')

  // ΔP plot, hovering the valve (largest loss).
  await page.click('[data-testid="tab-dp"]')
  await page.waitForSelector('[data-testid="dp-plot"] svg')
  await page.locator(`[data-testid="dp-segment"][data-component-id="${largest}"]`).hover()
  await page.waitForSelector('[data-testid="dp-readout"]')
  if (takeShots) {
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(outDir, 'dp-plot-dark.png') })
    console.log(`  saved ${join(outDir, 'dp-plot-dark.png')}`)
  }
  check('ΔP plot', (await page.locator('[data-testid="dp-segment"]').count()) === 6)

  // PRESSURE coloring on the 3D model.
  await page.click('[data-testid="tab-3d"]')
  await fit(page)
  await page.click('[data-testid="viewer-tool-pressure"]')
  await page.waitForSelector('[data-testid="pressure-legend"]')
  check('PRESSURE toggle on', true, (await text(page, 'pressure-legend')).replace(/\s+/g, ' '))
  await shot(page, 'pressure-3d-dark')
  await setTheme(page, 'light')
  await shot(page, 'pressure-3d-light')
  await setTheme(page, 'dark')
  await page.click('[data-testid="viewer-tool-pressure"]')
  await page.waitForSelector('[data-testid="pressure-legend"]', { state: 'detached' })
  check('PRESSURE toggle off', true)

  // Schematic shows ΔP per symbol.
  await page.click('[data-testid="tab-schematic"]')
  const dps = await page.locator('[data-testid="schematic-dp"]').count()
  check('schematic ΔP labels', dps === 6, `${dps}`)
  await page.click('[data-testid="tab-3d"]')

  // Units: US in Settings switches the hero to lbm/s, back to SI.
  await page.getByRole('radio', { name: /δp from flow/i }).click()
  await page.click('[data-testid="open-settings"]')
  await page.getByRole('radio', { name: 'US', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="settings-dialog"]', { state: 'detached' })
  const heroUS = (await text(page, 'results-hero')).replace(/\s+/g, ' ')
  check('US units', /lbm\/s/.test(heroUS), heroUS)
  await page.click('[data-testid="open-settings"]')
  await page.getByRole('radio', { name: 'SI', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="settings-dialog"]', { state: 'detached' })

  // Incomplete: rewrite one real solve response (see the header comment).
  await page.route(/\/datasets\/[^/]+\/solve$/, async (route) => {
    const res = await route.fetch()
    const run = (await res.json()) as {
      status: string
      result: {
        status: string
        total_dp_pa: number | null
        missing: string[]
        segments: {
          component_id: string
          type: string
          k: number | null
          k_match: string | null
          dp_pa: number | null
          p_after_pa: number | null
        }[]
      }
    }
    const valve = run.result.segments.find((s) => s.type === 'valve')
    if (valve) {
      valve.k = null
      valve.k_match = 'missing'
      valve.dp_pa = null
      run.result.missing = [valve.component_id]
    }
    for (const s of run.result.segments) s.p_after_pa = null
    run.result.status = run.status = 'incomplete'
    run.result.total_dp_pa = null
    await route.fulfill({ response: res, json: run })
  })
  await page.click('[data-testid="tab-dp"]')
  await solve(page, '0.2')
  await page.unroute(/\/datasets\/[^/]+\/solve$/)
  const status = await page.getAttribute('[data-testid="results-hero"]', 'data-status')
  check('incomplete state renders', status === 'incomplete', await text(page, 'results-status'))
  await shot(page, 'incomplete-dark')
  await page.click('[data-testid="tab-3d"]')
  await solve(page, '0.2') // back to a real, complete result

  // Stale: change setup after confirm.
  await page.click('[data-testid="tab-setup"]')
  await commitField(page, 'setup-temperature', '25')
  await waitText(page, 'dataset-status', /reconfirm/)
  await fit(page)
  const blocked = await page.getAttribute('[data-testid="solve-bar"]', 'data-blocked')
  const disabled = await page.isDisabled('[data-testid="solve"]')
  check('stale dataset blocks SOLVE', disabled && /reconfirm/i.test(blocked ?? ''), blocked ?? '')
  await shot(page, 'stale-dataset-dark')

  // Setup error: Water at 150 °C and 1 bar is a gas.
  await commitField(page, 'setup-temperature', '150')
  await page.waitForSelector('[data-testid="setup-error"]')
  check('setup error inline', true, (await text(page, 'setup-error')).replace(/\s+/g, ' '))
  await shot(page, 'setup-error-dark')

  // Reverting makes the dataset current again.
  await commitField(page, 'setup-temperature', '20')
  await waitText(page, 'dataset-status', /confirmed/)
  check('revert to 20 °C makes the dataset current', true)
}

async function main(): Promise<void> {
  checkBins()
  const health = await fetch(`${API}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`backend not reachable at ${API} (use \`make e2e\`)`)
  mkdirSync(outDir, { recursive: true })

  const s: Session = await launch(devMode)
  let failed = false
  try {
    console.log(`mode: ${s.mode}, url: ${s.page.url()}`)
    await setTheme(s.page, 'dark')
    await missingKFlow(s.page)
    await feedLineFlow(s.page)
    const result = await audit(s)
    console.log('\naudit:')
    for (const l of result.lines) console.log(`  ${l}`)
    if (!result.ok) failed = true
  } finally {
    await s.close()
  }
  if (results.some((r) => !r.ok)) failed = true
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps ok`)
  if (failed) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
