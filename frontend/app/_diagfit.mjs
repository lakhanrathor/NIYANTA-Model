import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5174'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const route = process.argv[2] ?? '/compare'
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('[fit]') || m.type() === 'error') console.log(`[${m.type()}]`, t.slice(0, 300))
})
await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
await page.waitForTimeout(6000)
console.log('STATUS:', (await page.locator('body').innerText()).split('\n').filter((l) => /Zoom:/.test(l)).join(' | '))
await page.screenshot({ path: `C:/Users/ANKITK~1/AppData/Local/Temp/opencode/shots5/${(route.split('/').filter(Boolean)[0] || 'home')}-fit.png`, fullPage: true })
await browser.close()
