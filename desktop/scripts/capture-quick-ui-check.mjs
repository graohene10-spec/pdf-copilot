// Isolated browser storage, synthetic PDFs, real mouse crops and a loopback
// vision stream. Native preferences, user documents and remote AI are untouched.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const artifacts = resolve('artifacts');
const port = Number(process.env.PHYDOG_CAPTURE_QUICK_UI_PORT || 1487);
const origin = `http://127.0.0.1:${port}`;
const names = ['框选快捷验证-A.pdf', '框选快捷验证-B.pdf', '框选快捷验证-C.pdf'];
const labels = ['核查截图', '解释截图', '截图边界'];
const questions = ['CQ_FIRST 按自定义格式核查截图。\n逐项说明原图依据。', 'CQ_SECOND 解释框选图片中的概念和公式。', 'CQ_THIRD 分析这张截图中的前提与适用边界。'];
const checks = [], errors = [], externalRequests = [], calls = [], geometry = [];
const held = new Map(), sockets = new Set();
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const hash = value => createHash('sha256').update(value).digest('hex');
let vite, browser, context, page, ids, modelFailure, passed = false;

const model = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    assert.equal(request.headers.authorization, 'Bearer capture-quick-local-key');
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const user = payload.input.findLast(item => item.role === 'user');
    const text = user.content.find(item => item.type === 'input_text').text;
    const name = names.find(value => text.includes(value)); assert.ok(name, 'Document identity is captured before asynchronous preparation.');
    const question = questions.find(value => text.startsWith(value)); assert.ok(question, 'The custom prompt is sent verbatim.');
    const images = user.content.filter(item => item.type === 'input_image').map(item => item.image_url);
    assert.equal(images.length, 1, 'The current crop is sent exactly once.');
    assert.match(images[0], /^data:image\/png;base64,/);
    assert.equal(payload.input.flatMap(item => Array.isArray(item.content) ? item.content : []).filter(item => item.type === 'input_image').length, 1, 'Historical screenshots are not reattached.');
    calls.push({ name, question, images });
    assert.equal(held.has(name), false, 'One running request per document.');
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    response.write(event({ type: 'response.output_text.delta', delta: `本机截图回答 ${name}。` }));
    held.set(name, response);
  } catch (error) { modelFailure = error; if (!response.headersSent) response.writeHead(500); response.end(); }
});
model.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(done => model.listen(0, '127.0.0.1', done));
const modelOrigin = `http://127.0.0.1:${model.address().port}`;

