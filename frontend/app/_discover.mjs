import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:5174'
const OUT = process.env.SHOT_OUT ?? 'C:/Users/ANKITK~1/AppData/Local/Temp/opencode/shots-discover'
const Q = process.env.SHOT_Q ?? 'Ganga'

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

const pageErrors = []
const consoleErrors = []
const badResponses = []
page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
})
page.on('response', (r) => {
  if (r.status() >= 400 && r.url().includes('/api/')) {
    badResponses.push(`${r.status()} ${r.url().replace(BASE, '')}`)
  }
})

const col = (n) => page.locator('div.grid.h-full > div').nth(n)
const text = async (n) => (await col(n).innerText()).replace(/\s+/g, ' ')
const snap = async (name) => {
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}

await page.goto(`${BASE}/discover?q=${encodeURIComponent(Q)}`, {
  waitUntil: 'domcontentloaded',
  timeout: 45000,
})
// River search is a trigram query with a cold ~10 s backend round trip.
await page
  .waitForResponse((r) => r.url().includes('/api/rivers/search'), { timeout: 30000 })
  .catch(() => null)
await page.waitForTimeout(1500)

const collapsed = await text(0)
await snap('1-left-collapsed')

const filtersBtn = page.locator('button[aria-label="Filters"]')
await filtersBtn.click()
await page.waitForTimeout(400)
const open = await text(0)
await snap('2-left-filters-open')
await filtersBtn.click()
await page.waitForTimeout(300)

const corridor = page.locator('input[type="range"]').last()
const countAt = async () => /Dams Along This River \((\d+)\)/.exec(await text(0))?.[1]
const waitDams = () =>
  page
    .waitForResponse((r) => r.url().includes('/rivers/') && r.url().includes('/dams'), {
      timeout: 20000,
    })
    .catch(() => null)

await corridor.focus()
await corridor.press('End')
await waitDams()
const wideLeft = await text(0)
await snap('3-left-corridor-wide')
const wideCount = await countAt()

await corridor.press('Home')
await waitDams()
const narrowLeft = await text(0)
await snap('4-left-corridor-narrow')
const narrowCount = await countAt()

const left = await text(0)
const right = await text(2)

const report = {
  leftHas: {
    searchResults: left.includes('Search Results'),
    riverInfo: left.includes('River Information'),
    damList: left.includes('Dams Along This River'),
    corridorBuffer: left.includes('Corridor buffer'),
  },
  rightHas: {
    availability: right.includes('Data Availability'),
    downloads: right.includes('Data Downloads'),
    nextSteps: right.includes('Next Steps'),
    damList: right.includes('Dams Along This River'),
    riverInfo: right.includes('River Information'),
  },
  filtersHiddenWhenCollapsed: !/refine search/i.test(collapsed),
  filtersShownWhenOpen: /refine search/i.test(open),
  tabsAreTwo: collapsed.includes('Search') && collapsed.includes('Upload') && !collapsed.includes('By Basin'),
  noApiStringsInLeft: !/(GET|POST|PUT|DELETE) \/api/.test(left),
  noApiStringsInRight: !/(GET|POST|PUT|DELETE) \/api/.test(right),
  damCountWide: wideCount,
  damCountNarrow: narrowCount,
  wideLabel: /Corridor buffer.*?(\d+) km/.exec(wideLeft)?.[1] ?? null,
  narrowLabel: /Corridor buffer.*?(\d+) km/.exec(narrowLeft)?.[1] ?? null,
  pageErrors: [...new Set(pageErrors)],
  consoleErrors: [...new Set(consoleErrors)],
  badResponses: [...new Set(badResponses)],
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
