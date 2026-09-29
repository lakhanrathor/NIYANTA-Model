import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5174'
const RUN = 'c9d73567-c486-4736-9443-dd1fa04f964e'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const reqs = []
page.on('response', (r) => {
  if (r.url().includes('/frames/')) reqs.push(`${r.status()} ${r.url().split('/api')[1]}`)
})
await page.goto(`${BASE}/results/${RUN}`, { waitUntil: 'networkidle', timeout: 45000 })
await page.waitForTimeout(6000)

const imgs = await page.evaluate(() =>
  [...document.querySelectorAll('img')].map((i) => ({
    src: (i.getAttribute('src') ?? '').slice(0, 90),
    w: i.naturalWidth,
    h: i.naturalHeight,
    cw: Math.round(i.getBoundingClientRect().width),
    ch: Math.round(i.getBoundingClientRect().height),
    complete: i.complete,
  })),
)
console.log('frame thumb requests:', reqs.length, reqs.slice(0, 3))
console.log('imgs:', JSON.stringify(imgs, null, 1))
await browser.close()
