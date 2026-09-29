import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:5174'
const OUT = process.env.SHOT_OUT ?? 'C:/Users/ANKITK~1/AppData/Local/Temp/opencode/shots-downloads'
const Q = process.env.SHOT_Q ?? 'Ganga'
const KIND = process.env.SHOT_KIND ?? 'WorldPop'

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
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}

await page.goto(`${BASE}/discover?q=${encodeURIComponent(Q)}`, {
  waitUntil: 'domcontentloaded',
  timeout: 45000,
})
await page
  .waitForResponse((r) => r.url().includes('/api/rivers/search'), { timeout: 30000 })
  .catch(() => null)
await page
  .waitForResponse((r) => r.url().includes('/corridors/') && r.url().includes('/datasets'), {
    timeout: 30000,
  })
  .catch(() => null)
await page.waitForTimeout(2500)

const downloadsBtns = page.locator('button:has-text("Download")')
const count = await downloadsBtns.count()
const labels = []
let target = null
for (let i = 0; i < count; i++) {
  const b = downloadsBtns.nth(i)
  const rowText = (await b.evaluate((el) => el.parentElement?.innerText ?? '')).replace(
    /\s+/g,
    ' ',
  )
  labels.push(rowText.slice(0, 60))
  if (!target && rowText.includes(KIND)) target = b
}

const before = await text(2)
await snap('1-before-click')

let clicked = false
if (target) {
  await target.click()
  clicked = true
  await page.waitForTimeout(6000)
}
const during = await text(2)
await snap('2-after-click')

const next = await text(2)
const report = {
  downloadButtons: count,
  buttonRows: labels,
  clickedKind: KIND,
  clicked,
  downloadsHasButtonFor: labels.map((l) => l.split(' ')[0]),
  afterClickShowsProgress: /%/.test(during),
  before: before.slice(before.indexOf('Data Downloads')),
  during: during.slice(during.indexOf('Data Downloads')),
  nextSteps: next.slice(next.indexOf('Next Steps')),
  pageErrors: [...new Set(pageErrors)],
  consoleErrors: [...new Set(consoleErrors)],
  badResponses: [...new Set(badResponses)],
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
