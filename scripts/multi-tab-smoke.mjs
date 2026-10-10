// Real Edge side-panel document, actual tab activation, synthetic PDFs and local SSE.
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { samplePdf } from '../tests/fixtures/pdf.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), lite = process.env.PDF_COPILOT_MATH_PROFILE === 'plain';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PDF_COPILOT_PLAYWRIGHT_PATH || join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const fixture = join(root, '.cache', 'multi-tab-extension' + (lite ? '-lite' : ''));
await mkdir(fixture, { recursive: true });
await cp(join(root, 'dist', lite ? 'extension-lite' : 'extension'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
// Native capture requires an activeTab gesture which headless cannot supply.
// Broad capture permission exists ONLY in this synthetic test copy.
manifest.host_permissions = ['<all_urls>'];
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
const background = join(fixture, 'background.js');
await writeFile(background, `const fixtureRegister = chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);
chrome.commands.onCommand.addListener = listener => { globalThis.fixtureCommand = listener; fixtureRegister(listener); };
` + await readFile(background, 'utf8'));
const checks = [], errors = [], started = [], pending = new Map(), aborted = [], live = new Set();
let maximum = 0;
const server = createServer(async (request, response) => {
  if (request.url === '/native.pdf') { response.writeHead(200, { 'Content-Type': 'application/pdf' }); response.end(samplePdf(6)); return; }
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); response.end(); return; }
  if (request.method !== 'POST' || request.url !== '/chat/completions') { response.writeHead(404); response.end(); return; }
  let body = ''; for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body), content = JSON.stringify(payload.messages.findLast(item => item.role === 'user' && JSON.stringify(item.content).includes('JOB_')).content);
  const name = content.match(/JOB_[A-Z0-9_]+/)?.[0]; assert(name, 'unique fixture job marker');
  started.push({ name, payload }); live.add(response); maximum = Math.max(maximum, live.size);
  response.on('close', () => { live.delete(response); if (!response.writableEnded) aborted.push(name); if (pending.get(name)?.response === response) pending.delete(name); });
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
  const event = value => response.write('data: ' + JSON.stringify({ choices: [{ delta: value, finish_reason: null }] }) + '\n\n');
  event({ reasoning_content: 'fixture reason: ' + name }); event({ content: '开始 ' + name + '\n' });
  const finish = () => {
    if (name === 'JOB_TOOLS_HIDDEN') {
      const count = payload.messages.filter(item => item.role === 'tool').length;
      if (count < 2) {
        const args = count === 0 ? { start_page: 3, end_page: 3, block_id: null } : { page: 4, block_id: null };
        event({ tool_calls: [{ index: 0, id: 'hidden-' + count, function: { name: count === 0 ? 'pdf_read' : 'pdf_view', arguments: JSON.stringify(args) } }] });
        response.end('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
        return;
      }
    }
    event({ content: '完成 ' + name + '\n公式 $E=mc^2$。' });
    response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  };
  finish.response = response; pending.set(name, finish);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 12000; while (Date.now() < end) { if (await fn()) return; await pause(50); } throw new Error('Timed out: ' + label); };
const pass = label => { checks.push(label); console.log('PASS ' + label); };
let context, panel, cdp, quick;
try {
  context = await chromium.launchPersistentContext(join(root, '.cache', 'edge-multi-tab-' + Date.now()), {
    executablePath: process.env.PDF_COPILOT_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: { width: 1200, height: 820 },
    ignoreDefaultArgs: ['--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    args: ['--disable-extensions-except=' + fixture, '--load-extension=' + fixture, '--no-first-run'],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const url = 'chrome-extension://' + worker.url().split('/')[2];
  await worker.evaluate(async baseUrl => {
    await chrome.storage.local.set({ settings: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low', baseUrl, theme: 'light', requestLimits: { concurrent: 2, codex: 1, queued: 1 } } });
    await chrome.storage.session.set({ 'apiKey:deepseek': 'synthetic-key' });
  }, baseUrl);
  const readers = [], tabs = [];
  for (const name of ['A', 'B', 'C', 'D']) {
    const reader = await context.newPage(); await reader.goto(url + '/reader/index.html');
    await reader.locator('#file-input').setInputFiles({ name: name + '.pdf', mimeType: 'application/pdf', buffer: samplePdf(6, false, true, { lines: { 1: ['Document ' + name] } }) });
    await reader.waitForFunction(() => document.querySelector('#page-surface')?.classList.contains('page-ready'));
    readers.push(reader); tabs.push(await reader.evaluate(() => chrome.tabs.getCurrent()));
  }
  await readers[0].bringToFront(); await readers[0].locator('#sidebar').click();
  cdp = await context.newCDPSession(context.pages().find(page => page.url() === 'about:blank') || readers[3]);
  let target;
  await until(async () => { target = (await cdp.send('Target.getTargets')).targetInfos.find(item => item.url === url + '/chat/index.html'); return !!target; }, 'real side-panel target');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let sequence = 0; const calls = new Map();
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.id) { const handler = calls.get(message.id); calls.delete(message.id); if (message.error) handler?.reject(new Error(message.error.message)); else handler?.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const remote = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; calls.set(id, { resolve, reject });
    cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  });
  await remote('Runtime.enable');
  panel = {
    async evaluate(fn, arg) {
      const result = await remote('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg) || 'undefined'})`, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    async read() { return this.evaluate(() => ({ source: document.querySelector('#source-name').textContent, text: document.querySelector('#messages').textContent,
      draft: document.querySelector('#prompt').value, status: document.querySelector('#status').textContent, busy: document.querySelector('#send').disabled,
      phase: document.querySelector('.answer-progress')?.dataset.state, progress: document.querySelector('.answer-progress')?.textContent })); },
  };
  const activate = async index => {
    await readers[index].bringToFront();
    await until(async () => (await panel.read()).source === String.fromCharCode(65 + index) + '.pdf', 'source ' + index);
  };
  const send = async name => { await panel.evaluate(name => { const input = document.querySelector('#prompt'); input.value = name; input.dispatchEvent(new Event('input')); document.querySelector('#composer').requestSubmit(); }, name); };
  const waitStart = name => until(() => started.some(item => item.name === name), name + ' started');
  const complete = async name => { assert(pending.has(name)); const finish = pending.get(name); finish(); await until(() => !live.has(finish.response), name + ' finished at server'); };
  await activate(0); const panelDocument = await panel.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
  assert.equal(panelDocument.length, 1);
  await send('JOB_A'); await waitStart('JOB_A');
  await until(async () => (await panel.read()).text.includes('开始 JOB_A'), 'initial stream');
  await activate(1); assert(!(await panel.read()).text.includes('JOB_A')); assert(!(await panel.read()).busy);
  await panel.evaluate(() => { const input = document.querySelector('#prompt'); input.value = 'B draft'; input.dispatchEvent(new Event('input')); });
  await panel.evaluate(() => { const effort = document.querySelector('#effort'); effort.value = 'high'; effort.dispatchEvent(new Event('change')); });
  await activate(0); assert((await panel.read()).text.includes('开始 JOB_A')); assert((await panel.read()).busy);
  assert.equal(await panel.evaluate(() => document.querySelector('#effort').value), 'low');
  await activate(1); assert.equal((await panel.read()).draft, 'B draft');
  assert.equal(await panel.evaluate(() => document.querySelector('#effort').value), 'high');
  await send('JOB_B'); await waitStart('JOB_B');
  assert.equal(started.find(item => item.name === 'JOB_B').payload.reasoning_effort, 'high');
  await readers[2].locator('#page-number').fill('2'); await readers[2].locator('#page-number').press('Enter');
  await readers[2].waitForFunction(() => document.querySelector('#page-surface')?.dataset.page === '2' && document.querySelector('#page-surface')?.classList.contains('page-ready'));
  await activate(2); await send('JOB_C');
  await until(async () => (await panel.read()).phase === 'queued', 'third question queued');
  assert((await panel.read()).progress.includes('第 1 位')); assert(!started.some(item => item.name === 'JOB_C'));
  await readers[2].locator('#page-number').fill('5'); await readers[2].locator('#page-number').press('Enter');
  await readers[2].waitForFunction(() => document.querySelector('#page-surface')?.dataset.page === '5');
  await activate(3); await send('JOB_FULL');
  await until(async () => (await panel.read()).status.includes('队列已满') && !(await panel.read()).busy, 'full queue restores question');
  assert.equal((await panel.read()).draft, 'JOB_FULL'); assert(!started.some(item => item.name === 'JOB_FULL'));
  await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, effort: 'high', documentLimits: { images: 1 } } }); });
  await complete('JOB_A'); await waitStart('JOB_C');
  const queuedPayload = started.find(item => item.name === 'JOB_C').payload;
  assert(JSON.stringify(queuedPayload).includes('当前 PDF 第 2 页')); assert(!JSON.stringify(queuedPayload).includes('当前 PDF 第 5 页'));
  assert.equal(queuedPayload.reasoning_effort, 'low');
  const queuedText = queuedPayload.messages.flatMap(message => typeof message.content === 'string' ? [message.content] : message.content.filter(part => part.type === 'text').map(part => part.text)).join('\n');
  assert(queuedText.includes('"images":5'), 'queued question retains its original PDF budget');
  await activate(0); await until(async () => (await panel.read()).text.includes('完成 JOB_A') && !(await panel.read()).busy, 'hidden answer restored');
  assert(!(await panel.read()).text.includes('JOB_B'));
  const resumed = await panel.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
  assert.equal(resumed[0].documentId, panelDocument[0].documentId, 'global panel survives switching tabs');
  await activate(1); await complete('JOB_B'); await until(async () => !(await panel.read()).busy, 'B done');
  await activate(2); await complete('JOB_C'); await until(async () => !(await panel.read()).busy, 'C done');
  assert.equal(await panel.evaluate(() => document.querySelectorAll('.katex').length > 0), !lite);
  assert.equal(maximum, 2); pass('real global side panel: independent drafts, streams, replies, two active jobs and FIFO queue');
  pass('queue overflow preserves question; queued page/model/effort/limits stay tied to submission');
  await activate(0);
  await panel.evaluate(() => {
    window.fixtureGet = chrome.storage.session.get.bind(chrome.storage.session);
    chrome.storage.session.get = async keys => { if (keys === 'apiKey:deepseek') await new Promise(resolve => setTimeout(resolve, 250)); return window.fixtureGet(keys); };
  });
  await send('JOB_EARLY_SWITCH'); await activate(1); await waitStart('JOB_EARLY_SWITCH');
  assert(!(await panel.read()).text.includes('JOB_EARLY_SWITCH')); assert(!(await panel.read()).busy);
  await complete('JOB_EARLY_SWITCH'); await activate(0); await until(async () => (await panel.read()).text.includes('完成 JOB_EARLY_SWITCH') && !(await panel.read()).busy, 'early switch completion');
  await panel.evaluate(() => { chrome.storage.session.get = window.fixtureGet; delete window.fixtureGet; });
  pass('switching tabs during submission preflight still sends the enhanced PDF question');
  await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, documentLimits: { images: 5 } } }); });
  await send('JOB_TOOLS_HIDDEN'); await waitStart('JOB_TOOLS_HIDDEN'); await activate(1);
  assert.equal((await readers[0].evaluate(() => chrome.tabs.getCurrent())).active, false, 'original PDF is no longer the active tab');
  // Headless can report inactive tabs as visible. Suspend their animation frames
  // explicitly, as desktop Chromium does, to exercise background export scheduling.
  await readers[0].evaluate(() => { window.fixtureRAF = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; });
  await complete('JOB_TOOLS_HIDDEN'); await until(() => started.filter(item => item.name === 'JOB_TOOLS_HIDDEN').length === 2, 'hidden text tool result');
  const readResult = started.findLast(item => item.name === 'JOB_TOOLS_HIDDEN').payload.messages.findLast(item => item.role === 'tool');
  assert(readResult.content.includes('Synthetic page 3')); assert(!(await panel.read()).text.includes('JOB_TOOLS_HIDDEN'));
  await complete('JOB_TOOLS_HIDDEN'); await until(() => started.filter(item => item.name === 'JOB_TOOLS_HIDDEN').length === 3, 'hidden image tool result');
  const viewResult = started.findLast(item => item.name === 'JOB_TOOLS_HIDDEN').payload;
  assert(viewResult.messages.findLast(item => item.role === 'tool').content.includes('"page":4'));
  assert(viewResult.messages.at(-1).content.some(item => item.type === 'image_url'));
  assert(!(await panel.read()).text.includes('JOB_TOOLS_HIDDEN'));
  await complete('JOB_TOOLS_HIDDEN'); await activate(0); await until(async () => (await panel.read()).text.includes('完成 JOB_TOOLS_HIDDEN') && !(await panel.read()).busy, 'hidden tools complete');
  assert((await panel.read()).text.includes('PDF 第 3 页')); assert((await panel.read()).text.includes('PDF 第 4 页'));
  await readers[0].evaluate(() => { window.requestAnimationFrame = window.fixtureRAF; delete window.fixtureRAF; });
  pass('inactive enhanced PDF still answers text/image tool calls; evidence returns to its original conversation');

  await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, requestLimits: { concurrent: 1, codex: 1, queued: 1 } } }); });
  await activate(0); await send('JOB_STOP_ACTIVE'); await waitStart('JOB_STOP_ACTIVE');
  await activate(1); await send('JOB_STOP_WAITING'); await until(async () => (await panel.read()).phase === 'queued', 'cancel wait');
  await panel.evaluate(() => document.querySelector('#stop').click());
  await until(async () => !(await panel.read()).busy && (await panel.read()).status.includes('已停止'), 'queued cancelled');
  await activate(2); await send('JOB_AFTER_CANCEL'); await until(async () => (await panel.read()).phase === 'queued', 'replacement queue');
  await activate(0); await panel.evaluate(() => document.querySelector('#stop').click());
  await until(() => aborted.includes('JOB_STOP_ACTIVE'), 'running abort reaches server'); await waitStart('JOB_AFTER_CANCEL');
  assert(!started.some(item => item.name === 'JOB_STOP_WAITING'));
  await activate(2); await complete('JOB_AFTER_CANCEL'); await until(async () => !(await panel.read()).busy, 'replacement done');
  pass('cancel queued question never calls provider; cancelling active question frees slot immediately');

  await activate(0); await send('JOB_RESTART'); await waitStart('JOB_RESTART');
  await activate(1); await send('JOB_RESTART_WAIT'); await until(async () => (await panel.read()).phase === 'queued', 'restart waiting');
  await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
  const restored = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'requests:summary' }));
  assert.equal(restored.summary.running, 1); assert.equal(restored.summary.queued, 1);
  assert(!started.some(item => item.name === 'JOB_RESTART_WAIT')); assert(!aborted.includes('JOB_RESTART'));
  await complete('JOB_RESTART'); await waitStart('JOB_RESTART_WAIT'); await complete('JOB_RESTART_WAIT');
  await until(async () => !(await panel.read()).busy, 'restart queue completed');
  pass('worker restart retains live stream ownership and does not start extra requests');

  await activate(0); await send('JOB_WINDOW'); await waitStart('JOB_WINDOW');
  const popup = await panel.evaluate(tab => chrome.windows.create({ url: chrome.runtime.getURL(`chat/index.html?mode=quick&tab=${tab.id}&window=${tab.windowId}`), type: 'popup', width: 510, height: 720 }), tabs[1]);
  await until(() => { quick = context.pages().find(page => page.url().includes('/chat/index.html?mode=quick&tab=')); return !!quick; }, 'quick popup');
  await quick.waitForFunction(() => document.querySelector('#source-name')?.textContent === 'B.pdf' && !document.querySelector('#send').disabled);
  await quick.locator('#prompt').fill('JOB_WINDOW_WAIT'); await quick.locator('#send').click();
  await quick.locator('.answer-progress[data-state=queued]').waitFor();
  assert(!started.some(item => item.name === 'JOB_WINDOW_WAIT'));
  await quick.close();
  await activate(2); await send('JOB_OWNER_CLOSED'); await until(async () => (await panel.read()).phase === 'queued', 'closed owner reclaimed');
  assert(!started.some(item => item.name === 'JOB_WINDOW_WAIT'));
  await complete('JOB_WINDOW'); await waitStart('JOB_OWNER_CLOSED'); await complete('JOB_OWNER_CLOSED');
  await until(async () => !(await panel.read()).busy, 'reclaimed job done');
  assert(Number.isInteger(popup.id)); pass('side panel and separate quick window share limits; closed owners free queue entries');

  await activate(0); await send('JOB_SOURCE_CLOSED'); await waitStart('JOB_SOURCE_CLOSED');
  await activate(1); await send('JOB_AFTER_SOURCE'); await until(async () => (await panel.read()).phase === 'queued', 'source-close queued');
  await readers[0].close();
  await until(() => aborted.includes('JOB_SOURCE_CLOSED'), 'hidden original tab closed');
  await waitStart('JOB_AFTER_SOURCE'); await complete('JOB_AFTER_SOURCE'); await until(async () => !(await panel.read()).busy, 'after source close done');
  pass('closing the original hidden PDF cancels its stream and advances the queue');

  const native = await context.newPage(); await native.goto(baseUrl + '/native.pdf');
  await native.locator('embed[type="application/pdf"]').waitFor();
  await until(async () => (await panel.read()).source.includes('native.pdf') && !(await panel.read()).busy, 'native source');
  await send('JOB_NATIVE'); await waitStart('JOB_NATIVE');
  assert(JSON.stringify(started.find(item => item.name === 'JOB_NATIVE').payload).includes('image_url'));
  await native.evaluate(() => { location.hash = 'page=2'; });
  await activate(1); await send('JOB_NATIVE_NEXT'); await until(async () => (await panel.read()).phase === 'queued', 'native next queued');
  assert(!aborted.includes('JOB_NATIVE'));
  await complete('JOB_NATIVE'); await waitStart('JOB_NATIVE_NEXT');
  await native.bringToFront(); await until(async () => (await panel.read()).source.includes('native.pdf') && (await panel.read()).text.includes('完成 JOB_NATIVE') && !(await panel.read()).busy, 'native completion after fragment change');
  await activate(1); await complete('JOB_NATIVE_NEXT'); await until(async () => !(await panel.read()).busy, 'native next done');
  await send('JOB_NATIVE_BLOCK'); await waitStart('JOB_NATIVE_BLOCK');
  await native.bringToFront(); await until(async () => (await panel.read()).source.includes('native.pdf') && !(await panel.read()).busy, 'native queued source');
  await send('JOB_NATIVE_QUEUED');
  await until(async () => (await panel.read()).phase === 'queued' && await panel.evaluate(() => document.querySelectorAll('.automatic-page').length === 2), 'queued native snapshot ready');
  assert(!started.some(item => item.name === 'JOB_NATIVE_QUEUED'));
  await activate(1); await complete('JOB_NATIVE_BLOCK'); await waitStart('JOB_NATIVE_QUEUED'); await complete('JOB_NATIVE_QUEUED');
  await native.bringToFront(); await until(async () => (await panel.read()).source.includes('native.pdf') && !(await panel.read()).busy, 'queued native answer restored');
  await native.close();
  pass('native browser PDF: page fragments preserve streams; queued visible image freezes before switching tabs');

  worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js')) || await context.waitForEvent('serviceworker');
  const commandTab = tabs[2]; await activate(2);
  const commands = await panel.evaluate(() => chrome.commands.getAll());
  assert.equal(commands.find(item => item.name === 'capture-region').shortcut, 'Alt+Shift+S');
  await worker.evaluate(tab => globalThis.fixtureCommand('capture-region', tab), commandTab);
  assert.equal(await readers[2].locator('#capture-region').getAttribute('aria-pressed'), 'true');
  const box = await readers[2].locator('#page-surface').boundingBox();
  await readers[2].mouse.move(box.x + 30, Math.max(box.y + 40, 140)); await readers[2].mouse.down();
  await readers[2].mouse.move(box.x + 220, Math.max(box.y + 150, 260), { steps: 6 }); await readers[2].mouse.up();
  await readers[2].locator('#preview-dialog[open]').waitFor();
  assert((await readers[2].locator('#preview-image').getAttribute('src')).startsWith('data:image/'));
  await readers[2].locator('#preview-cancel').click(); await readers[2].keyboard.press('Escape');
  assert.equal(await readers[2].locator('#capture-region').getAttribute('aria-pressed'), 'false');
  pass('registered customizable capture command enters enhanced selection and actual mouse drag previews crop');

  const stores = await panel.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  assert(!JSON.stringify(stores).includes('JOB_')); assert(!JSON.stringify(stores).includes('data:image'));
  assert.equal(stores.session.requestQueue.length, 0);
  const screenshot = await remote('Page.captureScreenshot', { format: 'png' });
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', 'multi-tab-panel' + (lite ? '-lite' : '') + '.png'), Buffer.from(screenshot.data, 'base64'));
  assert.deepEqual(errors, []); pass('scheduler persists metadata only; math profile and real panel rendering remain correct');
} catch (error) {
  console.error(error); if (panel) console.error(await panel.read().catch(() => ({})));
  if (quick && !quick.isClosed()) console.error(await quick.evaluate(() => ({ url: location.href, status: document.querySelector('#status')?.textContent, text: document.querySelector('#messages')?.textContent, draft: document.querySelector('#prompt')?.value })).catch(() => ({})));
  console.error({ started: started.map(item => item.name), aborted }); process.exitCode = 1;
} finally {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', 'multi-tab-results' + (lite ? '-lite' : '') + '.json'), JSON.stringify({ checks, errors, maximum, started: started.map(item => item.name), aborted }, null, 2));
  server.closeAllConnections(); await cdp?.detach().catch(() => {}); await context?.close(); await new Promise(resolve => server.close(resolve));
}
