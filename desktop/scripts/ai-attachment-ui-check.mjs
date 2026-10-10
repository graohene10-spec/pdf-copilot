// Real mouse crops and a local streaming server; native data and remote AI are untouched.
import { chromium } from 'playwright';
import { createServer as viteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const artifacts = resolve('artifacts');
const port = Number(process.env.PHYDOG_ATTACHMENT_UI_PORT || 1473);
const origin = `http://127.0.0.1:${port}`;
const names = ['附件验证-A.pdf', '附件验证-B.pdf', '附件验证-C.pdf'];
const checks = [], errors = [], remoteRequests = [], calls = [], sockets = new Set(), held = new Map();
const holdJobs = new Set(['ATTACH_A_RUNNING', 'ATTACH_B_QUEUED']);
const hash = value => createHash('sha256').update(value).digest('hex');
const event = value => `data: ${JSON.stringify(value)}\n\n`;
let server, browser, context, page, ids, passed = false, modelFailure, releasePendingModule;
const model = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    assert.equal(request.headers.authorization, 'Bearer attachment-synthetic-key');
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const user = payload.input.findLast(item => item.role === 'user');
    const question = user.content.find(item => item.type === 'input_text').text;
    const job = question.match(/ATTACH_[A-Z_]+/)?.[0]; assert.ok(job);
    const images = user.content.filter(item => item.type === 'input_image').map(item => item.image_url);
    calls.push({ job, question, images, totalImages: payload.input.flatMap(item => Array.isArray(item.content) ? item.content : []).filter(item => item.type === 'input_image').length });
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    response.write(event({ type: 'response.output_text.delta', delta: `已收到 ${job}。` }));
    if (holdJobs.has(job)) held.set(job, response);
    else response.end(event({ type: 'response.completed', response: { status: 'completed', output: [] } }));
  } catch (error) { modelFailure = error; if (!response.headersSent) response.writeHead(500); response.end(); }
});
model.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(done => model.listen(0, '127.0.0.1', done));
const modelOrigin = `http://127.0.0.1:${model.address().port}`;
const prompt = () => page.getByRole('textbox', { name: '向 AI 提问', exact: true });
const preview = () => page.locator('.ai-selection-context img');
const dialog = () => page.getByRole('dialog', { name: '设置', exact: true });
const shot = name => page.screenshot({ path: resolve(artifacts, name), animations: 'disabled' });
async function until(condition) {
  for (let i = 0; i < 200; i++) { if (modelFailure) throw modelFailure; if (await condition()) return; await new Promise(done => setTimeout(done, 75)); }
  throw new Error('Synthetic attachment condition timed out.');
}
async function readyPdf() {
  await page.waitForFunction(() => {
    const slot = document.querySelector('#page-surface');
    return slot?.classList.contains('page-ready') && !slot.classList.contains('pdf-preview') &&
      !document.querySelector('.pane-enter-active,.pane-leave-active,.sidebar-enter-active,.sidebar-leave-active,.view-enter-active') &&
      !document.querySelector('.pdf-scroll')?.style.width;
  });
}
async function select(index) { await page.getByRole('tab', { name: names[index], exact: true }).click(); await readyPdf(); await prompt().waitFor(); }
async function crop(index = 0) {
  await readyPdf();
  await page.getByTitle('框选公式或图表作为 AI 上下文', { exact: true }).click();
  const bounds = await page.locator('#page-surface').boundingBox();
  const x = bounds.x + 35 + index * 8, y = bounds.y + 50 + index * 14;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 145 + index * 6, y + 85 + index * 4, { steps: 5 }); await page.mouse.up();
  await preview().waitFor();
  await readyPdf();
  return preview().getAttribute('src');
}
async function configure(key) {
  await page.getByTitle('AI 设置', { exact: true }).click(); await dialog().waitFor();
  await dialog().getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog().getByLabel('API 地址', { exact: true }).fill(`${modelOrigin}/v1`);
  await dialog().getByLabel('API Key', { exact: true }).fill(key);
  await dialog().getByLabel('模型', { exact: true }).fill('attachment-mock-model');
  await dialog().locator('summary').filter({ hasText: '多文件提问' }).click();
  await dialog().getByLabel('同时运行的提问', { exact: true }).fill('1');
  await dialog().getByLabel('最多等待的提问', { exact: true }).fill('1');
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
}
async function send(job) { await prompt().fill(job); await page.getByRole('button', { name: '发送 ↑', exact: true }).click(); }
async function accepted() { await preview().waitFor({ state: 'detached' }); assert.equal(await prompt().inputValue(), ''); assert.equal(await page.locator('.ai-message img').count(), 0); }
async function complete(job) { await until(() => calls.some(call => call.job === job)); await page.locator('.ai-status').filter({ hasText: '回答完成' }).waitFor(); }
async function latestImage(index, job) {
  return page.evaluate(async ({ id, job }) => { const { chatState } = await import('/src/ai/workspace.ts'); return chatState(id).messages.find(message => message.role === 'user' && message.content === job)?.images?.[0]; }, { id: ids[index], job });
}
async function plainContext() { await page.getByLabel('当前页上下文与文档检索', { exact: true }).uncheck(); }
function finish(job) { const response = held.get(job); assert.ok(response); held.delete(job); response.end(event({ type: 'response.completed', response: { status: 'completed', output: [] } })); }
async function preparationRace(replaceCrop) {
  await context.close();
  context = await browser.newContext({ viewport: { width: 1440, height: 940 }, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin) || route.request().url().startsWith(modelOrigin)) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  let markBlocked;
  const blocked = new Promise(done => { markBlocked = done; });
  const release = new Promise(done => { releasePendingModule = done; });
  // Delay only the first lazy context module in an isolated browser. This puts
  // acceptance after a genuine component unmount or a newer real mouse crop.
  await page.route(/\/src\/ai\/document-chat\.mjs(?:\?|$)/, async route => { markBlocked(); await release; await route.continue(); });
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles({ name: names[0], mimeType: 'application/pdf', buffer: samplePdf(3, false, true, { lines: { 1: ['Delayed attachment acceptance'], 2: ['Page two'], 3: ['Page three'] } }) });
  await readyPdf(); const original = await crop(); await configure('attachment-synthetic-key'); await plainContext();
  ids = await page.evaluate(async name => { const { library } = await import('/src/sdk/index.ts'); return [(await library.list()).find(doc => doc.name === name).id]; }, names[0]);
  const job = replaceCrop ? 'ATTACH_NEWER_RACE' : 'ATTACH_UNMOUNT_RACE';
  await send(job);
  await Promise.race([blocked, new Promise((_, reject) => setTimeout(() => reject(new Error('Lazy context module was not intercepted.')), 10000))]);
  assert.equal(calls.some(call => call.job === job), false);
  let newer;
  if (replaceCrop) { newer = await crop(2); assert.notEqual(newer, original); }
  else { await page.getByTitle('文档库', { exact: true }).click(); await page.locator('.ai-pane').waitFor({ state: 'detached' }); }
  releasePendingModule(); releasePendingModule = undefined;
  await until(() => calls.some(call => call.job === job));
  if (!replaceCrop) await select(0);
  await complete(job);
  assert.deepEqual(calls.find(call => call.job === job).images, [original]);
  assert.equal(await latestImage(0, job), original);
  if (replaceCrop) assert.equal(await preview().getAttribute('src'), newer);
  else await preview().waitFor({ state: 'detached' });
  assert.equal(await page.locator('.ai-message img').count(), 0);
  checks.push(replaceCrop
    ? 'Delayed acceptance preserves a newer crop in the same file and still transmits only its original snapshot.'
    : 'Acceptance delayed until after a genuine library-view unmount still consumes the original crop before its file reopens.');
}

