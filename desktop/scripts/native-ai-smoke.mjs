// Production Windows UI smoke. Only the local synthetic model service receives requests.
// Run after packaging, with no other desktop test instance active.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const { productName } = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const portableExecutable = join(root, 'release', `${productName}-portable`, `${productName}.exe`);
const executable = process.env.PHYDOG_NATIVE_EXE ? resolve(process.env.PHYDOG_NATIVE_EXE) : portableExecutable;
if (![resolve(root, 'src-tauri/target/release/phydog.exe'), portableExecutable].some(path => path.toLowerCase() === executable.toLowerCase())) {
  throw new Error('Production AI smoke test only accepts this project’s fixed release/portable executable.');
}
const artifacts = join(root, 'artifacts');
const debugPort = 9228;
const credentialProvider = 'openai';
const fakeKey = 'phydog-native-ai-smoke-key';
const settingsKey = 'paperdesk.ai.settings.v1';
const fixtureName = `native-ai-smoke-${randomUUID()}.md`;
const fixturePath = join(artifacts, fixtureName);
await access(executable);
await mkdir(artifacts, { recursive: true });
await writeFile(fixturePath, '# Production native AI smoke\n\nThis is a synthetic test document.\n\n' +
  Array.from({ length: 80 }, (_, at) => `Synthetic paragraph ${at + 1}. No user document contents are included.\n\n`).join('') +
  '## Source evidence\n\nSMOKE_TARGET: This evidence verifies local document retrieval and clickable line references.\n\n' +
  Array.from({ length: 30 }, (_, at) => `Synthetic closing paragraph ${at + 1}.\n\n`).join(''));

const report = [], pageErrors = [], consoleErrors = [], sockets = new Set();
let application, browser, page, importedId, oldSettings, oldCredential, backedUp = false;
let mode = 'answer', calls = 0, evidence, stoppedResponse, stoppedClosed = false, requestCount = 0;
const frame = event => `data: ${JSON.stringify(event)}\n\n`;
const modelServer = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/responses');
    assert.equal(request.headers.authorization, `Bearer ${fakeKey}`, 'Only the synthetic credential may reach the mock service');
    let body = '';
    for await (const chunk of request) { body += chunk; assert.ok(body.length < 1_000_000); }
    const payload = JSON.parse(body);
    assert.equal(payload.model, 'native-smoke-model');
    assert.equal(payload.store, false);
    requestCount++;
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    if (mode === 'stop') {
      stoppedResponse = response;
      response.on('close', () => { stoppedClosed = true; });
      response.write(frame({ type: 'response.output_text.delta', delta: '取消时保留的流式片段。' }));
      return;
    }
    if (++calls === 1) {
      assert.ok(payload.tools.some(tool => tool.name === 'pdf_search'));
      response.end(frame({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'native-search', name: 'pdf_search',
        arguments: JSON.stringify({ query: 'SMOKE_TARGET', start_page: null, end_page: null, next_page: null }) }] } }));
    } else if (calls === 2) {
      const result = JSON.parse(payload.input.findLast(item => item.type === 'function_call_output').output);
      evidence = result.evidence.find(item => item.text.includes('SMOKE_TARGET'));
      assert.ok(evidence?.sourceId && evidence.line, 'The native question must retrieve the synthetic source');
      response.end(frame({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'native-read', name: 'pdf_read',
        arguments: JSON.stringify({ start_page: evidence.page, end_page: null, block_id: evidence.blockId }) }] } }));
    } else {
      const result = JSON.parse(payload.input.findLast(item => item.type === 'function_call_output').output);
      assert.ok(result.evidence.some(item => item.sourceId === evidence.sourceId));
      response.write(frame({ type: 'response.reasoning_summary_text.delta', delta: '核对合成文档中的原文。' }));
      response.write(frame({ type: 'response.output_text.delta', delta: '真实 Rust HTTP 流式片段，' }));
      setTimeout(() => {
        if (!response.destroyed) response.write(frame({ type: 'response.output_text.delta', delta: `引用 [${evidence.sourceId}]。公式 $E=mc^2$。` }));
      }, 250);
      setTimeout(() => {
        if (!response.destroyed) response.end(frame({ type: 'response.completed', response: { status: 'completed', output: [] } }));
      }, 1200);
    }
  } catch {
    // Avoid putting request bodies or credentials in errors and artifacts.
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Synthetic native AI smoke protocol assertion failed.' } }));
  }
});
modelServer.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
const address = modelServer.address();
const baseUrl = `http://127.0.0.1:${address.port}/v1`;
async function invoke(command, args) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
}
async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

