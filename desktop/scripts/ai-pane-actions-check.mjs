// Isolated UI checks with synthetic documents and local held SSE streams.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts'), checks = [], errors = [], remoteRequests = [];
const held = new Map(), sockets = new Set();
const names = ['按钮验证-A.md', '按钮验证-B.md', '按钮验证-C.md'];
const longModel = 'synthetic-model-with-a-very-long-name-for-minimum-window-layout-and-button-accessibility';
const event = value => `data: ${JSON.stringify(value)}\n\n`;
let server, browser, page, modelFailure;
const model = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    assert.equal(request.headers.authorization, 'Bearer actions-synthetic-key');
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const question = payload.input.findLast(item => item.role === 'user').content.find(item => item.type === 'input_text').text;
    const job = question.match(/ACTIONS_[ABC]/)?.[0]; assert.ok(job);
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    held.set(job, response);
    response.write(event({ type: 'response.output_text.delta', delta: `正在回答 ${job}。` }));
  } catch (error) { modelFailure = error; if (!response.headersSent) response.writeHead(500); response.end(); }
});
model.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(done => model.listen(0, '127.0.0.1', done));
const modelOrigin = `http://127.0.0.1:${model.address().port}`;
async function until(condition) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (modelFailure) throw modelFailure;
    if (await condition()) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('Local stream did not reach expected state.');
}
const pane = () => page.locator('.ai-pane:not(.pane-leave-active)');
const change = () => pane().getByRole('button', { name: '更改', exact: true });
const clear = () => pane().getByRole('button', { name: '清空对话', exact: true });
const prompt = () => pane().getByRole('textbox', { name: '向 AI 提问', exact: true });
const geometry = () => pane().evaluate(element => {
  const bounds = node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }; };
  const modelText = element.querySelector('.model-summary'), picker = element.querySelector('.model-picker'), summary = element.querySelector('.task-summary');
  return { pane: bounds(element), modelBar: bounds(element.querySelector('.model-bar')), headingCount: element.querySelectorAll('.ai-heading,h2,.heading-actions').length, composer: bounds(element.querySelector('.composer-actions')), change: bounds(element.querySelector('.model-change')), close: bounds(element.querySelector('.close-assistant')), summary: summary ? bounds(summary) : null, summaryText: summary?.textContent || '', clear: bounds(element.querySelector('.clear-conversation')), send: bounds(element.querySelector('.send-button')), picker: bounds(picker), pickerText: picker.textContent, shortcutHints: element.querySelectorAll('.composer-actions > span').length, model: bounds(modelText), modelEllipsis: getComputedStyle(modelText).textOverflow, modelOverflow: modelText.scrollWidth > modelText.clientWidth, changeFont: getComputedStyle(element.querySelector('.model-change')).fontSize, clearFont: getComputedStyle(element.querySelector('.clear-conversation')).fontSize, bodyOverflow: document.documentElement.scrollWidth > innerWidth };
});
async function assertLayout(label) {
  await page.mouse.move(5, 5); await page.waitForTimeout(200);
  const value = await geometry();
  assert.ok(value.change.height >= 36 && value.clear.height >= 36);
  assert.equal(value.headingCount, 0, 'There is no separate assistant title row.');
  assert.ok(value.close.width >= 32 && value.close.height >= 32);
  assert.ok(value.change.y >= value.modelBar.y && value.change.bottom <= value.modelBar.bottom && value.close.y >= value.modelBar.y && value.close.bottom <= value.modelBar.bottom, 'Settings and close remain in the single model row.');
  assert.ok(value.model.right <= (value.summary?.x ?? value.change.x) + 1 && value.change.right <= value.close.x + 1 && value.close.right <= value.modelBar.right + 1, 'Model summary, task count, settings and close do not overlap.');
  if (value.summary) assert.ok(value.summary.right <= value.change.x + 1 && value.summary.bottom <= value.modelBar.bottom);
  assert.ok(value.model.width > 60, 'Long model retains readable leading text at the minimum width.');
  assert.ok(parseFloat(value.changeFont) >= 12 && parseFloat(value.clearFont) >= 12);
  assert.ok(value.clear.right <= value.picker.x + 1 && value.picker.right <= value.send.x + 1, 'Clear, model picker and send occupy separate hit areas.');
  assert.ok(value.picker.width >= 60 && value.picker.height >= 32, 'The model picker keeps a usable hit area beside Send.');
  assert.equal(value.shortcutHints, 0, 'The Ctrl + Enter hint is not repeated beside Send; it lives in the tooltip.');
  assert.ok(value.send.right <= value.composer.right + 1 && value.send.bottom <= innerHeightOf(value), 'Send remains inside the visible composer.');
  assert.equal(value.modelEllipsis, 'ellipsis'); assert.equal(value.modelOverflow, true);
  assert.equal(value.bodyOverflow, false);
  checks.push({ label, ...value });
}
const innerHeightOf = value => value.pane.bottom + 1;
async function select(index) {
  await page.getByRole('tab', { name: names[index], exact: true }).click();
  await page.waitForFunction(name => document.querySelector('.markdown-paper')?.textContent?.includes(name), names[index]);
  await page.waitForFunction(() => !document.querySelector('.pane-enter-active,.pane-leave-active,.view-enter-active,.view-leave-active'));
}
async function ask(job) {
  await pane().getByRole('checkbox', { name: '当前页上下文与文档检索', exact: true }).uncheck();
  await prompt().fill(job);
  await pane().getByRole('button', { name: '发送 ↑', exact: true }).click();
  await until(() => held.has(job));
  assert.equal(await change().isDisabled(), true); assert.equal(await clear().isDisabled(), true);
}
function finish(job) {
  const response = held.get(job); assert.ok(response);
  response.end(event({ type: 'response.completed', response: { status: 'completed', output: [] } }));
}

