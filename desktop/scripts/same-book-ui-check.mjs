// Opening a second copy of the same book beside the first, in an isolated browser library.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const artifacts = resolve('artifacts'), checks = [], errors = [];
const port = 1471, origin = `http://127.0.0.1:${port}`;
let server, browser, page;
const panes = () => page.evaluate(() => [...document.querySelectorAll('.reader-pane')].filter(pane => pane.offsetParent).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(pane => ({ page: pane.querySelector('[aria-label="页码"]')?.value, focused: pane.classList.contains('focused') })));
const settled = () => page.waitForFunction(() => {
  const visible = [...document.querySelectorAll('.reader-pane')].filter(pane => pane.offsetParent);
  return visible.length && visible.every(pane => pane.querySelector('#page-surface')?.classList.contains('page-ready')) && !document.querySelector('.reader-pane.pending,.reader-pane.entering,.reading-main > .reader-overlay');
});
try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-same-book-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name: '同书多开.pdf', mimeType: 'application/pdf', buffer: samplePdf(4, false, true, { lines: { 1: ['Copy page one'], 2: ['Page two'], 3: ['Page three'], 4: ['Page four'] } }) }]);
  await settled();

  await page.locator('.file-tab').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '在右侧再开一份' }).click();
  await settled();
  assert.deepEqual(await page.locator('.file-tab').allInnerTexts().then(list => list.map(text => text.trim())), ['同书多开.pdf', '同书多开.pdf（2）']);
  let layout = await panes();
  assert.equal(layout.length, 2, 'Both copies are on screen side by side.');
  assert.deepEqual(layout.map(pane => pane.focused), [false, true]);
  checks.push('The tab menu opens a second copy of the same book in a pane on the right, labelled （2）.');

  // Each copy keeps its own position.
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction(() => document.querySelector('.reader-pane.focused [aria-label="页码"]')?.value === '2');
  layout = await panes();
  assert.deepEqual(layout.map(pane => pane.page), ['1', '2']);
  checks.push('Turning pages in one copy leaves the other copy where it was.');

  // Closing the copy keeps the original open.
  await page.locator('.file-tab').nth(1).click({ button: 'middle' });
  await page.waitForFunction(() => document.querySelectorAll('.file-tab').length === 1);
  await settled();
  assert.equal((await panes()).length, 1);
  checks.push('Closing the copy leaves the original book open.');
  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'same-book-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally {
  await browser?.close(); await server?.close();
}
