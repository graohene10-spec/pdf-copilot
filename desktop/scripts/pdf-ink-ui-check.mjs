// Hand-drawn PDF markup (标记) with real PDF.js layers, a synthetic document and isolated browser state.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const artifacts = resolve('artifacts'), checks = [], errors = [], remoteRequests = [];
const port = Number(process.env.PHYDOG_PDF_INK_UI_PORT || 1494), origin = `http://127.0.0.1:${port}`;
const name = '手写标记验证.pdf';
const lines = { 1: ['Ink markup check: page one', 'A highlighted sentence on line two', 'Underline this third line of text', 'Fourth line for the pen stroke', 'Fifth line stays readable', 'Sixth line selects normally'], 2: ['Second page heading', 'Second page body text'], 3: ['Third page'], 4: ['Fourth page'] };
let server, browser, page, passed = false;

const shot = (file, options = {}) => page.screenshot({ path: resolve(artifacts, file), animations: 'disabled', ...options });
const scroll = () => page.locator('.pdf-scroll');
const slot = number => page.locator(`.pdf-scroll .page-slot[data-page="${number}"]`);
const paths = (number, tool = '') => slot(number).locator(`.ink-layer path.ink-stroke${tool ? `.ink-${tool}` : ''}:not(.ink-live)`);
const palette = () => page.getByRole('toolbar', { name: '标记工具', exact: true });
const tool = label => palette().getByRole('button', { name: label, exact: true });
const markButton = () => page.locator('.reader-tools').getByRole('button', { name: '标记', exact: true });
async function ready(number) {
  await page.waitForFunction(number => {
    const surface = document.querySelector('.pdf-scroll #page-surface');
    return document.querySelector('[aria-label="页码"]')?.value === String(number) && surface?.dataset.page === String(number) && surface.classList.contains('page-ready') && !surface.classList.contains('pdf-preview') && surface.querySelector('.textLayer span') && !document.querySelector('.reader-overlay');
  }, number, { timeout: 60000 });
}
async function layer(number) { await slot(number).locator('.ink-layer').waitFor({ state: 'attached' }); }
/** Bounding box of a text line on a page, from the PDF.js text layer. */
async function textBox(number, text) {
  return page.evaluate(({ number, text }) => {
    const span = [...document.querySelectorAll(`.pdf-scroll .page-slot[data-page="${number}"] .textLayer span`)].find(span => span.textContent.includes(text));
    if (!span) return null;
    const box = span.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }, { number, text });
}
async function drag(points, steps = 6) {
  await page.mouse.move(points[0][0], points[0][1]); await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps });
  await page.mouse.up();
}
const selectionText = () => page.evaluate(() => window.getSelection()?.toString() || '');
async function storedInk() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('phydog-browser-prototype');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('settings', 'readonly'), store = transaction.objectStore('settings');
      const keys = store.getAllKeys(), values = store.getAll();
      transaction.oncomplete = () => { database.close(); resolve(keys.result.map((key, index) => [String(key), values.result[index]]).filter(([key]) => key.startsWith('ink.v1.'))); };
    };
  }));
}
async function waitForStored(predicate, message) {
  const started = Date.now();
  for (;;) {
    const stored = await storedInk();
    const parsed = stored.length === 1 ? JSON.parse(stored[0][1]) : null;
    if (parsed && predicate(parsed)) return { key: stored[0][0], value: parsed };
    if (Date.now() - started > 15000) throw new Error(`${message}: ${JSON.stringify(stored).slice(0, 400)}`);
    await page.waitForTimeout(100);
  }
}
const pageCounts = parsed => Object.fromEntries(Object.entries(parsed.pages).map(([key, strokes]) => [key, strokes.map(stroke => stroke.tool).sort().join(',')]));
async function pathBox(number, tool) {
  return page.evaluate(({ number, tool }) => {
    const slot = document.querySelector(`.pdf-scroll .page-slot[data-page="${number}"]`), path = slot.querySelector(`.ink-layer path.ink-${tool}:not(.ink-live)`);
    const box = path.getBoundingClientRect(), page = slot.getBoundingClientRect();
    return { left: (box.left - page.left) / page.width, top: (box.top - page.top) / page.height, width: box.width / page.width, height: box.height / page.height, pixels: box.width, pageWidth: page.width };
  }, { number, tool });
}

