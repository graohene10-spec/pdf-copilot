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
    // 这些检查按最强的可读性补偿（100%，即 4.8:1）来量；默认强度单独在后面验证。
    await settings.save({ ...settings.preferences.value, appearance: { ...settings.preferences.value.appearance, glassCompensation: 100, ...value } });
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
const themeInk = theme => theme === 'dark' ? 'light' : 'dark';
const INK_COLOR = { dark: 'rgb(22, 26, 32)', light: 'rgb(242, 244, 247)' };
/**
 * Glass (an element with its own translucent material) always takes the theme's ink and only gets denser;
 * bare text drawn straight on the photo still picks the ink that reads on the image below.
 */
async function inkByRole(selector, theme, imageInk) {
  await page.waitForFunction(({ selector, theme, imageInk }) => {
    const elements = [...document.querySelectorAll(selector)];
    const alpha = value => { const match = /\/\s*([\d.]+)\)$|rgba\([^)]*,\s*([\d.]+)\)$/.exec(value); return match ? Number(match[1] ?? match[2]) : value.startsWith('rgb(') ? 1 : 0; };
    return elements.length > 0 && elements.every(element => element.getAttribute('data-glass-ink') === (alpha(getComputedStyle(element).backgroundColor) > .02 ? theme : imageInk));
  }, { selector, theme: themeInk(theme), imageInk });
}
/** Text in glass components reaches 4.5:1 against the glass composited over the given image half. */
async function glassReadable(selector, side, minimum = 4.5) {
  const samples = await page.locator(selector).evaluateAll((elements, side) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const paint = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => { paint.clearRect(0, 0, 1, 1); paint.fillStyle = color; paint.fillRect(0, 0, 1, 1); return [...paint.getImageData(0, 0, 1, 1).data]; };
    const luminance = color => color.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const shell = document.querySelector('.app-shell');
    return elements.map(element => {
      const layers = []; for (let parent = element; parent && parent !== shell; parent = parent.parentElement) layers.unshift(parent);
      let background = side === 'black' ? [0, 0, 0] : [255, 255, 255];
      for (const layer of layers) { const color = rgba(getComputedStyle(layer).backgroundColor), alpha = color[3] / 255; background = background.map((value, index) => value * (1 - alpha) + color[index] * alpha); }
      const light = luminance(background), ink = luminance(rgba(getComputedStyle(element).color).slice(0, 3));
      return { name: element.className.split(' ')[0], contrast: (Math.max(light, ink) + .05) / (Math.min(light, ink) + .05) };
    });
  }, side);
  for (const sample of samples) { assert.ok(sample.contrast >= minimum, `${sample.name} glass keeps ${minimum}:1 over the ${side} image (measured ${sample.contrast.toFixed(2)}).`); metrics.minimumGlassContrast = Math.min(metrics.minimumGlassContrast ?? Infinity, sample.contrast); }
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
  // Text inside glass takes the glass's theme ink; text straight on the photo takes the image's ink. Either way it must read.
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].length > 0 && [...document.querySelectorAll(selector)].every(element => ['rgb(242, 244, 247)', 'rgb(22, 26, 32)'].includes(getComputedStyle(element).color)), selector);
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
async function themeText(selector, token = '--surface-ink') {
  const colors = await page.locator(selector).first().evaluate((element, token) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.documentElement.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(element).color, expected };
  }, token);
  assert.equal(colors.actual, colors.expected, `${selector} must retain its theme text (${token}), not a wallpaper-adapted ink.`);
}
async function noAdaptation() {
  await page.waitForFunction(() => !document.querySelector('[data-glass-ink]'));
  const leaked = await page.evaluate(() => [...document.querySelectorAll('.app-sidebar,.app-topbar,.library-heading,.library-search,.library-summary,.document-card,.reader-tools,.document-outline,.reading-pill,.document-details,.ai-pane')].filter(element => ['--ink','--control-ink','--secondary','--muted','--glass-label-shadow'].some(name => element.style.getPropertyValue(name))).map(element => element.className));
  assert.deepEqual(leaked, [], 'Foreground compensation must restore the original inline styles.');
}
async function shot(name) {
  await page.mouse.move(1435, 935); await settled(); await paint();
  await page.screenshot({ path: resolve(folder, name), animations: 'disabled' });
}

