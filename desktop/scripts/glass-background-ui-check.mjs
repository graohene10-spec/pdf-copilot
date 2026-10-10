// Exercise image import, draft rollback and persisted transparency in an isolated library.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = 'http://127.0.0.1:1483';
const artifacts = resolve('artifacts');
const checks = [], errors = [], remoteRequests = [];
let server, browser, page;
const dialog = () => page.getByRole('dialog', { name: '设置', exact: true });
const slider = () => dialog().getByRole('slider', { name: '玻璃透明度', exact: true });
const prefs = () => page.evaluate(async () => {
  const { library } = await import('/src/sdk/index.ts');
  return await library.getSetting('app.preferences.v1');
});
const settled = () => page.waitForFunction(() => !document.querySelector('.settings-pop-enter-active,.settings-pop-leave-active,.view-enter-active,.view-leave-active,.pane-enter-active,.pane-leave-active'));
async function openSettings() {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await slider().waitFor(); await settled();
}
async function closeSettings(save = false) {
  await dialog().getByRole('button', { name: save ? '保存' : '取消', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
}
async function choose(buffer, name = '背景测试.png', mimeType = 'image/png') {
  const pending = page.waitForEvent('filechooser');
  await dialog().getByRole('button', { name: /^(选择图片|替换图片)$/ }).click();
  await (await pending).setFiles({ name, mimeType, buffer });
  await page.waitForFunction(() => ![...document.querySelectorAll('.background-heading button')].some(button => button.textContent.includes('正在处理')));
}
async function shot(name) {
  await page.mouse.move(1435, 935); await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(artifacts, name), animations: 'disabled' });
}
const material = () => page.locator('.app-sidebar').evaluate(element => {
  const css = getComputedStyle(element);
  return { fill: css.backgroundColor, blur: css.backdropFilter, shadow: css.boxShadow };
});

