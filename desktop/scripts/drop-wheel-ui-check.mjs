// Real browser File/DragEvent/WheelEvent interactions on isolated IndexedDB.
// The fixtures and server stay local; desktop user data and AI are untouched.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const port = Number(process.env.PHYDOG_DROP_WHEEL_PORT || 1485);
const origin = `http://127.0.0.1:${port}`, artifacts = resolve('artifacts');
const names = ['拖入滚轮-A.pdf', '拖入滚轮-B.PDF', '拖入滚轮-C.markdown'];
const fixtures = [
  { name: names[0], type: 'application/pdf', data: samplePdf(12, false, true, { lines: { 1: ['Local drop and wheel fixture A'], 2: ['Page two scrolling'], 12: ['Final page'] } }).toString('base64') },
  { name: names[1], type: 'application/pdf', data: samplePdf(4, false, true, { lines: { 1: ['Local drop and wheel fixture B'] } }).toString('base64') },
  { name: names[2], type: 'text/markdown', data: Buffer.from(`# ${names[2]}\n\n本地拖入文件回归。\n\n` + '可保存的文档原文。\n\n'.repeat(120)).toString('base64') },
  { name: '拖入滚轮-坏格式.pdf', type: 'application/pdf', data: Buffer.from('This file is not a PDF.').toString('base64') },
  { name: '拖入滚轮-忽略.txt', type: 'text/plain', data: Buffer.from('Unsupported local text fixture.').toString('base64') },
];
const checks = [], errors = [], remoteRequests = [];
let server, browser, context, page, passed = false;
async function until(condition, message = 'Local UI condition timed out.') {
  for (let i = 0; i < 220; i++) { if (await condition()) return; await new Promise(done => setTimeout(done, 75)); }
  throw new Error(message);
}
async function documents() { return page.evaluate(async () => { const { library } = await import('/src/sdk/index.ts'); return library.list(); }); }
async function storedPreferences() { return page.evaluate(async () => { const { library } = await import('/src/sdk/index.ts'); const stored = await library.getSetting('app.preferences.v1'); return stored ? JSON.parse(stored) : null; }); }
async function drag(indices, { leave = false, textOnly = false } = {}) {
  return page.evaluate(({ indices, leave, textOnly }) => {
    const transfer = new DataTransfer();
    if (textOnly) transfer.setData('text/uri-list', 'https://example.invalid/document.pdf');
    else for (const index of indices) transfer.items.add(window.__dropWheelFiles[index]);
    const target = document.querySelector('.app-shell');
    const emit = type => { const event = new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: 540, clientY: 220 }); target.dispatchEvent(event); return event.defaultPrevented; };
    emit('dragenter'); const overPrevented = emit('dragover');
    const finalPrevented = emit(leave ? 'dragleave' : 'drop');
    return { overPrevented, finalPrevented };
  }, { indices, leave, textOnly });
}
const pdf = () => page.locator('.pdf-scroll:visible');
const zoom = () => page.locator('.reader-tools:visible .reader-zoom [title="适应宽度"]').innerText();
async function readyPdf() {
  await page.locator('.pdf-scroll:visible .page-slot.page-ready').first().waitFor();
  await page.waitForFunction(() => {
    const visible = element => element?.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const scroll = [...document.querySelectorAll('.pdf-scroll')].find(visible);
    const ready = scroll?.querySelector('.page-ready:not(.pdf-preview) .pdf-canvas');
    return visible(ready) && !document.querySelector('.reader-overlay,.pane-enter-active,.pane-leave-active,.view-enter-active,.sidebar-enter-active,.sidebar-leave-active') && !scroll.style.width;
  });
}
async function openPdf(index = 0) {
  const tab = page.getByRole('tab', { name: names[index], exact: true });
  if (await tab.count()) await tab.click();
  else await page.getByRole('button', { name: `打开 ${names[index]}`, exact: true }).click();
  await readyPdf();
}
async function physicalWheel(deltaY, modifier = null, target = pdf()) {
  const box = await target.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 160));
  if (modifier) await page.keyboard.down(modifier);
  try { await page.mouse.wheel(0, deltaY); }
  finally { if (modifier) await page.keyboard.up(modifier); }
}
async function syntheticWheel(target, modifiers = {}) {
  return target.evaluate((element, modifiers) => {
    const event = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true, ...modifiers });
    element.dispatchEvent(event); return event.defaultPrevented;
  }, modifiers);
}
const dialog = () => page.getByRole('dialog', { name: '设置', exact: true });
async function openShortcuts() {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await dialog().getByRole('button', { name: '快捷键', exact: true }).click();
}
async function save() { await dialog().getByRole('button', { name: '保存', exact: true }).click(); await dialog().waitFor({ state: 'detached' }); }
async function recordWheel(label, delta) {
  const input = dialog().getByRole('textbox', { name: `${label}快捷键`, exact: true });
  await input.click(); await physicalWheel(delta, 'Alt', input);
  await until(() => input.inputValue().then(value => value.includes('Alt') && value.includes(delta < 0 ? '滚轮向上' : '滚轮向下')));
}
try {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ cacheDir: resolve(artifacts, 'vite-drop-wheel-ui'), optimizeDeps: { include: ['@tauri-apps/api/webview'] }, server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin); await page.locator('.library-heading').waitFor();
  const initial = await documents();
  await page.evaluate(fixtures => {
    window.__dropWheelFiles = fixtures.map(({ name, type, data }) => new File([Uint8Array.from(atob(data), letter => letter.charCodeAt(0))], name, { type, lastModified: 1700000000000 }));
  }, fixtures);
  const cancelled = await drag([0], { leave: true }); assert.equal(cancelled.overPrevented, true);
  await page.waitForTimeout(150); assert.equal((await documents()).length, initial.length);
  const textDrag = await drag([], { textOnly: true }); assert.equal(textDrag.overPrevented, false);
  assert.equal((await documents()).length, initial.length);
  checks.push('Cancelling a file drag adds nothing; dragging a URL is not treated as a local document or intercepted.');

  const imported = await drag([0, 1, 2, 0]); assert.equal(imported.overPrevented, true); assert.equal(imported.finalPrevented, true);
  await until(async () => (await documents()).length === initial.length + 3, 'Mixed PDF/Markdown drop did not add exactly three unique documents.');
  const first = (await documents()).filter(doc => names.includes(doc.name));
  assert.equal(new Set(first.map(doc => doc.id)).size, 3); assert.equal(first.find(doc => doc.name === names[1]).kind, 'pdf');
  await page.getByRole('tab', { name: names[0], exact: true }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 3);
  await readyPdf();
  checks.push('One native browser drop adds multiple PDF/Markdown documents, recognizes uppercase extensions and deduplicates a repeated file within the batch.');
  const repeated = await drag([0, 1, 2]); assert.equal(repeated.finalPrevented, true);
  await page.waitForTimeout(400);
  assert.deepEqual((await documents()).filter(doc => names.includes(doc.name)).map(doc => doc.id).sort(), first.map(doc => doc.id).sort());
  assert.equal(await page.getByRole('tab').count(), 3);
  checks.push('Dropping the same files again while reading reuses document identities and tabs.');

  await drag([3]);
  await page.locator('.toast-message').filter({ hasText: /PDF/ }).waitFor();
  assert.equal((await documents()).some(doc => doc.name === fixtures[3].name), false);
  await drag([4]); await page.waitForTimeout(250);
  assert.equal((await documents()).some(doc => doc.name === fixtures[4].name), false);
  assert.equal((await documents()).length, initial.length + 3); assert.equal(await page.getByRole('tab').count(), 3);
  checks.push('Invalid PDF bytes and unsupported text files are not imported or opened; existing documents remain available.');

  await openPdf(0); const baselineZoom = await zoom();
  const beforeScroll = await pdf().evaluate(element => element.scrollTop);
  await physicalWheel(220); await until(() => pdf().evaluate(element => element.scrollTop).then(top => top > beforeScroll));
  assert.equal(await zoom(), baselineZoom);
  await physicalWheel(-120, 'Control'); await until(() => zoom().then(value => value !== baselineZoom)); await readyPdf();
  const bigger = await zoom(); assert.ok(parseFloat(bigger) > parseFloat(baselineZoom));
  await physicalWheel(120, 'Control'); await until(() => zoom().then(value => value !== bigger)); await readyPdf();
  assert.equal(await zoom(), baselineZoom);
  assert.equal(await page.evaluate(() => visualViewport.scale), 1);
  checks.push('Real ordinary wheel events scroll PDF without zoom; Ctrl + wheel up/down changes PDF scale without zooming the browser.');

  const currentZoom = await zoom();
  for (const target of [page.locator('.app-topbar'), page.locator('.app-sidebar'), page.getByLabel('页码', { exact: true })]) {
    assert.equal(await syntheticWheel(target, { ctrlKey: true }), false);
  }
  assert.equal(await zoom(), currentZoom);
  await openShortcuts();
  assert.equal(await syntheticWheel(dialog().locator('.settings-content'), { ctrlKey: true }), false);
  await recordWheel('放大', -120); await recordWheel('缩小', 120); await save(); await readyPdf();
  const stored = await storedPreferences(); assert.equal(stored.shortcuts.zoomIn, 'Alt+WheelUp'); assert.equal(stored.shortcuts.zoomOut, 'Alt+WheelDown');
  const customZoom = await zoom(); assert.equal(await syntheticWheel(pdf(), { ctrlKey: true }), false); assert.equal(await zoom(), customZoom);
  await physicalWheel(-120, 'Alt'); await until(() => zoom().then(value => value !== customZoom)); await readyPdf();
  assert.ok(parseFloat(await zoom()) > parseFloat(customZoom));
  checks.push('Headers, navigation, editable fields and dialogs do not consume wheel; settings record real Alt + wheel combinations and the reader honors them.');

  await page.reload(); await page.locator('.library-heading').waitFor();
  assert.equal((await storedPreferences()).shortcuts.zoomIn, 'Alt+WheelUp');
  await openShortcuts();
  assert.equal(await dialog().getByRole('textbox', { name: '放大快捷键', exact: true }).inputValue(), 'Alt + 滚轮向上');
  assert.equal(await dialog().getByRole('textbox', { name: '缩小快捷键', exact: true }).inputValue(), 'Alt + 滚轮向下');
  await dialog().getByRole('button', { name: '恢复全部默认', exact: true }).click(); await save();
  assert.equal((await storedPreferences()).shortcuts.zoomIn, 'Ctrl+WheelUp'); assert.equal((await storedPreferences()).shortcuts.zoomOut, 'Ctrl+WheelDown');
  assert.equal(await syntheticWheel(page.locator('.library-heading'), { ctrlKey: true }), false);
  checks.push('Recorded wheel shortcuts persist across reload and can be restored to the Ctrl + wheel defaults; library scrolling is not consumed.');
  await openPdf(0); const restored = await zoom(); await physicalWheel(-120, 'Control'); await until(() => zoom().then(value => value !== restored)); await readyPdf();
  assert.ok(parseFloat(await zoom()) > parseFloat(restored));
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []); passed = true;
  await page.screenshot({ path: resolve(artifacts, '开智-拖入与滚轮验证.png'), animations: 'disabled' });
  console.log(JSON.stringify({ passed, checks, documentCount: initial.length + 3, errors, remoteRequests }, null, 2));
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'drop-wheel-ui-check.json'), JSON.stringify({ passed, checks, errors, remoteRequests }, null, 2));
  await browser?.close(); await server?.close();
}
