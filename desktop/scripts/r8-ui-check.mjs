// Round 8: glass legibility settings and refraction, book covers from the card menu, markup shortcuts,
// collapsing the chrome in fullscreen (Ctrl+B springs it back), and PDF scrolling without pixel read-backs.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { samplePdf, imagePdf } from '../../tests/fixtures/pdf.mjs';

const artifacts = resolve('artifacts'), checks = [], errors = [];
const port = 1478, origin = `http://127.0.0.1:${port}`;
let server, browser;
const until = async (condition, message, tries = 120) => { for (let i = 0; i < tries; i++) { if (await condition()) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(message); };
const quiet = page => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity), null, { timeout: 30000 });
async function start(colorScheme = 'light') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme });
  // Count page-pixel read-backs: the dark-mode photo layer is the only reader code that calls getImageData.
  await context.addInitScript(() => {
    window.__readbacks = 0;
    const original = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) { window.__readbacks++; return original.apply(this, args); };
  });
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
const savePreferences = (page, patch) => page.evaluate(async patch => {
  const { useSettings } = await import('/src/settings/index.ts');
  const settings = useSettings();
  const next = JSON.parse(JSON.stringify(settings.preferences.value));
  next.appearance = { ...next.appearance, ...patch };
  await settings.save(next);
}, patch);

