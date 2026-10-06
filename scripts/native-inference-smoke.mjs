// Explicitly invoked real Codex test: two tiny synthetic inputs only.
// Requires the user's existing Native Messaging host and CLI login.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtime = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const playwright = require(process.env.PDF_COPILOT_PLAYWRIGHT_PATH || join(runtime, 'playwright'));
let context, chat;
const result = { text: 'not_run', image: 'not_run' };
try {
  context = await playwright.chromium.launchPersistentContext(join(root, '.cache', 'edge-native-inference-' + Date.now()), {
    executablePath: process.env.PDF_COPILOT_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: { width: 510, height: 720 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + join(root, 'dist', 'extension'), '--load-extension=' + join(root, 'dist', 'extension'), '--no-first-run'],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  await worker.evaluate(() => chrome.storage.local.set({ settings: { provider: 'codex', model: '', effort: 'low', theme: 'light', baseUrl: '', rememberKey: false } }));
  const source = await context.newPage(); await source.goto('chrome-extension://' + id + '/reader/index.html');
  const tab = await source.evaluate(() => chrome.tabs.getCurrent());
  chat = await context.newPage(); await chat.goto(`chrome-extension://${id}/chat/index.html?mode=quick&tab=${tab.id}&window=${tab.windowId}`);
  await chat.locator('#refresh').click();
  await chat.waitForFunction(() => !document.querySelector('#refresh').disabled, undefined, { timeout: 45000 });
  const models = await worker.evaluate(async () => (await chrome.storage.local.get('nativeModels')).nativeModels || []);
  assert(models.length > 0, await chat.locator('#status').textContent());
  const model = models.find(model => /mini/.test(model.id)) || models[0]; result.model = model.id;
  await chat.locator('#model-options summary').click();
  await chat.locator('#model').fill(model.id); await chat.locator('#model').press('Tab');
  const efforts = await chat.locator('#effort option').evaluateAll(options => options.map(option => option.value));
  if (efforts.includes('low')) await chat.locator('#effort').selectOption('low');
  const send = async prompt => {
    await chat.locator('#prompt').fill(prompt); await chat.locator('#send').click();
    await chat.locator('.answer-progress').waitFor();
    await chat.waitForFunction(() => document.querySelector('#stop').hidden, undefined, { timeout: 60000 });
    assert.equal(await chat.locator('#status').textContent(), '回答完成。');
    assert.equal(await chat.locator('.message.assistant.error').count(), 0);
    assert.equal(await chat.locator('.answer-progress').count(), 0);
    return chat.locator('.message.assistant .body').last().textContent();
  };
  const text = await send('Synthetic connection test. Reply with PDF_COPILOT_TEST_OK only. Do not use tools.');
  assert.match(text, /PDF_COPILOT_TEST_OK/); result.text = 'pass'; console.log('PASS real Codex text round trip');
  await chat.locator('#chat-menu summary').click(); await chat.locator('#clear').click();
  await chat.evaluate(async tab => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 64, 64);
    context.fillStyle = 'red'; context.fillRect(16, 16, 32, 32);
    const response = await chrome.runtime.sendMessage({ type: 'context:add', target: 'quick', context: {
      kind: 'image', dataUrl: canvas.toDataURL('image/png'), title: 'Synthetic color test',
      source: { name: 'Synthetic image', tabId: tab.id, windowId: tab.windowId },
    } });
    assertResponse(response);
    function assertResponse(response) { if (!response?.ok) throw new Error(response?.error || 'Cannot add synthetic image'); }
  }, tab);
  await chat.locator('.attachment img').waitFor();
  const image = await send('Describe the central shape and its color in this synthetic picture. One short sentence. Do not use tools.');
  assert.match(image, /red|红/i); assert.match(image, /square|方形|方块|正方/i);
  result.image = 'pass'; console.log('PASS real Codex synthetic image round trip');
  const local = await worker.evaluate(() => chrome.storage.local.get(null));
  assert(!JSON.stringify(local).includes('data:image'));
} catch (error) {
  result.error = error.message;
  result.status = chat ? await chat.locator('#status').textContent({ timeout: 500 }).catch(() => '') : '';
  console.error('Native inference test failed:', result.error, result.status); process.exitCode = 1;
} finally {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', 'native-inference-results.json'), JSON.stringify(result, null, 2));
  await context?.close();
}