try {
  await mkdir(folder, { recursive: true });
  server = await createServer({ cacheDir: resolve('artifacts/vite-glass-contrast-ui'), server: { host: '127.0.0.1', port: 1493, strictPort: true, watch: { ignored: ['**/src-tauri/**','**/artifacts/**','**/release/**'] } } });
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
    for (const kind of ['white', 'black', 'split', 'gray']) {
      const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1200;
      const drawing = canvas.getContext('2d');
      drawing.fillStyle = kind === 'black' ? '#000' : kind === 'gray' ? '#5a5a5a' : '#fff'; drawing.fillRect(0, 0, 1920, 1200);
      if (kind === 'split') { drawing.fillStyle = '#000'; drawing.fillRect(0, 0, 960, 1200); }
      data[kind] = canvas.toDataURL('image/png').split(',')[1];
    }
    return data;
  });

  const normalMaterial = {};
  const uploaded = {};
  for (const theme of ['light', 'dark']) {
    await appearance({ theme, glassTransparency: 83 });
    normalMaterial[theme] = await page.locator('.app-sidebar').evaluate(element => getComputedStyle(element).backgroundColor);
  }
  for (const kind of ['white', 'black']) {
    await appearance({ theme: 'light', glassTransparency: 83 });
    await upload(Buffer.from(fixtures[kind], 'base64'), `纯${kind === 'white' ? '白' : '黑'}底板.png`);
    uploaded[kind] = await page.evaluate(async () => { const { useSettings } = await import('/src/settings/index.ts'); return useSettings().preferences.value.appearance.background; });
    for (const theme of ['light', 'dark']) {
      await appearance({ theme, glassTransparency: 83 });
      await inkByRole('.app-sidebar,.app-topbar,.library-heading,.library-search,.library-summary,.document-card', theme, kind === 'white' ? 'dark' : 'light');
      await selectedInk();
      await glassReadable('.app-sidebar,.app-topbar,.library-search,.document-card', kind);
      const fill = await page.locator('.app-sidebar').evaluate(element => getComputedStyle(element).backgroundColor);
      const parts = value => value.match(/[\d.]+/g).map(Number);
      assert.deepEqual(parts(fill).slice(0, 3), parts(normalMaterial[theme]).slice(0, 3), 'Compensation keeps the theme\'s glass tint.');
      assert.ok((parts(fill)[3] ?? 1) >= (parts(normalMaterial[theme])[3] ?? 1) - .001, 'Compensation may only make the glass denser.');
    }
  }
  // The default strength (50%) thickens less and adds a faint text halo instead.
  await appearance({ theme: 'light', glassTransparency: 83, glassCompensation: 50 });
  await glassReadable('.app-sidebar,.app-topbar', 'black', 2.85);
  const halo = await page.locator('.app-sidebar').evaluate(element => element.style.getPropertyValue('--glass-label-shadow'));
  assert.match(halo, /0 0 3px/, 'Text on gently compensated glass gets a halo.');
  checks.push('At the default 50% strength the glass is thinner (≥2.9:1) and the text gets a faint halo.');
  checks.push('White and black PNG uploads in both themes: glass keeps the theme ink and becomes denser until it reads at 4.5:1; bare text on the photo takes the image ink; selected controls preserve the same foreground color.');

  await appearance({ theme: 'light', glassTransparency: 50 });
  await upload(Buffer.from(fixtures.gray, 'base64'), '主题往返灰阶底板.png');
  const themeControls = '.app-sidebar .import-button,.app-sidebar .brand,.app-topbar .sidebar-toggle';
  for (const theme of ['light', 'dark', 'light', 'dark', 'light']) {
    await appearance({ theme, glassTransparency: 50 });
    await page.waitForTimeout(320);
    await ink('.app-sidebar,.app-topbar', themeInk(theme));
    await page.waitForFunction(({ selector, color }) => [...document.querySelectorAll(selector)].every(element => getComputedStyle(element).color === color), { selector: themeControls, color: INK_COLOR[themeInk(theme)] });
  }
  await page.evaluate(async () => {
    const { useSettings } = await import('/src/settings/index.ts');
    const settings = useSettings();
    for (const theme of ['dark', 'light', 'dark', 'light']) {
      settings.previewAppearance({ ...settings.preferences.value.appearance, theme });
      await new Promise(resolve => setTimeout(resolve, 35));
    }
  });
  await page.waitForTimeout(320);
  await ink('.app-sidebar', 'dark');
  await page.evaluate(async () => { const { useSettings } = await import('/src/settings/index.ts'); useSettings().previewAppearance(null); });
  await page.evaluate(async () => {
    for (const theme of ['dark', 'light', 'dark', 'light']) {
      document.documentElement.dataset.theme = theme;
      // Force style calculation, then return before the next full frame. The
      // final theme name can match the previous cache despite real transitions.
      getComputedStyle(document.querySelector('.import-button')).backgroundColor;
      await new Promise(resolve => setTimeout(resolve, 6));
    }
  });
  await page.waitForTimeout(320);
  await ink('.app-sidebar,.app-topbar', 'dark');
  await page.waitForFunction(color => [...document.querySelectorAll('.app-sidebar .import-button,.app-topbar .sidebar-toggle')].every(element => getComputedStyle(element).color === color), INK_COLOR.dark);
  checks.push('Gray imagery: after settled and rapid dark/light round trips every glass bar and its controls end on the current theme\'s ink, including controls whose material colors are still transitioning on the first frame.');

  await page.evaluate(async uploaded => {
    const { useSettings } = await import('/src/settings/index.ts');
    const settings = useSettings();
    const decode = window.createImageBitmap.bind(window);
    window.__originalContrastDecode = window.createImageBitmap;
    let request = 0;
    window.createImageBitmap = async (...args) => {
      const current = ++request;
      const bitmap = await decode(...args);
      if (current === 1) await new Promise(resolve => setTimeout(resolve, 180));
      return bitmap;
    };
    settings.previewAppearance({ ...settings.preferences.value.appearance, theme: 'dark', glassTransparency: 83, background: uploaded.white });
    await new Promise(resolve => requestAnimationFrame(resolve));
    settings.previewAppearance({ ...settings.preferences.value.appearance, theme: 'light', glassTransparency: 83, background: uploaded.black });
  }, uploaded);
  await inkByRole('.app-sidebar,.app-topbar,.library-heading,.library-search,.library-summary,.document-card', 'light', 'light');
  await page.waitForTimeout(260);
  await inkByRole('.app-sidebar,.app-topbar,.library-heading,.library-search,.library-summary,.document-card', 'light', 'light');
  await page.evaluate(async () => {
    window.createImageBitmap = window.__originalContrastDecode;
    delete window.__originalContrastDecode;
    const { useSettings } = await import('/src/settings/index.ts');
    useSettings().previewAppearance(null);
  });
  checks.push('A delayed old image decode cannot overwrite the current wallpaper foreground after a simultaneous background and theme change.');

  await appearance({ theme: 'light', glassTransparency: 83 });
  await upload(Buffer.from(fixtures.split, 'base64'), '左黑右白底板.png');
  await ink('.app-sidebar', 'dark'); await glassReadable('.app-sidebar', 'black');
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
  await ink('.app-sidebar', 'dark'); await ink('.library-heading', 'light');
  await page.setViewportSize({ width: 1000, height: 720 }); await paint();
  await ink('.app-sidebar', 'dark');
  await ink('.library-heading', 'light');
  await page.setViewportSize({ width: 1440, height: 940 }); await paint();
  await ink('.app-sidebar', 'dark'); await ink('.library-heading', 'light'); await glassReadable('.app-sidebar', 'black');
  checks.push('Black-left/white-right imagery: the bare title uses its actual local region, glass over the black half stays light-theme glass made dense enough to read; mapping stays correct after resizing and collapsing/reopening the sidebar.');

  await appearance({ theme: 'dark', glassTransparency: 83 });
  await page.getByRole('button', { name: '打开 阅读工作台指南.md', exact: true }).click();
  await page.locator('.markdown-paper').waitFor(); await settled();
  // Every tab takes the top bar's ink, so an unselected tab can't drift to a different colour.
  await page.waitForFunction(() => document.querySelector('.app-topbar')?.hasAttribute('data-glass-ink'));
  const topbarInk = await page.locator('.app-topbar').evaluate(element => { const probe = document.createElement('span'); probe.style.color = 'var(--control-ink)'; element.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
  const tabColors = await page.locator('.file-tab [role="tab"] > span').evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
  assert.ok(tabColors.length && tabColors.every(color => color === topbarInk), `Tabs use the top bar's foreground ${topbarInk}: ${tabColors}`);
  const selectedTabColor = await page.locator('.file-tab [role="tab"] > span').first().evaluate(element => getComputedStyle(element).color);
  await page.locator('.file-tab').first().hover(); await paint();
  assert.equal(await page.locator('.file-tab [role="tab"] > span').first().evaluate(element => getComputedStyle(element).color), selectedTabColor, 'Hovering a folder tab must preserve its locally compensated foreground.');
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await page.locator('.ai-pane').waitFor(); await settled();
  // The assistant is glass like the sidebar: in the dark theme it stays dark glass with light text, even over the white half.
  await ink('.ai-pane', 'light'); await glassReadable('.ai-pane', 'white');
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
  await page.locator('.ai-pane .answer-code').waitFor();
  // Questions follow the pane's adapted ink; code blocks are solid and keep the theme's.
  // The title sits on the header's own bar, so compare with the pane body's ink.
  const paneInk = await page.locator('.ai-pane').evaluate(element => { const probe = document.createElement('span'); probe.style.color = 'var(--ink)'; element.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
  assert.equal(await page.locator('.ai-pane .user-question').evaluate(element => getComputedStyle(element).color), paneInk);
  await themeText('.ai-pane .answer-code');
  await themeText('.markdown-paper');
  await themeText('.reader-pane:not([style*="display: none"]) .reading-pill .pill-page');
  await openSettings();
  assert.equal(await dialog().getAttribute('data-glass-ink'), null, 'Tea/frosted popups are excluded from photo foreground adaptation.');
  // Save is the dialog's tinted primary action: fixed accent foreground, never wallpaper-adapted.
  await themeText('.settings-footer .settings-save', '--accent-on');
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
  await shot('开智-玻璃文字对比度-阅读-深色.png');
  checks.push('In the dark theme the glass AI pane over the white image stays dark glass with light text at 4.5:1; the solid reading pill, code, Markdown and excluded tea popups retain their own theme foregrounds.');

  const writesBefore = await page.evaluate(() => window.__backgroundWriteCount);
  for (const theme of ['light', 'dark']) {
    await appearance({ theme, glassTransparency: 0 });
    await noAdaptation();
    await page.waitForFunction(color => getComputedStyle(document.querySelector('.app-sidebar .brand')).color === color, theme === 'light' ? 'rgb(22, 26, 32)' : 'rgb(242, 244, 247)');
    const color = await page.locator('.app-sidebar .brand').evaluate(element => getComputedStyle(element).color);
    assert.equal(color, theme === 'light' ? 'rgb(22, 26, 32)' : 'rgb(242, 244, 247)', 'Opaque glass follows the theme, regardless of image colors.');
    await appearance({ glassTransparency: 83 });
    await ink('.app-sidebar,.ai-pane', themeInk(theme));
  }
  assert.equal(await page.evaluate(() => window.__backgroundWriteCount), writesBefore, 'Theme and transparency changes must not rewrite the large wallpaper CSS payload.');
  checks.push('0% returns theme-colored opaque glass; returning to 83% restores local compensation without rewriting cached image pixels.');

  await page.evaluate(() => { document.documentElement.dataset.contrast = 'high'; });
  await noAdaptation();
  await page.evaluate(() => { delete document.documentElement.dataset.contrast; });
  await ink('.app-sidebar,.ai-pane', 'light');
  const media = await context.newCDPSession(page);
  await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await noAdaptation();
  await media.send('Emulation.setEmulatedMedia', { features: [] });
  await ink('.app-sidebar,.ai-pane', 'light');
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
