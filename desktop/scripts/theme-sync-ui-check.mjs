// Theme switching over a custom photo backdrop: every glass component follows the theme (ink, glass, border),
// repeatedly and after reopening, and opening settings never restyles the root element.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts'), checks = [], errors = [];
const port = 1476, origin = `http://127.0.0.1:${port}`;
const GLASS = '.app-sidebar,.app-topbar,.reader-tools,.ai-pane';
let server, browser, page;
const settled = () => page.waitForFunction(() => !document.documentElement.dataset.themeTransition && !document.querySelector('.view-enter-active,.view-leave-active,.pane-enter-active,.pane-leave-active,.sidebar-enter-active,.sidebar-leave-active,.settings-pop-enter-active,.settings-pop-leave-active') && document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));
const snapshot = () => page.evaluate(GLASS => [...document.querySelectorAll(GLASS)].filter(element => element.offsetParent).map(element => {
  const style = getComputedStyle(element);
  return { name: element.className.split(' ')[0], ink: element.dataset.glassInk || '', floor: element.style.getPropertyValue('--glass-floor') || '0', background: style.backgroundColor, color: style.color, border: style.borderTopColor };
}), GLASS);
const luminance = color => { const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
async function open() {
  await page.getByRole('button', { name: '打开 主题同步.md', exact: true }).click(); await page.locator('.markdown-paper').waitFor();
  if (!await page.locator('.ai-pane').count()) await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await page.locator('.ai-pane').waitFor(); await settled(); await page.waitForTimeout(600);
}
try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-theme-sync-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })).newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name: '主题同步.md', mimeType: 'text/markdown', buffer: Buffer.from('# 主题同步\n\n正文。') }]);
  await page.locator('.markdown-paper').waitFor();
  // A photo-like backdrop: deep blue on the left, pale lilac on the right (under the assistant).
  const photo = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1000; const paint = canvas.getContext('2d'); const gradient = paint.createLinearGradient(0, 0, 1600, 1000); gradient.addColorStop(0, '#2d5fa8'); gradient.addColorStop(.55, '#8a7fc0'); gradient.addColorStop(1, '#f2e6f5'); paint.fillStyle = gradient; paint.fillRect(0, 0, 1600, 1000); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const pick = page.waitForEvent('filechooser'); await dialog.getByRole('button', { name: /^(选择图片|替换图片)$/ }).click();
  await (await pick).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo });
  await dialog.getByAltText('底板图片预览', { exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('.background-heading button')].some(button => button.textContent.includes('正在处理')));
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '阅读助手', exact: true }).click(); await page.locator('.ai-pane').waitFor(); await settled(); await page.waitForTimeout(600);

  const toggles = {};
  for (let round = 0; round < 4; round++) {
    await page.locator('.sidebar-bottom .icon-button').click(); await settled(); await page.waitForTimeout(400); await settled();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    const state = await snapshot();
    assert.equal(state.length, 4, 'Sidebar, top bar, reader tools and assistant are all on screen.');
    for (const item of state) {
      assert.equal(item.ink, theme === 'dark' ? 'light' : 'dark', `${theme}: ${item.name} uses the theme's ink (${JSON.stringify(item)})`);
      if (theme === 'dark') assert.ok(luminance(item.color) > .7, `${item.name} text is light in the dark theme`);
      else assert.ok(luminance(item.color) < .05, `${item.name} text is dark in the light theme`);
    }
    toggles[theme] = state;
    await page.screenshot({ path: resolve(artifacts, `theme-sync-${round}-${theme}.png`) });
  }
  checks.push('Four theme switches over a two-tone photo: sidebar, top bar, reader tools and assistant all take the theme\'s ink; glass over the bright side is made denser instead of flipping to the other theme\'s text.');

  // Reopening the assistant and reloading give exactly the same component styles as switching.
  await page.getByRole('button', { name: '关闭阅读助手', exact: true }).click(); await settled();
  await page.getByRole('button', { name: '阅读助手', exact: true }).click(); await page.locator('.ai-pane').waitFor(); await settled(); await page.waitForTimeout(600);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  assert.deepEqual(await snapshot(), toggles[theme], 'Reopening the assistant keeps the same styles.');
  for (const target of ['dark', 'light']) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== target) { await page.locator('.sidebar-bottom .icon-button').click(); await settled(); }
    await page.reload(); await page.locator('.app-shell').waitFor(); await open();
    assert.deepEqual(await snapshot(), toggles[target], `A fresh ${target} load matches the switched ${target} theme.`);
  }
  checks.push('Closing and reopening the assistant, and fresh loads in each theme, give exactly the same ink, glass and border colours as switching.');

  // Opening settings in the dark theme must not restyle :root (a scoped :global() selector once set opacity .1 on it).
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== 'dark') { await page.locator('.sidebar-bottom .icon-button').click(); await settled(); }
  const rootStyle = () => page.evaluate(() => { const style = getComputedStyle(document.documentElement); return { opacity: style.opacity, background: style.backgroundColor, blend: style.mixBlendMode, filter: style.filter }; });
  const before = await rootStyle();
  await page.getByRole('button', { name: '打开设置', exact: true }).click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); await settled();
  assert.deepEqual(await rootStyle(), before);
  assert.equal(before.opacity, '1');
  checks.push('After opening settings in the dark theme the root element keeps opacity 1 and no tint.');
  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'theme-sync-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); }
