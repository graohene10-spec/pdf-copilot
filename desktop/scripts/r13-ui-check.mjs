// Two-page reading: the page-view popover switches to spreads (optionally with the cover alone), fit width covers
// both pages, jumping to a right-hand page lands on its row, and the choice is kept after a reload.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts'), checks = [], errors = [];
const port = 1483, origin = `http://127.0.0.1:${port}`;
let server, browser;
try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-r13-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  const open = async () => { await page.getByRole('button', { name: '打开 PDF 阅读示例.pdf', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.page-slot.page-ready')); await page.waitForTimeout(400); };
  const slots = () => page.locator('.page-slot').evaluateAll(items => items.map(item => { const box = item.getBoundingClientRect(); return { page: Number(item.dataset.page), x: box.x, y: box.y, width: box.width }; }));
  const settled = () => page.waitForTimeout(900);
  await open();
  const single = await slots();
  assert.ok(single[1].y > single[0].y + 100, 'Single-page mode stacks pages vertically.');

  await page.getByRole('button', { name: '页面视图', exact: true }).click();
  const popover = page.getByRole('dialog', { name: '页面视图' });
  await popover.getByRole('button', { name: '双页' }).click(); await settled();
  let spread = await slots();
  assert.ok(Math.abs(spread[0].y - spread[1].y) < 1 && spread[1].x > spread[0].x + spread[0].width, `Pages 1 and 2 sit side by side (${JSON.stringify(spread.slice(0, 2))}).`);
  assert.ok(Math.abs(spread[2].x - spread[0].x) < 1 && spread[2].y > spread[0].y, 'Page 3 starts the next row on the left.');
  const area = await page.locator('.pdf-scroll').evaluate(element => { const style = getComputedStyle(element); return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight); });
  const used = spread[1].x + spread[1].width - spread[0].x;
  assert.ok(Math.abs(used - area) < 3, `Fit width spans both pages (${Math.round(used)} vs ${Math.round(area)}).`);
  await page.screenshot({ path: resolve(artifacts, 'r13-spread.png') });
  checks.push('The page-view popover switches to two pages side by side, and fit width covers the whole spread.');

  await popover.locator('.page-view-cover').click(); await settled();
  spread = await slots();
  assert.ok(spread[0].x > spread[1].x && spread[0].y < spread[1].y, 'The cover sits alone on the right.');
  assert.ok(Math.abs(spread[1].y - spread[2].y) < 1, 'Pages 2 and 3 form the next spread.');
  checks.push('“单独显示封面” puts page 1 alone on the right and pairs 2–3, 4–5.');

  await page.keyboard.press('Escape'); await page.mouse.click(720, 880);
  const input = page.locator('.reader-page-control input');
  await input.fill('3'); await input.press('Enter'); await settled();
  const row = await slots();
  const top = await page.locator('.pdf-scroll').evaluate(element => element.getBoundingClientRect().top);
  assert.ok(Math.abs(row[1].y - row[2].y) < 1 && row[1].y >= top - 1 && row[1].y < top + 60, 'Jumping to page 3 shows its row at the top.');
  assert.equal(await input.inputValue(), '2', 'The page number shows the left page of the row.');
  checks.push('Jumping to a right-hand page brings its spread to the top; the page number shows the row’s left page.');

  await page.reload(); await open();
  const kept = await slots();
  assert.ok(kept[0].x > kept[1].x && Math.abs(kept[1].y - kept[2].y) < 1, 'The two-page view with the cover alone is kept after a reload.');
  checks.push('The page view is a saved preference and survives a reload.');

  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'r13-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); }
