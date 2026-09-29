import { expect, test } from '@playwright/test'

/**
 * Chamoli 2021 case E2E: Discover → Build → Run → Results → Player, wired
 * through the mission context, all against the real backend + real DB.
 *
 * Preconditions: backend :8000, vite :5174, Dhauliganga OSM river saved with
 * the Rini / Tapovan / Vishnuprayag dam rows, run 42f2766b VALIDATED.
 */
const RUN_RINI = '42f2766b-c844-4a11-b7e0-e364aa271e8b'

async function searchRiver(page, name: string) {
  const panel = page.locator('section', { hasText: 'Discover Rivers' }).first()
  await panel.getByPlaceholder(/river name/i).fill(name)
  // The input submits on Enter (avoids button ambiguity in the panel)
  await panel.getByPlaceholder(/river name/i).press('Enter')
  // Results list rows are buttons carrying the river name; click until the
  // mission adopts it (dam table stops asking for a river).
  const row = panel.getByRole('button', { name })
  await row.first().waitFor({ timeout: 30000 })
  for (let i = 0; i < 3; i++) {
    await row.first().click()
    try {
      await expect(page.getByText('Dams Along This River (')).toBeVisible({ timeout: 8000 })
      return
    } catch {
      // selection did not stick — retry the click
    }
  }
}

test('Discover: Dhauliganga river + three cascade dam pins', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto('/discover')
  await searchRiver(page, 'Dhauliganga')

  // Dam rows for the cascade chain
  await expect(page.getByText('Rishiganga HEP Barrage (Rini)')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Tapovan Vishnugad Barrage')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Vishnuprayag Dam')).toBeVisible({ timeout: 30000 })

  // Select Rini → mission context adopts it (dam card shows chainage)
  await page.getByText('Rishiganga HEP Barrage (Rini)').click()
  await expect(page.getByText('16.2 km along river')).toBeVisible({ timeout: 30000 })
  expect(pageErrors).toEqual([])
})

test('Results: cascade auto-screens the Rini flood', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto(`/results/${RUN_RINI}`)
  await expect(page.getByText('Downstream cascade')).toBeVisible({ timeout: 60000 })
  // Auto-screen runs on mount: Tapovan exposed ~19 m, arrival ~9 min
  await expect(page.getByText('Tapovan Vishnugad Barrage')).toBeVisible({ timeout: 90000 })
  await expect(page.getByText('Exposed — held').first()).toBeVisible({ timeout: 30000 })
  expect(pageErrors).toEqual([])
})

test('Player: 3D scene, layers, cascade pins', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto(`/player/${RUN_RINI}`)
  // Viewport canvas mounts
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60000 })
  await expect(page.getByText('3D player', { exact: true })).toBeVisible({ timeout: 30000 })
  // Layers panel (context-driven visibility)
  await expect(page.getByText('Layers 3D')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Cascade dams')).toBeVisible({ timeout: 30000 })
  // Cascade panel auto-screens like Results
  await expect(page.getByText('Downstream cascade')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Tapovan Vishnugad Barrage').first()).toBeVisible({ timeout: 90000 })
  // Water status pill reports honest raster state (loading / wet / dry / no-tiles)
  await expect(page.getByText(/Loading depth raster|No depth tiles|dry everywhere|cells wet/)).toBeVisible({
    timeout: 120000,
  })
  expect(pageErrors).toEqual([])
})

test('Build: Tapovan counterpart config listed for the dam', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  // Adopt Tapovan via Discover, open Build
  await page.goto('/discover')
  await searchRiver(page, 'Dhauliganga')
  await expect(page.getByText('Tapovan Vishnugad Barrage')).toBeVisible({ timeout: 30000 })
  await page.getByText('Tapovan Vishnugad Barrage').click()
  await page.goto('/build')
  // Saved configurations for this dam include the recorded-geometry counterpart
  await expect(page.getByText(/Chamoli valley counterpart/i)).toBeVisible({ timeout: 60000 })
  expect(pageErrors).toEqual([])
})