try {
  application = spawn(executable, [], { cwd: resolve(executable, '..'), windowsHide: true, stdio: 'ignore', env: {
    ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${debugPort}`,
  } });
  const childErrors = [];
  application.on('error', error => childErrors.push(error.message));
  const endpoint = await until(async () => {
    try { const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1000) }); return response.ok && (await response.json()).webSocketDebuggerUrl; }
    catch { if (childErrors.length) throw new Error('Could not start the production application.'); return false; }
  }, 'Production WebView2 debugging endpoint did not become ready.', 30000);
  browser = await chromium.connectOverCDP(endpoint);
  page = await until(async () => browser.contexts().flatMap(context => context.pages()).find(candidate => /tauri\.localhost/.test(candidate.url())), 'Could not find the bundled production window.');
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Store a category only; raw browser messages can include request URLs or credentials.
    consoleErrors.push(/content.security.policy|\bCSP\b|connect-src/i.test(text) ? 'Bundled WebView CSP error'
      : /failed to load resource|\bHTTP\b/i.test(text) ? 'Bundled WebView resource or HTTP error' : 'Bundled WebView JavaScript console error');
  });
  assert.ok(!page.url().includes('1420'), 'The smoke must use bundled production assets');
  oldSettings = await page.evaluate(key => localStorage.getItem(key), settingsKey);
  oldCredential = await invoke('get_credential', { provider: credentialProvider });
  backedUp = true;
  // Seeding a synthetic credential prevents asynchronous settings loading from seeing a real key.
  await invoke('set_credential', { provider: credentialProvider, key: fakeKey });
  const imported = await invoke('import_documents', { paths: [fixturePath] });
  importedId = imported[0].id;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `打开 ${fixtureName}`, exact: true }).click();
  if (!(await page.locator('.ai-pane').isVisible())) await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await page.getByRole('button', { name: '更改', exact: true }).click();
  await page.getByLabel('服务商', { exact: true }).selectOption('openai');
  await page.getByLabel('API 地址', { exact: true }).fill(baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill(fakeKey);
  await page.getByLabel('模型', { exact: true }).fill('native-smoke-model');
  await page.getByLabel('思考强度', { exact: true }).selectOption('');
  await page.getByLabel('在这台电脑记住密钥').uncheck();
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('textbox', { name: '向 AI 提问', exact: true }).fill('检索 SMOKE_TARGET 并引用原文，用公式展示回答。');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await page.locator('.answer-body').filter({ hasText: '真实 Rust HTTP 流式片段' }).waitFor();
  assert.ok(!(await page.locator('.ai-status').textContent()).includes('回答完成'), 'A partial answer should render before the final SSE completion');
  await page.locator('.ai-status').filter({ hasText: '回答完成' }).waitFor();
  assert.equal(calls, 3);
  assert.ok(await page.locator('.answer-body .katex').count());
  await page.locator('.inline-citation').first().click();
  await page.locator('.source-highlight').waitFor();
  await page.waitForFunction(expectedLine => {
    const viewport = document.querySelector('.markdown-scroll');
    const target = document.querySelector('.source-highlight');
    if (!viewport || !target || viewport.scrollTop <= 0 || Number(target.getAttribute('data-source-line')) !== expectedLine) return false;
    const bounds = viewport.getBoundingClientRect(), source = target.getBoundingClientRect();
    return source.top < bounds.bottom && source.bottom > bounds.top;
  }, evidence.line);
  report.push('Production UI settings/send; Rust HTTP streaming; bounded search/read; reasoning; formula; clickable source line');
  await page.screenshot({ path: join(artifacts, 'native-ai-smoke.png'), animations: 'disabled' });

  await page.getByRole('button', { name: '清空对话', exact: true }).click();
  mode = 'stop';
  await page.getByRole('textbox', { name: '向 AI 提问', exact: true }).fill('停止测试：请持续回答。');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await page.locator('.answer-body').filter({ hasText: '取消时保留的流式片段' }).waitFor();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.locator('.ai-status').filter({ hasText: '回答已停止' }).waitFor();
  await page.getByRole('button', { name: '发送 ↑', exact: true }).waitFor();
  await until(() => stoppedClosed, 'Stopping the answer did not close the Rust HTTP response body.');
  report.push('Stop retains received text, restores composer, and cancels the native HTTP response body');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await writeFile(join(artifacts, 'native-ai-smoke.json'), JSON.stringify({ report, mockRequests: requestCount, pageErrors, consoleErrors }, null, 2));
  console.log(JSON.stringify({ report, mockRequests: requestCount, pageErrors, consoleErrors }, null, 2));
} finally {
  const cleanupErrors = [];
  if (page && !page.isClosed()) {
    // Return to the library before deleting the synthetic record; user records are untouched.
    await page.getByRole('button', { name: '文档库', exact: true }).click().catch(() => {});
    if (importedId) await invoke('remove_document', { id: importedId }).catch(() => cleanupErrors.push('synthetic document cleanup'));
    if (backedUp) {
      await invoke('set_credential', { provider: credentialProvider, key: oldCredential || '' }).catch(() => cleanupErrors.push('credential restoration'));
      await page.evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }, { key: settingsKey, value: oldSettings }).catch(() => cleanupErrors.push('settings restoration'));
    }
  } else if (backedUp || importedId) cleanupErrors.push('production window closed before restoration');
  stoppedResponse?.destroy();
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => modelServer.close(resolve));
  await browser?.close().catch(() => {});
  application?.kill();
  await unlink(fixturePath).catch(() => {});
  if (cleanupErrors.length) throw new Error('Native AI smoke cleanup requires attention: ' + cleanupErrors.join(', '));
}
