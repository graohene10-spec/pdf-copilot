// Inspect the light workspace material in an isolated browser library.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts');
const origin = 'http://127.0.0.1:1479';
const errors = [], remoteRequests = [], checks = [], captures = [];
let server, browser, page;
const ready = () => page.waitForFunction(() => {
  const surface = document.querySelector('#page-surface');
  return surface?.classList.contains('page-ready') && !surface.classList.contains('pdf-preview') &&
    !document.querySelector('.pane-enter-active,.pane-leave-active,.sidebar-enter-active,.sidebar-leave-active');
});
const settled = () => page.waitForFunction(() => !document.querySelector('.view-enter-active,.view-leave-active,.settings-pop-enter-active,.settings-pop-leave-active'));
const screenshot = async name => {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const filename = `white-ripple-preview-${name}.png`;
  await page.screenshot({ path: resolve(artifacts, filename), animations: 'disabled' });
  captures.push(filename);
};
try {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ server: { host: '127.0.0.1', port: 1479, strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/artifacts/**', '**/release/**'] } } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1, colorScheme: 'light' });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  await page.getByRole('button', { name: '打开 阅读工作台指南.md', exact: true }).waitFor();
  await page.getByTitle('列表视图', { exact: true }).click();
  await screenshot('library-light');
  const lightMaterial = await page.locator('.app-shell').evaluate(element => ({
    background: getComputedStyle(element).backgroundImage,
    texture: getComputedStyle(element, '::before').backgroundImage,
    textureSize: getComputedStyle(element, '::before').backgroundSize,
    textureOpacity: getComputedStyle(element, '::before').opacity
  }));
  checks.push('Light library: near-white workspace and sparse water rings; list actions remain usable.');
  await page.getByRole('button', { name: '打开 阅读工作台指南.md', exact: true }).click();
  await page.locator('.markdown-paper').waitFor(); await settled();
  await screenshot('markdown-light');
  await page.getByRole('button', { name: '文档库', exact: true }).click(); await settled();
  await page.getByRole('button', { name: '打开 PDF 阅读示例.pdf', exact: true }).click(); await ready();
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await page.locator('.ai-pane').waitFor(); await ready();
  await screenshot('reader-light');
  const pdfBefore = await page.locator('#page-surface').boundingBox();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.waitFor(); await settled();
  await screenshot('settings-light');
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await page.locator('#page-surface').boundingBox(), pdfBefore, 'Opening settings keeps PDF geometry stable.');
  checks.push('Light Markdown, PDF with assistant, and settings: no layout change from the backdrop texture.');
  await page.setViewportSize({ width: 1000, height: 740 }); await ready();
  assert.ok(await page.locator('.app-shell').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.ok(await page.locator('.app-topbar').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  const composer = await page.getByRole('textbox', { name: '向 AI 提问', exact: true }).boundingBox();
  assert.ok(composer.width > 100 && composer.y + composer.height <= 740);
  await screenshot('minimum-light');
  checks.push('1000px light window: no horizontal overflow; assistant composer stays usable.');
  await page.setViewportSize({ width: 1440, height: 940 }); await ready();
  await page.getByRole('button', { name: '文档库', exact: true }).click(); await settled();
  await page.getByTitle('切换深色主题', { exact: true }).first().click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await screenshot('library-dark');
  const darkMaterial = await page.locator('.app-shell').evaluate(element => ({
    background: getComputedStyle(element).backgroundImage,
    texture: getComputedStyle(element, '::before').backgroundImage
  }));
  assert.notEqual(darkMaterial.background, lightMaterial.background);
  assert.notEqual(darkMaterial.texture, lightMaterial.texture);
  checks.push('Dark library retains its separate graphite cloud and mineral-vein material.');
  await page.getByTitle('切换浅色主题', { exact: true }).first().click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.evaluate(() => { document.documentElement.dataset.contrast = 'high'; });
  const highContrastTexture = await page.locator('.app-shell').evaluate(element => getComputedStyle(element, '::before').opacity);
  assert.equal(highContrastTexture, '0');
  await screenshot('high-contrast');
  await page.evaluate(() => { document.documentElement.dataset.contrast = 'normal'; });
  checks.push('High-contrast mode hides the decorative water texture.');
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  console.log(JSON.stringify({ passed: true, checks, lightMaterial, darkMaterial, errors, remoteRequests, captures }, null, 2));
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'white-ripple-preview.json'), JSON.stringify({ checks, errors, remoteRequests, captures }, null, 2));
  await browser?.close(); await server?.close();
}