try {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ cacheDir: resolve(artifacts, 'vite-pdf-ink-ui'), optimizeDeps: { entries: ['index.html'], include: ['vue', 'pdfjs-dist', 'perfect-freehand', 'markdown-it', 'katex', '@tauri-apps/api/window', '@tauri-apps/api/webview', '@tauri-apps/api/core', '@tauri-apps/plugin-dialog'] }, server: { host: '127.0.0.1', port, strictPort: true, watch: null } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: samplePdf(4, false, true, { lines }) });
  await ready(1);

  // Entry: a 标记 toggle beside 框选 opens the floating glass palette.
  const toolbarOrder = await page.locator('.reader-tools > button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') || button.textContent.trim()));
  assert.ok(toolbarOrder.indexOf('标记') === toolbarOrder.findIndex(label => label.includes('框选')) + 1, `标记 follows 框选 (${toolbarOrder.join(' | ')})`);
  assert.equal(await markButton().getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.ink-layer').first().evaluate(element => getComputedStyle(element).pointerEvents), 'none', 'Layers ignore the pointer outside markup mode.');
  await markButton().click();
  await palette().waitFor();
  assert.equal(await markButton().getAttribute('aria-pressed'), 'true');
  for (const label of ['笔', '荧光笔', '划线', '橡皮', '撤销', '清除本页', '退出标记', '颜色：红墨水', '颜色：蓝墨水', '颜色：石墨', '颜色：黄色荧光', '颜色：绿色荧光']) assert.equal(await tool(label).count(), 1, `Palette has ${label}`);
  assert.equal(await tool('笔').getAttribute('aria-pressed'), 'true');
  assert.equal(await tool('撤销').isDisabled(), true);
  const radius = await palette().evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius));
  assert.ok(radius >= 10 && radius <= 14, `Palette corners are moderate (${radius}px).`);
  assert.equal(await page.locator('.ink-layer').first().evaluate(element => getComputedStyle(element).pointerEvents), 'auto');
  checks.push('The 标记 toggle sits after 框选; the palette offers pen, highlighter, underline, eraser, five inks, undo, clear page and exit with Chinese names and aria-pressed.');

  // Pen: a wavy stroke over two lines and across the internal link draws instead of selecting or navigating.
  await layer(1);
  const fourth = await textBox(1, 'Fourth line'), first = await textBox(1, 'page one');
  assert.ok(fourth && first);
  const y = fourth.y + fourth.height / 2;
  await drag([[fourth.x, y], [fourth.x + 60, y - 10], [fourth.x + 120, y + 12], [fourth.x + 190, y - 8], [fourth.x + 260, y + 6]]);
  await drag([[first.x + 10, first.y + first.height / 2], [first.x + 80, first.y + first.height / 2 + 4], [first.x + 150, first.y + first.height / 2 - 3]]);
  await paths(1, 'pen').nth(1).waitFor();
  assert.equal(await paths(1, 'pen').count(), 2);
  assert.equal(await selectionText(), '', 'Drawing does not start a text selection.');
  assert.equal(await page.getByLabel('页码', { exact: true }).inputValue(), '1', 'Drawing over a link does not follow it.');
  const penPath = await paths(1, 'pen').first().getAttribute('d');
  assert.match(penPath, /^M.+Q.+Z$/, 'The pen is a filled perfect-freehand outline.');
  checks.push('Pen strokes land on page 1 as single filled paths; no text selection starts and the internal link under the pen is not followed.');

  // Underline: a slightly uneven drag becomes a level, hand-wobbled line.
  await tool('划线').click();
  assert.equal(await tool('划线').getAttribute('aria-pressed'), 'true');
  const third = await textBox(1, 'Underline this');
  const underlineY = third.y + third.height + 2;
  await drag([[third.x, underlineY], [third.x + third.width / 2, underlineY + 3], [third.x + third.width, underlineY + 4]], 10);
  await paths(1, 'underline').first().waitFor();
  const underline = await paths(1, 'underline').first().boundingBox();
  assert.ok(Math.abs(underline.width - third.width) < 16, `Underline spans the drag (${underline.width} vs ${third.width}).`);
  assert.ok(underline.height < third.height * .5, `Underline stays a thin, near-level line (${underline.height}px for ${third.height}px text).`);
  const underlinePath = await paths(1, 'underline').first().getAttribute('d');

  // Highlighter: wide, translucent and multiplied with the page.
  await tool('荧光笔').click();
  const second = await textBox(1, 'highlighted sentence');
  await drag([[second.x - 4, second.y + second.height / 2], [second.x + second.width + 4, second.y + second.height / 2 + 1]], 10);
  await paths(1, 'highlighter').first().waitFor();
  const highlight = await paths(1, 'highlighter').first().evaluate(path => ({ opacity: Number(path.getAttribute('fill-opacity')), fill: path.getAttribute('fill'), blend: getComputedStyle(path.ownerSVGElement).mixBlendMode, height: path.getBoundingClientRect().height }));
  assert.ok(highlight.opacity > 0 && highlight.opacity < 1 && highlight.blend === 'multiply' && highlight.fill === '#ffd02e', JSON.stringify(highlight));
  assert.ok(highlight.height >= second.height * .7, `The highlighter covers the text line (${highlight.height}px vs ${second.height}px).`);
  assert.equal(await selectionText(), '');
  await page.mouse.move(5, 5);
  await shot('pdf-ink-marks.png', { clip: await slot(1).boundingBox().then(box => ({ x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 360) })) });
  await shot('pdf-ink-palette.png');
  checks.push('The underline tool snaps a nearly level drag and draws a thin, wobbly line; the highlighter is wide, translucent yellow and multiplied with the page.');

  // Undo with Ctrl+Z, erase by dragging, undo the erase, erase by tapping.
  await page.keyboard.press('Control+z');
  await paths(1, 'highlighter').first().waitFor({ state: 'detached' });
  assert.equal(await paths(1).count(), 3);
  await tool('橡皮').click();
  assert.equal(await tool('橡皮').getAttribute('aria-pressed'), 'true');
  const middle = underline.x + underline.width / 2;
  await drag([[middle - 20, underline.y - 12], [middle + 20, underline.y + underline.height + 12]], 8);
  await paths(1, 'underline').first().waitFor({ state: 'detached' });
  assert.equal(await paths(1, 'pen').count(), 2, 'The eraser removes only the strokes it touches.');
  await tool('撤销').click();
  await paths(1, 'underline').first().waitFor();
  assert.equal(await paths(1, 'underline').first().getAttribute('d'), underlinePath, 'An undone underline redraws identically (seeded).');
  await page.mouse.click(middle, underline.y + underline.height / 2);
  await paths(1, 'underline').first().waitFor({ state: 'detached' });
  // Erase the stroke across the link too, leaving one pen stroke on page 1.
  await page.mouse.click(first.x + 80, first.y + first.height / 2 + 4);
  await page.waitForFunction(() => document.querySelectorAll('.pdf-scroll .page-slot[data-page="1"] .ink-layer path.ink-pen').length === 1);
  checks.push('Ctrl+Z undoes the last stroke; dragging or tapping the eraser removes whole strokes; undo restores an erased stroke unchanged.');

  // Clear page is immediate and undoable.
  await tool('清除本页').click();
  await page.waitForFunction(() => !document.querySelector('.pdf-scroll .page-slot[data-page="1"] .ink-layer path.ink-stroke'));
  assert.equal(await tool('清除本页').isDisabled(), true);
  await page.keyboard.press('Control+z');
  await paths(1, 'pen').first().waitFor();
  assert.equal(await paths(1).count(), 1);
  checks.push('清除本页 removes the page’s marks without a confirmation and Ctrl+Z brings them back.');

  // Marks on page 2 belong to page 2.
  await tool('笔').click();
  const pageField = page.getByLabel('页码', { exact: true });
  await pageField.fill('2'); await pageField.press('Enter'); await ready(2); await layer(2);
  const heading = await textBox(2, 'Second page heading');
  await drag([[heading.x, heading.y + heading.height + 3], [heading.x + heading.width / 2, heading.y + heading.height + 6], [heading.x + heading.width, heading.y + heading.height + 2]]);
  await paths(2, 'pen').first().waitFor();
  assert.equal(await paths(2).count(), 1); assert.equal(await paths(1).count(), 1);
  const stored = await waitForStored(value => value.version === 1 && JSON.stringify(pageCounts(value)) === JSON.stringify({ 1: 'pen', 2: 'pen' }), 'Marks are saved per page');
  assert.match(stored.key, /^ink\.v1\.[0-9a-f-]{36}$/);
  checks.push(`Strokes are stored per page under ${stored.key.replace(/[0-9a-f-]{36}$/, '<documentId>')} with a version field, after a debounce.`);

  // Esc leaves markup mode; text selection and the pointer pass through again.
  await pageField.fill('1'); await pageField.press('Enter'); await ready(1); await layer(1);
  await scroll().focus();
  await page.keyboard.press('Escape');
  await palette().waitFor({ state: 'detached' });
  assert.equal(await markButton().getAttribute('aria-pressed'), 'false');
  assert.equal(await slot(1).locator('.ink-layer').evaluate(element => getComputedStyle(element).pointerEvents), 'none');
  const sixth = await textBox(1, 'Sixth line');
  await drag([[sixth.x + 2, sixth.y + sixth.height / 2], [sixth.x + sixth.width - 2, sixth.y + sixth.height / 2]], 8);
  assert.match(await selectionText(), /Sixth line/, 'Text selection works after leaving markup mode.');
  assert.equal(await paths(1).count(), 1, 'Dragging outside markup mode draws nothing.');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  checks.push('Esc exits markup mode; the layer stops taking the pointer and text selection works again.');

  // Zoom: the stroke keeps its place on the page and scales with it.
  const before = await pathBox(1, 'pen');
  const scaleBefore = await page.locator('.reader-zoom button').nth(1).innerText();
  await page.locator('[data-tip="放大"]').click(); await page.locator('[data-tip="放大"]').click();
  await page.waitForFunction(value => document.querySelector('.reader-zoom button:nth-child(2)')?.textContent.trim() !== value, scaleBefore);
  await ready(1);
  const after = await pathBox(1, 'pen');
  assert.ok(after.pageWidth > before.pageWidth * 1.1, 'The page grew.');
  for (const key of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(after[key] - before[key]) < .006, `Stroke ${key} relative to the page is unchanged (${before[key]} → ${after[key]}).`);
  assert.ok(Math.abs(after.pixels / before.pixels - after.pageWidth / before.pageWidth) < .03, 'The stroke scales with the page.');
  checks.push(`Zooming ${scaleBefore} → ${await page.locator('.reader-zoom button').nth(1).innerText()} scales the stroke with the page and keeps it on the same words.`);
  await page.locator('[data-tip="适应宽度"]').click(); await ready(1);

  // Dark theme: the ink layer uses the same tone-mapped filter as the page canvas.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const filter = await slot(1).locator('.ink-layer').evaluate(element => getComputedStyle(element).filter);
  assert.equal(filter, 'url("#kaizhi-pdf-dark")', 'The ink layer shares the page canvas tone-mapped dark filter.');
  await page.mouse.move(5, 5);
  await shot('pdf-ink-dark.png', { clip: await slot(1).boundingBox().then(box => ({ x: box.x, y: Math.max(0, box.y), width: box.width, height: 360 })) });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  checks.push('In the dark theme the ink layer uses the same inversion as the PDF canvas, so marks stay in page space.');

  // Persistence: reload and reopen the document.
  await page.reload();
  await page.getByRole('button', { name: `打开 ${name}`, exact: true }).click();
  await ready(1); await layer(1);
  await paths(1, 'pen').first().waitFor().catch(async error => {
    console.error(JSON.stringify({ stored: await storedInk(), layers: await page.locator('.ink-layer').evaluateAll(layers => layers.map(layer => ({ page: layer.dataset.page, viewBox: layer.getAttribute('viewBox'), paths: layer.querySelectorAll('path').length }))) }));
    throw error;
  });
  assert.equal(await paths(1).count(), 1);
  await page.getByLabel('页码', { exact: true }).fill('2'); await page.getByLabel('页码', { exact: true }).press('Enter'); await ready(2); await layer(2);
  await paths(2, 'pen').first().waitFor();
  assert.equal(await paths(2).count(), 1);
  checks.push('After a reload, reopening the document restores its marks on pages 1 and 2.');
  await shot('pdf-ink-restored.png');

  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  passed = true;
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'pdf-ink-ui.json'), JSON.stringify({ passed, checks, errors, remoteRequests }, null, 2));
  await browser?.close(); await server?.close();
}
console.log(JSON.stringify({ passed, checks, errors }, null, 2));
