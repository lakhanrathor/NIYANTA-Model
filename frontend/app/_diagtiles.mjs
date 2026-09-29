import { chromium } from 'playwright'

const BASE = process.env.SHOT_BASE || 'http://localhost:5174'
const RUN = process.env.SHOT_RUN || 'c9d73567-c486-4736-9443-dd1fa04f964e'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 980 } })
const tiles = []
p.on('response', (r) => {
  if (r.url().includes('/api/tiles/')) tiles.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 90)}`)
})
const logs = []
p.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))

await p.goto(`${BASE}/results/${RUN}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
console.log('--- after load ---')
console.log(tiles.join('\n') || '(none)')
await p.screenshot({ path: 'C:/Users/ANKITK~1/AppData/Local/Temp/opencode/shots10/diag_default.png' })

// zoom in 4 times with the + control
for (let i = 0; i < 4; i++) {
  await p.getByTitle('Zoom in').click()
  await p.waitForTimeout(1200)
}
console.log('--- after zoom +4 ---')
console.log(tiles.slice(-25).join('\n'))
const zoom = await p.evaluate(() => document.body.innerText.match(/Zoom\s+([\d.]+)/)?.[1])
console.log('zoom =', zoom)
console.log('--- console ---')
console.log(logs.filter((l) => l.includes('raster') || l.includes('error')).join('\n') || '(clean)')
await p.screenshot({ path: 'C:/Users/ANKITK~1/AppData/Local/Temp/opencode/shots10/diagzoomin.png' })
await b.close()
