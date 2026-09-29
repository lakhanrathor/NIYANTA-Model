import { chromium } from 'playwright'

const BASE = process.env.SHOT_BASE || 'http://localhost:5174'
const RUN = '7a696c2b-6790-48cc-a9da-69b8340a4ef9'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
const reqs = []
p.on('response', (r) => {
  if (r.url().includes('/api/runs/')) reqs.push(`${r.status()} ${r.url().replace(BASE, '')}`)
})
await p.goto(`${BASE}/results/${RUN}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
const text = await p.locator('body').innerText()
console.log('url =', p.url())
console.log('runId line =', text.match(/Run ID\s*\n?\s*(\S+)/)?.[1])
console.log('engine =', text.match(/Model Engine\s*\n?\s*(\S+)/)?.[1])
console.log('pop =', text.match(/Affected Population\s*\n?\s*([\d,]+)/)?.[1])
console.log('--- API ---')
console.log([...new Set(reqs)].join('\n'))
await p.screenshot({ path: 'C:/Users/ANKITK~1/AppData/Local/Temp/opencode/shots12/diag_runA.png' })
await b.close()
