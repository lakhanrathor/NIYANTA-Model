import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Full workflow E2E (spec: docs/UI_SPEC.md — Discover → Build → Run → Results
 * → Player → Compare):
 *
 *   Ganga → Bhimgoda Barrage → two saved configurations (case 2 + case 1)
 *   → delft3d simulation → VALIDATED → frame-driven tiles in Results →
 *   terrain + dam in Player3D → deep-linked Compare of the two existing
 *   same-scenario runs (delft3d vs sph).
 *
 * Preconditions (verified outside the test): backend :8000, vite :5174,
 * Ganga corridor ready, Bhimgoda in DB, two VALIDATED runs for Compare.
 */
const RIVER = 'Ganga'
const DAM = 'Bhimgoda Barrage'
/** Existing VALIDATED runs of the same scenario (2200a66f…), engines delft3d / sph. */
const RUN_A = 'c9d73567-c486-4736-9443-dd1fa04f964e'
const RUN_B = '7a696c2b-6790-48cc-a9da-69b8340a4ef9'

/**
 * Scrub with real key events. React's controlled <input type=range> does NOT
 * honour dispatched synthetic input/change events — only trusted interaction
 * (verified: ArrowRight → onChange → frame tiles swap; dispatches no-op).
 */
async function scrubForward(loc: Locator, steps: number) {
  await loc.focus()
  for (let i = 0; i < steps; i++) await loc.press('ArrowRight')
}

async function runState(page: Page, runId: string): Promise<string> {
  return page.evaluate(async (id) => {
    try {
      const r = await fetch(`/api/runs/${id}`)
      if (!r.ok) return `HTTP_${r.status}`
      const j = await r.json()
      return String(j.run?.state ?? '').toUpperCase()
    } catch {
      return 'FETCH_FAILED'
    }
  }, runId)
}

