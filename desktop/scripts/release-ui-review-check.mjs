// Release-specific regressions. Native discovery is fully simulated in an
// isolated browser profile; no real credentials or model requests are used.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:1491';
const artifacts = resolve('artifacts');
const checks = [], errors = [], remoteRequests = [];
let vite, browser, page;
const pane = () => page.locator('.ai-pane:not(.pane-leave-active)');
const picker = () => pane().getByRole('button', { name: '选择模型与思考强度', exact: true });
const menu = () => pane().getByRole('group', { name: '模型与思考强度', exact: true });
async function settle() { await page.waitForTimeout(650); }
// Esc steps back from the model list first, then closes the card.
async function closeMenu() { if (await menu().isVisible()) await page.keyboard.press('Escape'); await menu().waitFor({ state: 'hidden' }); }
// 模型胶囊直接排在抽屉里，不再需要先切到列表。
const modelList = async () => {};
const effortSlider = () => menu().getByRole('slider', { name: '思考强度', exact: true });

try {
  await mkdir(artifacts, { recursive: true });
  vite = await createServer({ cacheDir: resolve(artifacts, 'vite-release-ui-review'), server: { host: '127.0.0.1', port: 1491, strictPort: true, watch: null } });
  await vite.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.addInitScript(() => localStorage.setItem('paperdesk.ai.settings.v1', JSON.stringify({ provider: 'codex', model: 'saved-custom-model', effort: 'xhigh', baseUrl: 'preserved-endpoint', rememberKey: false, documentLimits: { maxToolRounds: 11 }, requestLimits: { concurrent: 2, codex: 1, queued: 4 } })));
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles(['模型菜单-A.md', '模型菜单-B.md'].map(name => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(`# ${name}\n\n仅用于本地 UI 测试。`) })));
  await page.getByRole('tab', { name: '模型菜单-A.md', exact: true }).click();
  await page.locator('.markdown-paper:visible').waitFor();
  await settle();
  await page.evaluate(() => {
    const ports = new Map(); let next = 0;
    window.__reviewDiscovery = { calls: [], ports, held: [], fail: false, hold: false, models: Array.from({ length: 7 }, (_, index) => ({ id: `review-${index}`, name: `评审模型 ${index}`, efforts: index === 5 ? ['low', 'high'] : ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', vision: true })) };
    window.__TAURI_INTERNALS__ = {
      transformCallback() { return ++next; }, unregisterCallback() {},
      async invoke(command, args) {
        if (command === 'get_credential') return '';
        if (command === 'native_connect') { ports.set(++next, args.channel); return next; }
        if (command === 'native_disconnect') { ports.delete(args.sessionId); return; }
        if (command !== 'native_send') throw new Error(`Unexpected IPC command: ${command}`);
        const state = window.__reviewDiscovery, channel = ports.get(args.sessionId), message = args.message;
        state.calls.push(message.type);
        if (message.type !== 'status' && message.type !== 'models') throw new Error(`Unexpected request: ${message.type}`);
        const respond = () => channel.onmessage({ id: message.id, ok: true, result: message.type === 'status' ? { compatible: true, loggedIn: !state.fail, diagnostic: state.fail ? '模拟未登录' : '', version: 'mock' } : state.models });
        if (message.type === 'models' && state.hold) state.held.push(respond);
        else queueMicrotask(respond);
      },
    };
  });
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await pane().getByRole('textbox', { name: '向 AI 提问', exact: true }).fill('保留用户草稿');
  const before = await page.evaluate(() => localStorage.getItem('paperdesk.ai.settings.v1'));
  await picker().click(); await modelList();
  await menu().getByRole('option', { name: '评审模型 6', exact: true }).waitFor();
  assert.equal(await menu().getByRole('option').count(), 9);
  assert.deepEqual(await page.evaluate(() => window.__reviewDiscovery.calls), ['status', 'models']);
  assert.equal(await page.evaluate(() => localStorage.getItem('paperdesk.ai.settings.v1')), before);
  checks.push('Cold composer discovers every Codex model without opening settings or changing stored configuration.');
  await menu().getByRole('option', { name: '评审模型 5', exact: true }).click();
  assert.equal(await effortSlider().getAttribute('aria-valuemax'), '2', 'Efforts follow the model: default, low, high.');
  await effortSlider().focus(); await effortSlider().press('Home'); await effortSlider().press('ArrowRight');
  assert.equal(await effortSlider().getAttribute('aria-valuetext'), '低');
  const chosen = await page.evaluate(() => JSON.parse(localStorage.getItem('paperdesk.ai.settings.v1')));
  assert.deepEqual(chosen, { ...JSON.parse(before), model: 'review-5', effort: 'low' });
  assert.equal(await pane().getByRole('textbox', { name: '向 AI 提问', exact: true }).inputValue(), '保留用户草稿');
  await closeMenu(); await picker().click();
  assert.deepEqual(await page.evaluate(() => window.__reviewDiscovery.calls), ['status', 'models']);
  await closeMenu();
  checks.push('Model switch adapts supported efforts, writes only model/effort, retains the draft and uses the cached inventory.');

  await picker().click(); await page.getByRole('button', { name: '打开设置', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: 'AI', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByLabel('模型', { exact: true }).waitFor();
  await page.evaluate(() => window.__reviewDiscovery.models = [{ id: 'new-inventory', name: '新读取的模型', efforts: ['low', 'high'], defaultEffort: 'high', vision: true }]);
  await dialog.getByRole('button', { name: '检查登录并读取模型', exact: true }).click();
  await dialog.getByRole('option', { name: '新读取的模型', exact: true }).waitFor({ state: 'attached' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await picker().click(); await modelList();
  await menu().getByRole('option', { name: '新读取的模型', exact: true }).waitFor();
  assert.equal(await menu().getByRole('option', { name: '评审模型 6', exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('paperdesk.ai.settings.v1'))), chosen);
  await closeMenu();
  checks.push('Refreshing models in settings updates an already-cached composer menu even when settings are cancelled.');

  await page.evaluate(async () => { (await import('/src/ai/native-models.ts')).registerNativeModelInventory([]); window.__reviewDiscovery.fail = true; });
  await picker().click();
  await menu().getByText('模拟未登录', { exact: true }).waitFor();
  await page.evaluate(() => window.__reviewDiscovery.fail = false);
  await modelList();
  await menu().getByRole('button', { name: '重新读取本机模型', exact: true }).click();
  await menu().getByRole('option', { name: '新读取的模型', exact: true }).waitFor();
  await closeMenu();
  checks.push('Discovery failure is visible and retry recovers without changing the saved model.');

  await page.evaluate(async () => { (await import('/src/ai/native-models.ts')).registerNativeModelInventory([]); window.__reviewDiscovery.hold = true; });
  await picker().click();
  await page.waitForFunction(() => window.__reviewDiscovery.held.length === 1);
  await page.getByRole('tab', { name: '模型菜单-B.md', exact: true }).click();
  await menu().waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.__reviewDiscovery.ports.size === 0);
  await page.evaluate(() => { window.__reviewDiscovery.held.splice(0).forEach(respond => respond()); window.__reviewDiscovery.hold = false; });
  assert.equal(await page.evaluate(async () => (await import('/src/ai/native-models.ts')).nativeModelInventory.value.length), 0);
  checks.push('Switching documents cancels pending discovery, closes its mock port and ignores the late result.');

  for (const mode of ['solid', 'high']) {
    await page.evaluate(mode => { document.documentElement.dataset.glass = mode === 'solid' ? 'solid' : 'custom'; document.documentElement.dataset.contrast = mode === 'high' ? 'high' : 'normal'; }, mode);
    await settle();
    const bounds = await page.locator('.tab-strip').evaluate(group => { const a = group.querySelector('.liquid-indicator').getBoundingClientRect(), b = group.querySelector('.file-tab.selected').getBoundingClientRect(); return { dx: Math.abs(a.left - b.left), dy: Math.abs(a.top - b.top), dw: Math.abs(a.width - b.width), dh: Math.abs(a.height - b.height) }; });
    for (const difference of Object.values(bounds)) assert.ok(difference < 1, `${mode}: ${JSON.stringify(bounds)}`);
  }
  checks.push('The selected second tab and liquid indicator stay aligned in both solid and high-contrast modes.');

  await page.evaluate(() => { const button = document.querySelector('.sidebar-toggle'); button.dataset.tip = '很长的自定义提示词'.repeat(1600); document.documentElement.dataset.contrast = 'normal'; });
  await page.locator('.sidebar-toggle').hover(); await settle();
  const tip = await page.locator('.glass-tooltip.visible').boundingBox();
  assert.ok(tip && tip.height <= 200 && tip.y >= 0 && tip.y + tip.height <= 960, JSON.stringify(tip));
  checks.push('A 16000-character custom tooltip is bounded and remains inside the viewport.');
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  await writeFile(resolve(artifacts, 'release-ui-review-check.json'), JSON.stringify({ checks, errors, remoteRequests }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors, remoteRequests }));
} finally {
  await browser?.close();
  await vite?.close();
}