try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ server: { host: '127.0.0.1', port: 1466, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/artifacts/**'] } } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1000, height: 680 }, deviceScaleFactor: 1, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:1466/') || url.startsWith(modelOrigin + '/')) return route.continue();
    remoteRequests.push(url); return route.abort();
  });
  await page.goto('http://127.0.0.1:1466');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles(names.map(name => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(`# ${name}\n\n这段合成文字用于检查选区按钮不会随对话操作一起扩大。\n\n## 阅读笔记\n\n记录问题与证据。`) })));
  await select(0);
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await prompt().waitFor();
  await page.waitForFunction(() => !document.querySelector('.pane-enter-active'));
  assert.equal(await clear().isDisabled(), true); assert.equal(await change().isEnabled(), true);
  await change().click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
  await dialog.getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog.getByLabel('API 地址', { exact: true }).fill(modelOrigin + '/v1');
  await dialog.getByLabel('API Key', { exact: true }).fill('actions-synthetic-key');
  await dialog.getByLabel('模型', { exact: true }).fill(longModel);
  await dialog.locator('summary').filter({ hasText: '多文件提问' }).click();
  await dialog.getByLabel('同时运行的提问', { exact: true }).fill('2');
  await dialog.getByLabel('最多等待的提问', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await assertLayout('1000×680, long model name, empty chat');
  assert.equal(await clear().isDisabled(), true);
  // Quick picker beside Send: changes only model / effort, closes with Esc and keeps the pane.
  const picker = pane().getByRole('button', { name: '选择模型与思考强度', exact: true });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('paperdesk.ai.settings.v1') || '{}'));
  const beforePick = await stored();
  await picker.click();
  const menu = pane().getByRole('dialog', { name: '模型与思考强度', exact: true });
  await menu.waitFor();
  await menu.getByRole('button', { name: '低', exact: true }).click();
  const afterPick = await stored();
  assert.equal(afterPick.effort, 'low');
  assert.deepEqual({ ...afterPick, effort: beforePick.effort }, beforePick, 'Only the effort changed in stored AI settings.');
  assert.equal(await menu.getByRole('button', { name: '低', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.match(await picker.innerText(), /低/);
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert.equal(await pane().count(), 1, 'Esc closes only the picker.');
  assert.equal(await picker.evaluate(element => document.activeElement === element), true, 'Focus returns to the picker.');
  checks.push({ label: 'Model picker beside Send stores only model / effort and closes with Esc', afterPick });

  // Recreate a cold Codex pane without visiting Settings. The native transport is
  // replaced in this disposable browser context; no real login is inspected.
  const apiSettings = await stored();
  await pane().getByRole('button', { name: '关闭阅读助手', exact: true }).click();
  await pane().waitFor({ state: 'detached' });
  await page.evaluate(async () => {
    const { registerNativeModelInventory } = await import('/src/ai/native-models.ts');
    registerNativeModelInventory([]);
    const value = JSON.parse(localStorage.getItem('paperdesk.ai.settings.v1'));
    localStorage.setItem('paperdesk.ai.settings.v1', JSON.stringify({ ...value, provider: 'codex', model: 'picker-native-5', effort: 'max' }));
    const ports = new Map(); let next = 0;
    window.__pickerDiscovery = {
      calls: [], pending: [], hold: false, failure: '', disconnected: 0,
      models: Array.from({ length: 7 }, (_, index) => ({ id: `picker-native-${index}`, name: `菜单测试模型 ${index}`, efforts: index === 5 ? ['low', 'high'] : ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', vision: true })),
    };
    window.__TAURI_INTERNALS__ = {
      transformCallback() { return ++next; }, unregisterCallback() {},
      async invoke(command, args) {
        if (command === 'get_credential') return '';
        if (command === 'native_connect') { ports.set(++next, args.channel); return next; }
        if (command === 'native_disconnect') { window.__pickerDiscovery.disconnected++; ports.delete(args.sessionId); return; }
        if (command !== 'native_send') throw new Error(`Unexpected mocked picker command: ${command}`);
        const channel = ports.get(args.sessionId), message = args.message, fixture = window.__pickerDiscovery;
        assertType(message.type);
        fixture.calls.push(message.type);
        // Native IPC serializes each response. Return a fresh inventory rather
        // than leaking the fixture's mutable array into Vue's shallow ref.
        const reply = fixture.failure ? { id: message.id, ok: false, error: fixture.failure } : { id: message.id, ok: true, result: message.type === 'status' ? { compatible: true, loggedIn: true, version: 'picker-local-test' } : structuredClone(fixture.models) };
        const deliver = () => channel.onmessage(reply);
        if (fixture.hold) fixture.pending.push(deliver); else queueMicrotask(deliver);
      },
    };
    function assertType(type) { if (!['status', 'models'].includes(type)) throw new Error(`Unexpected native request: ${type}`); }
  });
  await page.getByRole('button', { name: '阅读助手', exact: true }).click(); await prompt().waitFor();
  const codexBefore = await stored();
  const coldPicker = pane().getByRole('button', { name: '选择模型与思考强度', exact: true });
  await coldPicker.click();
  const nativeMenu = pane().getByRole('dialog', { name: '模型与思考强度', exact: true });
  await until(() => nativeMenu.locator('.menu-models button').count().then(count => count === 8));
  assert.deepEqual(await page.evaluate(() => window.__pickerDiscovery.calls), ['status', 'models']);
  assert.deepEqual(await stored(), codexBefore, 'Discovering models never rewrites saved configuration.');
  await nativeMenu.getByRole('button', { name: '菜单测试模型 5', exact: true }).click();
  const selectedNative = await stored();
  assert.equal(selectedNative.effort, 'high', 'Choosing a limited model normalizes an unsupported effort.');
  assert.deepEqual({ ...selectedNative, model: codexBefore.model, effort: codexBefore.effort }, codexBefore, 'Model choice preserves every unrelated field.');
  assert.deepEqual(await nativeMenu.locator('.menu-efforts button').allTextContents(), ['默认', '低', '高']);
  await page.evaluate(() => window.__pickerDiscovery.models.push({ id: 'picker-native-7', name: '新增菜单模型', efforts: ['low', 'high'], defaultEffort: 'low', vision: true }));
  await nativeMenu.getByRole('button', { name: '重新读取模型', exact: true }).click();
  await nativeMenu.getByRole('button', { name: '新增菜单模型', exact: true }).waitFor();
  assert.equal(await nativeMenu.locator('.menu-models button').count(), 9);
  assert.deepEqual(await stored(), selectedNative);
  await page.evaluate(() => { window.__pickerDiscovery.failure = 'PICKER_DISCOVERY_FAILURE'; });
  await nativeMenu.getByRole('button', { name: '重新读取模型', exact: true }).click();
  await nativeMenu.getByRole('status').filter({ hasText: 'PICKER_DISCOVERY_FAILURE' }).waitFor();
  assert.equal(await nativeMenu.locator('.menu-models button').count(), 9, 'A failed refresh keeps the known model inventory.');
  assert.deepEqual(await stored(), selectedNative);
  await page.evaluate(() => { window.__pickerDiscovery.failure = ''; window.__pickerDiscovery.hold = true; });
  const callsBeforeCancel = await page.evaluate(() => window.__pickerDiscovery.calls.length);
  const disconnectedBefore = await page.evaluate(() => window.__pickerDiscovery.disconnected);
  await nativeMenu.getByRole('button', { name: '重新读取模型', exact: true }).click();
  await until(() => page.evaluate(() => window.__pickerDiscovery.pending.length === 1));
  await page.keyboard.press('Escape'); await nativeMenu.waitFor({ state: 'detached' });
  await until(() => page.evaluate(value => window.__pickerDiscovery.disconnected > value, disconnectedBefore));
  await page.evaluate(() => { window.__pickerDiscovery.hold = false; for (const deliver of window.__pickerDiscovery.pending.splice(0)) deliver(); });
  await coldPicker.click(); await nativeMenu.waitFor();
  await page.waitForTimeout(120);
  assert.equal(await nativeMenu.locator('.menu-models button').count(), 9, 'A cancelled late reply cannot replace the current inventory.');
  assert.equal(await nativeMenu.getByRole('button', { name: '重新读取模型', exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.__pickerDiscovery.calls.length), callsBeforeCancel + 1, 'Cancelling status lookup prevents the subsequent models lookup.');
  assert.deepEqual(await stored(), selectedNative);
  await page.keyboard.press('Escape'); await nativeMenu.waitFor({ state: 'detached' });
  assert.equal(await coldPicker.evaluate(element => document.activeElement === element), true);
  checks.push({ label: 'Cold Codex picker discovers the full inventory without Settings; refresh adds models, failures preserve cache, Esc cancels native lookup and ignores late replies; only model/effort can change' });
  await pane().getByRole('button', { name: '关闭阅读助手', exact: true }).click(); await pane().waitFor({ state: 'detached' });
  await page.evaluate(value => { delete window.__TAURI_INTERNALS__; delete window.__pickerDiscovery; localStorage.setItem('paperdesk.ai.settings.v1', JSON.stringify(value)); }, apiSettings);
  await page.getByRole('button', { name: '阅读助手', exact: true }).click(); await prompt().waitFor();
  assert.deepEqual(await stored(), apiSettings, 'The original local API fixture is restored exactly.');
  await page.locator('.markdown-paper p').first().evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  const selectionClose = pane().locator('[data-tip="清除选区"]'); await selectionClose.waitFor();
  const selectionBounds = await selectionClose.boundingBox();
  assert.ok(selectionBounds.width < 24 && selectionBounds.height < 24, 'Selection × keeps its compact hit area.');
  await selectionClose.click();
  await ask('ACTIONS_A'); await assertLayout('First real local stream: change/clear disabled, stop visible');
  await select(1); assert.equal(await clear().isDisabled(), true); assert.equal(await change().isEnabled(), true);
  await ask('ACTIONS_B'); await assertLayout('Two real local streams: per-document disabled state, stop stays visible');
  await select(2);
  await pane().getByRole('checkbox', { name: '当前页上下文与文档检索', exact: true }).uncheck();
  await prompt().fill('ACTIONS_C');
  await pane().getByRole('button', { name: '发送 ↑', exact: true }).click();
  await pane().locator('.ai-status').filter({ hasText: '队列第 1 位' }).waitFor();
  assert.equal(held.has('ACTIONS_C'), false);
  await assertLayout('Two running plus one waiting: model/count/change/close stay in one row');
  assert.equal(await change().isDisabled(), true); assert.equal(await clear().isDisabled(), true);
  await page.locator('.toast-message').waitFor({ state: 'hidden' });
  await page.screenshot({ path: resolve(artifacts, 'ai-pane-actions-minimum-busy.png'), animations: 'disabled' });
  finish('ACTIONS_A'); await until(() => held.has('ACTIONS_C')); await select(0);
  await until(() => change().isEnabled()); assert.equal(await clear().isEnabled(), true);
  await assertLayout('Completed A while B runs: both actions usable for A');
  await page.screenshot({ path: resolve(artifacts, 'ai-pane-actions-minimum-light.png'), animations: 'disabled' });
  await page.locator('[data-tip="切换深色主题"]').click(); await page.waitForFunction(() => !document.documentElement.dataset.themeTransition);
  await page.screenshot({ path: resolve(artifacts, 'ai-pane-actions-minimum-dark.png'), animations: 'disabled' });
  await clear().click();
  assert.equal(await pane().locator('.ai-message').count(), 0); assert.equal(await clear().isDisabled(), true);
  assert.equal(await change().isEnabled(), true);
  await select(1); assert.equal(await change().isDisabled(), true); assert.equal(await clear().isDisabled(), true);
  await pane().getByRole('button', { name: '停止', exact: true }).click();
  await until(() => change().isEnabled()); assert.equal(await clear().isEnabled(), true);
  await clear().click(); assert.equal(await clear().isDisabled(), true);
  await select(2); finish('ACTIONS_C'); await until(() => change().isEnabled());
  await pane().getByRole('button', { name: '关闭阅读助手', exact: true }).click();
  await pane().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await prompt().waitFor(); await until(() => change().isEnabled());
  checks.push({ label: 'Selection × unchanged; empty / running / completed / stopped clear semantics and concurrent document isolation preserved', selectionBounds });
  checks.push({ label: 'Close button in the model row dismisses and reopens the assistant; no duplicate AI settings gear or message attachment thumbnail.' });
  assert.equal(await pane().locator('.ai-heading,.heading-actions,.attachment-image').count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  console.log(JSON.stringify({ passed: true, checks, errors, remoteRequests }, null, 2));
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'ai-pane-actions-check.json'), JSON.stringify({ checks, errors, remoteRequests }, null, 2));
  await browser?.close(); await server?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise(done => model.close(done));
}
