import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5174'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const bad = []
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
})
page.on('requestfailed', (r) => bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 400))
})
await page.goto(`${BASE}/compare`, { waitUntil: 'networkidle', timeout: 45000 })
await page.waitForTimeout(6000)
const text = await page.locator('body').innerText()
const lines = text.split('\n').filter((l) => l.trim())
const pick = (re) => lines.filter((l) => re.test(l))
console.log('BAD RESPONSES:', JSON.stringify(bad, null, 1))
console.log('BANNER:', JSON.stringify(pick(/unavailable|404|Source offline/)))
console.log('RUN STATES:', JSON.stringify(pick(/VALIDATED|DRAFT|RUNNING|FAILED/)))
console.log('METRICS:', JSON.stringify(pick(/Inundated|Peak Depth|Difference|SPH|DELFT3D/i).slice(0, 14)))
await page.screenshot({ path: 'C:/Users/ANKITK~1/AppData/Local/Temp/opencode/shots3/compare-fresh.png', fullPage: true })
await browser.close()
