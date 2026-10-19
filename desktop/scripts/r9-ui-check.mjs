// Round 9: Markdown gets whole-document zoom, region capture for the assistant and hand-drawn markup;
// the library sorts by several keys and its view switch follows the theme; the new logo is in place.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts'), checks = [], errors = [];
const port = 1479, origin = `http://127.0.0.1:${port}`;
let server, browser;
const quiet = page => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity), null, { timeout: 30000 });
async function start(colorScheme = 'light') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  return page;
}
async function add(page, name, mimeType, buffer) {
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name, mimeType, buffer }]);
}
const MARKDOWN = [
  '# 质能方程', '',
  '爱因斯坦在 1905 年提出质能等价，写作 $E=mc^2$，其中 $c$ 是光速。这一段文字用来验证框选能取到原文与公式源码。', '',
  '$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$', '',
  '| 量 | 符号 |', '| --- | --- |', '| 能量 | E |', '| 质量 | m |', '',
  ...Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 段：用于滚动和缩放的填充文字，足够长以便折行，确保页面可以上下滚动并验证缩放时阅读位置保持不动。\n`),
].join('\n');

try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-r9-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ---- 1. Markdown: Ctrl + wheel zooms the whole document --------------------------------------------------
  let page = await start('light');
  await add(page, '公式.md', 'text/markdown', Buffer.from(MARKDOWN));
  await page.locator('.markdown-paper .katex').first().waitFor();
  await quiet(page);
  const metrics = () => page.evaluate(() => {
    const paper = document.querySelector('.markdown-paper'), heading = paper.querySelector('h1'), formula = paper.querySelector('.katex-display');
    return { zoom: Number(getComputedStyle(paper).zoom), label: document.querySelector('.markdown-reader .reader-zoom').textContent, paper: paper.getBoundingClientRect().width, heading: heading.getBoundingClientRect().height, formula: formula.getBoundingClientRect().height, font: getComputedStyle(paper.querySelector('p')).fontSize };
  });
  const before = await metrics();
  // Zoom around a paragraph in the middle of the document (at the very top there is nothing to scroll back).
  const middle = page.locator('.markdown-paper p').nth(12);
  await middle.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const box = await middle.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 10);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.markdown-paper')).zoom) > 1);
  const zoomed = await metrics();
  assert.ok(zoomed.label.includes(`${Math.round(zoomed.zoom * 100)}%`) && zoomed.zoom > 1, `The toolbar shows the zoom (${zoomed.label}).`);
  assert.equal(zoomed.font, before.font, 'The font-size setting is untouched; the whole page scales instead.');
  for (const key of ['paper', 'heading', 'formula']) assert.ok(zoomed[key] > before[key] * 1.05, `${key} grows with the page (${before[key]} → ${zoomed[key]}).`);
  const anchor = await middle.boundingBox();
  assert.ok(Math.abs(anchor.y - box.y) < 14, `The paragraph under the cursor stays in place (${box.y} → ${anchor.y}).`);
  await page.getByRole('button', { name: '缩放比例', exact: true }).click();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.markdown-paper')).zoom) === 1);
  await page.evaluate(() => { document.querySelector('.markdown-scroll').scrollTop = 0; });
  checks.push(`Ctrl + wheel zooms the whole Markdown page (paper ${Math.round(before.paper)} → ${Math.round(zoomed.paper)}px, formula ${Math.round(before.formula)} → ${Math.round(zoomed.formula)}px) around the cursor; the percentage resets to 100%.`);

  // ---- 2. Markdown: region capture gives the assistant a screenshot plus the text and formula sources ------
  await page.getByRole('button', { name: '框选', exact: true }).click();
  const target = await page.locator('.markdown-paper p').first().boundingBox();
  const formula = await page.locator('.markdown-paper .katex-display').first().boundingBox();
  await page.mouse.move(target.x - 4, target.y - 4);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width + 4, formula.y + formula.height + 4, { steps: 8 });
  await page.mouse.up();
  // The capture opens the quick-ask spotlight (or the assistant, per settings) with this selection attached.
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__._instance?.setupState?.selection?.rect?.space === 'markdown');
  const sent = await page.evaluate(() => JSON.stringify(document.querySelector('#app').__vue_app__._instance.setupState.selection));
  const selection = await page.evaluate(async source => {
    const image = JSON.parse(source).image || '';
    if (!image) return { image: 0 };
    const picture = new Image(); picture.src = image; await picture.decode();
    const canvas = document.createElement('canvas'); canvas.width = picture.naturalWidth; canvas.height = picture.naturalHeight;
    const paint = canvas.getContext('2d'); paint.drawImage(picture, 0, 0);
    const data = paint.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0; for (let index = 0; index < data.length; index += 4) if (data[index] + data[index + 1] + data[index + 2] < 300) dark++;
    return { image: image.length, width: canvas.width, height: canvas.height, ink: dark / (data.length / 4) };
  }, sent);
  await writeFile(resolve(artifacts, 'r9-markdown-capture-image.png'), Buffer.from(JSON.parse(sent).image.split(',')[1], 'base64'));
  assert.ok(selection.image > 1000 && selection.ink > .01, `The capture is a real screenshot with text on it (${JSON.stringify(selection)}).`);
  assert.match(sent, /E=mc\^2/, 'The text under the region carries the formula source.');
  assert.match(sent, /\\\\int_0\^1/, 'Display formulas are included as LaTeX.');
  assert.match(sent, /"space":"markdown"/);
  await page.screenshot({ path: resolve(artifacts, 'r9-markdown-capture.png') });
  checks.push(`Markdown 框选 hands the assistant a ${selection.width}×${selection.height} screenshot of the region plus its text, with formulas as LaTeX ($E=mc^2$, \\int_0^1 …).`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

  // ---- 3. Markdown: hand-drawn markup hangs on its paragraph through zoom and reloads -----------------------
  await page.locator('.markdown-reader').getByRole('button', { name: '标记', exact: true }).click();
  await page.locator('.ink-palette').waitFor();
  const paragraph = page.locator('.markdown-paper p').nth(1);
  const line = await paragraph.boundingBox();
  await page.mouse.move(line.x + 20, line.y + line.height - 4);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) await page.mouse.move(line.x + 20 + step * 25, line.y + line.height - 4 + Math.sin(step) * 2);
  await page.mouse.up();
  const stroke = page.locator('.markdown-paper .ink-layer path.ink-stroke');
  await stroke.first().waitFor();
  const host = await stroke.first().evaluate(path => path.closest('[data-source-line]').dataset.sourceLine);
  const strokeBox = await stroke.first().boundingBox();
  await page.keyboard.press('Escape');
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.markdown-paper')).zoom) > 1);
  await page.waitForTimeout(400);
  const grown = await stroke.first().boundingBox();
  assert.ok(grown.width > strokeBox.width * 1.05, `The mark scales with the page (${strokeBox.width} → ${grown.width}).`);
  await page.waitForTimeout(1200); // the store saves 700 ms after the last change
  await page.reload();
  await page.getByRole('button', { name: '打开 公式.md', exact: true }).click();
  await page.locator('.markdown-paper .ink-layer path.ink-stroke').first().waitFor();
  assert.equal(await page.locator('.markdown-paper .ink-layer path.ink-stroke').first().evaluate(path => path.closest('[data-source-line]').dataset.sourceLine), host, 'After a restart the mark is back on the same paragraph.');
  await page.locator('.markdown-reader').getByRole('button', { name: '标记', exact: true }).click();
  await page.getByRole('button', { name: '清除全部标记', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.markdown-paper .ink-layer path.ink-stroke'));
  await page.keyboard.press('Control+z');
  await page.locator('.markdown-paper .ink-layer path.ink-stroke').first().waitFor();
  await page.screenshot({ path: resolve(artifacts, 'r9-markdown-ink.png') });
  checks.push('Markdown 标记: pen strokes attach to their paragraph, scale with zoom, persist across a reload, and 清除全部标记 can be undone.');
  await page.context().close();

  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'r9-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); }
