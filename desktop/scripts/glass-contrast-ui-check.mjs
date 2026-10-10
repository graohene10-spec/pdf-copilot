// Real image uploads and local foreground adaptation in an isolated browser library.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = 'http://127.0.0.1:1493';
const folder = resolve('artifacts');
const checks = [], errors = [], remoteRequests = [];
const metrics = {};
let server, browser, context, page;
const dialog = () => page.getByRole('dialog', { name: '设置', exact: true });
const settled = () => page.waitForFunction(() => !document.querySelector('.settings-pop-enter-active,.settings-pop-leave-active,.view-enter-active,.view-leave-active,.pane-enter-active,.pane-leave-active,.sidebar-enter-active,.sidebar-leave-active'));
async function paint() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function appearance(value) {
  await page.evaluate(async value => {
    const { useSettings } = await import('/src/settings/index.ts');
    const settings = useSettings();
    await settings.save({ ...settings.preferences.value, appearance: { ...settings.preferences.value.appearance, ...value } });
  }, value);
  await settled(); await paint();
}
async function openSettings() {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await dialog().getByRole('slider', { name: '玻璃透明度', exact: true }).waitFor();
  await settled();
}
async function upload(image, name) {
  await openSettings();
  const chooser = page.waitForEvent('filechooser');
  await dialog().getByRole('button', { name: /^(选择图片|替换图片)$/ }).click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: image });
  await dialog().getByAltText('底板图片预览', { exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('.background-heading button')].some(button => button.textContent.includes('正在处理')));
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
  await settled();
}
async function ink(selector, value) {
  await page.waitForFunction(({ selector, value }) => [...document.querySelectorAll(selector)].length > 0 && [...document.querySelectorAll(selector)].every(element => element.getAttribute('data-glass-ink') === value), { selector, value });
}
async function selectedInk() {
  const colors = await page.locator('.app-sidebar').evaluate(element => {
    const selected = element.querySelector('.workspace-nav button.selected');
    const plain = element.querySelector('.workspace-nav button:not(.selected)');
    if (!selected || !plain) throw new Error('Missing selected and ordinary sidebar controls.');
    return { selected: getComputedStyle(selected).color, plain: getComputedStyle(plain).color, local: getComputedStyle(element).getPropertyValue('--control-ink').trim() };
  });
  assert.equal(colors.selected, colors.plain, 'Selected and ordinary controls must share the locally compensated text color.');
}
async function localTextContrast(selector, side) {
  const expected = side === 'black' ? 'rgb(242, 245, 243)' : 'rgb(21, 25, 24)';
  await page.waitForFunction(({ selector, expected }) => [...document.querySelectorAll(selector)].length > 0 && [...document.querySelectorAll(selector)].every(element => getComputedStyle(element).color === expected), { selector, expected });
  const samples = await page.locator(selector).evaluateAll((elements, side) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const paint = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => { paint.clearRect(0, 0, 1, 1); paint.fillStyle = color; paint.fillRect(0, 0, 1, 1); return [...paint.getImageData(0, 0, 1, 1).data]; };
    const luminance = color => {
      const channels = color.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const shell = document.querySelector('.app-shell'), bounds = shell.getBoundingClientRect();
    return elements.map(element => {
      const rectangle = element.getBoundingClientRect();
      const layers = [];
      for (let parent = element; parent && parent !== shell; parent = parent.parentElement) layers.unshift(parent);
      let background = side === 'black' ? [0, 0, 0] : [255, 255, 255];
      for (const layer of layers) {
        const color = rgba(getComputedStyle(layer).backgroundColor), alpha = color[3] / 255;
        background = background.map((value, index) => value * (1 - alpha) + color[index] * alpha);
      }
      const foreground = rgba(getComputedStyle(element).color).slice(0, 3);
      const light = luminance(background), ink = luminance(foreground);
      return { text: element.textContent.trim().slice(0, 40), left: rectangle.left, right: rectangle.right, split: bounds.left + bounds.width / 2, contrast: (Math.max(light, ink) + .05) / (Math.min(light, ink) + .05) };
    });
  }, side);
  for (const sample of samples) {
    assert.ok(side === 'black' ? sample.right < sample.split - 8 : sample.left > sample.split + 8, `${selector} fixture text must sit wholly on its declared image half.`);
    assert.ok(sample.contrast >= 4.5, `${selector} text must maintain readable local contrast (measured ${sample.contrast.toFixed(2)}).`);
    metrics.minimumLocalContrast = Math.min(metrics.minimumLocalContrast ?? Infinity, sample.contrast);
    metrics.localLabelsChecked = (metrics.localLabelsChecked || 0) + 1;
  }
}
async function themeText(selector) {
  const colors = await page.locator(selector).first().evaluate(element => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--surface-ink)';
    document.documentElement.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(element).color, expected };
  });
  assert.equal(colors.actual, colors.expected, `${selector} must retain its opaque surface theme text.`);
}
async function noAdaptation() {
  await page.waitForFunction(() => !document.querySelector('[data-glass-ink]'));
  const leaked = await page.evaluate(() => [...document.querySelectorAll('.app-sidebar,.app-topbar,.library-heading,.library-search,.library-summary,.document-card,.reader-tools,.document-outline,.reading-status,.document-details,.ai-pane')].filter(element => ['--ink','--control-ink','--secondary','--muted','--glass-label-shadow'].some(name => element.style.getPropertyValue(name))).map(element => element.className));
  assert.deepEqual(leaked, [], 'Foreground compensation must restore the original inline styles.');
}
async function shot(name) {
  await page.mouse.move(1435, 935); await settled(); await paint();
  await page.screenshot({ path: resolve(folder, name), animations: 'disabled' });
}

