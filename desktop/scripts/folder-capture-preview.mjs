// Isolated visual preview: synthetic documents, no AI calls or user preferences.
// Browser screenshots omit OS cursors. The preview places the exact cursor asset
// at its real hotspot while dragging; this overlay is never part of the app.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const artifacts = resolve('artifacts');
const names = ['论文阅读.pdf', '数学笔记.pdf', '阅读清单.md'];
const files = [
  samplePdf(3, false, true, { lines: { 1: ['Reading, thinking, understanding', '1. A simple model', 'E = mc^2', 'Compare the assumptions and the evidence.'], 2: ['Notes and references'], 3: ['Further reading'] } }),
  samplePdf(2, false, true, { lines: { 1: ['Mathematical notes'], 2: ['Examples'] } }),
  Buffer.from('# 阅读清单\n\n## 正在阅读\n\n- 论文与资料\n- 数学笔记\n\n## 笔记\n\n记录问题、证据与新的想法。'),
];
const errors = [], checks = [];
let server, browser;
try {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ server: { host: '127.0.0.1', port: 1463, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/artifacts/**'] } } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, route => route.abort());
  await page.goto('http://127.0.0.1:1463');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles(names.map((name, index) => ({ name, mimeType: index < 2 ? 'application/pdf' : 'text/markdown', buffer: files[index] })));
  const ready = () => page.waitForFunction(() => document.querySelector('#page-surface')?.classList.contains('page-ready') && !document.querySelector('#page-surface')?.classList.contains('pdf-preview'));
  await ready();
  await page.waitForTimeout(300);
  await page.locator('.toast-message').waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('tab').count(), 3);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByTitle('切换深色主题', { exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.getByTitle('框选公式或图表作为 AI 上下文', { exact: true }).click();
    const bounds = await page.locator('#page-surface').boundingBox();
    const start = { x: bounds.x + bounds.width * .065, y: bounds.y + bounds.width * .09 };
    const end = { x: bounds.x + bounds.width * .83, y: bounds.y + bounds.width * .34 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    const cursor = await page.locator('#page-surface canvas').evaluate(element => getComputedStyle(element).cursor);
    assert.match(cursor, /url\(.*\) 16 16, crosshair$/);
    const cursorUrl = cursor.match(/url\("?([^"\)]+)"?\)/)?.[1];
    assert.ok(cursorUrl);
    const svg = await page.evaluate(async url => (await fetch(url)).text(), cursorUrl);
    assert.match(svg, /width=["']32["'] height=["']32["']/);
    assert.match(svg, /stroke=["']#fff["']/);
    assert.match(svg, /stroke=["']#15352b["']/);
    await page.evaluate(({ cursorUrl, end }) => {
      const image = document.createElement('img');
      image.id = 'preview-cursor'; image.src = cursorUrl;
      image.setAttribute('aria-hidden', 'true');
      Object.assign(image.style, { position: 'fixed', left: `${end.x - 16}px`, top: `${end.y - 16}px`, width: '32px', height: '32px', zIndex: '1000', pointerEvents: 'none' });
      document.body.append(image);
      return image.decode();
    }, { cursorUrl, end });
    const filter = await page.locator('#page-surface canvas').evaluate(element => getComputedStyle(element).filter);
    assert.equal(theme === 'dark' ? filter.includes('invert(0.87)') : filter === 'none', true);
    await page.screenshot({ path: resolve(artifacts, `folder-capture-${theme}.png`), animations: 'disabled' });
    await page.screenshot({ path: resolve(artifacts, `folder-capture-overview-${theme}.png`), clip: { x: 226, y: 0, width: 1174, height: 510 }, animations: 'disabled' });
    await page.screenshot({ path: resolve(artifacts, `folder-tabs-${theme}.png`), clip: { x: 226, y: 0, width: 1174, height: 95 }, animations: 'disabled' });
    const clip = { x: end.x - 95, y: end.y - 65, width: 190, height: 130 };
    await page.screenshot({ path: resolve(artifacts, `capture-detail-${theme}.png`), clip, animations: 'disabled' });
    await page.evaluate(() => document.getElementById('preview-cursor')?.remove());
    await page.mouse.up();
    await page.locator('.ai-selection-context img').waitFor();
    await page.getByTitle('清除选区', { exact: true }).click();
    await page.getByRole('button', { name: '关闭阅读助手', exact: true }).click();
    await ready(); await page.waitForTimeout(300);
    checks.push(`${theme}: cursor asset / 16px hotspot, dual outline capture, real PDF filter, capture context`);
  }
  const headerHeight = await page.locator('.app-topbar').evaluate(element => element.getBoundingClientRect().height);
  assert.equal(headerHeight, 48);
  // Keyboard focus and selection use the real buttons inside the curved tabs.
  await page.getByRole('tab', { name: names[0], exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name && document.activeElement?.getAttribute('aria-selected') === 'true', names[1]);
  await ready();
  await page.getByRole('tab', { name: names[1], exact: true }).click({ button: 'middle' });
  await page.getByRole('tab', { name: names[1], exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('tab').count(), 2);
  await page.locator('.markdown-paper').waitFor();
  // Enough tabs to require overflow; active tab must still scroll into view.
  const manyNames = Array.from({ length: 10 }, (_, index) => `文档-${index + 1}.md`);
  const more = page.waitForEvent('filechooser');
  await page.locator('.import-button').click();
  await (await more).setFiles(manyNames.map(name => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(`# ${name}\n\n用于验证标签溢出和键盘切换。`) })));
  await page.getByRole('tab', { name: manyNames[0], exact: true }).waitFor();
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.getByRole('tab', { name: manyNames[0], exact: true }).focus();
  await page.keyboard.press('End');
  await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name, manyNames.at(-1));
  const layout = await page.locator('.tab-strip').evaluate(element => {
    const active = element.querySelector('[aria-selected="true"]');
    const strip = element.getBoundingClientRect(), tab = active.getBoundingClientRect();
    return { overflow: element.scrollWidth > element.clientWidth, visible: tab.left >= strip.left - 1 && tab.right <= strip.right + 1, scrollTop: element.scrollTop, height: document.querySelector('.app-topbar').getBoundingClientRect().height, bodyOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.deepEqual(layout, { overflow: true, visible: true, scrollTop: 0, height: 48, bodyOverflow: false });
  checks.push('48px header preserved; arrow-key focus and middle-click close; 12 tabs at 1000px: horizontal overflow and active tab visibility');
  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'folder-capture-preview.json'), JSON.stringify({ checks, errors, headerHeight, layout, cursorPreview: 'Exact 32px asset placed at the pointer hotspot for screenshots only; production uses the CSS cursor.' }, null, 2));
  process.stdout.write(JSON.stringify({ passed: true, checks, artifacts }) + '\n');
} finally {
  await browser?.close();
  await server?.close();
}
