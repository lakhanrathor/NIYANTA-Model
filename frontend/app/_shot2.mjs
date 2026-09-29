import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:5174'
const OUT = process.env.SHOT_OUT ?? 'C:/Users/ANKITK~1/AppData/Local/Temp/opencode/shots2'
const RUN = process.env.SHOT_RUN ?? ''
const RIVER = process.env.SHOT_RIVER ?? ''

const routes = [
  ['watch', '/'],
  ['discover', '/discover'],
  ['build', '/build'],
  ['corridor', RIVER ? `/corridor/${RIVER}` : '/build'],
  ['run', RUN ? `/run/${RUN}` : '/run'],
  ['run-default', '/run'],
  ['results', RUN ? `/results/${RUN}` : '/results'],
  ['results-default', '/results'],
  ['compare', '/compare'],
  ['player', RUN ? `/player/${RUN}` : '/player'],
  ['player-default', '/player'],
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

const report = []
for (const [name, route] of routes) {
  const pageErrors = []
  const consoleErrors = []
  const badResponses = []
  const onPageError = (e) => pageErrors.push(String(e.message ?? e))
  const onConsole = (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
  }
  const onResponse = (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) {
      badResponses.push(`${r.status()} ${r.url().replace(BASE, '')}`)
    }
  }
  page.on('pageerror', onPageError)
  page.on('console', onConsole)
  page.on('response', onResponse)
  let body = ''
  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(4000)
    body = await page.locator('body').innerText()
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  } catch (err) {
    report.push({ name, route, error: String(err).slice(0, 300) })
  }
  page.off('pageerror', onPageError)
  page.off('console', onConsole)
  page.off('response', onResponse)
  report.push({
    name,
    route,
    chars: body.length,
    dashes: (body.match(/—/g) ?? []).length,
    pageErrors: [...new Set(pageErrors)].slice(0, 8),
    consoleErrors: [...new Set(consoleErrors)].slice(0, 8),
    badResponses: [...new Set(badResponses)].slice(0, 12),
    sample: body.replace(/\s+/g, ' ').slice(0, 260),
  })
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
for (const r of report) {
  console.log(
    `\n== ${r.name} (${r.route}) chars=${r.chars ?? '-'} dashes=${r.dashes ?? '-'}` +
      (r.error ? ` ERROR=${r.error}` : ''),
  )
  for (const e of r.pageErrors ?? []) console.log('   pageerror:', e)
  for (const e of r.consoleErrors ?? []) console.log('   console :', e)
  for (const e of r.badResponses ?? []) console.log('   api     :', e)
}
await browser.close()