const dialog = () => page.getByRole('dialog', { name: '设置', exact: true });
const quick = () => page.getByRole('dialog', { name: '框选快捷提问', exact: true });
const pane = () => page.locator('.ai-pane:visible');
const prompt = () => pane().getByRole('textbox', { name: '向 AI 提问', exact: true });
const preview = () => pane().locator('.ai-selection-context img');
const activeSurface = () => page.locator('.pdf-reader:visible #page-surface');
const shot = name => page.screenshot({ path: resolve(artifacts, name), animations: 'disabled' });
async function until(condition, label = 'Capture UI condition') {
  for (let index = 0; index < 220; index++) { if (modelFailure) throw modelFailure; if (await condition()) return; await new Promise(done => setTimeout(done, 70)); }
  throw new Error(`${label} timed out.`);
}
async function readyPdf() {
  await page.waitForFunction(() => {
    const surface = [...document.querySelectorAll('#page-surface')].find(item => item.closest('.pdf-reader')?.offsetParent !== null);
    return surface?.classList.contains('page-ready') && !surface.classList.contains('pdf-preview') && surface.querySelector('.pdf-canvas')?.width > 0 &&
      !document.querySelector('.pane-enter-active,.pane-leave-active,.sidebar-enter-active,.sidebar-leave-active,.view-enter-active') &&
      ![...document.querySelectorAll('.pdf-scroll')].some(item => item.offsetParent !== null && item.style.width);
  });
}
async function select(index) { await page.getByRole('tab', { name: names[index], exact: true }).click(); await readyPdf(); }
async function openAssistant() { if (!(await pane().count())) await page.getByRole('button', { name: '阅读助手', exact: true }).click(); await prompt().waitFor(); await readyPdf(); }
async function closeAssistant() { if (await pane().count()) await pane().getByRole('button', { name: '关闭阅读助手', exact: true }).click(); await pane().waitFor({ state: 'detached' }); await readyPdf(); }
async function aiSettings() {
  await page.getByRole('button', { name: '打开设置', exact: true }).click(); await dialog().waitFor();
  await dialog().getByRole('button', { name: 'AI', exact: true }).click();
  await dialog().getByLabel('PDF 框选后显示快捷提问', { exact: true }).waitFor();
}
async function saveSettings() { await dialog().getByRole('button', { name: '保存', exact: true }).click(); await dialog().waitFor({ state: 'detached' }); }
async function preferences() { return page.evaluate(async () => { const { library } = await import('/src/sdk/index.ts'); const value = await library.getSetting('app.preferences.v1'); return value ? JSON.parse(value) : null; }); }
async function configure(key, enable = true) {
  await aiSettings();
  await dialog().getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog().getByLabel('API 地址', { exact: true }).fill(`${modelOrigin}/v1`);
  await dialog().getByLabel('API Key', { exact: true }).fill(key);
  await dialog().getByLabel('模型', { exact: true }).fill('capture-quick-local-model');
  const limits = dialog().locator('summary').filter({ hasText: '多文件提问' });
  if (!(await limits.locator('..').getAttribute('open'))) await limits.click();
  await dialog().getByLabel('同时运行的提问', { exact: true }).fill('1');
  await dialog().getByLabel('其中 Codex 同时运行数', { exact: true }).fill('1');
  await dialog().getByLabel('最多等待的提问', { exact: true }).fill('1');
  await dialog().getByLabel('PDF 框选后显示快捷提问', { exact: true }).setChecked(enable);
  // The assistant's three suggestions and the capture bubbles are configured alike; extra default bubbles are removed.
  while (await dialog().getByRole('button', { name: '删除框选提问 4', exact: true }).count()) await dialog().getByRole('button', { name: '删除框选提问 4', exact: true }).click();
  for (let index = 0; index < 3; index++) {
    await dialog().getByLabel(`快捷提问 ${index + 1} 按钮介绍`, { exact: true }).fill(labels[index]);
    await dialog().getByLabel(`快捷提问 ${index + 1} 提示词`, { exact: true }).fill(questions[index]);
    await dialog().getByLabel(`框选提问 ${index + 1} 提问概括`, { exact: true }).fill(labels[index]);
    await dialog().getByLabel(`框选提问 ${index + 1} 提问内容`, { exact: true }).fill(questions[index]);
  }
  await saveSettings();
}
async function draft(index, value) {
  await select(index); await openAssistant();
  await prompt().fill(value); await pane().getByLabel('当前页上下文与文档检索', { exact: true }).uncheck();
  await closeAssistant();
}
async function crop(offset = 0, expectsQuick = true) {
  await readyPdf();
  const scale = await page.locator('.pdf-reader:visible .reader-zoom button[data-tip="适应宽度"]').innerText();
  const before = expectsQuick ? await page.screenshot({ animations: 'disabled' }) : null;
  await page.locator('[data-tip="框选公式或图表作为 AI 上下文"]').click();
  await activeSurface().locator('xpath=self::*[contains(@class,"capture-mode")]').waitFor();
  const bounds = await activeSurface().boundingBox(); assert.ok(bounds);
  const rectangle = { x: bounds.x + 35 + offset * 11, y: bounds.y + 45 + offset * 15, width: 152 + offset * 9, height: 88 + offset * 5 };
  const hit = await page.evaluate(point => { const element = document.elementFromPoint(point.x, point.y); return { tag: element?.tagName, class: element?.className, slot: element?.closest('.page-slot')?.id, bounds: element?.getBoundingClientRect().toJSON() }; }, rectangle);
  assert.equal(hit.slot, 'page-surface', `Mouse crop starts on the active PDF slot: ${JSON.stringify({ rectangle, bounds, hit })}`);
  await page.evaluate(() => {
    window.__captureQuickPointerTrace = [];
    const listener = event => { window.__captureQuickPointerTrace.push({ type: event.type, x: event.clientX, y: event.clientY, slot: event.target.closest?.('.page-slot')?.id, class: event.target.closest?.('.page-slot')?.className }); };
    window.__captureQuickPointerTraceDispose?.();
    for (const type of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(type, listener, true);
    window.__captureQuickPointerTraceDispose = () => { for (const type of ['pointerdown', 'pointerup', 'pointercancel']) document.removeEventListener(type, listener, true); };
  });
  await page.mouse.move(rectangle.x, rectangle.y); await page.mouse.down();
  await page.mouse.move(rectangle.x + rectangle.width, rectangle.y + rectangle.height, { steps: 6 }); await page.mouse.up();
  try { if (expectsQuick) await quick().waitFor(); else await preview().waitFor(); }
  catch (error) {
    console.error(JSON.stringify(await page.evaluate(() => ({ pointerEvents: window.__captureQuickPointerTrace, surfaces: [...document.querySelectorAll('#page-surface')].map(element => ({ class: element.className, rect: element.getBoundingClientRect().toJSON(), overlay: { hidden: element.querySelector('.selection-box')?.hidden, style: element.querySelector('.selection-box')?.getAttribute('style') } })), toast: document.querySelector('.toast')?.textContent })), null, 2));
    throw error;
  }
  await page.evaluate(() => window.__captureQuickPointerTraceDispose?.());
  return { rectangle, scale, before };
}
async function sampleScreenshot(buffer, samples) {
  return page.evaluate(async ({ png, samples }) => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`;
    await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const ratio = image.naturalWidth / innerWidth;
    return samples.map(point => {
      const colors = context.getImageData(Math.round(point.x * ratio) - 1, Math.round(point.y * ratio) - 1, 3, 3).data;
      return [0, 1, 2].map(channel => { let sum = 0; for (let index = channel; index < colors.length; index += 4) sum += colors[index]; return sum / (colors.length / 4); });
    });
  }, { png: buffer.toString('base64'), samples });
}
async function state(index) {
  return page.evaluate(async id => {
    const { chatState } = await import('/src/ai/workspace.ts'); const value = chatState(id);
    return { draft: value.draft, status: value.status, phase: value.request?.phase || '', images: value.messages.filter(item => item.role === 'user').map(item => item.images || []), users: value.messages.filter(item => item.role === 'user').length };
  }, ids[index]);
}
async function accepted() { await quick().waitFor({ state: 'detached' }); await prompt().waitFor(); await preview().waitFor({ state: 'detached' }); assert.equal(await pane().locator('.ai-message img').count(), 0); }
function finish(index) { const response = held.get(names[index]); assert.ok(response); held.delete(names[index]); response.end(event({ type: 'response.completed', response: { status: 'completed', output: [] } })); }
async function idle() { await until(() => page.evaluate(async () => { const { taskSummary } = await import('/src/ai/workspace.ts'); return taskSummary.running === 0 && taskSummary.queued === 0; }), 'All local requests finish'); }

try {
  await mkdir(artifacts, { recursive: true });
  vite = await createViteServer({ cacheDir: resolve(artifacts, 'vite-capture-quick-ui'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null } }); await vite.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin + '/') || route.request().url().startsWith(modelOrigin + '/')) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles(names.map((name, index) => ({ name, mimeType: 'application/pdf', buffer: samplePdf(3, false, false, { lines: { 1: [`Document ${index + 1} capture evidence`, 'Selectable ordinary text'], 2: ['Synthetic second page'], 3: ['Synthetic third page'] } }) })));
  await readyPdf();
  ids = await page.evaluate(async names => { const { library } = await import('/src/sdk/index.ts'); const docs = await library.list(); return names.map(name => docs.find(doc => doc.name === name).id); }, names);

  await aiSettings();
  assert.equal(await dialog().getByLabel('PDF 框选后显示快捷提问', { exact: true }).isChecked(), true);
  assert.deepEqual(await dialog().locator('.capture-question-editor input').evaluateAll(inputs => inputs.map(input => input.value)), ['为什么？', '详细展开', '通俗解释', '举个例子']);
  await dialog().getByLabel('PDF 框选后显示快捷提问', { exact: true }).uncheck();
  await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'detached' });
  assert.equal((await preferences())?.pdf?.quickAskOnCapture ?? true, true);
  await crop(0); assert.deepEqual((await quick().locator('.capture-quick-buttons button').allTextContents()).map(value => value.trim()), ['为什么？', '详细展开', '通俗解释', '举个例子']);
  assert.deepEqual(await quick().locator('.thought-key').allTextContents(), ['1', '2', '3', '4']);
  await page.keyboard.press('Escape'); await quick().waitFor({ state: 'detached' });
  checks.push('Capture focus is on by default with the short default questions and number keys; cancelling its settings keeps it on.');

  await configure('capture-quick-local-key');
  assert.equal((await preferences()).pdf.quickAskOnCapture, true);
  await page.reload(); await page.getByRole('button', { name: `打开 ${names[0]}`, exact: true }).click(); await readyPdf();
  assert.equal((await preferences()).pdf.quickAskOnCapture, true);
  // Browser credentials deliberately live only for the page session.
  // Restore the synthetic key through the normal form after the reload.
  await configure('capture-quick-local-key');
  // Reload returns to the library and retains only the actively opened tab.
  for (const name of names.slice(1)) { await page.getByRole('button', { name: '文档库', exact: true }).click(); await page.getByRole('button', { name: `打开 ${name}`, exact: true }).click(); await readyPdf(); }
  await draft(0, '保留的截图草稿 A');
  const first = await crop();
  assert.equal(await pane().count(), 0, 'Capture choices do not open the assistant.');
  assert.equal(await page.locator('.pdf-reader:visible .reader-zoom button[data-tip="适应宽度"]').innerText(), first.scale, 'No sidebar resize occurs at crop completion.');
  assert.deepEqual((await quick().locator('.capture-quick-buttons button').allTextContents()).map(value => value.trim()), labels);
  assert.equal(await quick().getByRole('button', { name: '继续到阅读助手', exact: true }).isVisible(), true);
  await page.waitForTimeout(650); // focus ring settles from its entrance scale
  const hole = await page.locator('.capture-quick-hole').boundingBox(); assert.ok(hole);
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(hole[key] - first.rectangle[key]) <= 3, `The undimmed hole follows the real mouse crop (${key}).`);
  const panel = await quick().locator('.capture-quick-actions').boundingBox();
  assert.ok(panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= 1440 && panel.y + panel.height <= 960, 'Quick actions stay inside the viewport.');
  const samples = [{ x: first.rectangle.x + first.rectangle.width / 2, y: first.rectangle.y + first.rectangle.height / 2 }, { x: first.rectangle.x + first.rectangle.width / 2, y: first.rectangle.y + first.rectangle.height + 64 }];
  const beforePixels = await sampleScreenshot(first.before, samples);
  const afterPixels = await sampleScreenshot(await page.screenshot({ animations: 'disabled' }), samples);
  assert.ok(afterPixels[0].every((value, index) => Math.abs(value - beforePixels[0][index]) <= 2), 'Pixels inside the selection hole remain unchanged.');
  assert.ok(beforePixels[1].reduce((sum, value) => sum + value, 0) / 3 - afterPixels[1].reduce((sum, value) => sum + value, 0) / 3 >= 30, 'PDF pixels beyond the feathered edge are visibly dimmed and blurred.');
  geometry.push({ crop: first.rectangle, hole, panel, devicePixelRatio: await page.evaluate(() => devicePixelRatio), samples, beforePixels, afterPixels });
  await shot('capture-quick-light.png');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await quick().isVisible(), true); await shot('capture-quick-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });
  await quick().getByRole('button', { name: labels[0], exact: true }).evaluate(button => { button.click(); button.click(); });
  await accepted(); await until(() => held.has(names[0]));
  assert.equal(calls.length, 1); assert.equal(calls[0].question, questions[0]);
  assert.equal(await prompt().inputValue(), '保留的截图草稿 A');
  assert.deepEqual((await state(0)).images.at(-1), calls[0].images);
  finish(0); await idle();
  checks.push('Saved settings survive reload; a real crop keeps the sidebar closed and scale stable, preserves its undimmed rectangle, shows custom labels, and rapid double-click sends one full image prompt without erasing the draft.');

  await pane().getByRole('button', { name: '新对话', exact: true }).click(); await prompt().fill('保留的截图草稿 A');
  await closeAssistant(); await crop(1);
  const countBeforeContinue = calls.length;
  await quick().getByRole('button', { name: '继续到阅读助手', exact: true }).click();
  await quick().waitFor({ state: 'detached' }); await preview().waitFor(); await readyPdf();
  const continuedImage = await preview().getAttribute('src');
  assert.equal(calls.length, countBeforeContinue); assert.equal(await prompt().inputValue(), '保留的截图草稿 A');
  await pane().getByRole('button', { name: labels[1], exact: true }).click(); await preview().waitFor({ state: 'detached' });
  await until(() => held.has(names[0])); assert.deepEqual(calls.at(-1).images, [continuedImage]);
  finish(0); await idle();
  checks.push('Continue opens the ordinary assistant with the exact unsent crop and existing draft; a later shortcut consumes and sends that crop once.');

  await closeAssistant();
  await page.getByRole('button', { name: '进入全屏', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement); await readyPdf();
  await crop(1); await page.keyboard.press('Escape'); await quick().waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), true);
  assert.equal(await page.locator('.selection-context').count(), 0); assert.equal(await pane().count(), 0);
  await page.getByRole('button', { name: '退出全屏', exact: true }).click(); await page.waitForFunction(() => !document.fullscreenElement); await readyPdf();
  const text = activeSurface().locator('.textLayer span').filter({ hasText: 'Selectable ordinary text' }).first();
  const textBox = await text.boundingBox(); assert.ok(textBox);
  await page.mouse.move(textBox.x + 2, textBox.y + textBox.height / 2); await page.mouse.down();
  await page.mouse.move(textBox.x + textBox.width - 2, textBox.y + textBox.height / 2, { steps: 7 }); await page.mouse.up();
  await until(() => page.evaluate(() => !!window.getSelection()?.toString().trim()), 'Real PDF text selection');
  assert.equal(await quick().count(), 0); assert.equal(await pane().count(), 0);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  checks.push('Escape cancels only the screenshot choice and leaves fullscreen active; ordinary text selection never opens screenshot choices or the sidebar.');

  await crop(2); await page.setViewportSize({ width: 1416, height: 936 });
  await quick().waitFor({ state: 'detached' }); await readyPdf();
  await openAssistant(); await preview().waitFor(); const resizedImage = await preview().getAttribute('src'); assert.match(resizedImage, /^data:image\/png/);
  await closeAssistant();
  await select(1); await crop(1); await page.setViewportSize({ width: 1440, height: 960 }); await quick().waitFor({ state: 'detached' });
  await openAssistant(); await preview().waitFor(); const otherImage = await preview().getAttribute('src'); await closeAssistant();
  await select(0); await crop(1);
  const raceCount = calls.length;
  await page.evaluate(({ label, name }) => {
    [...document.querySelectorAll('.capture-quick-actions button')].find(button => button.textContent.trim() === label).click();
    [...document.querySelectorAll('[role="tab"]')].find(tab => tab.getAttribute('aria-label') === name).click();
  }, { label: labels[0], name: names[1] });
  await quick().waitFor({ state: 'detached' }); await readyPdf();
  await until(async () => !(await state(0)).phase, 'Cancelled preparing screenshot request');
  assert.equal(calls.length, raceCount, 'Tab switching before acceptance cancels preparation.');
  await openAssistant(); await preview().waitFor(); assert.equal(await preview().getAttribute('src'), otherImage);
  await closeAssistant(); await select(0); await openAssistant(); await preview().waitFor();
  assert.notEqual(await preview().getAttribute('src'), otherImage);
  await pane().locator('[data-tip="清除选区"]').click(); await closeAssistant();
  checks.push('Resizing closes only the floating layer and keeps its crop available; switching tabs while preparing cancels the pending send and preserves the other file’s independent screenshot.');

  await draft(0, '队列草稿 A'); await crop(0); await quick().getByRole('button', { name: labels[0], exact: true }).click();
  await accepted(); await until(() => held.has(names[0]));
  await draft(1, '队列草稿 B'); await crop(1); await quick().getByRole('button', { name: labels[1], exact: true }).click();
  await accepted(); await until(async () => (await state(1)).phase === 'queued');
  const queueCount = calls.length;
  await draft(2, '队列草稿 C'); await crop(2); await quick().getByRole('button', { name: labels[2], exact: true }).click();
  await quick().locator('[role="status"]').filter({ hasText: '队列已满' }).waitFor();
  assert.equal(calls.length, queueCount); assert.equal(await pane().count(), 0);
  assert.equal((await state(2)).users, 0); assert.equal((await state(2)).draft, '队列草稿 C');
  assert.equal(await quick().getByRole('button', { name: labels[2], exact: true }).isEnabled(), true);
  await shot('capture-quick-queue-full.png');
  finish(0); await until(() => held.has(names[1]));
  assert.equal(await quick().isVisible(), true, 'Another file’s queue progress does not dismiss a rejected crop.');
  await quick().getByRole('button', { name: labels[2], exact: true }).click(); await accepted();
  await until(async () => (await state(2)).phase === 'queued');
  finish(1); await until(() => held.has(names[2])); finish(2); await idle();
  for (let index = 0; index < 3; index++) { assert.equal((await state(index)).draft, `队列草稿 ${String.fromCharCode(65 + index)}`); assert.deepEqual((await state(index)).images.at(-1), calls.findLast(call => call.name === names[index]).images); }
  checks.push('Cross-file screenshot actions share the existing concurrency queue; accepted queued crops disappear immediately, queue-full rejection preserves crop/draft and permits retry, and each eventual request retains its own image and document.');

  await select(0); await openAssistant(); await pane().getByRole('button', { name: '新对话', exact: true }).click(); await prompt().fill('队列草稿 A');
  await closeAssistant(); await configure(''); await crop(2);
  const missingCount = calls.length;
  await quick().getByRole('button', { name: labels[2], exact: true }).click(); await dialog().waitFor();
  await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'detached' });
  await quick().waitFor(); await quick().locator('[role="status"]').filter({ hasText: '请先连接 AI 服务' }).waitFor();
  assert.equal(calls.length, missingCount); assert.equal((await state(0)).draft, '队列草稿 A');
  await quick().getByRole('button', { name: '继续到阅读助手', exact: true }).click(); await preview().waitFor();
  const retryImage = await preview().getAttribute('src');
  await configure('capture-quick-local-key');
  await pane().getByRole('button', { name: labels[2], exact: true }).click(); await preview().waitFor({ state: 'detached' });
  await until(() => held.has(names[0])); assert.deepEqual(calls.at(-1).images, [retryImage]); finish(0); await idle();
  checks.push('Missing credentials open settings without consuming the crop; cancel returns to the choices, Continue retains the attachment, and configuring the local service later sends that exact image.');

  await closeAssistant(); await configure('capture-quick-local-key', false);
  await crop(0, false); assert.equal(await quick().count(), 0);
  assert.equal((await preferences()).pdf.quickAskOnCapture, false);
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); assert.equal(modelFailure, undefined);
  checks.push('Disabling the option restores the ordinary capture-to-assistant path without changing its saved custom questions.');
  passed = true;
  console.log(JSON.stringify({ passed, checks, requests: calls.length, errors, externalRequests }, null, 2));
} catch (error) {
  await shot('capture-quick-failure.png').catch(() => {});
  console.error(String(error?.stack || error)); process.exitCode = 1;
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'capture-quick-ui.json'), JSON.stringify({ passed, isolatedBrowser: true, loopbackVisionModel: true, checks, geometry, requests: calls.map(({ name, question, images }) => ({ name, question, imageCount: images.length, imageHashes: images.map(hash) })), errors, externalRequests, modelFailure: modelFailure && String(modelFailure) }, null, 2));
  await context?.close(); await browser?.close(); await vite?.close();
  for (const socket of sockets) socket.destroy(); await new Promise(done => model.close(done));
}
