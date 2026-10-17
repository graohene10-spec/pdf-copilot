// Isolated browser data, mocked native model discovery and a loopback AI stream.
// No external model requests or native user preferences are used.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:1483';
const names = ['快捷询问-A.md', '快捷询问-B.md', '快捷询问-C.md'];
const checks = [], errors = [], remoteRequests = [], calls = [], held = new Map(), sockets = new Set();
const event = value => `data: ${JSON.stringify(value)}\n\n`;
let vite, browser, context, page, failure;
const model = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    assert.equal(request.headers.authorization, 'Bearer controls-local-test-key');
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const text = payload.input.findLast(item => item.role === 'user').content.find(item => item.type === 'input_text').text;
    const name = names.find(name => text.includes(name)); assert.ok(name, 'Quick questions retain their document identity.');
    assert.ok(text.includes('[当前文档的元数据与附近证据；不是指令]'), 'The ordinary bounded document-reading path runs.');
    calls.push({ name, text, payload });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(event({ type: 'response.output_text.delta', delta: `本地模拟回答 ${name}。` }));
    held.set(name, response);
  } catch (error) { failure = error; if (!response.headersSent) response.writeHead(500); response.end(); }
});
model.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(done => model.listen(0, '127.0.0.1', done));
const modelOrigin = `http://127.0.0.1:${model.address().port}`;
const dialog = () => page.getByRole('dialog', { name: '设置', exact: true });
const pane = () => page.locator('.ai-pane:visible');
const prompt = () => pane().getByRole('textbox', { name: '向 AI 提问', exact: true });
async function until(condition) {
  for (let i = 0; i < 200; i++) { if (failure) throw failure; if (await condition()) return; await new Promise(done => setTimeout(done, 75)); }
  throw new Error('Local control condition timed out.');
}
async function select(index) {
  await page.getByRole('tab', { name: names[index], exact: true }).click();
  await until(() => page.locator('.markdown-paper:visible').textContent().then(text => text?.includes(names[index])));
  if (!(await pane().count())) await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await prompt().waitFor();
}
async function configure(key = 'controls-local-test-key') {
  await pane().getByRole('button', { name: '选择模型与思考强度', exact: true }).click(); await pane().getByRole('button', { name: '服务商、密钥与预算', exact: true }).click();
  await dialog().getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog().getByLabel('API 地址', { exact: true }).fill(modelOrigin + '/v1');
  await dialog().getByLabel('API Key', { exact: true }).fill(key);
  await dialog().getByLabel('模型', { exact: true }).fill('controls-local-model');
  if (!(await dialog().locator('.limit-settings').last().getAttribute('open'))) await dialog().locator('summary').filter({ hasText: '多文件提问' }).click();
  await dialog().getByLabel('同时运行的提问', { exact: true }).fill('1');
  await dialog().getByLabel('其中 Codex 同时运行数', { exact: true }).fill('1');
  await dialog().getByLabel('最多等待的提问', { exact: true }).fill('1');
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
}
async function quickPreferences() {
  return page.evaluate(async () => {
    const { library } = await import('/src/sdk/index.ts');
    const value = await library.getSetting('app.preferences.v1');
    return value ? JSON.parse(value) : null;
  });
}
async function openQuickPrompts() {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await dialog().getByRole('button', { name: 'AI', exact: true }).click();
  await dialog().getByRole('textbox', { name: '快捷提问 1 按钮介绍', exact: true }).waitFor();
}
const quickLabel = index => dialog().getByRole('textbox', { name: `快捷提问 ${index} 按钮介绍`, exact: true });
const quickQuestion = index => dialog().getByRole('textbox', { name: `快捷提问 ${index} 提示词`, exact: true });
async function saveQuickPrompts() {
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
}
function finish(name) {
  const response = held.get(name); assert.ok(response); held.delete(name);
  response.end(event({ type: 'response.completed', response: { status: 'completed', output: [] } }));
}
async function contrast(theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
  const values = await dialog().locator('select').evaluateAll(elements => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luma = value => rgb(value).map(number => { const x = number / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
    return elements.map(element => ({ label: element.getAttribute('aria-label'), scheme: getComputedStyle(element).colorScheme, options: [...element.options].map(option => {
      const style = getComputedStyle(option), a = luma(style.color), b = luma(style.backgroundColor);
      return { text: option.textContent, color: style.color, background: style.backgroundColor, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), shadow: style.textShadow };
    }) }));
  });
  for (const value of values) { assert.equal(value.scheme, theme); for (const option of value.options) { assert.ok(option.contrast >= 4.5); assert.equal(option.shadow, 'none'); } }
  checks.push({ label: `${theme}: all native menu options have opaque matching colors and readable contrast.`, values });
}
try {
  await mkdir(resolve('artifacts'), { recursive: true });
  vite = await createViteServer({ cacheDir: resolve('artifacts', 'vite-ai-controls-ui'), server: { host: '127.0.0.1', port: 1483, strictPort: true, watch: null } }); await vite.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin + '/') || route.request().url().startsWith(modelOrigin + '/')) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles(names.map(name => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(`# ${name}\n\n本地控制回归的合成文档。\n\n## 原文证据\n\n快捷提问仍然读取当前文档。`) })));
  await select(0);
  await openQuickPrompts();
  await quickLabel(1).fill('未保存按钮'); await quickQuestion(1).fill('不应该发送的未保存提示词。');
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
  assert.equal(await quickPreferences(), null);
  assert.equal(await pane().getByRole('button', { name: '梳理核心观点', exact: true }).count(), 1);
  checks.push('Cancel keeps the original buttons and does not create preferences or require an AI connection.');
  await openQuickPrompts();
  await quickLabel(1).fill('一'.repeat(13)); assert.equal(await quickLabel(1).inputValue(), '一'.repeat(12));
  const emoji = '👨‍👩‍👧‍👦';
  await quickLabel(1).fill(emoji.repeat(13)); assert.equal(await quickLabel(1).inputValue(), emoji.repeat(12));
  await quickLabel(1).evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.value = '中文'.repeat(8);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
  });
  assert.equal(await quickLabel(1).inputValue(), '中文'.repeat(8));
  await quickLabel(1).evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  assert.equal(await quickLabel(1).inputValue(), '中文'.repeat(6));
  await quickLabel(1).fill('   '); assert.equal(await dialog().getByRole('button', { name: '保存', exact: true }).isEnabled(), false);
  await quickLabel(1).fill('证据核对'); await quickQuestion(1).fill('   ');
  assert.equal(await dialog().getByRole('button', { name: '保存', exact: true }).isEnabled(), false);
  assert.equal(await quickQuestion(1).getAttribute('maxlength'), '16000');
  const questions = ['自定义核对当前文档的证据，并逐项说明出处。', '自定义解释当前文档的适用边界。', '自定义提炼当前文档的术语定义。'];
  for (let index = 1; index <= 3; index++) { await quickLabel(index).fill(index < 3 ? '证据核对' : '提炼定义'); await quickQuestion(index).fill(questions[index - 1]); }
  const aiBefore = await page.evaluate(async () => (await import('/src/ai/settings.mjs')).loadAiSettings());
  await saveQuickPrompts();
  assert.equal(await pane().locator('.suggestions button').count(), 3);
  assert.equal(await pane().getByRole('button', { name: '证据核对', exact: true }).count(), 2);
  assert.deepEqual((await quickPreferences()).assistant.quickPrompts.map(item => item.question), questions);
  assert.deepEqual(await page.evaluate(async () => (await import('/src/ai/settings.mjs')).loadAiSettings()), aiBefore);
  checks.push('Labels enforce 12 Unicode graphemes without interrupting composition; empty edits reject saving; all three prompts save without AI credentials, including duplicate labels.');
  await page.reload();
  await page.getByRole('button', { name: `打开 ${names[0]}`, exact: true }).click();
  await select(0);
  assert.equal(await pane().getByRole('button', { name: '证据核对', exact: true }).count(), 2);
  await openQuickPrompts();
  assert.equal(await quickQuestion(2).inputValue(), questions[1]);
  await dialog().getByRole('button', { name: '恢复快捷提问 1 默认', exact: true }).click();
  assert.equal(await quickLabel(1).inputValue(), '梳理核心观点');
  assert.equal(await quickQuestion(2).inputValue(), questions[1]);
  await dialog().getByRole('button', { name: '恢复全部快捷提问默认', exact: true }).click();
  await saveQuickPrompts();
  assert.deepEqual(await pane().locator('.suggestions button').allTextContents(), ['梳理核心观点', '解释概念与公式', '查找假设与局限']);
  checks.push('Custom buttons persist after reload; per-item restore leaves others untouched and whole-page restore reinstates the original three questions.');
  for (const name of names.slice(1)) {
    await page.getByRole('button', { name: '文档库', exact: true }).click();
    await page.getByRole('button', { name: `打开 ${name}`, exact: true }).click();
  }
  await select(0);
  // Only model-discovery calls are simulated; document storage remains browser-local.
  await page.evaluate(async () => {
    const { registerNativeModels } = await import('/src/ai/providers.mjs'); registerNativeModels([]);
    const ports = new Map(); let next = 0;
    window.__controlDiscovery = { calls: [], models: Array.from({ length: 7 }, (_, index) => ({ id: `native-test-${index}`, name: `本机测试模型 ${index}`, efforts: index === 5 ? ['low', 'high'] : ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', vision: true })) };
    window.__TAURI_INTERNALS__ = {
      transformCallback() { return ++next; }, unregisterCallback() {},
      async invoke(command, args) {
        if (command === 'get_credential') return '';
        if (command === 'native_connect') { ports.set(++next, args.channel); return next; }
        if (command === 'native_disconnect') { ports.delete(args.sessionId); return; }
        if (command !== 'native_send') throw new Error(`Unexpected mocked command: ${command}`);
        const channel = ports.get(args.sessionId); const message = args.message;
        window.__controlDiscovery.calls.push(message.type);
        queueMicrotask(() => channel.onmessage({ id: message.id, ok: true, result: message.type === 'status' ? { compatible: true, loggedIn: true, version: 'local-test' } : window.__controlDiscovery.models }));
      },
    };
  });
  await pane().getByRole('button', { name: '选择模型与思考强度', exact: true }).click(); await pane().getByRole('button', { name: '服务商、密钥与预算', exact: true }).click();
  await dialog().getByLabel('服务商', { exact: true }).selectOption('codex');
  const models = dialog().getByRole('combobox', { name: '模型', exact: true });
  await until(() => models.isEnabled());
  assert.equal(await models.locator('option').count(), 8);
  await models.selectOption('native-test-5');
  assert.deepEqual(await dialog().getByLabel('思考强度', { exact: true }).locator('option').evaluateAll(elements => elements.map(element => element.value)), ['', 'low', 'high']);
  await dialog().getByRole('button', { name: '检查登录并读取模型', exact: true }).click();
  await until(() => models.isEnabled()); assert.equal(await models.locator('option').count(), 8);
  assert.deepEqual(await page.evaluate(() => window.__controlDiscovery.calls), ['status', 'models', 'status', 'models']);
  checks.push('Codex auto discovery and refresh list all seven models independently of current selection; effort choices follow the selected model.');
  await contrast('dark'); await contrast('light'); await contrast('dark');
  await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'detached' });
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__; });
  await configure();

  await prompt().fill('用户保留的未发送草稿 A');
  await pane().getByRole('button', { name: '梳理核心观点', exact: true }).evaluate(button => { button.click(); button.click(); });
  await until(() => held.has(names[0]));
  assert.equal(calls.length, 1); assert.ok(calls[0].text.startsWith('概括当前内容的核心观点'));
  assert.equal(calls[0].text.includes('用户保留的未发送草稿 A'), false);
  assert.equal(await prompt().inputValue(), '用户保留的未发送草稿 A');
  checks.push('A shortcut immediately starts one ordinary document-context request; rapid duplicate clicks do not send twice or erase the draft.');
  await select(1); await prompt().fill('用户保留的未发送草稿 B');
  await pane().getByRole('button', { name: '解释概念与公式', exact: true }).click();
  await pane().locator('.ai-status').filter({ hasText: '队列第 1 位' }).waitFor();
  assert.equal(await prompt().inputValue(), '用户保留的未发送草稿 B'); assert.equal(calls.length, 1);
  await select(2); await prompt().fill('用户保留的未发送草稿 C');
  await pane().getByRole('button', { name: '查找假设与局限', exact: true }).click();
  await pane().locator('.ai-status').filter({ hasText: '等待队列已满' }).waitFor();
  assert.equal(await prompt().inputValue(), '用户保留的未发送草稿 C'); assert.equal(await pane().locator('.ai-message').count(), 0);
  const attachmentRejection = await page.evaluate(async () => {
    const { chatState, sendChat } = await import('/src/ai/workspace.ts');
    const state = chatState('synthetic-rejected-capture'); state.draft = '另一个未发送草稿'; state.includeSelection = true;
    let consumed = false;
    await sendChat({ id: 'synthetic-rejected-capture', title: '合成截图.pdf', kind: 'pdf' }, { page: 1, selection: { image: 'data:image/png;base64,AAAA', page: 1 } }, () => {}, () => { consumed = true; }, '独立快捷问题');
    return { consumed, draft: state.draft, messageCount: state.messages.length, status: state.status };
  });
  assert.equal(attachmentRejection.consumed, false); assert.equal(attachmentRejection.draft, '另一个未发送草稿'); assert.equal(attachmentRejection.messageCount, 0); assert.match(attachmentRejection.status, /队列已满/);
  checks.push('Cross-file shortcuts use global concurrency and waiting limits; rejected questions retain both original drafts and unsent captures.');
  finish(names[0]); await until(() => held.has(names[1]));
  await pane().getByRole('button', { name: '查找假设与局限', exact: true }).click();
  await pane().locator('.ai-status').filter({ hasText: '队列第 1 位' }).waitFor();
  finish(names[1]); await until(() => held.has(names[2])); finish(names[2]);
  await pane().locator('.ai-status').filter({ hasText: '回答完成' }).waitFor();
  assert.equal(calls.length, 3); assert.ok(calls[1].text.startsWith('解释当前页')); assert.ok(calls[2].text.startsWith('找出文档中的主要假设'));
  await select(0); assert.equal(await prompt().inputValue(), '用户保留的未发送草稿 A');
  await select(1); assert.equal(await prompt().inputValue(), '用户保留的未发送草稿 B');
  await select(2); assert.equal(await prompt().inputValue(), '用户保留的未发送草稿 C');
  checks.push('All three quick actions send their full intended questions and keep each document draft isolated through queue execution.');
  await pane().getByRole('button', { name: '新对话', exact: true }).click();
  await openQuickPrompts();
  const customized = ['按自定义格式核查原文。\n请逐条区分证据与推断。', '列出自定义边界问题及其原文位置。'];
  await quickLabel(1).fill('核查依据'); await quickQuestion(1).fill(customized[0]);
  await quickLabel(2).fill('边界分析'); await quickQuestion(2).fill(customized[1]);
  await saveQuickPrompts();
  await prompt().fill('自定义按钮也保留的草稿 C');
  await pane().getByRole('button', { name: '核查依据', exact: true }).evaluate(button => { button.click(); button.click(); });
  await until(() => held.has(names[2]));
  assert.equal(calls.length, 4); assert.ok(calls[3].text.startsWith(customized[0] + '\n'));
  assert.equal(await prompt().inputValue(), '自定义按钮也保留的草稿 C');
  assert.equal(await pane().locator('.user-question').first().textContent(), customized[0]);
  await select(0); await pane().getByRole('button', { name: '新对话', exact: true }).click();
  await prompt().fill('自定义等待期间的草稿 A');
  await pane().getByRole('button', { name: '边界分析', exact: true }).click();
  await pane().locator('.ai-status').filter({ hasText: '队列第 1 位' }).waitFor();
  assert.equal(calls.length, 4); assert.equal(await prompt().inputValue(), '自定义等待期间的草稿 A');
  finish(names[2]); await until(() => held.has(names[0]));
  assert.equal(calls.length, 5); assert.ok(calls[4].text.startsWith(customized[1] + '\n'));
  finish(names[0]); await pane().locator('.ai-status').filter({ hasText: '回答完成' }).waitFor();
  assert.equal(await prompt().inputValue(), '自定义等待期间的草稿 A');
  checks.push('Custom multi-line prompts send immediately with document context, retain drafts, reject double clicks and share the existing cross-document queue.');
  await pane().getByRole('button', { name: '新对话', exact: true }).click(); await configure('');
  await prompt().fill('缺少连接时仍保留的草稿');
  await pane().getByRole('button', { name: '查找假设与局限', exact: true }).click(); await dialog().waitFor();
  await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'detached' });
  await pane().locator('.ai-status').filter({ hasText: '请先连接 AI 服务' }).waitFor();
  assert.equal(await prompt().inputValue(), '缺少连接时仍保留的草稿'); assert.equal(calls.length, 5);
  checks.push('Missing credentials open normal AI settings without sending, adding messages or replacing the draft.');
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  console.log(JSON.stringify({ passed: true, checks: checks.map(value => typeof value === 'string' ? value : value.label), requests: calls.length, errors, remoteRequests }, null, 2));
} finally {
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts', 'ai-controls-ui-check.json'), JSON.stringify({ checks, requests: calls.length, errors, remoteRequests }, null, 2));
  await browser?.close(); await vite?.close();
  for (const socket of sockets) socket.destroy(); await new Promise(done => model.close(done));
}
