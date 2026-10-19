// Conversation actions against a local held SSE model: regenerate, branch, edit,
// parallel conversations of one document and the notice for answers finishing off screen.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts'), checks = [], errors = [], remoteRequests = [], asked = [];
const held = new Map(), sockets = new Set();
const name = '对话分支验证.md';
const event = value => `data: ${JSON.stringify(value)}\n\n`;
let server, browser, page, modelFailure;
const model = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    // 问题预判是独立的短请求：给一句建议就结束，不计入这里的提问。
    if (body.includes('请预判这位读者')) { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '预判的问题？' })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } })}\n\n`); return; }
    const question = payload.input.findLast(item => item.role === 'user').content.find(item => item.type === 'input_text').text;
    const job = question.match(/JOB_[A-Z0-9_]+/)?.[0]; assert.ok(job, question);
    asked.push({ job, history: payload.input.filter(item => item.role === 'user').length });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    response.write(event({ type: 'response.output_text.delta', delta: `回答 ${job}。` }));
    held.set(job, response);
  } catch (error) { modelFailure = error; if (!response.headersSent) response.writeHead(500); response.end(); }
});
model.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(done => model.listen(0, '127.0.0.1', done));
const modelOrigin = `http://127.0.0.1:${model.address().port}`;
async function until(condition, label = 'condition') {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (modelFailure) throw modelFailure;
    if (await condition()) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
const pane = () => page.locator('.ai-pane:visible');
const prompt = () => pane().getByRole('textbox', { name: '向 AI 提问', exact: true });
const answers = () => pane().locator('.ai-message.assistant');
const questions = () => pane().locator('.ai-message.user .user-question');
const title = () => pane().locator('.title-text').textContent();
function finish(job) {
  const response = held.get(job); assert.ok(response, job); held.delete(job);
  response.end(event({ type: 'response.completed', response: { status: 'completed', output: [] } }));
}
async function idle() { await until(() => pane().getByRole('button', { name: '发送', exact: true }).count().then(count => count === 1), 'idle composer'); }
async function ask(job) {
  await prompt().fill(job);
  await pane().getByRole('button', { name: '发送', exact: true }).click();
  await until(() => held.has(job), job);
}

try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ server: { host: '127.0.0.1', port: 1497, strictPort: true, watch: null } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:1497/') || url.startsWith(modelOrigin + '/')) return route.continue();
    remoteRequests.push(url); return route.abort();
  });
  await page.goto('http://127.0.0.1:1497');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name, mimeType: 'text/markdown', buffer: Buffer.from(`# ${name}\n\n用于检查对话分支、重新生成与编辑。`) }]);
  await page.locator('.markdown-paper').filter({ hasText: '对话分支验证' }).waitFor();
  await page.getByRole('button', { name: '阅读助手', exact: true }).click(); await prompt().waitFor();
  await pane().getByRole('button', { name: '选择模型与思考强度', exact: true }).click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: 'AI', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog.getByLabel('API 地址', { exact: true }).fill(modelOrigin + '/v1');
  await dialog.getByLabel('API Key', { exact: true }).fill('conversation-local-key');
  await dialog.getByLabel('模型', { exact: true }).fill('conversation-local-model');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await pane().getByRole('switch', { name: '当前页上下文与文档检索', exact: true }).uncheck();

  // Two turns, then regenerate the last answer in place.
  await ask('JOB_ONE'); finish('JOB_ONE'); await idle();
  await ask('JOB_TWO'); finish('JOB_TWO'); await idle();
  assert.equal(await answers().count(), 2);
  assert.equal(await pane().locator('.answer-meta').getByText(/tokens/).count(), 0, 'Answers no longer list token counts.');
  await answers().last().hover();
  await answers().last().getByRole('button', { name: '重新生成', exact: true }).click();
  await until(() => held.has('JOB_TWO'), 'regenerated JOB_TWO');
  assert.equal(asked.at(-1).job, 'JOB_TWO'); assert.equal(asked.at(-1).history, 2, 'Regeneration resends the question after the first turn only.');
  finish('JOB_TWO'); await idle();
  assert.equal(await questions().count(), 2); assert.equal(await answers().count(), 2, 'The last answer is replaced, not duplicated.');
  checks.push('Regenerate replaces the latest answer in place and resends the same question with the earlier history.');

  // Branch from the first answer: a new conversation with only the first turn.
  const original = await title();
  await answers().first().hover();
  await answers().first().getByRole('button', { name: '从这里分支', exact: true }).click();
  await until(async () => (await questions().count()) === 1, 'branch shows one turn');
  assert.match(await title(), / · 分支$/);
  await pane().getByRole('button', { name: '对话记录', exact: true }).click();
  const history = page.getByRole('dialog', { name: '对话记录', exact: true });
  assert.equal(await history.locator('.history-item').count(), 2);
  assert.equal(await history.locator('.branch-mark').count(), 1);
  await page.keyboard.press('Escape'); await pane().locator('.title-text').click(); await history.waitFor({ state: 'detached' }).catch(() => {});
  checks.push('Branching copies the conversation up to an answer into a new, marked conversation.');

  // Edit the (only) question of the branch: it is replaced and answered again.
  await questions().first().hover();
  await pane().getByRole('button', { name: '编辑问题', exact: true }).first().click();
  const editor = pane().getByRole('textbox', { name: '编辑问题', exact: true });
  await editor.fill('JOB_EDITED 改写后的问题');
  await editor.press('Enter');
  await until(() => held.has('JOB_EDITED'), 'edited question sent');
  assert.equal(asked.at(-1).history, 1);
  finish('JOB_EDITED'); await idle();
  assert.equal(await questions().count(), 1); assert.match(await questions().first().textContent(), /JOB_EDITED/);
  checks.push('Editing the latest question replaces it and answers automatically.');

  // Two conversations of the same document answer at the same time.
  await ask('JOB_PARALLEL_A');
  await pane().getByRole('button', { name: '新对话', exact: true }).click();
  await until(async () => (await questions().count()) === 0, 'fresh conversation');
  await pane().getByRole('switch', { name: '当前页上下文与文档检索', exact: true }).uncheck();
  await ask('JOB_PARALLEL_B');
  assert.ok(held.has('JOB_PARALLEL_A') && held.has('JOB_PARALLEL_B'), 'Both conversations run in parallel.');
  checks.push('Two conversations of one document stream at the same time.');

  // A finishes while B is on screen: a notice appears and opens A.
  finish('JOB_PARALLEL_A');
  const notice = page.locator('.answer-notice');
  await notice.waitFor();
  assert.match(await notice.textContent(), /已回答完/);
  finish('JOB_PARALLEL_B'); await idle();
  assert.equal(await page.locator('.answer-notice').count(), 1, 'The conversation on screen does not raise a notice.');
  await page.screenshot({ path: resolve(artifacts, 'ai-conversation-notice.png') });
  await notice.locator('.notice-body').click();
  await until(async () => (await pane().locator('.ai-message.user').filter({ hasText: 'JOB_PARALLEL_A' }).count()) === 1, 'notice opens A');
  await notice.waitFor({ state: 'detached' });
  checks.push('An answer finishing off screen raises a notice that opens its conversation.');

  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  console.log(JSON.stringify({ passed: true, checks, original }, null, 2));
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'ai-conversation-ui-check.json'), JSON.stringify({ checks, errors, remoteRequests, asked }, null, 2));
  await browser?.close(); await server?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise(done => model.close(done));
}
