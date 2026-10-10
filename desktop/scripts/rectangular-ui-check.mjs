// Real interaction checks in an isolated browser library; no native user data or AI requests.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.PHYDOG_RECTANGULAR_UI_PORT || 1476);
const origin = `http://127.0.0.1:${port}`;
const artifacts = resolve('artifacts');
const checks = [], errors = [], remoteRequests = [], states = [];
let server, browser, page;
const settle = async () => {
  await page.waitForFunction(() => !document.querySelector('.view-enter-active,.view-leave-active,.pane-enter-active,.pane-leave-active,.sidebar-enter-active,.sidebar-leave-active,.outline-enter-active,.outline-leave-active,.settings-pop-enter-active,.settings-pop-leave-active'));
  await page.waitForTimeout(240);
};
const ready = () => page.waitForFunction(() => document.querySelector('#page-surface')?.classList.contains('page-ready') && !document.querySelector('#page-surface')?.classList.contains('pdf-preview'));
const dialog = () => page.getByRole('dialog', { name: '设置', exact: true });
const shot = name => page.screenshot({ path: resolve(artifacts, name), animations: 'disabled' });
const style = locator => locator.evaluate(element => {
  const css = getComputedStyle(element);
  return { color: css.color, background: css.backgroundColor, radius: [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomRightRadius, css.borderBottomLeftRadius] };
});
async function moveAway() { await page.mouse.move(1430, 930); await page.waitForTimeout(240); }
async function compareState(name, locator, select, deselect) {
  await moveAway();
  const before = await style(locator);
  await select(); await settle(); await moveAway();
  const selected = await style(locator);
  assert.equal(selected.color, before.color, `${name}: selecting preserves foreground.`);
  await locator.hover(); await page.waitForTimeout(240);
  const hover = await style(locator);
  assert.equal(hover.color, before.color, `${name}: selected hover preserves foreground.`);
  await moveAway();
  states.push({ name, before, selected, hover });
  if (deselect) { await deselect(); await settle(); }
}
async function rectangles(name, selectors) {
  const actual = await page.locator(selectors).evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0).map(element => {
    const css = getComputedStyle(element);
    return { name: element.className || element.tagName, radius: [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomRightRadius, css.borderBottomLeftRadius] };
  }));
  assert.ok(actual.length > 0, `${name}: visible components were examined.`);
  for (const item of actual) assert.ok(item.radius.every(value => parseFloat(value) === 0), `${name}: ${item.name} is rectangular (${item.radius}).`);
  checks.push(`${name}: ${actual.length} visible panels, controls and cards have square corners.`);
}
async function importEntry(name, payload) {
  const entries = page.getByRole('button', { name: /加入文档/ });
  assert.equal(await entries.count(), 1, `${name}: exactly one import entry is mounted.`);
  assert.equal(await page.getByRole('button', { name: /导入 PDF\s*\/\s*Markdown|^导入文档$/ }).count(), 0, `${name}: redundant import buttons are removed.`);
  const chooserPromise = page.waitForEvent('filechooser');
  await entries.click();
  const chooser = await chooserPromise;
  assert.equal(chooser.isMultiple(), true);
  await chooser.setFiles({ name: payload, mimeType: 'text/markdown', buffer: Buffer.from(`# ${payload}\n\nA local rectangular UI verification document.\n`) });
  await page.locator('.markdown-paper').waitFor(); await settle();
  assert.equal(await page.getByRole('tab', { name: payload, exact: true }).count(), 1);
  checks.push(`${name}: unique import control opens a multi-file picker and imports Markdown.`);
}

