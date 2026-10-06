// Local synthetic PDFs and model replies, isolated Edge profile, no account calls.
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { samplePdf } from '../tests/fixtures/pdf.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url), lite = process.env.PDF_COPILOT_MATH_PROFILE === 'plain';
const runtime = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(process.env.PDF_COPILOT_PLAYWRIGHT_PATH || join(runtime, 'playwright'));
const fixture = join(root, '.cache', 'page-extension' + (lite ? '-lite' : ''));
await mkdir(fixture, { recursive: true }); await mkdir(join(root, 'artifacts'), { recursive: true });
await cp(join(root, 'dist', lite ? 'extension-lite' : 'extension'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
// A headless test cannot click the browser action to grant activeTab. Explicit
// grant ONLY in this synthetic test copy; shipped manifest stays unchanged.
manifest.host_permissions = ['<all_urls>'];
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
const requests = [], checks = [], errors = [];
const pdf = samplePdf(6, false, true);
const server = createServer(async (request, response) => {
  if (request.url === '/native.pdf') { response.writeHead(200, { 'Content-Type': 'application/pdf' }); response.end(pdf); return; }
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); response.end(); return; }
  if (request.url !== '/chat/completions') { response.writeHead(404); response.end(); return; }
  let text = ''; for await (const chunk of request) text += chunk;
  const payload = JSON.parse(text); requests.push(payload);
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
  response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '这是当前页的解释。\n$$E=mc^2$$' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
let context, chat;
const images = payload => payload.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : []);
const passed = text => { checks.push(text); console.log('PASS ' + text); };
try {
  context = await chromium.launchPersistentContext(join(root, '.cache', 'edge-page-' + Date.now()), {
    executablePath: process.env.PDF_COPILOT_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: { width: 1200, height: 820 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + fixture, '--load-extension=' + fixture, '--no-first-run'],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const url = 'chrome-extension://' + worker.url().split('/')[2];
  const settingsPage = await context.newPage(); await settingsPage.goto(url + '/settings/index.html');
  assert.equal(await settingsPage.locator('#extension-version').textContent(), 'v' + manifest.version);
  await settingsPage.close();
  await worker.evaluate(async baseUrl => {
    await chrome.storage.local.set({ settings: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low', baseUrl, theme: 'light' } });
    await chrome.storage.session.set({ 'apiKey:deepseek': 'synthetic-key' });
  }, baseUrl);
  const reader = await context.newPage(); await reader.goto(url + '/reader/index.html');
  await reader.locator('#file-input').setInputFiles({ name: 'page-demo.pdf', mimeType: 'application/pdf', buffer: pdf });
  const ready = number => reader.waitForFunction(number => document.querySelector('#page-surface')?.dataset.page === String(number) && document.querySelector('#page-surface')?.classList.contains('page-ready'), number);
  await ready(1);
  const tab = await reader.evaluate(() => chrome.tabs.getCurrent());
  chat = await context.newPage(); await chat.goto(`${url}/chat/index.html?mode=quick&tab=${tab.id}&window=${tab.windowId}`);
  await chat.locator('#pdf-context-control').waitFor(); assert(await chat.locator('#pdf-context').isChecked());
  const send = async prompt => {
    const start = requests.length;
    const previous = await chat.locator('.message.assistant').count();
    await chat.locator('#prompt').fill(prompt); await chat.locator('#send').click();
    await chat.waitForFunction(previous => document.querySelector('#stop').hidden && document.querySelectorAll('.message.assistant').length > previous, previous);
    assert.equal(await chat.locator('#status').textContent(), '回答完成。');
    assert.equal(requests.length, start + 1); return requests.at(-1);
  };
  for (const number of [4, 2]) {
    await reader.locator('#page-number').fill(String(number)); await reader.locator('#page-number').press('Enter'); await ready(number);
    const sent = await send('解释现在这一页');
    assert.equal(images(sent).length, 1); assert(JSON.stringify(sent).includes('当前 PDF 第 ' + number + ' 页'));
    assert(JSON.stringify(sent).includes('Synthetic page ' + number));
  }
  passed('default on; direct questions follow fresh reader page; historical pixels excluded');
  await chat.setViewportSize({ width: 340, height: 720 });
  await chat.waitForFunction(() => document.querySelector('#composer').getBoundingClientRect().bottom <= innerHeight + 1);
  await chat.screenshot({ path: join(root, 'artifacts', 'page-direct-chat' + (lite ? '-lite' : '') + '.png') });
  await chat.locator('.automatic-page summary').first().click();
  assert(await chat.locator('.automatic-page img').first().isVisible());
  passed('sent current page has a collapsible preview and exact physical page');
  // Manual selection uses the existing inbox, not a test-only message pathway.
  // Read actual identity via the public source broker.
  const source = await chat.evaluate(tabId => chrome.runtime.sendMessage({ type: 'source:get', tabId }), tab.id);
  await chat.evaluate(async ({ tab, key }) => chrome.runtime.sendMessage({ type: 'context:add', target: 'quick', context: {
    kind: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5qkAAAAASUVORK5CYII=', title: 'manual-crop',
    source: { tabId: tab.id, windowId: tab.windowId, fingerprint: key, page: 2 },
  } }), { tab, key: source.tab.documentKey });
  await chat.locator('.attachment').waitFor();
  const manual = await send('解释所选公式'); assert.equal(images(manual).length, 1); assert(JSON.stringify(manual.messages.at(-1)).includes('manual-crop'));
  assert(!JSON.stringify(manual.messages.at(-1)).includes('当前 PDF 第 2 页'));
  passed('manual crop suppresses duplicate current-page attachment');
  await chat.locator('#pdf-context').uncheck(); await chat.reload();
  await chat.locator('#pdf-context-control').waitFor(); assert(!await chat.locator('#pdf-context').isChecked());
  const off = await send('仅回答这个问题'); assert.equal(images(off).length, 0); assert(!off.tools);
  await worker.evaluate(() => chrome.storage.local.set({ pdfContextEnabled: true }));
  await chat.waitForFunction(() => document.querySelector('#pdf-context').checked);
  passed('explicit off survives reload; preference updates synchronize live');
  await chat.locator('#model-options summary').click(); await chat.locator('#model').fill('deepseek-v4-pro'); await chat.locator('#model').dispatchEvent('change');
  const textOnly = await send('解释这页文字'); assert.equal(images(textOnly).length, 0); assert(JSON.stringify(textOnly).includes('[当前页文字；模型不支持图片]'));
  passed('text-only model automatically gets page text');
  for (const width of [280, 340, 510]) {
    await chat.setViewportSize({ width, height: 720 });
    assert(await chat.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#composer').getBoundingClientRect().bottom <= innerHeight + 1));
  }
  await chat.locator('#model-options summary').click(); await chat.setViewportSize({ width: 340, height: 720 });
  await chat.screenshot({ path: join(root, 'artifacts', 'page-chat' + (lite ? '-lite' : '') + '.png') });
  for (const width of [510, 869, 1200]) {
    await reader.setViewportSize({ width, height: 820 }); assert(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await reader.waitForFunction(() => !document.querySelector('#status').textContent.includes('正在渲染'));
  await reader.screenshot({ path: join(root, 'artifacts', 'page-reader' + (lite ? '-lite' : '') + '.png') });
  passed('new UI fits narrow chat and reader widths');
  await reader.locator('#file-input').setInputFiles({ name: 'no-text-layer.pdf', mimeType: 'application/pdf', buffer: samplePdf(1, false, false, { lines: { 1: [] } }) });
  await chat.waitForFunction(() => document.querySelector('#source-name').textContent === 'no-text-layer.pdf');
  const beforeEmpty = requests.length;
  await chat.locator('#prompt').fill('解释这张扫描页'); await chat.locator('#send').click();
  await chat.waitForFunction(() => document.querySelector('#stop').hidden && document.querySelector('#status').textContent.includes('当前页没有文字层'));
  assert.equal(requests.length, beforeEmpty);
  passed('text-only model on a page without text stops with a clear model-switch hint');
  const native = await context.newPage(); await native.goto(baseUrl + '/native.pdf'); await native.waitForTimeout(500);
  const nativeTab = await worker.evaluate(async baseUrl => (await chrome.tabs.query({ url: baseUrl + '/native.pdf' }))[0], baseUrl);
  await chat.close(); chat = await context.newPage();
  await worker.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, model: 'deepseek-flash' } }); });
  await chat.goto(`${url}/chat/index.html?mode=quick&tab=${nativeTab.id}&window=${nativeTab.windowId}`);
  await chat.locator('#pdf-context-control').waitFor();
  const nativeSent = await send('解释浏览器当前可见页'); assert.equal(images(nativeSent).length, 1);
  assert(JSON.stringify(nativeSent).includes('当前可见区域')); assert(!nativeSent.tools);
  assert(await chat.locator('.automatic-page').isVisible());
  passed('native browser PDF direct question attaches actual visible screenshot');
  await worker.evaluate(() => { globalThis.savedCapture = chrome.tabs.captureVisibleTab; chrome.tabs.captureVisibleTab = async () => { throw new Error('synthetic permission denied'); }; });
  const count = requests.length;
  await chat.locator('#prompt').fill('权限拒绝不能发出空上下文请求'); await chat.locator('#send').click();
  await chat.waitForFunction(() => document.querySelector('#stop').hidden && document.querySelector('#status').textContent.includes('无法读取当前可见页'));
  assert.equal(requests.length, count);
  await worker.evaluate(() => { chrome.tabs.captureVisibleTab = globalThis.savedCapture; delete globalThis.savedCapture; });
  passed('native permission denial blocks incomplete upload and gives actionable guidance');
  await worker.evaluate(() => {
    globalThis.savedCapture = chrome.tabs.captureVisibleTab;
    chrome.tabs.captureVisibleTab = () => new Promise(resolve => { globalThis.releaseCapture = resolve; });
  });
  await chat.locator('#prompt').fill('准备截图时停止'); await chat.locator('#send').click();
  await chat.locator('.answer-progress').waitFor();
  await worker.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      if (typeof globalThis.releaseCapture === 'function') return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('snapshot gate did not start');
  });
  await chat.locator('#stop').click();
  await worker.evaluate(dataUrl => {
    globalThis.releaseCapture(dataUrl); delete globalThis.releaseCapture;
    chrome.tabs.captureVisibleTab = globalThis.savedCapture; delete globalThis.savedCapture;
  }, images(nativeSent)[0].image_url.url);
  await chat.waitForTimeout(100);
  assert.equal(requests.length, count); assert.equal(await chat.locator('.answer-progress').count(), 0);
  passed('stop during snapshot preparation never sends late pixels or a model request');
  const stores = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  assert(!JSON.stringify(stores).includes('data:image')); assert(!JSON.stringify(stores).includes('Synthetic page'));
  passed('automatic snapshots and PDF text never persist in browser storage');
  assert.deepEqual(errors, []);
} catch (error) { console.error(error); if (chat) console.error(await chat.locator('#status').textContent().catch(() => '')); process.exitCode = 1; }
finally {
  await writeFile(join(root, 'artifacts', 'page-results' + (lite ? '-lite' : '') + '.json'), JSON.stringify({ version: manifest.version, checks, errors, requests: requests.length, limitation: 'Headless native capture uses explicit all_urls grant only in the isolated synthetic test copy.' }, null, 2));
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
