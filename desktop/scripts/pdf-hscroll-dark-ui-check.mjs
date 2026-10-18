// PDF horizontal scrolling when zoomed, and the tone-mapped dark mode (text, pale content, colour images, scanned pages).
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { samplePdf, imagePdf } from '../../tests/fixtures/pdf.mjs';

const artifacts = resolve('artifacts'), checks = [], errors = [];
const port = 1477, origin = `http://127.0.0.1:${port}`;
let server, browser;
async function openPdf(page, name, buffer) {
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name, mimeType: 'application/pdf', buffer }]);
  await page.waitForSelector('#page-surface.page-ready'); await page.waitForTimeout(800);
}
// Reads composited pixels from a real screenshot (filters are applied at composite time, not in the canvas).
async function pixels(page, points) {
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ shot, points }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${shot}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), paint = canvas.getContext('2d'); paint.drawImage(bitmap, 0, 0);
    return points.map(([x, y]) => [...paint.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)]);
  }, { shot, points });
}
const lum = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
const hue = ([r, g, b]) => { const max = Math.max(r, g, b), min = Math.min(r, g, b); if (max === min) return null; const d = max - min; const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-pdf-hscroll-dark-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ---- Horizontal scrolling ------------------------------------------------
  let page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })).newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await openPdf(page, '横向滚动.pdf', samplePdf(3, false, true, { lines: { 1: ['LEFT EDGE wide line .......... RIGHT EDGE'] } }));
  assert.equal(await page.locator('.pdf-hscroll').isVisible(), false, 'No horizontal bar while the page fits.');
  for (let step = 0; step < 10; step++) await page.locator('.reader-zoom button[aria-label="放大"]').click();
  await page.waitForFunction(() => { const s = document.querySelector('.pdf-scroll'); return s.scrollWidth > s.clientWidth + 100; });
  // 缩放提交（预览 → 正式画面）结束、滚动宽度连续几帧不变后再拖。
  await page.waitForFunction(() => new Promise(done => { const s = document.querySelector('.pdf-scroll'); const first = s.scrollWidth; setTimeout(() => done(!document.querySelector('.page-slot.pdf-preview') && s.scrollWidth === first), 700); }));
  await page.locator('.pdf-hscroll').waitFor();
  const state = () => page.evaluate(() => { const s = document.querySelector('.pdf-scroll'), keep = s.scrollLeft; s.scrollLeft = 1e7; const max = s.scrollLeft; s.scrollLeft = keep; const slot = s.querySelector('.page-slot').getBoundingClientRect(), view = s.getBoundingClientRect(); const thumb = document.querySelector('.pdf-hscroll-thumb').getBoundingClientRect(); return { left: s.scrollLeft, max, slotLeft: slot.left - view.left, slotRight: slot.right - view.left, width: s.clientWidth, thumb: thumb.width }; });
  const bar = await page.locator('.pdf-hscroll').boundingBox();
  let thumb = await page.locator('.pdf-hscroll-thumb').boundingBox();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2); await page.mouse.down(); await page.mouse.move(bar.x + bar.width + 40, thumb.y, { steps: 6 }); await page.mouse.up();
  let value = await state();
  assert.equal(Math.round(value.left), Math.round(value.max), 'Dragging to the end reaches the maximum scroll.');
  assert.ok(value.slotRight <= value.width - 8, `The page's right edge is fully visible at the end (${value.slotRight} ≤ ${value.width}).`);
  await page.screenshot({ path: resolve(artifacts, 'pdf-hscroll-right.png') });
  thumb = await page.locator('.pdf-hscroll-thumb').boundingBox();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2); await page.mouse.down(); await page.mouse.move(bar.x - 40, thumb.y, { steps: 6 }); await page.mouse.up();
  value = await state();
  assert.equal(value.left, 0); assert.ok(value.slotLeft >= 8, 'The page\'s left edge is fully visible at the start.');
  await page.mouse.click(bar.x + bar.width * .9, bar.y + bar.height / 2);
  assert.ok((await state()).left > 0, 'Clicking the track jumps there.');
  checks.push('Zoomed PDF shows a glass horizontal bar; dragging reaches both page edges with margin, clicking the track jumps.');
  const before = await state();
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await page.waitForFunction(width => document.querySelector('.pdf-scroll').clientWidth > width + 100, before.width);
  await page.waitForTimeout(300);
  const wider = await state();
  assert.ok(wider.thumb > before.thumb, 'Hiding the sidebar widens the view and the thumb.');
  for (let step = 0; step < 12; step++) await page.locator('.reader-zoom button[aria-label="缩小"]').click();
  await page.waitForFunction(() => { const s = document.querySelector('.pdf-scroll'); return s.scrollWidth <= s.clientWidth + 1; });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.pdf-hscroll').isVisible(), false, 'The bar disappears once the page fits again.');
  checks.push('The bar range follows sidebar changes and zoom, and hides when the page fits.');
  await page.context().close();

  // ---- Dark mode ----------------------------------------------------------
  page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })).newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await openPdf(page, '深色模式.pdf', imagePdf());
  assert.equal(await page.locator('.pdf-canvas').first().evaluate(element => getComputedStyle(element).filter), 'url("#kaizhi-pdf-dark")');
  assert.equal(await page.locator('.page-slot').first().locator('.pdf-photos canvas').count(), 1, 'The colour photo gets a colour-preserving layer.');
  // Page coordinates (PDF points, 500×650) to screen.
  const slot = await page.locator('.page-slot').first().boundingBox();
  const at = (x, y) => [slot.x + x / 500 * slot.width, slot.y + (650 - y) / 650 * slot.height];
  const [background, rule, callout, photoRed, vectorRed] = await pixels(page, [at(470, 620), at(250, 560), at(400, 520), at(52, 425), at(380, 325)]);
  assert.ok(lum(background) > 18 && lum(background) < 45, `Page background is dark grey, not black (${background}).`);
  assert.ok(lum(rule) - lum(background) > 12, `A pale grey rule stays visible (${rule} vs ${background}).`);
  assert.ok(lum(callout) - lum(background) > 15, `A pale fill stays distinguishable (${callout} vs ${background}).`);
  assert.ok(photoRed[0] > photoRed[1] + 60 && photoRed[0] > photoRed[2] + 60, `The photo keeps its red corner (${photoRed}).`);
  const vectorHue = hue(vectorRed);
  assert.ok(vectorHue !== null && (vectorHue < 25 || vectorHue > 335), `A red vector box keeps a red hue (${vectorRed}).`);
  await page.locator('.page-slot').first().screenshot({ path: resolve(artifacts, 'pdf-dark-mixed.png') });
  const textColour = await page.evaluate(() => { const slot = document.querySelector('.page-slot').getBoundingClientRect(); return [slot.x + slot.width * .1, slot.y + slot.height * (60 / 650)]; });
  checks.push(`Dark mode: background ${background}, pale rule ${rule}, pale fill ${callout} stay distinct; the photo keeps ${photoRed}; a red vector box stays red-hued (${vectorRed}).`);
  await page.locator('.pdf-scroll').evaluate(element => { element.scrollTop = element.querySelectorAll('.page-slot')[1].offsetTop - 20; });
  await page.waitForFunction(() => document.querySelectorAll('.page-slot')[1]?.classList.contains('page-ready'));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.page-slot').nth(1).locator('.pdf-photos').count(), 0, 'A scanned page is treated as text, not as a photo.');
  const scan = await page.locator('.page-slot').nth(1).boundingBox();
  const samples = await pixels(page, Array.from({ length: 40 }, (_, index) => [scan.x + scan.width * (.1 + (index % 8) * .1), scan.y + 60 + Math.floor(index / 8) * 9]));
  const light = samples.filter(color => lum(color) > 150).length, dark = samples.filter(color => lum(color) < 70).length;
  assert.ok(dark > light && light > 0, `The scanned page reads as light text on a dark page (${dark} dark / ${light} light samples).`);
  await page.locator('.page-slot').nth(1).screenshot({ path: resolve(artifacts, 'pdf-dark-scan.png') });
  checks.push(`A scanned page is inverted with the text: ${dark} dark and ${light} light samples.`);
  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'pdf-hscroll-dark-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); }
