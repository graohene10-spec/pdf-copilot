// The assistant's greeting, placeholder, model card, document-context switch, predicted question and thinking line,
// against a local held SSE model. No external requests.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { PLACEHOLDERS } from '../src/ai/greeting.ts';

const artifacts = resolve('artifacts'), checks = [], errors = [], requests = [];
const event = value => `data: ${JSON.stringify(value)}\n\n`;
let release, releasePrediction, holdPrediction = false;
const model = createServer(async (request, response) => {
  for (const [name, value] of [['access-control-allow-origin', '*'], ['access-control-allow-headers', 'authorization,content-type'], ['access-control-allow-methods', 'POST,OPTIONS']]) response.setHeader(name, value);
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  let body = ''; for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body), text = JSON.stringify(payload.input);
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (text.includes('请预判这位读者')) {
    requests.push({ kind: 'predict', model: payload.model, reasoning: payload.reasoning });
    const finish = () => {
      response.write(event({ type: 'response.output_text.delta', delta: '“测量假设说的是什么？”\n多余的第二行' }));
      response.write(event({ type: 'response.completed', response: { status: 'completed', output: [] } })); response.end();
    };
    if (holdPrediction) releasePrediction = finish; else finish();
    return;
  }
  requests.push({ kind: 'ask', model: payload.model });
  response.write(event({ type: 'response.reasoning_summary_text.delta', delta: 'Reading the measurement postulate.' }));
  release = () => { response.write(event({ type: 'response.output_text.delta', delta: '测量结果只能是本征值。' })); response.write(event({ type: 'response.completed', response: { status: 'completed', output: [] } })); response.end(); };
});
await new Promise(done => model.listen(0, '127.0.0.1', done));
const modelOrigin = `http://127.0.0.1:${model.address().port}`, port = 1475, origin = `http://127.0.0.1:${port}`;
let server, browser, page;
const pane = () => page.locator('.ai-pane:not(.pane-leave-active)');
const until = async (condition, message) => { for (let i = 0; i < 100; i++) { if (await condition()) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(message); };
try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-ai-r7-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await (await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: 'light' })).newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => route.request().url().startsWith(origin) || route.request().url().startsWith(modelOrigin) ? route.continue() : route.abort());
  await page.goto(origin);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name: '量子力学笔记.md', mimeType: 'text/markdown', buffer: Buffer.from('# 量子力学笔记\n\n## 测量假设\n\n测量结果只能是可观测量的本征值。') }]);
  await page.locator('.markdown-paper').waitFor();
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await pane().locator('.ai-welcome-lead').waitFor(); await page.waitForTimeout(600);

  // 1. Welcome: a greeting in Anthropic Serif, no document sentence, no quick prompt buttons.
  const welcome = await pane().locator('.ai-welcome').evaluate(element => ({ text: element.innerText, font: getComputedStyle(element.querySelector('.ai-welcome-lead')).fontFamily, buttons: element.querySelectorAll('button').length }));
  assert.match(welcome.font, /^"Anthropic Serif"/);
  assert.doesNotMatch(welcome.text, /关于《|直接提问|梳理核心观点/);
  assert.equal(welcome.buttons, 0);
  assert.ok(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('27px "Anthropic Serif"'); }), 'The bundled Anthropic Serif is loaded.');
  const placeholder = await pane().getByRole('textbox', { name: '向 AI 提问', exact: true }).getAttribute('placeholder');
  assert.ok(PLACEHOLDERS.includes(placeholder), `Placeholder is one of the scholarly lines: ${placeholder}`);
  await pane().screenshot({ path: resolve(artifacts, 'ai-r7-welcome.png') });
  checks.push(`Empty assistant shows only the mark and a greeting set in Anthropic Serif (${welcome.text.split('\n')[0]}); the input placeholder is "${placeholder}".`);

  // 2. Compact liquid-glass model card: no notes, no bolt, translucent, small.
  await pane().getByRole('button', { name: '选择模型与思考强度', exact: true }).click();
  const card = page.locator('.model-card'); await card.waitFor(); await page.waitForTimeout(400);
  const cardInfo = await card.evaluate(element => ({ box: element.getBoundingClientRect().toJSON(), text: element.innerText, background: getComputedStyle(element).backgroundColor, track: element.querySelector('.effort-track').getBoundingClientRect().height, fill: getComputedStyle(element.querySelector('.effort-fill')).backgroundImage }));
  assert.ok(cardInfo.box.width <= 240 && cardInfo.box.height <= 110, `Card is compact: ${Math.round(cardInfo.box.width)}×${Math.round(cardInfo.box.height)}`);
  assert.doesNotMatch(cardInfo.text, /简单问题|困难问题|较慢|平衡速度/);
  assert.equal(await card.getByRole('button', { name: '最快：关闭思考', exact: true }).count(), 0);
  assert.equal(cardInfo.fill, 'none', 'The effort fill is a neutral tint, not a blue gradient.');
  const alpha = Number(/[\d.]+(?=\)$)/.exec(cardInfo.background)?.[0] ?? 1);
  assert.ok(alpha < .6, `The card glass is translucent (${cardInfo.background}).`);
  const slider = card.getByRole('slider', { name: '思考强度', exact: true });
  const trackBox = await card.locator('.effort-track').boundingBox();
  await page.mouse.move(trackBox.x + 4, trackBox.y + trackBox.height / 2); await page.mouse.down();
  assert.equal(await card.locator('.effort-track.dragging').count(), 1, 'Pressing the slider turns the knob into a glass lens.');
  await page.mouse.move(trackBox.x + trackBox.width - 2, trackBox.y + trackBox.height / 2, { steps: 5 }); await page.screenshot({ path: resolve(artifacts, 'ai-r7-card-drag.png'), clip: { x: trackBox.x - 20, y: trackBox.y - 50, width: trackBox.width + 40, height: 110 } }); await page.mouse.up();
  assert.equal(await slider.getAttribute('aria-valuenow'), await slider.getAttribute('aria-valuemax'));
  await card.getByRole('button', { name: '服务商、密钥与预算', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
  await dialog.getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog.getByLabel('API 地址', { exact: true }).fill(modelOrigin + '/v1');
  await dialog.getByLabel('API Key', { exact: true }).fill('r7-synthetic-key');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  checks.push(`Model card is ${Math.round(cardInfo.box.width)}×${Math.round(cardInfo.box.height)}px translucent glass without notes or the bolt; the knob turns into a lens while dragging.`);

  // 3. Document context switch: on and off differ clearly, including the mini switch.
  const switchState = () => pane().locator('.context-switch').evaluate(element => ({ on: element.classList.contains('on'), track: getComputedStyle(element.querySelector('.mini-switch')).backgroundColor, knob: element.querySelector('.mini-switch i').getBoundingClientRect().left - element.querySelector('.mini-switch').getBoundingClientRect().left }));
  const first = await switchState();
  await pane().locator('.context-switch').click();
  // 软件合成下一帧可能要近一秒：等开关自身的过渡结束再读颜色。
  await page.waitForFunction(() => { const element = document.querySelector('.ai-pane .mini-switch'); return [element, element.firstElementChild].every(node => !node.getAnimations().length); });
  const second = await switchState();
  assert.notEqual(first.on, second.on);
  assert.notEqual(first.track, second.track, 'The mini switch fills when on.');
  assert.ok(Math.abs(first.knob - second.knob) >= 8, 'The knob moves across.');
  if (!second.on) await pane().locator('.context-switch').click();
  const label = await pane().locator('.context-switch > span:last-child').evaluate(element => ({ text: element.textContent, clipped: element.scrollWidth > element.clientWidth + 1 }));
  assert.deepEqual(label, { text: '文档上下文', clipped: false }, 'At a normal window width the chip label is shown in full.');
  checks.push('文档上下文 shows a mini switch: filled ink capsule with the knob on the right when on, hollow outline when off.');

  // 4. Predicted question: ghost text from the small model; Tab fills it in.
  const prompt = pane().getByRole('textbox', { name: '向 AI 提问', exact: true });
  await prompt.focus();
  await until(async () => await pane().locator('.prompt-ghost').count() > 0, 'A predicted question appears.');
  assert.match(await pane().locator('.prompt-ghost').innerText(), /^测量假设说的是什么？/);
  assert.deepEqual(requests.filter(item => item.kind === 'predict')[0], { kind: 'predict', model: 'gpt-5.4-mini', reasoning: { effort: 'none' } });
  await pane().locator('.ai-composer').screenshot({ path: resolve(artifacts, 'ai-r7-prediction.png') });
  const predictionCount = () => requests.filter(item => item.kind === 'predict').length;
  async function setPrediction(enabled) {
    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();
    const section = dialog.getByRole('region', { name: '猜你想问设置', exact: true });
    await section.getByRole('checkbox', { name: '启用猜你想问', exact: true }).setChecked(enabled);
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
  }
  async function storedPrediction() {
    return page.evaluate(async () => {
      const { library } = await import('/src/sdk/index.ts');
      return JSON.parse(await library.getSetting('app.preferences.v1')).assistant.predictQuestions;
    });
  }
  await setPrediction(false);
  assert.equal(await storedPrediction(), false);
  assert.equal(await pane().locator('.prompt-ghost').count(), 0, 'Disabling clears an existing suggestion even after the composer loses focus.');
  const beforeDisabledFocus = predictionCount();
  await prompt.focus(); await page.waitForTimeout(1100);
  assert.equal(predictionCount(), beforeDisabledFocus, 'Disabled suggestions issue no new requests.');
  await page.keyboard.press('Tab');
  assert.equal(await prompt.inputValue(), '', 'Tab cannot adopt a disabled suggestion.');
  await setPrediction(true);
  assert.equal(await storedPrediction(), true);
  await prompt.focus();
  await until(async () => await pane().locator('.prompt-ghost').count() > 0, 'Suggestions resume after enabling.');
  await page.keyboard.press('Tab');
  assert.equal(await prompt.inputValue(), '测量假设说的是什么？');
  checks.push('With document context on, the composer shows a predicted question from GPT-5.4 Mini (thinking off); Tab fills it in.');

  // 5. Thinking line: spinner glyph, an English verb, elapsed time, no token count.
  await page.keyboard.press('Control+Enter');
  const thinking = pane().locator('.thinking.live'); await thinking.waitFor();
  const live = await thinking.innerText();
  assert.match(live, /[·✢✳✶✻✽]/); assert.match(live, /[A-Z][a-z]+ing…/); assert.match(live, /\d+(\.\d)?s/); assert.doesNotMatch(live, /token|思考中/i);
  await pane().locator('.ai-message.assistant').first().screenshot({ path: resolve(artifacts, 'ai-r7-thinking.png') });
  holdPrediction = true;
  const beforeAnswer = predictionCount();
  release();
  await pane().locator('.answer-body').waitFor();
  assert.match(await pane().locator('.thinking').first().innerText(), /^✻\s*Thought for \d/);
  assert.equal(await pane().getByText(/tokens/).count(), 0);
  checks.push(`Thinking shows "${live.replace(/\s+/g, ' ').trim()}" with a Claude Code spinner and no token count; afterwards "Thought for …".`);
  await until(async () => predictionCount() > beforeAnswer && Boolean(releasePrediction), 'A prediction starts after the answer.');
  await setPrediction(false);
  releasePrediction();
  await page.waitForTimeout(1100);
  assert.equal(await pane().locator('.prompt-ghost').count(), 0, 'A late reply cannot restore a disabled suggestion.');
  const beforeReload = predictionCount();
  await page.reload();
  assert.equal(await storedPrediction(), false, 'The disabled preference survives a reload.');
  const assistantButton = page.getByRole('button', { name: '阅读助手', exact: true });
  if (await assistantButton.count() && !await pane().count()) await assistantButton.click();
  if (await pane().count()) await pane().getByRole('textbox', { name: '向 AI 提问', exact: true }).focus();
  await page.waitForTimeout(1100);
  assert.equal(predictionCount(), beforeReload);
  checks.push('猜你想问 has its own AI settings switch: saving off clears existing suggestions, aborts pending requests, rejects late replies and persists across reload; saving on restores suggestions.');
  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'ai-r7-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); model.close(); }
