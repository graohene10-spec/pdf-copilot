// Side-by-side reading and the floating reading-position pill, in an isolated browser library.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const artifacts = resolve('artifacts'), checks = [], errors = [], remoteRequests = [];
const names = ['并排验证-A.pdf', '并排验证-B.pdf', '并排验证-C.pdf'];
const port = 1466, origin = `http://127.0.0.1:${port}`;
let server, browser, page;
const shot = name => page.screenshot({ path: resolve(artifacts, name), animations: 'disabled' });
const panes = () => page.evaluate(() => [...document.querySelectorAll('.reader-pane')].filter(pane => pane.offsetParent).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(pane => ({ name: pane.querySelector('.pill-name')?.textContent || '', width: Math.round(pane.getBoundingClientRect().width), focused: pane.classList.contains('focused') })));
async function settled() {
  await page.waitForFunction(() => {
    const visible = [...document.querySelectorAll('.reader-pane')].filter(pane => pane.offsetParent);
    return visible.length && visible.every(pane => pane.querySelector('#page-surface')?.classList.contains('page-ready')) && !document.querySelector('.reader-pane.pending,.reader-pane.entering,.reading-main > .reader-overlay');
  }).catch(async error => {
    console.error(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.reader-pane')].map(pane => ({ shown: !!pane.offsetParent, className: pane.className, surface: pane.querySelector('#page-surface')?.className, slots: [...pane.querySelectorAll('.page-slot')].map(slot => slot.className).slice(0, 3), overlay: pane.querySelector('.reader-overlay')?.textContent })))));
    throw error;
  });
}
try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-split-view-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles(names.map((name, index) => ({ name, mimeType: 'application/pdf', buffer: samplePdf(4, false, true, { lines: { 1: [`Split document ${'ABC'[index]}`], 2: ['Page two'], 3: ['Page three'], 4: ['Page four'] } }) })));
  await settled();

  // The old footer is gone; the reader reaches the bottom and a small pill floats over it.
  assert.equal(await page.locator('.reading-status').count(), 0);
  const pill = page.locator('.reader-pane:visible .reading-pill');
  assert.match(await pill.getAttribute('aria-label'), /阅读位置自动保存 · 第 1 \/ 4 页/);
  await page.mouse.move(700, 450); await page.waitForTimeout(2700);
  const collapsed = await pill.boundingBox();
  assert.ok(collapsed.width < 48, `Idle pill collapses to a progress ring (${collapsed.width}px).`);
  const main = await page.locator('.reading-main').boundingBox();
  assert.ok(main.y + main.height >= 900 - 16, 'The reading area extends to the window bottom.');
  await page.locator('.reader-pane:visible .pdf-scroll').evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
  await page.waitForFunction(() => /第 [23] \/ 4 页/.test(document.querySelector('.reader-pane:not([style*="display: none"]) .reading-pill')?.getAttribute('aria-label') || ''));
  await page.waitForTimeout(500);
  assert.ok((await pill.boundingBox()).width > 60, 'Turning the page expands the pill with the page number.');
  await shot('split-view-pill.png');
  checks.push('Reading position moved from a footer bar into a floating ring that expands on page change and collapses when idle.');

  // Add B beside A from the picker; the new pane takes focus.
  await page.locator('[data-split-anchor]').click();
  const picker = page.getByRole('dialog', { name: '并排阅读', exact: true });
  await picker.waitFor();
  // Open tabs come first, then the rest of the library (the browser preview's samples).
  assert.deepEqual((await picker.getByRole('option').allTextContents()).slice(0, 2), ['并排验证-B.pdfPDF', '并排验证-C.pdfPDF']);
  assert.deepEqual(await picker.locator('.split-picker-group').allTextContents(), ['已打开', '文档库']);
  await picker.getByRole('option', { name: /并排验证-B/ }).click();
  await settled();
  let layout = await panes();
  assert.deepEqual(layout.map(pane => [pane.name, pane.focused]), [['并排验证-A', false], ['并排验证-B', true]]);
  assert.ok(Math.abs(layout[0].width - layout[1].width) <= 2, 'Two panes share the width equally.');
  assert.equal(await page.locator('.file-tab.beside').count(), 1, 'The other visible file is marked in the tab strip.');
  assert.equal(await page.locator('.split-count').innerText(), '2');
  checks.push('The picker adds an open or library document beside the current one; panes share the width and the new pane takes focus.');

  // Clicking a pane moves focus without reloading it; shortcuts follow focus.
  await page.locator('.reader-pane:visible').first().locator('.pdf-scroll').click({ position: { x: 60, y: 200 } });
  layout = await panes(); assert.deepEqual(layout.map(pane => pane.focused), [true, false]);
  const before = await page.locator('.reader-pane:visible').first().getByLabel('页码', { exact: true }).inputValue();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction(value => document.querySelector('.reader-pane.focused [aria-label="页码"]')?.value !== value, before);
  assert.equal(await page.locator('.reader-pane:visible').nth(1).getByLabel('页码', { exact: true }).inputValue(), '1', 'Only the focused pane turns its page.');
  checks.push('Clicking a pane focuses it; keyboard page turning applies to the focused pane only.');

  // Keyboard shortcut opens the picker; three panes is the limit.
  await page.keyboard.press('Control+Backslash'); await picker.waitFor();
  await picker.getByRole('option', { name: /并排验证-C/ }).click(); await settled();
  assert.equal((await panes()).length, 3);
  await page.keyboard.press('Control+Backslash'); await picker.waitFor();
  assert.match(await picker.innerText(), /最多同时并排 3 份文档/);
  await page.keyboard.press('Escape'); await picker.waitFor({ state: 'detached' });
  await shot('split-view-three.png');
  checks.push('Ctrl + \\ opens the picker; at three panes it explains the limit and Escape closes it.');

  // Close the middle pane from its pill; the tab stays open.
  await page.locator('.reader-pane:visible').nth(1).locator('.pill-close').click();
  await settled();
  assert.deepEqual((await panes()).map(pane => pane.name), ['并排验证-A', '并排验证-C']);
  assert.equal(await page.getByRole('tab').count(), 3);
  // Selecting a tab that is not on screen replaces the focused pane.
  await page.locator('.reader-pane:visible').first().locator('.pdf-scroll').click({ position: { x: 60, y: 200 } });
  await page.getByRole('tab', { name: names[1], exact: true }).click(); await settled();
  assert.deepEqual((await panes()).map(pane => pane.name), ['并排验证-B', '并排验证-C']);
  // Closing the focused tab hands focus to the remaining pane and leaves a single reader.
  await page.getByRole('button', { name: `关闭 ${names[1]} 标签`, exact: true }).click(); await settled();
  layout = await panes();
  assert.equal(layout.length, 1); assert.equal(await page.locator('.reading-pill .pill-close').count(), 0);
  assert.equal(await page.getByRole('tab', { selected: true }).getAttribute('aria-label'), names[2]);
  checks.push('Closing a pane keeps its tab; opening another tab replaces the focused pane; closing the focused tab returns to one reader.');

  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'split-view-ui.json'), JSON.stringify({ checks, errors, remoteRequests }, null, 2));
  await browser?.close(); await server?.close();
}
