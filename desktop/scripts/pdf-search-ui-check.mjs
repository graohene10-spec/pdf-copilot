// Exercise actual PDF.js layers with local synthetic documents and isolated browser state.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const artifacts = resolve('artifacts');
const report = [], errors = [];
let server, browser, page, passed = false;
const names = ['搜索图层验证-A.pdf', '搜索图层验证-B.pdf'];
const lines = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [index + 1, [`Ordinary page ${index + 1}`, ...([1, 4, 9].includes(index + 1) ? ['prefix TARGET suffix'] : [])]]));
const files = [samplePdf(10, false, true, { lines }), samplePdf(2, false, true, { lines: { 1: ['BETA first'], 2: ['BETA second'] } })];
const find = () => page.getByRole('textbox', { name: '文档内搜索', exact: true });
async function ready(number) { await page.waitForFunction(number => document.querySelector('[aria-label="页码"]')?.value === String(number) && document.querySelector('#page-surface')?.classList.contains('page-ready') && !document.querySelector('#page-surface')?.classList.contains('pdf-preview'), number); await page.waitForTimeout(150); }
async function matches(total, current) { await page.waitForFunction(({ total, current }) => document.querySelector('.reader-search-count')?.textContent.trim() === `${current} / ${total}`, { total, current }); }
async function geometry() {
  const result = await page.evaluate(() => {
    const textLayer = document.querySelector('#text-layer');
    const span = [...textLayer.querySelectorAll('span')].find(span => span.firstChild?.nodeType === Node.TEXT_NODE && span.textContent.includes('TARGET'));
    const range = document.createRange(), start = span.textContent.indexOf('TARGET');
    range.setStart(span.firstChild, start); range.setEnd(span.firstChild, start + 6);
    const source = range.getBoundingClientRect(), marker = document.querySelector('#page-surface .document-search-current')?.getBoundingClientRect();
    const plain = rect => rect && ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    return { source: plain(source), marker: plain(marker), original: textLayer.textContent, nodes: textLayer.querySelectorAll('span').length };
  });
  assert.ok(result.marker, 'The current hit must have a visible overlay');
  for (const property of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(result.source[property] - result.marker[property]) < 2, `Search word highlight ${property} aligns with original PDF text range`);
  return result;
}

try {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ cacheDir: resolve(artifacts, 'vite-pdf-search-ui'), optimizeDeps: { entries: ['index.html'], include: ['vue', 'pdfjs-dist', 'markdown-it', 'katex', '@tauri-apps/api/window', '@tauri-apps/api/webview', '@tauri-apps/api/core', '@tauri-apps/plugin-dialog'] }, server: { host: '127.0.0.1', port: 1489, strictPort: true, watch: { ignored: ['**/artifacts/**', '**/src-tauri/**'] } } });
  await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => {
    window.__pdfSearchWorkers = 0;
    const WorkerType = window.Worker;
    window.Worker = class extends WorkerType { constructor(...args) { super(...args); window.__pdfSearchWorkers++; } };
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:1489');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles(names.map((name, index) => ({ name, mimeType: 'application/pdf', buffer: files[index] })));
  await ready(1);
  await page.getByRole('button', { name: '文档库', exact: true }).click();
  await page.getByRole('button', { name: `打开 ${names[1]}`, exact: true }).click(); await ready(1);
  await page.getByRole('tab', { name: names[0], exact: true }).click(); await ready(1);
  await find().fill('TARGET'); await matches(3, 1); await ready(1);
  const initial = await geometry(); report.push({ check: 'Word overlay aligns with the unchanged original PDF text layer', geometry: initial });
  await page.locator('[data-tip="放大"]').click(); await page.waitForTimeout(400); await ready(1);
  const zoomed = await geometry();
  assert.equal(zoomed.original, initial.original); assert.equal(zoomed.nodes, initial.nodes); assert.ok(zoomed.source.width > initial.source.width);
  report.push({ check: 'Atomic zoom redraw restores accurate highlights without replacing PDF text', geometry: zoomed });
  await find().press('Enter'); await matches(3, 2); await ready(4); await geometry();
  await find().press('Enter'); await matches(3, 3); await ready(9); await geometry();
  assert.equal(await page.locator('.page-slot:not(.page-ready) .pdf-search-highlights').count(), 0);
  report.push({ check: 'Cross-page navigation restores released text layers and removes released page highlights' });
  const workerCount = await page.evaluate(() => window.__pdfSearchWorkers);
  await page.getByRole('tab', { name: names[1], exact: true }).click(); await ready(1);
  await find().fill('BETA'); await matches(2, 1);
  await page.getByRole('tab', { name: names[0], exact: true }).click(); await ready(9); await matches(3, 3); await geometry();
  assert.equal(await find().inputValue(), 'TARGET');
  assert.equal(await page.evaluate(() => window.__pdfSearchWorkers), workerCount);
  report.push({ check: 'Warm PDF tabs preserve their independent search query, current result and worker' });
  await find().press('Escape'); assert.equal(await find().inputValue(), ''); assert.equal(await page.locator('.document-search-hit').count(), 0);
  await find().fill('obsolete'); await find().fill('TARGET'); await matches(3, 1); await ready(1);
  assert.equal(await find().inputValue(), 'TARGET'); report.push({ check: 'Escape clears all highlights and a newer query wins over canceled work' });
  const pageInput = page.getByRole('spinbutton', { name: '页码', exact: true });
  await pageInput.fill('2'); await pageInput.press('Enter'); await ready(2);
  const beforeColdWorkers = await page.evaluate(() => window.__pdfSearchWorkers);
  await page.getByRole('button', { name: '文档库', exact: true }).click();
  await page.locator('.pdf-reader').waitFor({ state: 'detached' }); await page.locator('.library-heading').waitFor();
  await page.getByRole('button', { name: `打开 ${names[0]}`, exact: true }).click();
  await ready(2); await matches(3, 1); await page.waitForTimeout(200);
  assert.equal(await find().inputValue(), 'TARGET'); assert.equal(await pageInput.inputValue(), '2');
  assert.ok(await page.evaluate(() => window.__pdfSearchWorkers) > beforeColdWorkers, 'Cold restoration creates a new worker after the reader is unmounted');
  report.push({ check: 'Cold restore retains search results without overriding a later saved reading position' });
  assert.deepEqual(errors, []); passed = true;
  await page.screenshot({ path: resolve(artifacts, 'pdf-search-ui.png') });
} finally {
  await writeFile(resolve(artifacts, 'pdf-search-ui-report.json'), JSON.stringify({ passed, checks: report, errors }, null, 2));
  await browser?.close(); await server?.close();
}
console.log(JSON.stringify({ passed, checks: report.length, errors }));
