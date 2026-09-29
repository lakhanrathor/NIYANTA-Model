import { chromium } from '@playwright/test'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:5174'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 240)}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e.message).slice(0, 240)}`))

const route = process.argv[2] ?? '/compare'
await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
for (const t of [1000, 3000, 6000]) {
  await page.waitForTimeout(t === 1000 ? 1000 : 2000)
  const flat = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const zoom = /Zoom:\s*([0-9.]+)/.exec(flat)?.[1] ?? '-'
  const cursor = /Cursor:\s*([^ ]+)/.exec(flat)?.[1] ?? '-'
  const tiles = await page.locator('.maplibregl-canvas').count()
  console.log(`t=${t} zoom=${zoom} cursor=${cursor} canvases=${tiles} chars=${flat.length}`)
}
const counts = {}
for (const l of logs) {
  const k = l.slice(0, 60)
  counts[k] = (counts[k] ?? 0) + 1
}
console.log('--- console ---')
for (const [k, v] of Object.entries(counts)) console.log(`  x${v} ${k}`)
await browser.close()
