// Isolated browser regression checks; native user data and external AI services are untouched.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.PHYDOG_SETTINGS_UI_PORT || 1451);
const origin = process.env.PHYDOG_SETTINGS_UI_URL || `http://127.0.0.1:${port}`;
const folder = resolve('artifacts');
await mkdir(folder, { recursive: true });
const report = [], errors = [], remoteRequests = [];
let server, browser, context, page;
let fileChoosers = 0;
const settings = () => page.getByRole('dialog', { name: '设置', exact: true });
const shot = name => page.screenshot({ path: resolve(folder, name), fullPage: true, animations: 'disabled' });
async function storedPreferences() {
  return page.evaluate(async () => {
    const { library } = await import('/src/sdk/index.ts');
    const stored = await library.getSetting('app.preferences.v1');
    return stored ? JSON.parse(stored) : null;
  });
}
async function paint() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function setTransparency(value) {
  await settings().getByRole('slider', { name: '玻璃透明度', exact: true }).evaluate((element, number) => {
    element.value = String(number);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await paint();
}
async function materialTransparency(value) {
  assert.equal(await page.locator('html').evaluate(element => element.style.getPropertyValue('--glass-transparency')), String(value / 100));
  assert.equal(await page.locator('html').getAttribute('data-glass'), value === 0 ? 'solid' : 'custom');
}
async function openSettings(tab = '外观') {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await settings().waitFor();
  await settings().getByRole('button', { name: tab, exact: true }).click();
}
async function save() {
  const button = settings().getByRole('button', { name: '保存', exact: true });
  assert.equal(await button.isEnabled(), true);
  await button.click();
  await settings().waitFor({ state: 'hidden' });
}
async function openMarkdown() {
  await page.getByRole('button', { name: '打开 阅读工作台指南.md', exact: true }).click();
  await page.locator('.markdown-paper').waitFor();
}
async function record(label, chord) {
  const input = settings().getByRole('textbox', { name: `${label}快捷键`, exact: true });
  await input.click();
  await input.press(chord);
  return input;
}
async function sidebarVisible(visible) { await page.locator('.app-sidebar').waitFor({ state: visible ? 'visible' : 'detached' }); }
async function aiVisible(visible) { await page.locator('.ai-pane').waitFor({ state: visible ? 'visible' : 'detached' }); }
async function markdownStyle(fontSize, contentWidth) {
  const actual = await page.locator('.markdown-paper').evaluate(element => ({ font: getComputedStyle(element).fontSize, width: getComputedStyle(element).maxWidth }));
  assert.deepEqual(actual, { font: `${fontSize}px`, width: `${contentWidth}px` });
}

try {
  if (!process.env.PHYDOG_SETTINGS_UI_URL) {
    server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/public/vendor/**', '**/artifacts/**', '**/test-results/**'] } } });
    await server.listen();
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('filechooser', () => fileChoosers++);
  await page.route(/^https?:\/\//, async route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    remoteRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '打开 阅读工作台指南.md', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await storedPreferences(), null);
  await page.emulateMedia({ colorScheme: 'light' });
  await paint();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  report.push('System theme follows live light/dark changes.');

  // Saving only AI metadata must not create or rewrite general preferences.
  await openSettings('AI');
  await settings().getByLabel('服务商', { exact: true }).selectOption('openai');
  await settings().getByLabel('API Key', { exact: true }).fill('fake-settings-ui-key');
  await save();
  assert.equal(await storedPreferences(), null);
  assert.equal(await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))).includes('fake-settings-ui-key')), false);
  report.push('AI-only save closes the unified dialog without creating general defaults or storing the browser key.');

  await openSettings();
  await settings().getByLabel('主题', { exact: true }).selectOption('dark');
  await settings().getByLabel('默认文档视图', { exact: true }).selectOption('list');
  await shot('settings-ui-appearance.png');
  await settings().getByRole('button', { name: '阅读', exact: true }).click();
  await settings().getByLabel('PDF 初始缩放模式', { exact: true }).selectOption('custom');
  await settings().getByLabel('PDF 初始缩放比例', { exact: true }).fill('125');
  await settings().getByLabel('PDF 缩放步长', { exact: true }).fill('10');
  await settings().getByLabel('Markdown 默认字号', { exact: true }).fill('22');
  await settings().getByLabel('Markdown 内容宽度', { exact: true }).fill('1000');
  await save();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('.document-collection.list').waitFor();
  const initial = await storedPreferences();
  assert.deepEqual(initial.appearance, { theme: 'dark', libraryView: 'list', glassTransparency: 70, background: null });
  assert.equal(initial.pdf.initialZoom, 125);
  assert.equal(initial.pdf.zoomStep, 10);
  report.push('Theme, default list view and PDF numeric preferences save through the real browser adapter.');

  // Exercise continuous values, endpoint fallback and keyboard adjustment.
  let previousTransparency = 70;
  for (const value of [83, 37, 0, 100, 70]) {
    await openSettings();
    await setTransparency(value);
    assert.equal((await storedPreferences()).appearance.glassTransparency, previousTransparency, 'Live preview must not persist until Save.');
    await materialTransparency(value);
    await save();
    assert.equal((await storedPreferences()).appearance.glassTransparency, value);
    previousTransparency = value;
    if (value === 0) assert.equal(await page.locator('.app-sidebar').evaluate(element => getComputedStyle(element).backgroundImage), 'none');
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.document-collection.list').waitFor();
  await materialTransparency(70);
  await openSettings();
  const slider = settings().getByRole('slider', { name: '玻璃透明度', exact: true });
  assert.equal(await slider.inputValue(), '70');
  await slider.press('ArrowRight');
  assert.equal(await slider.inputValue(), '71');
  await materialTransparency(71);
  await settings().getByRole('button', { name: '取消', exact: true }).click();
  await settings().waitFor({ state: 'hidden' });
  await materialTransparency(70);
  report.push('Continuous transparency values and both endpoints preview, persist, reload, adjust with keyboard and roll back on Cancel.');

  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const drawing = canvas.getContext('2d');
    const gradient = drawing.createLinearGradient(0, 0, 1280, 720);
    gradient.addColorStop(0, '#22485c'); gradient.addColorStop(0.5, '#67c5aa'); gradient.addColorStop(1, '#edc8ad');
    drawing.fillStyle = gradient; drawing.fillRect(0, 0, 1280, 720);
    drawing.strokeStyle = '#ffffff80'; drawing.lineWidth = 8;
    for (let x = 0; x < 1280; x += 160) { drawing.beginPath(); drawing.arc(x, 400, 230, 0, Math.PI * 2); drawing.stroke(); }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const upload = { name: '本地底板测试.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') };
  const beforeWallpaper = await storedPreferences();
  await openSettings();
  await settings().getByLabel('主题', { exact: true }).selectOption('light');
  await setTransparency(61);
  await settings().getByLabel('底板图片文件', { exact: true }).setInputFiles(upload);
  await settings().getByAltText('底板图片预览', { exact: true }).waitFor();
  await settings().getByAltText('底板图片预览', { exact: true }).evaluate(image => image.decode());
  assert.equal(await page.locator('html').getAttribute('data-background'), 'custom');
  assert.deepEqual(await storedPreferences(), beforeWallpaper);
  await settings().getByRole('button', { name: '取消', exact: true }).click();
  await settings().waitFor({ state: 'hidden' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('html').getAttribute('data-background'), 'default');
  await materialTransparency(70);

  await openSettings();
  await setTransparency(61);
  await settings().getByLabel('底板图片文件', { exact: true }).setInputFiles(upload);
  await settings().getByAltText('底板图片预览', { exact: true }).waitFor();
  await save();
  const wallpaper = await storedPreferences();
  assert.equal(wallpaper.appearance.background.name, upload.name);
  assert.match(wallpaper.appearance.background.dataUrl, /^data:image\/(webp|jpeg);base64,/);
  assert.notEqual(wallpaper.appearance.background.dataUrl, `data:image/png;base64,${imageData}`, 'The imported image must be locally re-encoded, not copied verbatim.');
  assert.equal(wallpaper.appearance.glassTransparency, 61);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.document-collection.list').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-background'), 'custom');
  await materialTransparency(61);
  await openSettings();
  assert.equal(await settings().getByAltText('底板图片预览', { exact: true }).getAttribute('src'), wallpaper.appearance.background.dataUrl);
  await settings().getByLabel('底板图片文件', { exact: true }).setInputFiles({ name: '不支持.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await settings().getByRole('status').filter({ hasText: /PNG|JPEG|WebP/ }).waitFor();
  assert.deepEqual(await storedPreferences(), wallpaper);
  assert.equal(await settings().getByAltText('底板图片预览', { exact: true }).getAttribute('src'), wallpaper.appearance.background.dataUrl);
  await settings().getByRole('button', { name: '恢复默认底板', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-background'), 'default');
  assert.deepEqual(await storedPreferences(), wallpaper);
  await settings().press('Escape');
  await settings().waitFor({ state: 'hidden' });
  assert.equal(await page.locator('html').getAttribute('data-background'), 'custom');
  report.push('Local image uploads are re-encoded, preview without saving, persist after reload, reject unsupported files, and restore the previous image on Cancel/Escape.');

  await openSettings();
  await setTransparency(92);
  await settings().getByRole('button', { name: '恢复默认底板', exact: true }).click();
  await page.evaluate(async () => {
    const { library } = await import('/src/sdk/index.ts');
    window.__settingsOriginalSave = library.setSetting;
    library.setSetting = async () => { throw new Error('模拟本机保存失败'); };
  });
  await settings().getByRole('button', { name: '保存', exact: true }).click();
  await settings().getByRole('status').filter({ hasText: '模拟本机保存失败' }).waitFor();
  assert.equal(await settings().isVisible(), true);
  assert.deepEqual(await storedPreferences(), wallpaper);
  assert.equal(await page.evaluate(async () => (await import('/src/settings/index.ts')).useSettings().preferences.value.appearance.glassTransparency), 61);
  await page.evaluate(async () => {
    const { library } = await import('/src/sdk/index.ts');
    library.setSetting = window.__settingsOriginalSave;
    delete window.__settingsOriginalSave;
  });
  await settings().getByRole('button', { name: '取消', exact: true }).click();
  await settings().waitFor({ state: 'hidden' });
  await materialTransparency(61);
  assert.equal(await page.locator('html').getAttribute('data-background'), 'custom');

  await openSettings();
  await setTransparency(9);
  await page.locator('.settings-backdrop').click({ position: { x: 10, y: 10 } });
  await settings().waitFor({ state: 'hidden' });
  await materialTransparency(61);
  await openSettings();
  await settings().getByRole('button', { name: '恢复默认底板', exact: true }).click();
  await setTransparency(70);
  await save();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.document-collection.list').waitFor();
  assert.equal((await storedPreferences()).appearance.background, null);
  assert.equal(await page.locator('html').getAttribute('data-background'), 'default');
  assert.equal(await page.locator('html').evaluate(element => element.style.getPropertyValue('--custom-workspace-image')), '');
  report.push('Storage failure leaves persisted appearance intact and the draft retryable; backdrop cancellation rolls back immediately; resetting wallpaper persists the built-in background.');

  // Hold an actual image decode until its dialog has been cancelled and reopened.
  await page.evaluate(() => {
    const original = window.createImageBitmap.bind(window);
    window.__settingsOriginalBitmap = window.createImageBitmap;
    window.createImageBitmap = async (...args) => {
      const bitmap = await original(...args);
      const release = bitmap.close.bind(bitmap);
      bitmap.close = () => { release(); window.__settingsDecodeReleased = true; };
      await new Promise(resolve => { window.__settingsReleaseDecode = resolve; });
      return bitmap;
    };
  });
  await openSettings();
  await settings().getByLabel('底板图片文件', { exact: true }).setInputFiles(upload);
  await page.waitForFunction(() => typeof window.__settingsReleaseDecode === 'function');
  assert.equal(await settings().getByRole('button', { name: '保存', exact: true }).isEnabled(), false);
  await settings().getByRole('button', { name: '取消', exact: true }).click();
  await settings().waitFor({ state: 'hidden' });
  await openSettings();
  await setTransparency(55);
  await page.evaluate(() => {
    window.createImageBitmap = window.__settingsOriginalBitmap;
    delete window.__settingsOriginalBitmap;
    window.__settingsReleaseDecode();
    delete window.__settingsReleaseDecode;
  });
  await page.waitForFunction(() => window.__settingsDecodeReleased === true);
  await paint();
  assert.equal(await settings().getByAltText('底板图片预览', { exact: true }).count(), 0);
  assert.equal(await page.locator('html').getAttribute('data-background'), 'default');
  await materialTransparency(55);
  assert.equal((await storedPreferences()).appearance.background, null);
  await settings().getByRole('button', { name: '取消', exact: true }).click();
  await settings().waitFor({ state: 'hidden' });
  await materialTransparency(70);
  report.push('An image finishing after cancellation cannot modify a reopened dialog or resurrect its wallpaper; Save is disabled during processing.');

  await openSettings('AI');
  await settings().getByLabel('模型', { exact: true }).fill('settings-ui-cross-tab-model');
  await settings().getByRole('button', { name: '阅读', exact: true }).click();
  await settings().getByRole('button', { name: 'AI', exact: true }).click();
  assert.equal(await settings().getByLabel('模型', { exact: true }).inputValue(), 'settings-ui-cross-tab-model');
  await settings().getByRole('button', { name: '阅读', exact: true }).click();
  await save();
  await openSettings('AI');
  assert.equal(await settings().getByLabel('模型', { exact: true }).inputValue(), 'settings-ui-cross-tab-model');
  await settings().getByRole('button', { name: '取消', exact: true }).click();
  await settings().waitFor({ state: 'hidden' });
  report.push('AI drafts survive tab switches; saving from Reading also persists the visited AI configuration.');

  await openMarkdown();
  await markdownStyle(22, 1000);
  await openSettings('阅读');
  await settings().getByLabel('Markdown 默认字号', { exact: true }).fill('25');
  await settings().getByLabel('Markdown 内容宽度', { exact: true }).fill('700');
  await shot('settings-ui-reading.png');
  await save();
  await markdownStyle(25, 700);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.document-collection.list').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await openMarkdown();
  await markdownStyle(25, 700);
  report.push('Markdown font and width apply immediately and survive a full reload, together with theme/list view.');

  await openSettings('快捷键');
  await record('显示 / 隐藏侧栏', 'Alt+Shift+b');
  await record('显示 / 隐藏 AI 助手', 'Control+Shift+8');
  await record('搜索文档', 'Alt+Shift+b');
  assert.equal(await settings().getByRole('button', { name: '保存', exact: true }).isEnabled(), false);
  assert.match(await settings().locator('.settings-error').innerText(), /同时用于/);
  await settings().getByRole('button', { name: '恢复搜索文档默认快捷键', exact: true }).click();
  await record('导入文档', 'Control+o');
  await paint();
  assert.equal(fileChoosers, 0, 'Recording Ctrl+O must not open a file dialog.');
  await settings().focus();
  await page.keyboard.press('Control+b');
  await paint();
  await sidebarVisible(true);
  await page.keyboard.press('Control+Shift+8');
  await paint();
  await aiVisible(false);
  await shot('settings-ui-shortcuts.png');
  await save();
  await page.keyboard.press('Alt+Shift+b');
  await paint(); await sidebarVisible(false);
  await page.keyboard.press('Alt+Shift+b');
  await paint(); await sidebarVisible(true);
  await page.keyboard.press('Control+Shift+8');
  await page.locator('.ai-pane').waitFor();
  report.push('Shortcut conflicts block saving; recording/import and all modal keystrokes leave global actions untouched; custom sidebar/AI bindings work.');

  // Actual editable fields must keep ordinary text input gestures local.
  const composer = page.getByRole('textbox', { name: '向 AI 提问', exact: true });
  await composer.fill('输入框隔离检查');
  await composer.press('Alt+Shift+b');
  await composer.press('Control+Shift+8');
  await paint(); await sidebarVisible(true); await aiVisible(true);
  await composer.press('Control+k');
  await page.getByRole('textbox', { name: '搜索文档', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '搜索文档', exact: true }).evaluate(element => document.activeElement === element), true);
  await openMarkdown();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.document-collection.list').waitFor();
  await openMarkdown();
  await page.keyboard.press('Alt+Shift+b');
  await paint(); await sidebarVisible(false);
  await page.keyboard.press('Alt+Shift+b');
  await paint(); await sidebarVisible(true);
  await page.keyboard.press('Control+Shift+8');
  await page.locator('.ai-pane').waitFor();
  await page.getByRole('button', { name: '关闭阅读助手', exact: true }).click();
  report.push('Editable composer ignores sidebar/AI toggles, still permits search; custom bindings survive reload.');

  await openSettings('快捷键');
  const sidebarInput = settings().getByRole('textbox', { name: '显示 / 隐藏侧栏快捷键', exact: true });
  await sidebarInput.click(); await sidebarInput.press('Escape');
  assert.equal(await settings().isVisible(), true);
  assert.equal(await sidebarInput.inputValue(), 'Alt + Shift + B');
  await sidebarVisible(true);
  await sidebarInput.press('Escape');
  await settings().waitFor({ state: 'hidden' });
  await openSettings('快捷键');
  await settings().getByRole('button', { name: '禁用显示 / 隐藏侧栏快捷键', exact: true }).click();
  await save();
  await page.keyboard.press('Alt+Shift+b');
  await paint(); await sidebarVisible(true);
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await sidebarVisible(false);
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await sidebarVisible(true);
  report.push('First Esc cancels recording, second closes settings; disabled shortcut does nothing while its toolbar action remains available.');

  await openSettings('快捷键');
  await settings().getByRole('button', { name: '恢复全部默认', exact: true }).click();
  await save();
  await page.keyboard.press('Control+b');
  await paint(); await sidebarVisible(false);
  await page.keyboard.press('Control+b');
  await paint(); await sidebarVisible(true);
  await page.keyboard.press('Control+Shift+7');
  await page.locator('.ai-pane').waitFor();
  await page.keyboard.press('Control+Shift+8');
  await paint(); await aiVisible(true);
  const restored = await storedPreferences();
  assert.equal(restored.shortcuts.sidebar, 'Ctrl+KeyB');
  assert.equal(restored.shortcuts.ai, 'Ctrl+Shift+Digit7');
  assert.equal(restored.shortcuts.capture, 'Alt+Shift+KeyS');
  assert.deepEqual(restored.markdown, { fontSize: 25, contentWidth: 700 });
  await shot('settings-ui-markdown.png');
  report.push('Restore defaults removes custom chords, keeps original AI/capture bindings, and preserves reading preferences.');

  const legacy = structuredClone(restored);
  delete legacy.appearance.glassTransparency;
  delete legacy.appearance.background;
  legacy.appearance.glass = 'rich';
  await page.evaluate(async legacy => {
    const { library } = await import('/src/sdk/index.ts');
    await library.setSetting('app.preferences.v1', JSON.stringify(legacy));
  }, legacy);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.document-collection.list').waitFor();
  await materialTransparency(30);
  await openSettings();
  assert.equal(await settings().getByRole('slider', { name: '玻璃透明度', exact: true }).inputValue(), '30');
  await save();
  const upgraded = await storedPreferences();
  assert.deepEqual(upgraded.markdown, legacy.markdown);
  assert.deepEqual(upgraded.shortcuts, legacy.shortcuts);
  assert.equal(upgraded.appearance.glassTransparency, 30);
  assert.equal(upgraded.appearance.background, null);
  assert.equal(Object.hasOwn(upgraded.appearance, 'glass'), false);
  report.push('Legacy four-level preferences migrate and save to numeric transparency without losing reading settings or shortcuts.');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await sidebarVisible(false);
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await sidebarVisible(true);
  assert.equal(await page.locator('.app-sidebar').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  report.push('Reduced-motion mode disables sidebar motion while keeping its controls functional.');

  await openSettings();
  await setTransparency(90);
  await save();
  const media = await context.newCDPSession(page);
  await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches), true);
  const material = await page.locator('.app-sidebar').evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, sheen: style.backgroundImage, blur: style.getPropertyValue('--glass-1-blur').trim() };
  });
  assert.match(material.background, /^rgb\(/);
  assert.equal(material.sheen, 'none');
  assert.equal(material.blur, '0px');
  await media.detach();
  report.push('System reduced-transparency mode overrides even the clear material with an opaque, unblurred surface.');
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteRequests, []);
  const result = { passed: true, report, pageErrors: errors, externalRequests: remoteRequests, fileChoosers, isolatedBrowser: true };
  await writeFile(resolve(folder, 'settings-ui-check.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) await shot('settings-ui-failure.png').catch(() => {});
  await writeFile(resolve(folder, 'settings-ui-check.json'), JSON.stringify({ passed: false, report, pageErrors: errors, externalRequests: remoteRequests, error: String(error?.stack || error) }, null, 2));
  throw error;
} finally {
  await context?.close(); await browser?.close(); await server?.close();
}