try {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ server: { host: '127.0.0.1', port: 1483, strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/artifacts/**', '**/release/**'] } } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  await page.getByRole('button', { name: '打开 阅读工作台指南.md', exact: true }).waitFor();
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 1920, 1200);
    gradient.addColorStop(0, '#e3f2f0'); gradient.addColorStop(.45, '#a3cfb9');
    gradient.addColorStop(.7, '#89baca'); gradient.addColorStop(1, '#dae7f5');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1920, 1200);
    for (let i = 0; i < 8; i++) {
      ctx.beginPath(); ctx.ellipse(1280, 820, 180 + i * 80, 120 + i * 55, -.15, 0, Math.PI * 2);
      ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,.7)' : 'rgba(40,80,90,.25)'; ctx.lineWidth = 4; ctx.stroke();
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const image = Buffer.from(imageData, 'base64');
  await writeFile(resolve(artifacts, 'wallpaper-test-fixture.png'), image);
  const before = await prefs();
  await openSettings();
  assert.equal(await slider().inputValue(), '70');
  await choose(image);
  await page.waitForFunction(() => document.documentElement.dataset.background === 'custom');
  assert.equal(await dialog().getByRole('img', { name: '底板图片预览' }).count(), 1);
  await slider().fill('83');
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--glass-transparency') === '0.83');
  await slider().focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await slider().inputValue(), '84');
  assert.equal(await prefs(), before, 'A preview must not persist the draft.');
  await closeSettings();
  assert.equal(await page.locator('html').getAttribute('data-background'), 'default');
  assert.equal(await page.locator('html').evaluate(element => element.style.getPropertyValue('--glass-transparency')), '0.7');
  checks.push('Picker imports a local raster; slider previews every percentage and responds to keyboard; cancel restores both and leaves storage unchanged.');

  await openSettings(); await choose(image); await slider().fill('83'); await closeSettings(true);
  const stored = JSON.parse(await prefs());
  assert.equal(stored.appearance.glassTransparency, 83);
  assert.equal(stored.appearance.background.name, '背景测试.png');
  assert.match(stored.appearance.background.dataUrl, /^data:image\/(webp|jpeg);base64,/);
  assert.ok(stored.appearance.background.dataUrl.length < 1400000);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.background === 'custom');
  await page.getByTitle('列表视图', { exact: true }).click();
  await shot('开智-清透玻璃-自定义底板-浅色.png');
  await page.getByTitle('切换深色主题', { exact: true }).first().click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForFunction(() => document.querySelector('.app-sidebar')?.dataset.glassInk === 'dark');
  assert.equal(await page.locator('.app-sidebar').evaluate(element => getComputedStyle(element).getPropertyValue('--control-ink').trim()), '#151918', 'Bright custom images use dark text even in a dark theme.');
  assert.equal(await page.locator('html').evaluate(element => element.style.getPropertyValue('--photo-dark-alpha')), '', 'Text adaptation does not apply a material tint compensation.');
  assert.equal(await page.locator('html').getAttribute('data-background'), 'custom');
  await shot('开智-清透玻璃-自定义底板-深色.png');
  await page.getByTitle('切换浅色主题', { exact: true }).first().click();
  checks.push('Save and reload preserve image pixels and percentage; bright custom backgrounds use dark foregrounds, without changing glass tint or making external requests.');

  await openSettings();
  const priorImage = JSON.parse(await prefs()).appearance.background.dataUrl;
  await choose(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), '伪装.png');
  await dialog().locator('.settings-error').filter({ hasText: /支持/ }).waitFor();
  assert.equal(await dialog().getByRole('img', { name: '底板图片预览' }).getAttribute('src'), priorImage);
  assert.equal(JSON.parse(await prefs()).appearance.background.dataUrl, priorImage);
  await slider().fill('0');
  await page.waitForFunction(() => document.documentElement.dataset.glass === 'solid');
  const opaque = await material();
  await slider().fill('83'); await page.waitForTimeout(150);
  const clear = await material();
  assert.notEqual(clear.fill, opaque.fill);
  assert.ok(opaque.blur === 'none' || /^blur\(0px\)/.test(opaque.blur), 'Opaque material does not need a backdrop blur.');
  assert.ok(clear.shadow !== 'none');
  await shot('开智-清透玻璃-设置预览.png');
  await closeSettings();
  checks.push('An invalid disguised image preserves the current wallpaper; 0% gives opaque material and continuous adjustment visibly changes chrome.');

  await page.getByRole('button', { name: '打开 PDF 阅读示例.pdf', exact: true }).click();
  const pdfReady = () => page.waitForFunction(() => document.querySelector('#page-surface')?.classList.contains('page-ready') && !document.querySelector('#page-surface')?.classList.contains('pdf-preview'));
  await pdfReady();
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await page.locator('.ai-pane').waitFor(); await settled();
  await page.waitForFunction(() => {
    const paper = document.querySelector('#page-surface'), viewport = document.querySelector('.reading-main');
    return paper && viewport && paper.getBoundingClientRect().width <= viewport.clientWidth &&
      paper.classList.contains('page-ready') && !paper.classList.contains('pdf-preview');
  });
  const paper = page.locator('#page-surface');
  const bounds = await paper.boundingBox();
  const canvas = page.locator('#page-surface canvas').first();
  const pixels = await canvas.evaluate(element => element.toDataURL());
  await openSettings(); await slider().fill('21'); await closeSettings(true);
  assert.deepEqual(await paper.boundingBox(), bounds, 'Changing glass never resizes a PDF.');
  assert.equal(await canvas.evaluate(element => element.toDataURL()), pixels, 'Changing glass never changes PDF pixels.');
  await openSettings(); await slider().fill('83'); await closeSettings(true);
  await shot('开智-清透玻璃-自定义底板-阅读.png');
  checks.push('Glass changes leave PDF geometry and actual canvas pixels unchanged with the AI sidebar open.');

  await page.evaluate(() => { document.documentElement.dataset.contrast = 'high'; });
  assert.equal(await page.locator('.app-shell').evaluate(element => getComputedStyle(element, '::before').opacity), '0');
  await page.evaluate(() => { delete document.documentElement.dataset.contrast; });
  await page.setViewportSize({ width: 1000, height: 680 }); await openSettings();
  assert.ok(await dialog().evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.ok(await dialog().getByRole('button', { name: '保存', exact: true }).isVisible());
  await dialog().getByRole('button', { name: '恢复默认底板', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.background === 'default');
  await closeSettings();
  assert.equal(await page.locator('html').getAttribute('data-background'), 'custom');
  await openSettings(); await dialog().getByRole('button', { name: '恢复默认底板', exact: true }).click(); await closeSettings(true);
  assert.equal(JSON.parse(await prefs()).appearance.background, null);
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.background === 'default');
  assert.equal(await page.locator('html').evaluate(element => element.style.getPropertyValue('--custom-workspace-image')), '');
  checks.push('High contrast hides custom textures; minimum-size settings remain usable; restore-default supports cancel and persists on save/reload.');
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  console.log(JSON.stringify({ passed: true, checks, errors, remoteRequests }));
} finally {
  await writeFile(resolve(artifacts, 'glass-background-ui.json'), JSON.stringify({ checks, errors, remoteRequests }, null, 2));
  await browser?.close(); await server?.close();
}
