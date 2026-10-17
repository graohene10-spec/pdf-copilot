// Real PDF.js/Vue KeepAlive behavior with synthetic local documents only.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const report = [], errors = [], artifacts = resolve('artifacts');
const names = ['缓存验证-A.pdf', '缓存验证-B.pdf', '缓存验证-C.md', '缓存验证-D.pdf', '缓存验证-慢载入.pdf'];
const pdf = name => samplePdf(9, false, true, { lines: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, [`${name} page ${i + 1}`]])) });
const files = [pdf('CACHE ALPHA'), pdf('CACHE BETA'), Buffer.from('# 缓存验证 Markdown\n\n' + Array.from({ length: 220 }, (_, i) => `段落 ${i + 1}：这是合成的阅读位置验证内容。\n\n`).join('')), pdf('CACHE DELTA'), pdf('CACHE SLOW')];
let server, browser, context, page, passed = false;
const reader = `document.querySelector('#app')._vnode.component.exposed.reader.value`;
async function stats() { return page.evaluate(() => document.querySelector('#app')._vnode.component.exposed.getReaderCacheStats()); }
async function ready(number = 1) {
  await page.waitForFunction(number => document.querySelector('[aria-label="页码"]')?.value === String(number) &&
    document.querySelector('#page-surface')?.classList.contains('page-ready') &&
    !document.querySelector('#page-surface')?.classList.contains('pdf-preview') &&
    !document.querySelector('.reader-overlay,.pane-enter-active,.pane-leave-active,.sidebar-enter-active,.sidebar-leave-active'), number);
}
async function open(index) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles({ name: names[index], mimeType: index === 2 ? 'text/markdown' : 'application/pdf', buffer: files[index] });
  await page.getByRole('tab', { name: names[index], exact: true }).waitFor();
  if (index !== 2) await ready();
  else await page.locator('.markdown-paper').filter({ hasText: '段落 220' }).waitFor();
}
async function select(index, number = 1) {
  await page.evaluate(name => {
    const tab = [...document.querySelectorAll('[role=tab]')].find(tab => tab.getAttribute('aria-label') === name);
    window.__cacheSwitchStart = performance.now(); tab.click();
  }, names[index]);
  if (index !== 2) await ready(number);
  else await page.locator('.markdown-paper').filter({ hasText: '段落 220' }).waitFor();
  return page.evaluate(() => Math.round((performance.now() - window.__cacheSwitchStart) * 10) / 10);
}
async function go(number) { const field = page.getByLabel('页码', { exact: true }); await field.fill(String(number)); await field.press('Enter'); await ready(number); }
async function snapshot(key) {
  await page.evaluate(({ key, reader }) => {
    const api = (0, eval)(reader), canvas = document.querySelector('#pdf-canvas');
    window.__cacheSnapshots ||= {};
    window.__cacheSnapshots[key] = { pdf: api.getPdf(), canvas, bitmap: canvas.toDataURL(), view: api.getViewState() };
  }, { key, reader });
}
async function verifySnapshot(key) {
  return page.evaluate(({ key, reader }) => {
    const prior = window.__cacheSnapshots[key], api = (0, eval)(reader), canvas = document.querySelector('#pdf-canvas');
    return { samePdf: api.getPdf() === prior.pdf, sameCanvas: canvas === prior.canvas, sameBitmap: canvas.toDataURL() === prior.bitmap, before: prior.view, now: api.getViewState() };
  }, { key, reader });
}
try {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ cacheDir: resolve('node_modules/.vite-reader-tabs-cache-check'), server: { host: '127.0.0.1', port: 1478, strictPort: true } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1400, height: 980 }, deviceScaleFactor: 2 });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()} ${(await response.text().catch(() => '')).slice(0, 1200)}`); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, route => route.abort());
  await page.goto('http://127.0.0.1:1478');
  await open(0); await go(4);
  await page.locator('.pdf-scroll').evaluate(element => element.scrollTop += 235);
  await page.waitForTimeout(180); await snapshot('A');
  await open(1); await go(2); await snapshot('B');
  let cache = await stats();
  const betaId = cache.find(entry => entry.active).id;
  assert.equal(cache.length, 2); assert.ok(cache.find(entry => !entry.active).suspended);
  assert.ok(cache.filter(entry => !entry.active).every(entry => entry.pages <= 1 && entry.pixels <= 4_000_000));
  const warm = [];
  for (let turn = 0; turn < 4; turn++) {
    warm.push(await select(0, 4));
    const identity = await verifySnapshot('A');
    assert.equal(identity.samePdf, true); assert.equal(identity.sameCanvas, true); assert.equal(identity.sameBitmap, true);
    assert.ok(Math.abs(identity.now.fraction - identity.before.fraction) < .003);
    warm.push(await select(1, 2));
    const beta = await verifySnapshot('B');
    assert.equal(beta.samePdf, true); assert.equal(beta.sameCanvas, true);
  }
  report.push({ test: 'warm switches reuse exact PDFProxy, current canvas and bitmap with restored page/fraction', warmSwitchMs: warm, medianMs: [...warm].sort((a, b) => a - b)[Math.floor(warm.length / 2)] });

  await open(2);
  await page.locator('.markdown-scroll').evaluate(element => element.scrollTop = (element.scrollHeight - element.clientHeight) * .58);
  await page.getByRole('button', { name: '查看源码', exact: true }).click();
  await page.waitForTimeout(200);
  const mdTop = await page.locator('.markdown-scroll').evaluate(element => { window.__cacheMarkdown = element; return element.scrollTop; });
  await select(0, 4); await select(2);
  assert.equal(await page.locator('.markdown-scroll').evaluate(element => element === window.__cacheMarkdown), true);
  assert.ok(await page.getByRole('button', { name: '阅读视图', exact: true }).isVisible());
  assert.ok(Math.abs(await page.locator('.markdown-scroll').evaluate(element => element.scrollTop) - mdTop) < 3);
  report.push({ test: 'Markdown warm activation retains DOM, source mode and scroll position', passed: true });

  // B is least recently used after C -> A -> C. Opening D evicts B, and a
  // cold re-open must recreate its worker while restoring its reading state.
  await open(3); cache = await stats();
  assert.equal(cache.length, 3); assert.ok(!cache.some(entry => entry.id === betaId));
  const coldStart = performance.now(); await select(1, 2); const coldMs = Math.round(performance.now() - coldStart);
  const betaCold = await verifySnapshot('B');
  assert.equal(betaCold.samePdf, false); assert.equal(betaCold.sameCanvas, false);
  assert.equal(betaCold.now.page, 2); assert.ok(Math.abs(betaCold.now.fraction - betaCold.before.fraction) < .003);
  report.push({ test: 'LRU eviction recreates PDF parser and bitmap while preserving page and position', coldSwitchMs: coldMs });

  // Finish an asynchronous page text read after its component is inactive.
  await select(0, 4);
  await page.evaluate(reader => {
    const proxy = (0, eval)(reader).getPdf();
    return proxy.getPage(4).then(page => {
      const prototype = Object.getPrototypeOf(page), original = prototype.getTextContent;
      prototype.getTextContent = async function(...args) {
        if (this._transport === proxy._transport) await new Promise(resolve => setTimeout(resolve, 550));
        return original.apply(this, args);
      };
      window.__restoreCacheText = () => { prototype.getTextContent = original; };
    });
  }, reader);
  await go(5); await select(1, 2); await page.waitForTimeout(750);
  assert.equal(await page.getByLabel('页码', { exact: true }).inputValue(), '2');
  assert.ok((await page.locator('.reader-pane:visible .reading-pill').getAttribute('aria-label')).includes('第 2 / 9 页'));
  assert.equal((await verifySnapshot('B')).now.page, 2);
  await page.evaluate(() => window.__restoreCacheText());
  report.push({ test: 'delayed background text/progress cannot pollute the active document', passed: true });

  // Both tab changes execute in one JS task before Vue can deactivate them.
  await select(0, 5); await snapshot('Afast');
  await page.evaluate(names => {
    const tab = name => [...document.querySelectorAll('[role=tab]')].find(tab => tab.getAttribute('aria-label') === name);
    tab(names[1]).click(); tab(names[0]).click();
  }, names);
  await ready(5);
  const rapid = await verifySnapshot('Afast'); assert.equal(rapid.samePdf, true); assert.equal(rapid.sameCanvas, true);
  assert.equal(await page.locator('#page-surface').count(), 1);
  report.push({ test: 'same-frame A -> B -> A resumes one active reader with its original bitmap', passed: true });

  // Delay actual PDF rendering during the first opening, switch away before
  // ready, and come back while that document is still retained by KeepAlive.
  await page.evaluate(reader => (0, eval)(reader).getPdf().getPage(5).then(page => {
    const prototype = Object.getPrototypeOf(page), original = prototype.render;
    prototype.render = function(...args) { const task = original.apply(this, args); task.onContinue = resume => setTimeout(resume, 180); return task; };
    window.__restoreCacheRaster = () => { prototype.render = original; };
  }), reader);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles({ name: names[4], mimeType: 'application/pdf', buffer: files[4] });
  await page.getByRole('tab', { name: names[4], exact: true }).waitFor();
  await page.waitForFunction(() => {
    const app = document.querySelector('#app')._vnode.component.exposed;
    return app.getReaderCacheStats().find(entry => entry.active)?.pages > 0 && !!document.querySelector('.pdf-reader .reader-overlay');
  });
  await select(1, 2); await select(4, 1);
  await page.evaluate(() => window.__restoreCacheRaster());
  assert.equal((await stats()).find(entry => entry.active)?.suspended, false);
  report.push({ test: 'switching away during first PDF load and back resumes without stuck loading/resize holds', passed: true });

  await snapshot('Closed');
  const closedId = (await stats()).find(entry => entry.active).id;
  await page.getByRole('button', { name: `关闭 ${names[4]} 标签`, exact: true }).click();
  await page.waitForTimeout(350);
  assert.ok(!(await stats()).some(entry => entry.id === closedId));
  assert.equal(await page.evaluate(() => window.__cacheSnapshots.Closed.canvas.width * window.__cacheSnapshots.Closed.canvas.height), 0);
  report.push({ test: 'closing a cached tab frees its canvas and removes cache ownership', passed: true });

  await page.getByRole('button', { name: '文档库', exact: true }).click();
  await page.waitForTimeout(350); assert.equal((await stats()).length, 0);
  await page.getByRole('button', { name: `打开 ${names[0]}`, exact: true }).click(); await ready(5);
  report.push({ test: 'library view releases all warm buffers; reading state survives reopening', passed: true });

  // Hold the real worker request before parsing malformed local bytes, so
  // its error arrives while another tab is active rather than racing UI clicks.
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage;
    let held = false;
    Worker.prototype.postMessage = function(message, ...rest) {
      if (!held && message?.action === 'GetDocRequest') {
        held = true; window.__invalidParseHeld = true;
        setTimeout(() => original.call(this, message, ...rest), 450);
        return;
      }
      return original.call(this, message, ...rest);
    };
    window.__restoreInvalidParse = () => { Worker.prototype.postMessage = original; };
  });
  const invalidChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await invalidChooser).setFiles({ name: '缓存验证-损坏.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nBroken synthetic PDF structure\n%%EOF') });
  await page.getByRole('tab', { name: '缓存验证-损坏.pdf', exact: true }).waitFor();
  await page.waitForFunction(() => window.__invalidParseHeld);
  await select(0, 5); await page.waitForTimeout(850);
  await page.getByRole('tab', { name: '缓存验证-损坏.pdf', exact: true }).click();
  await page.locator('.pdf-reader .error-state').waitFor();
  assert.equal(await page.locator('.reading-main > .reader-overlay').count(), 0, 'background parse failure must dismiss parent loading on activation');
  assert.ok(await page.locator('.pdf-reader .error-state').getByRole('button', { name: '重试', exact: true }).isVisible());
  await page.evaluate(() => window.__restoreInvalidParse());
  await page.getByRole('button', { name: '关闭 缓存验证-损坏.pdf 标签', exact: true }).click();
  await select(0, 5);
  report.push({ test: 'malformed PDF fails in background, then activation shows retry without a permanent loading overlay', passed: true });
  assert.deepEqual(errors, []); passed = true;
  await page.screenshot({ path: resolve(artifacts, 'reader-tabs-cache.png'), animations: 'disabled' });
  console.log(JSON.stringify({ passed, report, errors }, null, 2));
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'reader-tabs-cache.json'), JSON.stringify({ passed, report, errors }, null, 2));
  await context?.close(); await browser?.close(); await server?.close();
}
