// Isolated Edge, synthetic PDF and localhost model; no account or personal files.
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { samplePdf } from '../tests/fixtures/pdf.mjs';
import { DOCUMENT_LIMIT_FIELDS, DOCUMENT_LIMITS } from '../extension/common/document-limits.mjs';
const root = resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
const runtime = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(process.env.PDF_COPILOT_PLAYWRIGHT_PATH || join(runtime, 'playwright'));
const lite = process.env.PDF_COPILOT_MATH_PROFILE === 'plain';
const fixture = join(root, '.cache', 'resource-extension' + (lite ? '-lite' : ''));
await mkdir(fixture, { recursive: true }); await mkdir(join(root, 'artifacts'), { recursive: true });
await cp(join(root, 'dist', lite ? 'extension-lite' : 'extension'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*']; // Only in the localhost test copy.
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
const requests = [], errors = [], checks = []; let releaseFirst;
const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); response.end(); return; }
  if (request.url !== '/responses') { response.writeHead(404); response.end(); return; }
  let text = ''; for await (const chunk of request) text += chunk;
  const payload = JSON.parse(text); requests.push(payload);
  const initial = !payload.input.some(item => item.type === 'function_call_output');
  if (requests.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
  const output = initial ? Array.from({ length: 5 }, (_, i) => ({ type: 'function_call', id: 'fc' + i, call_id: 'view' + i, name: 'pdf_view', arguments: JSON.stringify({ page: i + 2, block_id: null }) })) : [];
  if (!initial) response.write('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '已核对图片，回答完成。' }) + '\n\n');
  response.end('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } }) + '\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const passed = text => { checks.push(text); console.log('PASS ' + text); };
const imageCount = payload => payload.input.flatMap(item => item.content || item.output || []).filter(part => part.type === 'input_image').length;
let context;
try {
  context = await chromium.launchPersistentContext(join(root, '.cache', 'edge-resources-' + Date.now()), {
    executablePath: process.env.PDF_COPILOT_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: { width: 1100, height: 850 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + fixture, '--load-extension=' + fixture, '--no-first-run'],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const url = 'chrome-extension://' + worker.url().split('/')[2];
  await worker.evaluate(async baseUrl => {
    await chrome.storage.local.set({ settings: { provider: 'openai', model: 'gpt-5.4-mini', effort: 'low', baseUrl, theme: 'light' } });
    await chrome.storage.session.set({ 'apiKey:openai': 'synthetic-key' });
  }, baseUrl);
  const settings = await context.newPage(); await settings.goto(url + '/settings/index.html');
  assert.equal(await settings.locator('#extension-version').textContent(), 'v' + manifest.version);
  assert.equal(await settings.locator('#limit-images').inputValue(), '5');
  assert.equal(await settings.locator('#resource-settings').getAttribute('open'), null);
  await settings.locator('#resource-settings summary').click();
  assert.equal(await settings.locator('#resource-fields input').count(), 7);
  passed('old preferences migrate to five page images; seven budget controls start folded');
  const save = async values => {
    for (const [key, value] of Object.entries(values)) await settings.locator('#limit-' + key).fill(String(value));
    await settings.locator('button[type=submit]').click();
    await settings.waitForFunction(() => document.querySelector('#status').textContent.startsWith('已保存'));
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.documentLimits);
    for (const [key, value] of Object.entries(values)) assert.equal(stored[key], value * (key === 'searchMilliseconds' ? 1000 : 1));
  };
  const reader = await context.newPage(); await reader.goto(url + '/reader/index.html');
  await reader.locator('#file-input').setInputFiles({ name: 'resource-demo.pdf', mimeType: 'application/pdf', buffer: samplePdf(10, false, true) });
  await reader.waitForFunction(() => document.querySelector('#page-surface')?.classList.contains('page-ready'));
  const tab = await reader.evaluate(() => chrome.tabs.getCurrent());
  const chat = await context.newPage(); await chat.goto(`${url}/chat/index.html?mode=quick&tab=${tab.id}&window=${tab.windowId}`);
  await chat.locator('#pdf-context-control').waitFor();
  await chat.locator('#prompt').fill('结合前后页面解释'); await chat.locator('#send').click();
  await chat.waitForFunction(() => !document.querySelector('#stop').hidden);
  for (let n = 0; !releaseFirst && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 50));
  assert(releaseFirst, 'first model request prepared');
  await save({ images: 2, calls: 4, pages: 3, characters: 1000, rounds: 1, searchPages: 20, searchMilliseconds: 2 });
  releaseFirst();
  await chat.waitForFunction(() => document.querySelector('#stop').hidden);
  assert.equal(await chat.locator('#status').textContent(), '回答完成。'); assert.equal(imageCount(requests.at(-1)), 5);
  passed('in-flight question keeps its original budget and receives five actual rendered pages');
  await settings.reload(); await settings.locator('#limit-images').waitFor({ state: 'attached' });
  assert.equal(await settings.locator('#limit-images').inputValue(), '2'); await settings.locator('#resource-settings summary').click();
  assert.equal(await settings.locator('#limit-searchMilliseconds').inputValue(), '2');
  passed('custom budgets persist across settings reload with correct seconds conversion');
  await chat.locator('#prompt').fill('解释新问题'); await chat.locator('#send').click();
  await chat.waitForFunction(() => document.querySelectorAll('.message.assistant').length === 2 && document.querySelector('#stop').hidden);
  assert.equal(await chat.locator('#status').textContent(), '回答完成。'); assert.equal(imageCount(requests.at(-1)), 2);
  const body = requests.at(-2).input.at(-1).content.find(item => item.type === 'input_text').text;
  assert(body.includes('"images":2')); assert(body.includes('"characters":1000'));
  assert.equal(requests.at(-1).tools, undefined);
  passed('next question uses saved image, text, call and round limits without stale-window state');
  await save({ images: 7, pages: 40, calls: 60, characters: 120000, rounds: 8, searchPages: 500, searchMilliseconds: 30 });
  await settings.locator('#reset-resource-limits').click();
  for (const field of DOCUMENT_LIMIT_FIELDS) assert.equal(Number(await settings.locator('#limit-' + field.key).inputValue()), field.default / (field.scale || 1));
  await save({});
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.documentLimits), { ...DOCUMENT_LIMITS });
  await settings.locator('#limit-images').fill('11');
  assert.equal(await settings.locator('#limit-images').evaluate(input => input.checkValidity()), false);
  await settings.locator('button[type=submit]').click();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.documentLimits.images), 5);
  await settings.locator('#limit-images').fill('5');
  passed('higher budgets, reset and out-of-range validation preserve saved preferences');
  await settings.setViewportSize({ width: 390, height: 840 });
  assert(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await settings.locator('#resource-settings').screenshot({ path: join(root, 'artifacts', 'resource-settings' + (lite ? '-lite' : '') + '.png') });
  assert.equal(errors.length, 0, errors.join('\n'));
  passed('resource controls fit narrow screens with no browser errors');
  await writeFile(join(root, 'artifacts', 'resource-limits-report' + (lite ? '-lite' : '') + '.json'), JSON.stringify({ checks, modelRequests: requests.length, errors }, null, 2));
} finally {
  releaseFirst?.(); await context?.close(); await new Promise(resolve => server.close(resolve));
}
