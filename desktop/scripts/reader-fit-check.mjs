// Isolated browser UI verification; no native app or model API is started.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.PHYDOG_READER_PORT || 1457);
const origin = process.env.PHYDOG_UI_URL || `http://127.0.0.1:${port}`;
const folder = resolve('artifacts');
const fixtureName = '阅读区域匹配验证.pdf';
const checks = [], pageErrors = [], consoleErrors = [];
let server, browser, context, page, failure;
let storedZoom = 'fit-width';
let imported = false;

function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, width] of [600, 1200, 600].entries()) {
    const pageNumber = index + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 1000] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    const label = index === 1 ? 'WIDE PAGE TWO - 1200 PT' : `NARROW PAGE ${pageNumber} - 600 PT`;
    const lines = Array.from({ length: 23 }, (_, line) => `BT /F1 15 Tf 40 ${900 - line * 36} Td (Document page ${pageNumber} / reading line ${line + 1}) Tj ET`).join('\n');
    const stream = `0.3 0.45 0.3 RG 3 w 18 18 ${width - 36} 964 re S\nBT /F1 26 Tf 40 948 Td (${label}) Tj ET\n${lines}\n`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  objects.push('<< /Type /Outlines /First 11 0 R /Last 11 0 R /Count 1 >>');
  objects.push('<< /Title (Wide second page) /Parent 10 0 R /Dest [6 0 R /Fit] >>');
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

async function metrics() {
  return page.evaluate(() => {
    const view = document.querySelector('.pdf-scroll');
    const slot = document.querySelector('.page-ready#page-surface');
    if (!view || !slot) return null;
    const style = getComputedStyle(view);
    const height = slot.getBoundingClientRect().height;
    return {
      page: Number(slot.dataset.page),
      scale: Number(slot.style.getPropertyValue('--scale-factor')),
      width: slot.getBoundingClientRect().width,
      available: view.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      top: view.scrollTop,
      maxTop: Math.max(0, view.scrollHeight - view.clientHeight),
      slotTop: slot.offsetTop,
      height,
      fraction: (view.scrollTop - slot.offsetTop) / height,
    };
  });
}
async function settled() {
  let last, stable = 0;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await metrics();
    const key = value && [value.page, value.scale, value.width, value.available, value.top].join(':');
    stable = key && key === last ? stable + 1 : 0;
    last = key;
    if (value && stable >= 6) return value;
    await page.waitForTimeout(100);
  }
  throw new Error(`Reader layout did not settle: ${JSON.stringify(await metrics())}`);
}
function assertScale(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < .00001, `${label}: scale ${actual} != ${expected}`);
}
function assertPosition(before, after, label) {
  assert.equal(after.page, before.page, `${label}: current page changed`);
  const expected = Math.max(0, Math.min(after.maxTop, after.slotTop + before.fraction * after.height));
  assert.ok(Math.abs(after.top - expected) < 4, `${label}: reading position moved (${after.top} vs ${expected})`);
}
async function settings({ zoom, enabled }) {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '阅读', exact: true }).click();
  await dialog.getByLabel('PDF 初始缩放模式', { exact: true }).selectOption('custom');
  await dialog.getByLabel('PDF 初始缩放比例', { exact: true }).fill(String(zoom));
  await dialog.getByLabel('侧栏打开后页面超宽时适应宽度', { exact: true }).setChecked(enabled);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  storedZoom = zoom;
  const value = await settled();
  assertScale(value.scale, zoom / 100, 'settings applies zoom immediately');
}
async function manual(zoom = 100, enabled = true) {
  if (storedZoom === zoom) await settings({ zoom: zoom === 100 ? 110 : 100, enabled });
  await settings({ zoom, enabled });
}
async function goPage(number, fraction = .18) {
  const input = page.getByRole('spinbutton', { name: '页码', exact: true });
  await input.fill(String(number));
  await input.press('Enter');
  await page.locator(`.page-ready#page-surface[data-page="${number}"]`).waitFor();
  await page.locator('.pdf-scroll').evaluate((view, fraction) => {
    const slot = view.querySelector('#page-surface');
    view.scrollTop = slot.offsetTop + slot.getBoundingClientRect().height * fraction;
  }, fraction);
  const value = await settled();
  assert.equal(value.page, number);
  return value;
}
async function togglePanel(button, selector) {
  const panel = page.locator(selector);
  const wasOpen = await panel.count() > 0;
  await button.click();
  await panel.waitFor({ state: wasOpen ? 'detached' : 'visible' });
}
const panels = {
  sidebar: async () => togglePanel(page.getByRole('button', { name: '切换侧栏', exact: true }), '.app-sidebar'),
  ai: async () => togglePanel(page.getByRole('button', { name: '阅读助手', exact: true }), '.ai-pane'),
  outline: async () => togglePanel(page.locator('.pdf-reader .reader-tools').getByRole('button', { name: '目录', exact: true }), '.pdf-reader .document-outline'),
  details: async () => togglePanel(page.getByTitle('文档详情与标签', { exact: true }), '.document-details'),
};