try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-r8-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ---- 1. Glass: legibility modes, photo tint and refraction -------------------------------------------------
  let page = await start('light');
  await add(page, '玻璃.md', 'text/markdown', Buffer.from('# 玻璃\n\n正文。'));
  await page.locator('.markdown-paper').waitFor();
  const night = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800; const paint = canvas.getContext('2d');
    const gradient = paint.createLinearGradient(0, 0, 1200, 800); gradient.addColorStop(0, '#0b1424'); gradient.addColorStop(1, '#3a2a44');
    paint.fillStyle = gradient; paint.fillRect(0, 0, 1200, 800);
    return canvas.toDataURL('image/jpeg', .9);
  });
  await savePreferences(page, { background: { name: 'night', dataUrl: night }, gallery: [{ name: 'night', dataUrl: night }], glassTransparency: 100 });
  const glass = () => page.evaluate(() => [...document.querySelectorAll('.app-sidebar,.app-topbar')].map(element => ({ ink: element.dataset.glassInk || '', floor: Number(element.style.getPropertyValue('--glass-floor') || 0), tint: element.style.getPropertyValue('--glass-rgb-3'), lens: element.style.getPropertyValue('--refraction'), filter: getComputedStyle(element).backdropFilter })));
  const settle = async () => { await page.waitForTimeout(500); await quiet(page); await page.waitForTimeout(300); };
  await settle();
  const strong = (await savePreferences(page, { glassLegibility: 'thicken', glassCompensation: 100 }), await settle(), await glass());
  const gentle = (await savePreferences(page, { glassCompensation: 40 }), await settle(), await glass());
  for (const [index, item] of gentle.entries()) {
    assert.equal(item.ink, 'dark', 'Thicken keeps the light theme\'s dark ink.');
    assert.ok(item.floor < strong[index].floor, `Lower strength whitens the glass less (${item.floor} < ${strong[index].floor}).`);
  }
  const switched = (await savePreferences(page, { glassLegibility: 'ink' }), await settle(), await glass());
  assert.ok(switched.every(item => item.ink === 'light' && item.floor === 0), 'Ink mode keeps the glass clear and switches to light text over the night photo.');
  const off = (await savePreferences(page, { glassLegibility: 'off' }), await settle(), await glass());
  assert.ok(off.every(item => !item.ink && item.floor === 0), 'Off writes nothing.');
  const tinted = (await savePreferences(page, { glassLegibility: 'thicken', glassTint: 'photo' }), await settle(), await glass());
  assert.ok(tinted.every(item => /^\d+ \d+ \d+$/.test(item.tint)), 'Photo tint sets the glass colour from the photo.');
  assert.ok(tinted.every(item => /^url\("?#kaizhi-lens-\d+"?\)$/.test(item.lens) && /url\(/.test(item.filter)), 'Glass gets its own refraction filter.');
  const lens = await page.evaluate(() => { const id = document.querySelector('.app-sidebar').style.getPropertyValue('--refraction').match(/#([\w-]+)/)[1]; const filter = document.getElementById(id); return { displacement: filter.querySelectorAll('feDisplacementMap').length, blur: filter.querySelector('feGaussianBlur')?.getAttribute('stdDeviation'), image: filter.querySelector('feImage')?.getAttribute('href')?.slice(0, 22) }; });
  assert.ok(lens.displacement >= 1 && Number(lens.blur) > 0 && lens.image === 'data:image/png;base64,', `The lens bends a sharp rim over the frosted middle (${JSON.stringify(lens)}).`);
  await page.screenshot({ path: resolve(artifacts, 'r8-glass-photo-tint.png') });
  await savePreferences(page, { glassRefraction: false }); await settle();
  assert.ok((await glass()).every(item => !item.lens && !/url\(/.test(item.filter)), 'Turning refraction off restores the plain blur.');
  await savePreferences(page, { glassRefraction: true, glassTint: 'theme', glassCompensation: 50 }); await settle();
  // The settings page explains the whitening and offers the controls.
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
  for (const name of ['可读性补偿方式', '可读性补偿强度', '玻璃底色', '光线折射']) assert.equal(await dialog.getByLabel(name, { exact: true }).count(), 1, `${name} is in Appearance.`);
  assert.match(await dialog.innerText(), /「泛白」来自两样东西/);
  await dialog.screenshot({ path: resolve(artifacts, 'r8-settings-glass.png') });
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  checks.push(`Glass legibility: thicken at 40% whitens less than at 100% (floor ${gentle[0].floor} vs ${strong[0].floor}); ink mode keeps it clear with light text; off writes nothing; photo tint colours the glass; each glass has an SVG lens (${lens.displacement} displacement maps, blur ${lens.blur}); refraction can be turned off.`);
  await page.context().close();

  // ---- 2. Card menu, covers -----------------------------------------------------------------------------------
  page = await start('light');
  await add(page, '封面.pdf', 'application/pdf', samplePdf(2, false, false, { lines: { 1: ['Cover page title', 'A second line of text'] } }));
  await page.waitForSelector('#page-surface.page-ready');
  await page.getByRole('button', { name: '文档库', exact: true }).first().click(); await page.locator('.document-card').first().waitFor(); await quiet(page);
  const card = page.locator('.document-card').first();
  const menuFor = async () => { const box = await card.boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + 60, { button: 'right' }); await page.locator('.context-menu').waitFor(); };
  await menuFor();
  const items = await page.getByRole('menuitem').allInnerTexts();
  for (const text of ['打开', '收藏', '封面：首页预览', '封面：选择图片…', '封面：默认图标', '从文档库移除']) assert.ok(items.some(item => item.startsWith(text)), `Card menu has ${text}`);
  await until(() => page.locator('.context-menu').evaluate(element => /url\(/.test(getComputedStyle(element).backdropFilter)), 'The menu is refractive glass.');
  await page.getByRole('menuitem', { name: /封面：选择图片/ }).hover(); await page.waitForTimeout(500);
  assert.equal(await page.locator('.context-menu .liquid-indicator.visible').count(), 1, 'A glass droplet slides under the pointed item.');
  await page.locator('.context-menu').screenshot({ path: resolve(artifacts, 'r8-card-menu.png') });
  await page.getByRole('menuitem', { name: /封面：首页预览/ }).click();
  await card.locator('.cover-image.page').waitFor();
  const image = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 400; const paint = canvas.getContext('2d'); paint.fillStyle = '#d24d6b'; paint.fillRect(0, 0, 300, 400); paint.fillStyle = '#f6d36b'; paint.fillRect(40, 60, 220, 120); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
  await menuFor();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('menuitem', { name: /封面：选择图片/ }).click();
  await (await chooser).setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: image });
  await card.locator('.cover-image.image').waitFor();
  await card.screenshot({ path: resolve(artifacts, 'r8-card-cover.png') });
  await page.reload(); await card.locator('.cover-image.image').waitFor();
  await menuFor(); await page.getByRole('menuitem', { name: /封面：默认图标/ }).click();
  await until(async () => await card.locator('.cover-image').count() === 0, 'The default icon returns.');
  assert.equal(await card.locator('.document-type-icon').count(), 1);
  checks.push('Right-clicking a book offers open, star, three cover choices (first page, own image, default icon) and remove, in a refractive glass menu with a sliding highlight; covers persist across reload.');

  // ---- 3. Markup shortcuts ------------------------------------------------------------------------------------
  await card.click(); await page.waitForSelector('#page-surface.page-ready'); await quiet(page);
  const tool = name => page.locator('.ink-palette').getByRole('button', { name, exact: true });
  await page.keyboard.press('Alt+Digit1'); await page.locator('.ink-palette').waitFor();
  assert.equal(await tool('笔').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Alt+Digit2'); assert.equal(await tool('荧光笔').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Alt+Digit3'); assert.equal(await tool('划线').getAttribute('aria-pressed'), 'true');
  await tool('划线').hover(); await page.waitForTimeout(1200);
  assert.match(await page.locator('.glass-tooltip').innerText(), /Alt \+ 3/);
  await page.keyboard.press('Alt+Digit3'); await page.locator('.ink-palette').waitFor({ state: 'detached' });
  checks.push('Alt+1 / Alt+2 / Alt+3 pick pen, highlighter and underline (tooltips show the keys); pressing the active tool\'s key again leaves markup.');

  // ---- 4. Fullscreen: collapse the chrome into a corner tag; Ctrl+B springs it back -----------------------
  const workspace = () => page.locator('.reading-workspace').boundingBox();
  const pdfMorph = () => page.locator('.pdf-scroll').evaluate(element => element.getAnimations().some(animation => String(animation.effect?.getKeyframes()[0]?.transform || '').includes('scale')));
  const sidebarSpring = () => page.locator('.app-sidebar').evaluate(element => element.getAnimations().map(animation => animation.transitionProperty).filter(Boolean)).catch(() => []);
  // Ctrl+B outside fullscreen: the sidebar width springs and the PDF eases from its old frame into the new one.
  await page.keyboard.press('Control+KeyB');
  let leaving = [];
  await until(async () => { leaving = await sidebarSpring(); return leaving.includes('flex-basis') || leaving.includes('width'); }, 'The sidebar\'s width animates.', 40);
  await until(pdfMorph, 'The PDF springs from its previous frame after the sidebar folds.', 80);
  await quiet(page);
  await page.keyboard.press('Control+KeyB'); await page.locator('.app-sidebar').waitFor(); await quiet(page);
  await page.getByRole('button', { name: '进入全屏', exact: true }).click(); await page.waitForTimeout(600);
  const before = await workspace();
  await page.getByRole('button', { name: '收起顶栏与侧栏', exact: true }).click();
  await page.locator('.chrome-tag').waitFor(); await page.locator('.app-topbar').waitFor({ state: 'hidden' }); await page.locator('.app-sidebar').waitFor({ state: 'detached' });
  await until(pdfMorph, 'The reader zooms into the freed space with a spring.', 80);
  await quiet(page);
  const collapsed = await workspace();
  assert.ok(collapsed.width > before.width + 150 && collapsed.y < before.y - 40, `The reader takes the freed space (${Math.round(before.width)}×${Math.round(before.y)} → ${Math.round(collapsed.width)}×${Math.round(collapsed.y)}).`);
  await page.screenshot({ path: resolve(artifacts, 'r8-fullscreen-collapsed.png') });
  await page.keyboard.press('Control+KeyB');
  await page.locator('.app-topbar').waitFor(); await page.locator('.app-sidebar').waitFor(); await page.locator('.chrome-tag').waitFor({ state: 'detached' }); await quiet(page);
  const restored = await workspace();
  assert.ok(Math.abs(restored.width - before.width) < 2 && Math.abs(restored.y - before.y) < 2, 'Ctrl+B brings back the top bar together with the sidebar.');
  await page.getByRole('button', { name: '收起顶栏与侧栏', exact: true }).click(); await page.locator('.chrome-tag').waitFor(); await quiet(page);
  await page.locator('.chrome-tag').click(); await page.locator('.app-topbar').waitFor(); await page.locator('.app-sidebar').waitFor();
  checks.push(`In fullscreen the top bar and sidebar fold into a corner tag (reading area ${Math.round(before.width)}px → ${Math.round(collapsed.width)}px wide, ${Math.round(before.y - collapsed.y)}px taller); the tag or Ctrl+B restores both; the sidebar's width springs and the PDF eases from its old frame into the new one.`);
  await page.context().close();

  // ---- 5. PDF images: no read-backs in light theme, lazy photo layer in dark theme -------------------------
  page = await start('light');
  await add(page, '图片.pdf', 'application/pdf', imagePdf());
  await page.waitForSelector('#page-surface.page-ready'); await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__readbacks), 0, 'Light theme reads no page pixels.');
  assert.equal(await page.locator('.pdf-photos').count(), 0);
  await page.locator('.sidebar-bottom .icon-button').click();
  await until(async () => await page.locator('.pdf-photos canvas').count() > 0, 'Switching to dark adds the colour layer to the painted page.');
  const readbacks = await page.evaluate(() => window.__readbacks);
  assert.ok(readbacks > 0 && readbacks <= 4, `Only tiny thumbnails are read, once per image (${readbacks}).`);
  await page.evaluate(() => document.querySelector('.pdf-scroll').scrollTop += 2000); await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('.pdf-scroll').scrollTop = 0); await page.waitForTimeout(1500);
  assert.ok(await page.locator('.pdf-photos canvas').count() > 0);
  assert.equal(await page.evaluate(() => window.__readbacks), readbacks, 'Revisited pages reuse the cached classification.');
  checks.push(`Dark-mode photo protection reads no pixels in light theme; in dark theme it classifies images from ${readbacks} tiny thumbnails once, during idle time, and reuses the result.`);
  await page.context().close();

  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'r8-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); }