test('Ganga → Bhimgoda Barrage → delft3d run → results / player / compare', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  let runId = ''

  await test.step('discover: search Ganga, select Bhimgoda Barrage', async () => {
    await page.goto('/discover')
    await page.getByPlaceholder(/River name/).fill(RIVER)
    await page.getByPlaceholder(/River name/).press('Enter')

    const riverRow = page.getByRole('button', { name: new RegExp(`^${RIVER}\\b`) }).first()
    await expect(riverRow).toBeVisible()
    await riverRow.click()

    const damRow = page.getByRole('row', { name: new RegExp(DAM) }).first()
    await expect(damRow).toBeVisible({ timeout: 20_000 })
    await damRow.click()
    await expect(damRow).toHaveClass(/accent-soft/)
  })

  await test.step('build: dam record seeds the draft, hydrology + engine set', async () => {
    // dam detail only fetches in build mode — arm the waiter before navigating
    const damDetail = page.waitForResponse(
      (r) => /\/api\/dams\/[0-9a-f-]{36}/.test(r.url()) && r.status() === 200,
      { timeout: 20_000 },
    )
    await page.getByRole('link', { name: /Continue to Build|Open Build/ }).click()
    await damDetail
    await expect(page).toHaveURL(/\/corridor\//)

    // failure-case cards prove BuildConfig rendered
    const case2Card = page.getByRole('button', { name: /^Case 2/ })
    await expect(case2Card).toBeVisible()

    // initial level at crest → overtopping starts immediately ("now")
    const crest = await page.getByLabel(/^Crest level/).inputValue()
    await page.getByLabel(/^Initial water level/).fill(crest)

    await page.getByLabel(/^Inflow/).fill('5000')
    await page.getByLabel(/^Duration/).fill('6')

    await page.getByRole('button', { name: 'delft3d', exact: true }).click()
  })

  await test.step('build: two configurations saved per dam, Load restores case 2', async () => {
    await page.getByRole('button', { name: 'Save configuration' }).click()
    const saved2 = page.locator('li').filter({ hasText: 'case 2' }).first()
    await expect(saved2).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /^Case 1/ }).click()
    await page.getByRole('button', { name: 'Save configuration' }).click()
    const saved1 = page.locator('li').filter({ hasText: 'case 1' }).first()
    await expect(saved1).toBeVisible({ timeout: 15_000 })

    // Load the case-2 config back into the draft
    await saved2.getByRole('button', { name: 'Load' }).click()
    await expect(case2Selected(page).getByText('selected')).toBeVisible()
  })

  await test.step('run: delft3d simulation reaches VALIDATED', async () => {
    await page.getByRole('button', { name: 'Start Simulation' }).click()
    try {
      await page.waitForURL(/\/run\/[0-9a-f-]{36}/, { timeout: 180_000 })
    } catch {
      const lines = (await page.locator('body').innerText())
        .split('\n')
        .filter((l) => /fail|preflight|error|unavailable|denied|invalid/i.test(l))
        .slice(0, 12)
      throw new Error(`start simulation never navigated to /run — panel said:\n${lines.join('\n')}`)
    }
    runId = new URL(page.url()).pathname.split('/').pop() ?? ''
    expect(runId).toMatch(/^[0-9a-f-]{36}$/)
    test.info().annotations.push({ type: 'run id', description: runId })

    // Node-side poll: visible in the report, immune to page-context quirks
    const terminal = [
      'VALIDATED',
      'SUCCEEDED',
      'COMPLETED',
      'DONE',
      'PUBLISHED',
      'FAILED',
      'CANCELLED',
      'ERROR',
    ]
    let state = ''
    const deadline = Date.now() + 15 * 60_000
    while (Date.now() < deadline) {
      state = await runState(page, runId)
      if (terminal.includes(state)) break
      await page.waitForTimeout(1000)
    }
    expect(state, `run ${runId} left in state ${state}`).toBe('VALIDATED')
    await expect(page.getByText('All stages complete')).toBeVisible()
  })

  await test.step('results: frame-driven raster tiles respond per frame', async () => {
    const frame0 = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/tiles/${runId}`) &&
        /frame=0(?!\d)/.test(r.url()) &&
        r.status() === 200,
      { timeout: 45_000 },
    )
    await page.goto(`/results/${runId}`)
    await frame0

    await expect(page.getByText(/^\d+ frames$/)).toBeVisible()

    const scrub = page.locator('input[type=range]')
    await expect(scrub).toHaveCount(1)
    await expect(scrub).toBeEnabled()

    const max = Number(await scrub.getAttribute('max'))
    const target = Math.min(10, max)
    expect(target).toBeGreaterThan(0)

    const targetTile = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/tiles/${runId}`) &&
        new RegExp(`frame=${target}(?!\\d)`).test(r.url()) &&
        r.status() === 200,
      { timeout: 30_000 },
    )
    await scrubForward(scrub, target)
    await targetTile
  })

  await test.step('player: terrain.json + WebGL canvas + playback advances', async () => {
    const terrain = page.waitForResponse(
      (r) => r.url().includes('/terrain.json') && r.status() === 200,
      { timeout: 30_000 },
    )
    await page.goto(`/player/${runId}`)
    await terrain

    await expect(page.locator('canvas').first()).toBeVisible()
    await expect(page.getByText('Terrain Height Scale', { exact: true })).toBeVisible()

    const play = page.locator('button[title="Play"]')
    // anchor on First frame: Play's title flips to Pause once playing
    const frameScrub = page.locator('button[title="First frame"] ~ input[type=range]')
    await expect(frameScrub).toBeEnabled({ timeout: 20_000 })
    await play.click()
    await expect(frameScrub).not.toHaveValue('0', { timeout: 15_000 })
    await page.locator('button[title="Pause"]').click()
  })

  await test.step('compare: deep-link a/b seeds the pickers and stays in the URL', async () => {
    const comparison = page.waitForResponse(
      (r) => /\/api\/comparisons(\?|\/)/.test(r.url()) && r.status() === 200,
      { timeout: 45_000 },
    )
    await page.goto(`/compare?a=${RUN_A}&b=${RUN_B}`)
    await comparison

    await expect(page).toHaveURL(new RegExp(`a=${RUN_A}`))
    await expect(page).toHaveURL(new RegExp(`b=${RUN_B}`))

    const pickers = page.locator('select')
    await expect(pickers.nth(0)).toHaveValue(RUN_A)
    await expect(pickers.nth(1)).toHaveValue(RUN_B)

    await expect(page.getByText('DELFT3D', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('SPH', { exact: true }).first()).toBeVisible()
  })

  const realErrors = pageErrors.filter((e) => !/abort/i.test(e))
  expect(realErrors, `uncaught page errors:\n${realErrors.join('\n')}`).toEqual([])
})

function case2Selected(page: Page) {
  return page.getByRole('button', { name: /^Case 2/ })
}
