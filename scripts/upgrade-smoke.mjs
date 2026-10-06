import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { samplePdf } from '../tests/fixtures/pdf.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const embeddedMath = process.env.PDF_COPILOT_MATH_PROFILE !== 'plain';
const artifactPrefix = embeddedMath ? '' : 'lite-';
const require = createRequire(import.meta.url);
const runtime = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const playwright = require(process.env.PDF_COPILOT_PLAYWRIGHT_PATH || join(runtime, 'playwright'));
const fixture = join(root, '.cache', embeddedMath ? 'upgrade-extension' : 'upgrade-extension-lite');
await mkdir(fixture, { recursive: true });
await cp(join(root, 'dist', embeddedMath ? 'extension' : 'extension-lite'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
// Headless input dispatch does not activate browser-level accelerators. Capture
// the listener in this test copy, then exercise it with a real native PDF Tab.
// Shortcut assignment itself is checked using the unmodified Commands API.
const backgroundFile = join(fixture, 'background.js');
await writeFile(backgroundFile, `const fixtureRegister = chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);
chrome.commands.onCommand.addListener = listener => { globalThis.fixtureCommand = listener; fixtureRegister(listener); };
const fixtureMessages = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
chrome.runtime.onMessage.addListener = listener => fixtureMessages((message, sender, respond) => {
  if (message.type !== 'fixture:command') return listener(message, sender, respond);
  Promise.resolve(globalThis.fixtureCommand(message.command, sender.tab)).then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
  return true;
});
const fixturePanel = chrome.sidePanel.open.bind(chrome.sidePanel);
chrome.sidePanel.open = options => fixturePanel(options).then(value => { globalThis.fixturePanelResult = { ok: true, options }; return value; }, error => { globalThis.fixturePanelResult = { ok: false, error: error.message }; throw error; });
` + await readFile(backgroundFile, 'utf8'));
const requests = [];
const pause = (response, ms) => new Promise(resolve => {
  const closed = () => { clearTimeout(timer); resolve(); };
  const timer = setTimeout(() => { response.off('close', closed); resolve(); }, ms);
  response.once('close', closed);
});
const formula = '行内 $E=mc^2$ 和 \\(x^2+1\\)。\n$$\\int_0^1 x\\,dx=\\frac{1}{2}$$\n\\[a^2+b^2=c^2\\]\n代码 `$not_math$`\n```text\n$code_math$\n```\n<img src="https://example.invalid/hidden.png" onerror="alert(1)">';
const server = createServer(async (request, response) => {
  if (request.url === '/native.pdf') {
    response.writeHead(200, { 'Content-Type': 'application/pdf' });
    response.end(samplePdf(40, true)); return;
  }
  if (request.url !== '/chat/completions') { response.writeHead(404); response.end(); return; }
  let body = ''; for await (const part of request) body += part;
  const payload = JSON.parse(body); requests.push(payload);
  const prompt = JSON.stringify(payload.messages.at(-1).content);
  if (prompt.includes('TEST_ERROR')) {
    await pause(response, 500); if (response.destroyed) return;
    response.writeHead(503, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); response.end('Synthetic service unavailable'); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
  const delta = value => response.write('data: ' + JSON.stringify({ choices: [{ delta: value, finish_reason: null }] }) + '\n\n');
  await pause(response, 300); if (response.destroyed) return;
  delta({ reasoning_content: '这是本机模拟等待阶段。' });
  if (/TEST_CANCEL|TEST_CLEAR|TEST_SWITCH/.test(prompt)) {
    if (prompt.includes('TEST_CANCEL_PARTIAL')) delta({ content: '部分公式 $x=2$。' });
    await pause(response, 15000); if (response.destroyed) return;
  } else { await pause(response, 1200); if (response.destroyed) return; }
  delta({ content: formula.slice(0, 40) });
  await pause(response, 450); if (response.destroyed) return;
  delta({ content: formula.slice(40) });
  response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const errors = [], externalRequests = [], mathRequests = [];
let context;
try {
  context = await playwright.chromium.launchPersistentContext(join(root, '.cache', `edge-upgrade-${embeddedMath ? 'math' : 'lite'}-${Date.now()}`), {
    executablePath: process.env.PDF_COPILOT_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: { width: 1200, height: 820 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + fixture, '--load-extension=' + fixture, '--no-first-run'],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => {
    if (request.url().includes('example.invalid')) externalRequests.push(request.url());
    if (request.url().includes('/vendor/katex/')) mathRequests.push(request.url());
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = worker.url().split('/')[2];
  await worker.evaluate(async ({ baseUrl }) => {
    await chrome.storage.local.set({ settings: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low', baseUrl, theme: 'light', rememberKey: false } });
    await chrome.storage.session.set({ 'apiKey:deepseek': 'synthetic-test-key' });
  }, { baseUrl });
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  assert.equal(commands.find(command => command.name === 'open-sidebar')?.shortcut, 'Ctrl+Shift+7', 'sidebar shortcut is actually registered');
  assert.equal(commands.find(command => command.name === 'open-sidebar')?.description, '打开 AI 侧栏');
  assert.equal(commands.find(command => command.name === 'open-reader')?.shortcut, 'Ctrl+Shift+8', 'reader shortcut is actually registered');
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings/index.html`);
  assert.equal(await settings.locator('#extension-version').textContent(), 'v' + manifest.version);
  assert.equal(await settings.locator('[data-command="open-sidebar"]').textContent(), 'Ctrl+Shift+7');
  assert.equal(await settings.locator('[data-command="_execute_action"]').count(), 0, 'reserved browser action is not presented as the sidebar');
  assert.equal(await settings.locator('[data-command="open-reader"]').textContent(), 'Ctrl+Shift+8');
  await settings.evaluate(() => {
    window.originalGetAll = chrome.commands.getAll;
    chrome.commands.getAll = async () => [{ name: 'open-reader', shortcut: '' }];
  });
  await settings.locator('#refresh-shortcuts').click();
  await settings.waitForFunction(() => document.querySelector('#shortcut-status').textContent.includes('增强阅读器'));
  assert.equal(await settings.locator('[data-command="open-reader"]').textContent(), '未设置', 'unassigned shortcuts are never presented as enabled');
  await settings.evaluate(() => { chrome.commands.getAll = window.originalGetAll; delete window.originalGetAll; });
  await settings.locator('#refresh-shortcuts').click();
  await settings.waitForFunction(() => document.querySelector('[data-command="open-reader"]').textContent === 'Ctrl+Shift+8');
  const shortcutsOpening = context.waitForEvent('page');
  await settings.locator('#configure-shortcuts').click();
  const shortcuts = await shortcutsOpening;
  await shortcuts.waitForURL(/^(edge|chrome):\/\/extensions\/shortcuts/);
  await shortcuts.getByText('打开 AI 侧栏', { exact: true }).waitFor();
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await shortcuts.screenshot({ path: join(root, 'artifacts', artifactPrefix + 'shortcuts.png') });
  await shortcuts.close();
  await settings.bringToFront();
  await settings.evaluate(() => {
    const button = document.createElement('button'); button.id = 'fixture-sidebar'; button.textContent = 'Test sidebar command';
    button.onclick = async () => { window.fixtureCommandResult = await chrome.runtime.sendMessage({ type: 'fixture:command', command: 'open-sidebar' }); };
    document.body.append(button);
  });
  await settings.locator('#fixture-sidebar').click();
  await settings.waitForFunction(() => window.fixtureCommandResult);
  const panelResult = await worker.evaluate(() => globalThis.fixturePanelResult);
  assert.equal(panelResult?.ok, true, panelResult?.error || 'sidebar command must open the real browser panel');
  const settingsTab = await settings.evaluate(() => chrome.tabs.getCurrent());
  assert.equal((await worker.evaluate(() => globalThis.fixturePanelResult.options)).windowId, settingsTab.windowId, 'sidebar command opens the correct browser window with a real click gesture');
  await settings.close();
  const native = await context.newPage();
  await native.goto(baseUrl + '/native.pdf');
  await native.bringToFront();
  const openedReader = context.waitForEvent('page', { timeout: 15000 });
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await globalThis.fixtureCommand('open-reader', tab);
  });
  const reader = await openedReader;
  await reader.waitForURL(`chrome-extension://${id}/reader/index.html?**`);
  assert.equal(new URL(reader.url()).searchParams.get('url'), baseUrl + '/native.pdf', 'native PDF shortcut retains its source');
  await reader.locator('#open-url').click();
  await reader.waitForFunction(() => document.querySelector('#text-layer')?.textContent.includes('Synthetic page 1'));
  const dimensions = await reader.evaluate(() => ({ scroll: document.querySelector('#reading-area').scrollHeight, visible: document.querySelector('#reading-area').clientHeight }));
  assert(dimensions.scroll > dimensions.visible * 10, 'continuous layout contains the long document');
  const area = await reader.locator('#reading-area').boundingBox();
  await reader.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await reader.mouse.wheel(0, 1100);
  await reader.waitForFunction(() => Number(document.querySelector('#page-number').value) > 1);
  await reader.mouse.wheel(0, -2500);
  await reader.waitForFunction(() => document.querySelector('#page-number').value === '1');
  await reader.locator('#page-number').fill('25'); await reader.locator('#page-number').press('Enter');
  await reader.waitForFunction(() => document.querySelector('#text-layer')?.textContent.includes('Synthetic page 25'));
  const pixels = await reader.evaluate(() => Array.from(document.querySelectorAll('#reading-area canvas')).filter(canvas => canvas.width > 1 && canvas.height > 1).map(canvas => canvas.width * canvas.height));
  assert(pixels.length <= 3, `bounded canvases: ${pixels.length}`);
  assert(pixels.reduce((a, b) => a + b, 0) <= 24_000_000, 'bounded canvas pixel allocation');
  await reader.locator('#zoom-in').click();
  await reader.waitForFunction(() => document.querySelector('#text-layer')?.textContent.includes('Synthetic page 25'));
  await reader.locator('#bookmark').click();
  await reader.locator('#page-number').fill('26'); await reader.locator('#page-number').press('Enter');
  await reader.waitForFunction(() => document.querySelector('#text-layer')?.textContent.includes('Synthetic page 26'));
  await reader.locator('#bookmarks button').filter({ hasText: '第 25 页' }).click();
  await reader.waitForFunction(() => document.querySelector('#page-number').value === '25');
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await reader.screenshot({ path: join(root, 'artifacts', artifactPrefix + 'scroll-reader.png') });
  const tab = await reader.evaluate(async () => chrome.tabs.getCurrent());
  const chat = await context.newPage();
  await chat.setViewportSize({ width: 420, height: 820 });
  await chat.goto(`chrome-extension://${id}/chat/index.html?mode=quick&tab=${tab.id}&window=${tab.windowId}`);
  const send = async prompt => { await chat.locator('#prompt').fill(prompt); await chat.locator('#send').click(); };
  await send('TEST_WAIT');
  await chat.locator('.answer-progress[data-state="thinking"]').waitFor();
  await chat.waitForFunction(() => !!document.querySelector('.message details pre')?.textContent);
  assert.equal(await chat.locator('.answer-progress').getAttribute('data-state'), 'thinking', 'reasoning still waits for the answer');
  await chat.screenshot({ path: join(root, 'artifacts', artifactPrefix + 'thinking.png') });
  await chat.locator('.answer-progress[data-state="receiving"]').waitFor();
  await chat.waitForFunction(() => document.querySelector('#status').textContent === '回答完成。');
  assert.equal(await chat.locator('.answer-progress').count(), 0);
  assert.equal(await chat.locator('.message.assistant .katex').count(), embeddedMath ? 4 : 0);
  assert.equal(await chat.locator('.message.assistant .body img').count(), 0, 'raw HTML stays text');
  assert.equal(await chat.locator('.message.assistant .body').textContent().then(text => text.includes('$code_math$')), true);
  assert.equal(externalRequests.length, 0);
  if (!embeddedMath) assert.equal(mathRequests.length, 0, 'lite never requests missing formula resources');
  await chat.evaluate(() => document.fonts.ready);
  await chat.screenshot({ path: join(root, 'artifacts', artifactPrefix + 'formulas.png') });
  await send('TEST_CANCEL'); await chat.locator('.answer-progress').waitFor(); await chat.locator('#stop').click();
  await chat.waitForFunction(() => document.querySelector('#stop').hidden);
  assert.equal(await chat.locator('.answer-progress').count(), 0);
  await send('TEST_CANCEL_PARTIAL'); await chat.locator('.answer-progress[data-state="receiving"]').waitFor(); await chat.locator('#stop').click();
  await chat.waitForFunction(() => document.querySelector('#stop').hidden);
  assert.equal(await chat.locator('.message.assistant').last().locator('.katex').count(), embeddedMath ? 1 : 0, 'partial answer renders after stopping in the embedded edition');
  await send('TEST_ERROR'); await chat.locator('.answer-progress').waitFor();
  await chat.waitForFunction(() => document.querySelector('#stop').hidden);
  assert.equal(await chat.locator('.answer-progress').count(), 0);
  await send('TEST_CLEAR'); await chat.locator('.answer-progress').waitFor(); await chat.locator('#clear').click();
  await chat.waitForFunction(() => document.querySelector('#stop').hidden);
  assert.equal(await chat.locator('.message').count(), 0); assert.equal(await chat.locator('.answer-progress').count(), 0);
  await send('TEST_SWITCH'); await chat.locator('.answer-progress').waitFor();
  await reader.locator('#file-input').setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: samplePdf(3) });
  await chat.waitForFunction(() => document.querySelector('#source-name').textContent === 'replacement.pdf');
  await chat.waitForFunction(() => document.querySelector('#stop').hidden);
  assert.equal(await chat.locator('.message').count(), 0); assert.equal(await chat.locator('.answer-progress').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`Edge upgrade smoke passed (${embeddedMath ? 'embedded math' : 'plain'}): named sidebar shortcut registered/visible in browser UI, shortcut settings link, sidebar command user gesture, native PDF command source, actual shortcut diagnostics/version, continuous wheel scrolling, mixed page sizes, bounded canvases, jump/zoom/bookmark, formulas/code/HTML, waiting/receiving, stop/error/clear/document switch. Real browser accelerator input still needs manual verification.`);
} catch (error) {
  if (context) for (const page of context.pages()) console.error('Upgrade page:', page.url(), await page.locator('#status').textContent({ timeout: 1000 }).catch(() => ''));
  throw error;
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