try {
  await mkdir(artifacts, { recursive: true });
  server = await viteServer({ server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 940 }, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (route.request().url().startsWith(origin) || route.request().url().startsWith(modelOrigin)) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles(names.map((name, index) => ({ name, mimeType: 'application/pdf', buffer: samplePdf(3, false, true, { lines: { 1: [`Document ${index + 1} attachment fixture`], 2: ['Page two'], 3: ['Page three'] } }) })));
  await readyPdf(); await page.waitForTimeout(200);
  const firstCrop = await crop();
  ids = await page.evaluate(async names => { const { library } = await import('/src/sdk/index.ts'); const docs = await library.list(); return names.map(name => docs.find(doc => doc.name === name).id); }, names);
  assert.equal(await page.locator('.ai-pane > .ai-header').count(), 0);
  assert.equal(await page.locator('.ai-pane > :first-child').getAttribute('class'), 'model-bar');
  await configure('');
  await send('ATTACH_MISSING'); await dialog().waitFor();
  await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'detached' });
  await page.locator('.ai-status').filter({ hasText: '请先连接 AI 服务' }).waitFor();
  assert.equal(await preview().getAttribute('src'), firstCrop);
  assert.equal(await prompt().inputValue(), 'ATTACH_MISSING'); assert.equal(calls.length, 0);
  checks.push('Missing key preserves the unsent crop and draft; the redundant assistant header is absent.');

  await configure('attachment-synthetic-key');
  await shot('ai-attachment-before.png');
  await send('ATTACH_BASIC'); await accepted(); await complete('ATTACH_BASIC');
  assert.deepEqual(calls.find(call => call.job === 'ATTACH_BASIC').images, [firstCrop]);
  assert.equal(await latestImage(0, 'ATTACH_BASIC'), firstCrop);
  assert.equal(await page.locator('.ai-pane img').count(), 0);
  await shot('ai-attachment-accepted.png');
  checks.push('Accepted capture disappears from composer and history, while the actual HTTP image and retained message attachment match the original crop.');

  await plainContext(); await send('ATTACH_NEXT'); await complete('ATTACH_NEXT');
  assert.equal(calls.find(call => call.job === 'ATTACH_NEXT').totalImages, 0);
  checks.push('A subsequent ordinary question does not resend the consumed crop or historical image.');

  const closeCrop = await crop(1); assert.notEqual(closeCrop, firstCrop);
  await prompt().fill('ATTACH_CLOSE_RACE');
  await page.evaluate(() => { document.querySelector('.ai-pane .send-button:not(.stop)').click(); document.querySelector('.close-assistant').click(); });
  await page.locator('.ai-pane').waitFor({ state: 'detached' });
  await until(() => calls.some(call => call.job === 'ATTACH_CLOSE_RACE'));
  await page.getByRole('button', { name: '阅读助手', exact: true }).click(); await prompt().waitFor(); await readyPdf();
  await preview().waitFor({ state: 'detached' });
  assert.deepEqual(calls.find(call => call.job === 'ATTACH_CLOSE_RACE').images, [closeCrop]);
  checks.push('Submitting and immediately unmounting the assistant still consumes exactly that crop; reopening shows no stale image.');

  const runningCrop = await crop(2); await send('ATTACH_A_RUNNING'); await accepted(); await until(() => held.has('ATTACH_A_RUNNING'));
  await select(1); const queuedCrop = await crop(1); await plainContext();
  await send('ATTACH_B_QUEUED'); await accepted();
  await page.locator('.ai-status').filter({ hasText: '队列第 1 位' }).waitFor();
  assert.equal(calls.some(call => call.job === 'ATTACH_B_QUEUED'), false);
  assert.equal(await latestImage(1, 'ATTACH_B_QUEUED'), queuedCrop);
  await shot('ai-attachment-queued.png');
  checks.push('Queued acceptance hides its crop immediately without issuing HTTP; the queued message keeps its image snapshot.');

  await select(2); const rejectedCrop = await crop(2); await plainContext(); await send('ATTACH_QUEUE_FULL');
  await page.locator('.ai-status').filter({ hasText: '队列已满' }).waitFor();
  assert.equal(await preview().getAttribute('src'), rejectedCrop);
  assert.equal(await prompt().inputValue(), 'ATTACH_QUEUE_FULL');
  assert.equal(await page.locator('.ai-message').count(), 0);
  assert.equal(calls.some(call => call.job === 'ATTACH_QUEUE_FULL'), false);
  await shot('ai-attachment-rejected.png');
  finish('ATTACH_A_RUNNING'); await until(() => held.has('ATTACH_B_QUEUED'));
  assert.deepEqual(calls.find(call => call.job === 'ATTACH_A_RUNNING').images, [runningCrop]);
  assert.deepEqual(calls.find(call => call.job === 'ATTACH_B_QUEUED').images, [queuedCrop]);
  assert.equal(await preview().getAttribute('src'), rejectedCrop);
  assert.equal(await prompt().inputValue(), 'ATTACH_QUEUE_FULL');
  finish('ATTACH_B_QUEUED'); await until(async () => page.evaluate(async () => { const { taskSummary } = await import('/src/ai/workspace.ts'); return taskSummary.running === 0 && taskSummary.queued === 0; }));
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click(); await accepted(); await complete('ATTACH_QUEUE_FULL');
  assert.deepEqual(calls.find(call => call.job === 'ATTACH_QUEUE_FULL').images, [rejectedCrop]);
  checks.push('Queue-full rejection preserves crop/draft and creates no message or request; later retry submits the same crop, while another document starts its original queued image.');

  await select(1); const otherCrop = await crop(2);
  await select(0); await page.locator('.ai-status').filter({ hasText: '回答完成' }).waitFor(); const originCrop = await crop(1);
  await prompt().fill('ATTACH_TAB_RACE');
  await page.evaluate(name => {
    document.querySelector('.ai-pane .send-button:not(.stop)').click();
    [...document.querySelectorAll('[role="tab"]')].find(tab => tab.getAttribute('aria-label') === name).click();
  }, names[1]);
  await readyPdf(); await preview().waitFor();
  await until(() => calls.some(call => call.job === 'ATTACH_TAB_RACE'));
  assert.equal(await preview().getAttribute('src'), otherCrop);
  assert.deepEqual(calls.find(call => call.job === 'ATTACH_TAB_RACE').images, [originCrop]);
  assert.match(calls.find(call => call.job === 'ATTACH_TAB_RACE').question, new RegExp(names[0].replace(/\./g, '\\.')));
  await select(0); await preview().waitFor({ state: 'detached' });
  await select(1); assert.equal(await preview().getAttribute('src'), otherCrop);
  checks.push('An accepted request after an immediate tab switch clears only its origin; the other file keeps its newer crop, and the wire retains the origin image/name.');

  await page.locator('.context-heading input').uncheck();
  await send('ATTACH_OMIT'); await complete('ATTACH_OMIT');
  assert.equal(calls.find(call => call.job === 'ATTACH_OMIT').totalImages, 0);
  assert.equal(await preview().getAttribute('src'), otherCrop);
  const newerCrop = await crop(); assert.notEqual(newerCrop, otherCrop);
  assert.equal(await preview().getAttribute('src'), newerCrop);
  assert.equal(await page.locator('.ai-message img').count(), 0);
  await shot('ai-attachment-new-crop.png');
  checks.push('Opting out of the crop leaves it available; a fresh real crop replaces it normally without exposing historical thumbnails.');
  await preparationRace(false);
  await preparationRace(true);
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []); assert.equal(modelFailure, undefined);
  passed = true;
  console.log(JSON.stringify({ passed, checks, requests: calls.length, errors, remoteRequests }, null, 2));
} catch (error) {
  await shot('ai-attachment-failure.png').catch(() => {});
  console.error(String(error?.stack || error)); process.exitCode = 1;
} finally {
  releasePendingModule?.();
  const requests = calls.map(({ job, images, totalImages }) => ({ job, imageCount: images.length, imageHashes: images.map(hash), totalImages }));
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'ai-attachment-ui.json'), JSON.stringify({ passed, isolatedBrowser: true, checks, requests, errors, remoteRequests, modelFailure: modelFailure && String(modelFailure) }, null, 2));
  await context?.close(); await browser?.close(); await server?.close();
  for (const socket of sockets) socket.destroy(); await new Promise(done => model.close(done));
}
