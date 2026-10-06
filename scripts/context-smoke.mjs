// Real Edge rendering and extension messaging, synthetic documents and local model fixtures only.
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { samplePdf } from '../tests/fixtures/pdf.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(root, 'artifacts'), { recursive: true });
const require = createRequire(import.meta.url);
const runtime = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(process.env.PDF_COPILOT_PLAYWRIGHT_PATH || join(runtime, 'playwright'));
const lite = process.env.PDF_COPILOT_MATH_PROFILE === 'plain';
const fixture = join(root, '.cache', 'context-extension' + (lite ? '-lite' : ''));
await mkdir(fixture, { recursive: true }); await cp(join(root, 'dist', lite ? 'extension-lite' : 'extension'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8')); manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
const requests = [], checks = [], errors = [];
const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); response.end(); return; }
  if (!['/responses', '/chat/completions'].includes(request.url)) { response.writeHead(404); response.end(); return; }
  let body = ''; for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body); requests.push(payload);
  const openai = request.url === '/responses';
  const history = openai ? payload.input : payload.messages;
  if (JSON.stringify(history).includes('TEST_CONTEXT_CANCEL')) await new Promise(resolve => setTimeout(resolve, 4000));
  if (response.destroyed) return;
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
  const count = history.filter(item => openai ? item.type === 'function_call_output' : item.role === 'tool').length;
  const calls = [
    ['pdf_search', { query: 'coupling constant', start_page: null, end_page: null, next_page: null }],
    ['pdf_read', { start_page: 2, end_page: 3, block_id: null }],
    ['pdf_view', { page: 2, block_id: 'p2-b0' }],
  ];
  const event = value => response.write('data: ' + JSON.stringify(value) + '\n\n');
  if (count < calls.length && payload.tools?.length) {
    const [name, args] = calls[count], id = 'call' + count;
    if (openai) event({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'reasoning', id: 'r' + count, encrypted_content: 'synthetic-opaque' }, { type: 'function_call', id: 'f' + count, call_id: id, name, arguments: JSON.stringify(args) }] } });
    else {
      event({ choices: [{ delta: { reasoning_content: '本机模拟正在查找定义。', tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
      response.write('data: [DONE]\n\n');
    }
  } else {
    const result = history.find(item => openai ? item.type === 'function_call_output' : item.role === 'tool');
    let citation = '';
    if (result) { const content = openai ? result.output : result.content; const data = JSON.parse(typeof content === 'string' ? content : content[0].text); citation = data.evidence?.find(item => item.page === 2)?.sourceId || ''; }
    const text = `The coupling constant is defined on the earlier page. [${citation}]\nFormula $g^2=1$. [Sunknown-999]`;
    if (openai) { event({ type: 'response.output_text.delta', delta: text }); event({ type: 'response.completed', response: { status: 'completed', output: [] } }); }
    else { event({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }); response.write('data: [DONE]\n\n'); }
  }
  response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
let context, chat;
try {
  context = await chromium.launchPersistentContext(join(root, '.cache', 'edge-context-' + Date.now()), {
    executablePath: process.env.PDF_COPILOT_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    viewport: { width: 1100, height: 800 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--disable-extensions-except=' + fixture, '--load-extension=' + fixture, '--no-first-run'],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2], url = 'chrome-extension://' + id;
  await worker.evaluate(async baseUrl => {
    await chrome.storage.local.set({ settings: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low', baseUrl, theme: 'light' } });
    await chrome.storage.session.set({ 'apiKey:deepseek': 'synthetic', 'apiKey:openai': 'synthetic' });
  }, baseUrl);
  const reader = await context.newPage(); await reader.goto(url + '/reader/index.html');
  const pdf = samplePdf(8, false, true, { labels: true, lines: { 2: ['The coupling constant g is defined by equation (6.23).', 'Assume g is small. This is the perturbative approximation.'], 8: ['Equation (6.23) is used in this later derivation.'] } });
  await reader.locator('#file-input').setInputFiles({ name: 'synthetic-context.pdf', mimeType: 'application/pdf', buffer: pdf });
  await reader.waitForFunction(() => document.querySelector('#page-count').textContent.includes('8'));
  await reader.locator('#page-number').fill('8'); await reader.locator('#page-number').press('Enter');
  await reader.waitForFunction(() => document.querySelector('#page-surface')?.dataset.page === '8' && document.querySelector('#page-surface')?.classList.contains('page-ready'));
  const tab = await reader.evaluate(() => chrome.tabs.getCurrent());
  chat = await context.newPage(); await chat.goto(`${url}/chat/index.html?mode=quick&tab=${tab.id}&window=${tab.windowId}`);
  await chat.locator('#pdf-context-control').waitFor(); assert.equal(await chat.locator('#pdf-context').isChecked(), true, 'document context defaults on');
  for (const provider of ['deepseek', 'openai']) {
    if (provider === 'openai') {
      await chat.locator('#chat-menu summary').click(); await chat.locator('#clear').click();
      await worker.evaluate(async baseUrl => chrome.storage.local.set({ settings: { provider: 'openai', model: 'gpt-5.4-mini', effort: 'low', baseUrl, theme: 'light' } }), baseUrl);
      await chat.waitForFunction(() => document.querySelector('#provider').value === 'openai');
    }
    const start = requests.length;
    await chat.locator('#prompt').fill('Explain the assumption in equation (6.23), using the earlier definition.'); await chat.locator('#send').click();
    await chat.waitForFunction(() => document.querySelector('#stop').hidden && document.querySelector('.message.assistant'), undefined, { timeout: 60000 });
    assert.equal(await chat.locator('#status').textContent(), '回答完成。');
    const sent = requests.slice(start); assert.equal(sent.length, 4, 'three retrieval rounds then answer');
    const first = JSON.stringify(sent[0]); assert(first.includes('data:image/jpeg;base64,'), 'direct question includes current page');
    assert(first.includes(provider === 'deepseek' ? '当前 PDF 第 8 页' : '当前 PDF 第 2 页'), 'fresh reader page rather than stale source metadata');
    assert.equal(await chat.locator('.automatic-page').count(), 1);
    assert(sent[0].tools.some(tool => (tool.name || tool.function?.name) === 'pdf_view'));
    const last = JSON.stringify(sent.at(-1)); assert(last.includes('Assume g is small')); assert(!last.includes('%PDF-')); assert(last.includes('data:image/jpeg;base64,'));
    assert.equal(await chat.locator('.document-sources').count(), 1);
    await chat.locator('.document-sources summary').click();
    assert((await chat.locator('.document-sources').textContent()).includes('页标签 1 · PDF 第 2 页'));
    assert.equal(await chat.locator('.citation-inline').count(), 1, 'unknown evidence IDs stay plain text');
    await chat.locator('.citation-inline').click();
    await reader.waitForFunction(() => document.querySelector('#page-number').value === '2');
    await reader.locator('.selection-box:not([hidden])').first().waitFor({ state: 'visible' });
    assert.equal(await chat.locator('.katex').count() > 0, !lite);
    checks.push(provider + ' search/read/image/citation/page-labels'); console.log('PASS ' + checks.at(-1));
  }
  for (const width of [280, 340, 510]) {
    await chat.setViewportSize({ width, height: 720 });
    assert(await chat.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'context UI fits narrow pane');
  }
  await chat.setViewportSize({ width: 340, height: 720 });
  await chat.screenshot({ path: join(root, 'artifacts', 'context-chat' + (lite ? '-lite' : '') + '.png') });
  checks.push('context controls and source panel fit 280/340/510px'); console.log('PASS ' + checks.at(-1));
  const stores = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  const stored = JSON.stringify(stores); assert(!stored.includes('coupling constant')); assert(!stored.includes('data:image')); assert(!stored.includes('perturbative approximation'));
  checks.push('no PDF text/index/images persisted'); console.log('PASS ' + checks.at(-1));
  await chat.locator('#chat-menu summary').click(); await chat.locator('#clear').click();
  await chat.locator('#prompt').fill('TEST_CONTEXT_CANCEL'); await chat.locator('#send').click();
  await chat.locator('.answer-progress').waitFor();
  assert(await chat.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'busy controls fit narrow pane'); await chat.locator('#stop').click();
  assert.equal(await chat.locator('.answer-progress').count(), 0); assert((await chat.locator('#status').textContent()).includes('已停止'));
  checks.push('cancel releases PDF session and removes progress'); console.log('PASS ' + checks.at(-1));
  await chat.locator('#prompt').fill('TEST_CONTEXT_CANCEL_SWITCH'); await chat.locator('#send').click(); await chat.locator('.answer-progress').waitFor();
  await reader.locator('#file-input').setInputFiles({ name: 'replacement-context.pdf', mimeType: 'application/pdf', buffer: samplePdf(3) });
  await chat.waitForFunction(() => document.querySelector('#source-name').textContent === 'replacement-context.pdf' && document.querySelector('#stop').hidden);
  assert.equal(await chat.locator('.message').count(), 0); assert.equal(await chat.locator('.answer-progress').count(), 0);
  checks.push('switching PDF cancels the old retrieval and isolates messages'); console.log('PASS ' + checks.at(-1));
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error); if (chat) console.error(await chat.locator('#status').textContent().catch(() => ''));
  for (const payload of requests.slice(-1)) for (const item of payload.input || payload.messages || []) {
    if (item.role === 'tool' || item.type === 'function_call_output') {
      const value = item.content ?? item.output; const parsed = JSON.parse(typeof value === 'string' ? value : value[0].text);
      console.error('Tool result:', JSON.stringify({ error: parsed.error, evidence: parsed.evidence?.map(item => ({ page: item.page, sourceId: item.sourceId })) }));
    }
  }
  process.exitCode = 1;
}
finally {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', 'context-results' + (lite ? '-lite' : '') + '.json'), JSON.stringify({ checks, errors, requests: requests.length }, null, 2));
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