try {
  await mkdir(folder, { recursive: true });
  if (!process.env.PHYDOG_UI_URL) {
    server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true } });
    await server.listen();
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  // No real AI request is permitted during this reader-only test.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, route => route.abort());
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles({ name: fixtureName, mimeType: 'application/pdf', buffer: pdfFixture() });
  imported = true;
  await page.locator('.pdf-reader .page-ready').first().waitFor();
  await manual();
  await goPage(2);
  checks.push({ test: 'fixture', result: 'three pages with widths 600/1200/600; second-page reading position selected' });

  for (const [name, toggle] of Object.entries(panels)) {
    await manual();
    const before = await goPage(2);
    await toggle();
    const after = await settled();
    assert.ok(before.width > after.available + 1, `${name}: fixture must overflow the newly reduced viewport`);
    assert.ok(after.scale < before.scale, `${name}: an overflowing page should shrink`);
    assert.ok(after.width <= after.available + 1, `${name}: page must fit the padded viewport`);
    assertPosition(before, after, `${name} opening`);
    await toggle();
    const closed = await settled();
    assertScale(closed.scale, after.scale, `${name} closing does not grow manual scale`);
    assertPosition(after, closed, `${name} closing`);
    checks.push({ test: `${name} overflowing open / close`, before, after, closed });
  }

  await manual(25);
  await goPage(2);
  for (const [name, toggle] of Object.entries(panels)) {
    const before = await settled();
    await toggle();
    const after = await settled();
    assert.ok(before.width <= after.available + 1, `${name}: this page should already fit`);
    assertScale(after.scale, before.scale, `${name}: a page that fits must retain manual zoom`);
    await toggle();
    assertScale((await settled()).scale, before.scale, `${name}: closing keeps small manual zoom`);
  }
  checks.push({ test: 'non-overflowing panels', result: 'all four openings preserve 25% manual zoom' });

  await manual(100, false);
  await goPage(2);
  for (const [name, toggle] of Object.entries(panels)) {
    const before = await settled();
    await toggle();
    const after = await settled();
    assertScale(after.scale, before.scale, `${name}: disabled auto-fit preserves manual zoom`);
    assert.ok(after.width > after.available + 1, `${name}: disabled auto-fit should leave actual overflow`);
    await toggle();
  }
  await panels.ai();
  await settled();
  await page.screenshot({ path: resolve(folder, 'reader-fit-disabled.png'), animations: 'disabled' });
  await panels.ai();
  checks.push({ test: 'disabled fitting', result: 'all four panel openings preserve overflowing manual zoom' });

  await manual(100, true);
  const beforeResize = await goPage(2);
  await page.setViewportSize({ width: 1180, height: 1000 });
  const smaller = await settled();
  assertScale(smaller.scale, beforeResize.scale, 'ordinary window resize preserves manual zoom');
  assert.ok(smaller.width > smaller.available + 1);
  await page.setViewportSize({ width: 1400, height: 1000 });
  assertScale((await settled()).scale, beforeResize.scale, 'restoring window size keeps manual zoom');
  checks.push({ test: 'manual window resize', before: beforeResize, smaller });

  await page.getByTitle('适应宽度', { exact: true }).click();
  const fitted = await settled();
  assert.ok(Math.abs(fitted.width - fitted.available) < 2);
  await page.setViewportSize({ width: 1180, height: 1000 });
  const fitSmaller = await settled();
  assert.ok(Math.abs(fitSmaller.width - fitSmaller.available) < 2);
  assert.ok(fitSmaller.scale < fitted.scale);
  await page.setViewportSize({ width: 1400, height: 1000 });
  const fitLarger = await settled();
  assert.ok(Math.abs(fitLarger.width - fitLarger.available) < 2);
  assert.ok(fitLarger.scale > fitSmaller.scale);
  checks.push({ test: 'fit mode follows window width using current landscape page', fitted, fitSmaller, fitLarger });

  await manual(100);
  await goPage(1, 0);
  const narrow = await settled();
  await panels.sidebar();
  assertScale((await settled()).scale, narrow.scale, 'narrow first page fits without change');
  await panels.sidebar();
  const wide = await goPage(2);
  await panels.sidebar();
  const fitWide = await settled();
  assert.ok(fitWide.scale < wide.scale);
  assert.ok(fitWide.width <= fitWide.available + 1);
  await page.screenshot({ path: resolve(folder, 'reader-fit-mixed.png'), animations: 'disabled' });
  checks.push({ test: 'mixed page widths', narrow, wide, fitWide });

  for (const name of ['ai', 'outline', 'details']) {
    const before = await settled();
    await panels[name]();
    const after = await settled();
    assert.ok(after.available > 0, `${name}: reader must retain a measurable viewport`);
    assert.ok(after.width <= after.available + 1, `${name}: combined panels should fit`);
    assert.ok(after.scale <= before.scale);
    assertPosition(before, after, `${name} combined opening`);
  }
  const combined = await settled();
  assert.ok(combined.scale < .25, 'all panels should exercise fitting below 25%');
  await page.screenshot({ path: resolve(folder, 'reader-fit-panels.png'), animations: 'disabled' });
  checks.push({ test: 'combined panels below 25%', combined });
  for (const name of ['details', 'outline', 'ai', 'sidebar']) {
    await panels[name]();
    assertScale((await settled()).scale, combined.scale, `${name}: combined close cannot enlarge manual scale`);
  }
  await page.setViewportSize({ width: 1000, height: 1000 });
  await manual(100);
  await goPage(2);
  for (const name of ['sidebar', 'ai', 'outline', 'details']) {
    await panels[name]();
    const value = await settled();
    assert.ok(value.available > 0, `${name}: minimum window needs positive reading width`);
    assert.ok(value.width <= value.available + 1, `${name}: minimum window should fit the current wide page`);
    assert.equal(value.page, 2);
  }
  const minimumWindow = await settled();
  assert.ok(minimumWindow.scale < .25);
  await page.screenshot({ path: resolve(folder, 'reader-fit-min-window.png'), animations: 'disabled' });
  checks.push({ test: '1000px minimum window with all panels', minimumWindow });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
} catch (error) {
  failure = error;
  if (page) {
    await page.screenshot({ path: resolve(folder, 'reader-fit-failure.png'), animations: 'disabled' }).catch(() => {});
    checks.push({ test: 'failure state', metrics: await metrics().catch(() => null), error: error.message });
  }
} finally {
  if (page && imported) {
    await page.evaluate(async name => {
      const { browserLibrary } = await import('/src/sdk/browser.ts');
      for (const doc of await browserLibrary.list()) if (doc.name === name) await browserLibrary.remove(doc.id);
    }, fixtureName).catch(() => {});
  }
  await context?.close();
  await browser?.close();
  await server?.close();
  const report = { passed: !failure, checks, pageErrors, consoleErrors, cleanup: { browserClosed: !browser?.isConnected(), serverClosed: !server?.httpServer?.listening, fixtureProfileDiscarded: true }, failure: failure?.message };
  await writeFile(resolve(folder, 'reader-fit-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (failure) throw failure;