try {
  await mkdir(folder, { recursive: true });
  server = await createServer({ server: { host: '127.0.0.1', port: 1493, strictPort: true, watch: { ignored: ['**/src-tauri/**','**/artifacts/**','**/release/**'] } } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 940 }, colorScheme: 'light' });
  await context.addInitScript(() => {
    const frame = window.requestAnimationFrame.bind(window);
    window.__contrastFrameCount = 0;
    window.requestAnimationFrame = callback => { window.__contrastFrameCount++; return frame(callback); };
  });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  await page.getByRole('button', { name: '打开 阅读工作台指南.md', exact: true }).waitFor();
  await page.evaluate(() => {
    const style = document.documentElement.style;
    const original = style.setProperty.bind(style);
    window.__backgroundWriteCount = 0;
    style.setProperty = (name, value, priority) => {
      if (name === '--custom-workspace-image') window.__backgroundWriteCount++;
      return original(name, value, priority);
    };
  });
  const fixtures = await page.evaluate(() => {
    const data = {};
    for (const kind of ['white', 'black', 'split']) {
      const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1200;
      const drawing = canvas.getContext('2d');
      drawing.fillStyle = kind === 'black' ? '#000' : '#fff'; drawing.fillRect(0, 0, 1920, 1200);
      if (kind === 'split') { drawing.fillStyle = '#000'; drawing.fillRect(0, 0, 960, 1200); }
      data[kind] = canvas.toDataURL('image/png').split(',')[1];
    }
    return data;
  });

  const normalMaterial = {};
  for (const theme of ['light', 'dark']) {
    await appearance({ theme, glassTransparency: 83 });
    normalMaterial[theme] = await page.locator('.app-sidebar').evaluate(element => getComputedStyle(element).backgroundColor);
  }
  for (const kind of ['white', 'black']) {
    await appearance({ theme: 'light', glassTransparency: 83 });
    await upload(Buffer.from(fixtures[kind], 'base64'), `纯${kind === 'white' ? '白' : '黑'}底板.png`);
    for (const theme of ['light', 'dark']) {
      await appearance({ theme, glassTransparency: 83 });
      await ink('.app-sidebar,.app-topbar,.library-heading,.library-search,.library-summary,.document-card', kind === 'white' ? 'dark' : 'light');
      await selectedInk();
      const fill = await page.locator('.app-sidebar').evaluate(element => getComputedStyle(element).backgroundColor);
      assert.ok(/(?:rgba|color)\(/.test(fill), 'Custom wallpaper preserves translucent chrome.');
      assert.equal(fill, normalMaterial[theme], 'Foreground compensation must not change the glass tint or opacity.');
    }
  }
  checks.push('Actual white and black PNG uploads compensate each glass region in both themes; selected controls preserve the same foreground color.');

  await appearance({ theme: 'light', glassTransparency: 83 });
  await upload(Buffer.from(fixtures.split, 'base64'), '左黑右白底板.png');
  await ink('.app-sidebar', 'light');
  await ink('.library-heading', 'light');
  await selectedInk();
  await localTextContrast('.breadcrumb', 'black');
  await localTextContrast('.library-summary > div strong,.library-summary > div > span', 'black');
  await localTextContrast('.library-search > kbd', 'white');
  await localTextContrast('.document-card:nth-child(2) .document-progress > span', 'white');
  const headingBounds = await page.locator('.library-heading h1').boundingBox();
  assert.ok(headingBounds.x + headingBounds.width < 720, 'The heading glyphs are fully over the black half of the bitmap.');
  await shot('开智-玻璃文字对比度-分区-浅色.png');

  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await page.locator('.app-sidebar').waitFor({ state: 'detached' }); await settled();
  await ink('.library-heading', 'light');
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await page.locator('.app-sidebar').waitFor(); await settled();
  await ink('.app-sidebar,.library-heading', 'light');
  await page.setViewportSize({ width: 1000, height: 720 }); await paint();
  await ink('.app-sidebar', 'light');
  await ink('.library-heading', 'light');
  await page.setViewportSize({ width: 1440, height: 940 }); await paint();
  await ink('.app-sidebar,.library-heading', 'light');
  checks.push('Black-left/white-right imagery uses the actual local title region; cover mapping and foregrounds remain correct after resizing and collapsing/reopening the sidebar.');

  await appearance({ theme: 'dark', glassTransparency: 83 });
  await page.getByRole('button', { name: '打开 阅读工作台指南.md', exact: true }).click();
  await page.locator('.markdown-paper').waitFor(); await settled();
  await ink('.file-tab', 'light');
  const selectedTabColor = await page.locator('.file-tab [role="tab"] > span').first().evaluate(element => getComputedStyle(element).color);
  await page.locator('.file-tab').first().hover(); await paint();
  assert.equal(await page.locator('.file-tab [role="tab"] > span').first().evaluate(element => getComputedStyle(element).color), selectedTabColor, 'Hovering a folder tab must preserve its locally compensated foreground.');
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await page.locator('.ai-pane').waitFor(); await settled();
  await ink('.ai-pane', 'dark');
  await page.evaluate(async () => {
    const { library } = await import('/src/sdk/index.ts');
    const { chatState } = await import('/src/ai/workspace.ts');
    const document = (await library.list()).find(document => document.name === '阅读工作台指南.md');
    const state = chatState(document.id);
    state.messages = [
      { id: 'contrast-local-user', role: 'user', content: '仅用于本机显示检查的消息', sources: [] },
      { id: 'contrast-local-assistant', role: 'assistant', content: '本机代码显示检查\n\n```js\nconst sample = 1;\n```', sources: [] },
    ];
  });
  await page.locator('.ai-pane .user-question').waitFor();
  await page.locator('.ai-pane .message-code').waitFor();
  await themeText('.ai-pane .user-question');
  await themeText('.ai-pane .message-code');
  await themeText('.markdown-paper');
  await localTextContrast('.reading-status > span:last-child', 'white');
  await openSettings();
  assert.equal(await dialog().getAttribute('data-glass-ink'), null, 'Tea/frosted popups are excluded from photo foreground adaptation.');
  await themeText('.settings-footer .settings-save');
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
  await shot('开智-玻璃文字对比度-阅读-深色.png');
  checks.push('The AI pane over the white image uses dark chrome text in a dark theme; opaque user bubbles, code, Markdown and excluded tea popups retain their own theme foregrounds.');

  const writesBefore = await page.evaluate(() => window.__backgroundWriteCount);
  for (const theme of ['light', 'dark']) {
    await appearance({ theme, glassTransparency: 0 });
    await noAdaptation();
    await page.waitForFunction(color => getComputedStyle(document.querySelector('.app-sidebar .brand')).color === color, theme === 'light' ? 'rgb(21, 25, 24)' : 'rgb(242, 245, 243)');
    const color = await page.locator('.app-sidebar .brand').evaluate(element => getComputedStyle(element).color);
    assert.equal(color, theme === 'light' ? 'rgb(21, 25, 24)' : 'rgb(242, 245, 243)', 'Opaque glass follows the theme, regardless of image colors.');
    await appearance({ glassTransparency: 83 });
    await ink('.app-sidebar', 'light'); await ink('.ai-pane', 'dark');
  }
  assert.equal(await page.evaluate(() => window.__backgroundWriteCount), writesBefore, 'Theme and transparency changes must not rewrite the large wallpaper CSS payload.');
  checks.push('0% returns theme-colored opaque glass; returning to 83% restores local compensation without rewriting cached image pixels.');

  await page.evaluate(() => { document.documentElement.dataset.contrast = 'high'; });
  await noAdaptation();
  await page.evaluate(() => { delete document.documentElement.dataset.contrast; });
  await ink('.app-sidebar', 'light'); await ink('.ai-pane', 'dark');
  const media = await context.newCDPSession(page);
  await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await noAdaptation();
  await media.send('Emulation.setEmulatedMedia', { features: [] });
  await ink('.app-sidebar', 'light'); await ink('.ai-pane', 'dark');
  await media.detach();
  checks.push('Explicit high contrast and system reduced transparency remove injected foreground variables; compensation returns when those modes are disabled.');

  await page.mouse.move(1435, 935); await settled(); await paint();
  await page.waitForTimeout(180);
  const framesBefore = await page.evaluate(() => window.__contrastFrameCount);
  await page.waitForTimeout(250);
  const idleFrames = await page.evaluate(before => window.__contrastFrameCount - before, framesBefore);
  metrics.idleFrames = idleFrames;
  assert.ok(idleFrames <= 2, `Idle foreground compensation must not keep a frame loop running (observed ${idleFrames} frames).`);
  await appearance({ background: null });
  await noAdaptation();
  assert.equal(await page.locator('html').getAttribute('data-background'), 'default');
  assert.equal(await page.locator('html').evaluate(element => element.style.getPropertyValue('--custom-workspace-image')), '');
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  metrics.imagePayloadWrites = await page.evaluate(() => window.__backgroundWriteCount);
  checks.push('Idle rendering schedules no continuing frame loop; resetting the background removes every injected foreground variable and data attribute.');
  console.log(JSON.stringify({ passed: true, checks, metrics, errors, remoteRequests, isolatedBrowser: true }));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(folder, 'glass-contrast-ui-failure.png'), animations: 'disabled' }).catch(() => {});
  errors.push(String(error?.stack || error));
  throw error;
} finally {
  await writeFile(resolve(folder, 'glass-contrast-ui.json'), JSON.stringify({ passed: errors.length === 0, checks, metrics, errors, remoteRequests, isolatedBrowser: true }, null, 2));
  await context?.close(); await browser?.close(); await server?.close();
}