try {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/artifacts/**', '**/public/vendor/**'] } } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '打开 PDF 阅读示例.pdf', exact: true }).waitFor();
  await importEntry('Visible sidebar', 'Rectangular sidebar import.md');
  await page.getByRole('button', { name: '文档库', exact: true }).click(); await settle();

  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByTitle(theme === 'light' ? '切换浅色主题' : '切换深色主题', { exact: true }).first().click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme); await settle();
    const recent = page.locator('.workspace-nav button').filter({ hasText: '最近阅读' });
    await compareState(`${theme}: category`, recent, () => recent.click(), () => page.locator('.workspace-nav button').filter({ hasText: '全部文档' }).click());
    const list = page.getByTitle('列表视图', { exact: true });
    await page.getByTitle('卡片视图', { exact: true }).click(); await settle();
    await compareState(`${theme}: list layout`, list, () => list.click());
    const listState = states.at(-1);
    assert.notEqual(listState.before.background, listState.selected.background, `${theme}: selection has a visible background change.`);
    await rectangles(`${theme}: library`, '.app-sidebar,.app-topbar,.import-button,.library-search,.library-summary,.document-card,.document-cover,.view-switch,.view-switch button,.workspace-nav button,.format-pill,.heading-count');
    await shot(`rectangular-library-${theme}.png`);

    const libraryTab = page.getByRole('button', { name: '文档库', exact: true });
    const selectedLibraryColor = (await style(libraryTab)).color;
    await page.getByRole('button', { name: '打开 阅读工作台指南.md', exact: true }).click();
    await page.locator('.markdown-paper').waitFor(); await settle();
    assert.equal((await style(libraryTab)).color, selectedLibraryColor, `${theme}: library tab keeps its foreground when deselected.`);
    const markdownTab = page.getByRole('tab', { name: '阅读工作台指南.md', exact: true });
    const selectedTabColor = (await style(markdownTab)).color;
    const outline = page.locator('.markdown-reader .quiet-button').filter({ hasText: '目录' });
    if (await outline.count() === 0) throw new Error('Markdown outline control was not found.');
    if (await outline.evaluate(element => element.classList.contains('active'))) { await outline.click(); await settle(); }
    await compareState(`${theme}: Markdown outline`, outline, () => outline.click(), () => outline.click());
    const source = page.locator('.markdown-reader .quiet-button').filter({ hasText: /查看源码|阅读视图/ });
    await compareState(`${theme}: Markdown source`, source, () => source.click(), () => source.click());
    const star = page.getByTitle('收藏文档', { exact: true });
    await compareState(`${theme}: favorite control`, star, () => star.click(), () => star.click());
    const details = page.getByTitle('文档详情与标签', { exact: true });
    await compareState(`${theme}: details control`, details, () => details.click(), () => page.getByTitle('关闭文档详情', { exact: true }).click());
    const ai = page.getByRole('button', { name: '阅读助手', exact: true });
    await compareState(`${theme}: AI assistant`, ai, () => ai.click());
    await rectangles(`${theme}: reading and AI`, '.reader-tools,.reader-tools button,.reader-zoom,.document-outline,.ai-pane,.ai-pane button,.ai-pane textarea,.ai-composer,.model-bar,.ai-selection-context');
    const suggestion = page.getByRole('button', { name: '梳理核心观点', exact: true });
    const suggestionColor = (await style(suggestion)).color;
    await suggestion.hover(); await page.waitForTimeout(240);
    assert.equal((await style(suggestion)).color, suggestionColor, `${theme}: AI suggestion hover keeps text color.`);
    await suggestion.click();
    const send = page.getByRole('button', { name: '发送 ↑', exact: true });
    assert.equal(await send.isEnabled(), true);
    const sendColor = (await style(send)).color;
    assert.equal(sendColor, (await style(ai)).color, `${theme}: AI send and selected navigation share the neutral control color.`);
    await shot(`rectangular-reading-${theme}.png`);
    await page.getByRole('button', { name: '关闭阅读助手', exact: true }).click(); await settle();
    await libraryTab.click(); await settle();
    await page.getByRole('button', { name: '打开 PDF 阅读示例.pdf', exact: true }).click(); await ready(); await settle();
    assert.equal((await style(markdownTab)).color, selectedTabColor, `${theme}: file tab keeps foreground when inactive.`);
    await markdownTab.hover(); await page.waitForTimeout(240);
    assert.equal((await style(markdownTab)).color, selectedTabColor, `${theme}: file tab hover keeps foreground.`);
    const crop = page.locator('.crop-toggle');
    await compareState(`${theme}: PDF capture mode`, crop, () => crop.click(), () => crop.click());
    await rectangles(`${theme}: PDF controls`, '.reader-tools,.reader-tools button,.reader-page-control,.reader-page-control input,.reader-zoom');

    await page.getByRole('button', { name: '打开设置', exact: true }).click(); await dialog().waitFor(); await settle();
    const readingCategory = dialog().getByRole('button', { name: '阅读', exact: true });
    await compareState(`${theme}: settings category`, readingCategory, () => readingCategory.click(), () => dialog().getByRole('button', { name: '外观', exact: true }).click());
    const transparency = dialog().getByRole('slider', { name: '玻璃透明度', exact: true });
    const sliderColor = (await style(transparency)).color;
    await transparency.fill('83');
    assert.equal((await style(transparency)).color, sliderColor, `${theme}: transparency adjustment keeps the neutral foreground.`);
    await rectangles(`${theme}: settings`, '.settings-dialog,.dialog-header,.settings-tabs,.settings-tabs button,.settings-dialog select,.settings-dialog input:not([type=checkbox]):not([type=range]),.settings-dialog .transparency-control,.settings-dialog button,.settings-footer');
    await shot(`rectangular-settings-${theme}.png`);
    await dialog().getByRole('button', { name: 'AI', exact: true }).click(); await settle();
    await rectangles(`${theme}: AI settings`, '.ai-settings input:not([type=checkbox]),.ai-settings select,.ai-settings button');
    await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'detached' });
    await libraryTab.click(); await settle();
    checks.push(`${theme}: category, list, library/file tabs, Markdown/PDF modes, details, AI, settings category and glass selection preserve foreground including hover.`);
  }

  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await page.locator('.app-sidebar').waitFor({ state: 'detached' }); await settle();
  assert.equal(await page.getByRole('button', { name: /加入文档/ }).count(), 0, 'Collapsing the sidebar removes its import action without another toolbar entry.');
  const shortcutChooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await shortcutChooser).setFiles({ name: 'Rectangular shortcut import.md', mimeType: 'text/markdown', buffer: Buffer.from('# Keyboard import\n\nAvailable with the sidebar collapsed.\n') });
  await page.locator('.markdown-paper').waitFor(); await settle();
  checks.push('Collapsed sidebar shows no import button while Ctrl+O still opens its multi-file picker.');
  await page.setViewportSize({ width: 1000, height: 740 }); await settle();
  assert.ok(await page.locator('.app-topbar').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.equal(await page.getByRole('button', { name: /加入文档/ }).count(), 0);
  await shot('rectangular-reading-minimum.png');
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await page.locator('.app-sidebar').waitFor(); await settle();
  assert.equal(await page.getByRole('button', { name: /加入文档/ }).count(), 1);
  await importEntry('Reopened sidebar', 'Rectangular reopened import.md');
  await page.getByRole('button', { name: '文档库', exact: true }).click(); await settle();
  await shot('rectangular-library-minimum.png');
  checks.push('1000px window has no hidden-sidebar toolbar import or overflow; reopening restores the single sidebar action.');

  // Empty only this disposable browser library and verify its single entry still works.
  await page.evaluate(async () => { const { library } = await import('/src/sdk/index.ts'); for (const doc of await library.list()) await library.remove(doc.id); });
  await page.reload(); await page.locator('.library-empty h2').waitFor(); await settle();
  assert.equal(await page.locator('.library-empty h2').innerText(), '暂无文档');
  assert.equal(await page.locator('.library-empty button').count(), 0);
  await importEntry('Empty library', 'Rectangular empty import.md');
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  console.log(JSON.stringify({ passed: true, checks: checks.length, statePairs: states.length, errors, remoteRequests }));
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'rectangular-ui.json'), JSON.stringify({ checks, states, errors, remoteRequests }, null, 2));
  await browser?.close(); await server?.close();
}
