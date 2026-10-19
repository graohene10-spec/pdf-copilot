// The assistant's greeting, placeholder, model drawer, document-context switch, predicted question and thinking line,
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
  assert.equal(await pane().locator('.ai-welcome-source').count(), 0, 'Poems and quotes appear without an author / title line.');
  assert.doesNotMatch(welcome.text, /—\s*\S+《/);
  assert.ok(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('27px "Anthropic Serif"'); }), 'The bundled Anthropic Serif is loaded.');
  const placeholder = await pane().getByRole('textbox', { name: '向 AI 提问', exact: true }).getAttribute('placeholder');
  assert.ok(PLACEHOLDERS.includes(placeholder), `Placeholder is one of the scholarly lines: ${placeholder}`);
  await pane().screenshot({ path: resolve(artifacts, 'ai-r7-welcome.png') });
  checks.push(`Empty assistant shows only the mark and a greeting set in Anthropic Serif (${welcome.text.split('\n')[0]}); the input placeholder is "${placeholder}".`);

  // 2. Model / effort: the composer itself grows downward into a drawer (no popup card, no provider link).
  const field = pane().locator('.composer-field');
  const before = await field.boundingBox();
  await pane().getByRole('button', { name: '选择模型与思考强度', exact: true }).click();
  const drawer = pane().getByRole('group', { name: '模型与思考强度', exact: true }); await drawer.waitFor();
  const growing = await pane().locator('.composer-drawer').evaluate(element => element.getAnimations().some(animation => animation.transitionProperty === 'height'));
  await page.waitForFunction(() => !document.querySelector('.ai-pane .composer-drawer').getAnimations().length);
  const after = await field.boundingBox();
  assert.ok(growing, 'The drawer height animates (spring) instead of popping in.');
  assert.ok(after.height - before.height > 50, `The composer grows to show the controls (${Math.round(before.height)} → ${Math.round(after.height)}).`);
  assert.ok(Math.abs(after.y + after.height - (before.y + before.height)) < 2, 'Its bottom edge stays put: the drawer opens from the composer\'s lower edge.');
  assert.equal(await page.locator('.model-card').count(), 0, 'No popup card.');
  assert.equal(await page.getByRole('button', { name: '服务商、密钥与预算', exact: true }).count(), 0, 'Provider, keys and budget live in Settings only.');
  assert.ok(await drawer.getByRole('option').count() >= 1, 'Models are listed as chips in the drawer.');
  const fill = await drawer.locator('.effort-fill').evaluate(element => getComputedStyle(element).backgroundImage);
  assert.equal(fill, 'none', 'The effort fill is a neutral tint, not a blue gradient.');
  const slider = drawer.getByRole('slider', { name: '思考强度', exact: true });
  const trackBox = await drawer.locator('.effort-track').boundingBox();
  await page.mouse.move(trackBox.x + 4, trackBox.y + trackBox.height / 2); await page.mouse.down();
  assert.equal(await drawer.locator('.effort-track.dragging').count(), 1, 'Pressing the slider turns the knob into a glass lens.');
  await page.mouse.move(trackBox.x + trackBox.width - 2, trackBox.y + trackBox.height / 2, { steps: 5 }); await pane().screenshot({ path: resolve(artifacts, 'ai-r8-drawer.png') }); await page.mouse.up();
  assert.equal(await slider.getAttribute('aria-valuenow'), await slider.getAttribute('aria-valuemax'));
  await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' });
  const closed = await field.boundingBox();
  assert.ok(Math.abs(closed.height - before.height) < 2, 'Esc folds the drawer back.');
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'AI', exact: true }).click();
  await dialog.getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog.getByLabel('API 地址', { exact: true }).fill(modelOrigin + '/v1');
  await dialog.getByLabel('API Key', { exact: true }).fill('r7-synthetic-key');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  checks.push(`Model and effort open as a drawer under the composer (${Math.round(before.height)} → ${Math.round(after.height)}px, spring height), with model chips and the lens slider; no provider link.`);

  // 3. Document context switch: a capsule with a book glyph; off is quiet with a slash, on is accent glass.
  const switchState = () => pane().locator('.context-switch').evaluate(element => ({ on: element.classList.contains('on'), background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, slash: Number(getComputedStyle(element.querySelector('.context-slash')).opacity) }));
  const first = await switchState();
  await pane().locator('.context-switch').click();
  await page.waitForFunction(() => { const element = document.querySelector('.ai-pane .context-switch'); return [element, element.querySelector('.context-slash')].every(node => !node.getAnimations().length); });
  const second = await switchState();
  assert.notEqual(first.on, second.on);
  assert.notEqual(first.background, second.background, 'The capsule fills with accent glass when on.');
  assert.notEqual(first.color, second.color, 'Glyph and label take the accent colour when on.');
  const [onState, offState] = first.on ? [first, second] : [second, first];
  assert.ok(offState.slash > .9 && onState.slash < .1, 'A slash crosses the book when off.');
  if (!second.on) await pane().locator('.context-switch').click();
  const label = await pane().locator('.context-label').evaluate(element => ({ text: element.textContent, clipped: element.scrollWidth > element.clientWidth + 1 }));
  assert.deepEqual(label, { text: '文档上下文', clipped: false }, 'At a normal window width the chip label is shown in full.');
  checks.push('文档上下文 is a capsule: book glyph with a slash when off, accent-tinted glass when on.');

  // 4. No context, no guess: a blank conversation never asks the small model.
  const prompt = pane().getByRole('textbox', { name: '向 AI 提问', exact: true });
  const predictionCount = () => requests.filter(item => item.kind === 'predict').length;
  await prompt.focus(); await page.waitForTimeout(1400);
  assert.equal(predictionCount(), 0, 'An empty conversation sends no prediction request.');
  assert.equal(await pane().locator('.prompt-ghost').count(), 0, 'And shows no predicted question.');
  checks.push('A blank conversation (no history, no selection) shows no predicted question and sends no request.');

  // 5. Thinking line: spinner glyph, an English verb with a left-to-right shimmer, whole-second time, no token count.
  await prompt.fill('测量假设是什么？');
  await page.keyboard.press('Control+Enter');
  const thinking = pane().locator('.thinking.live'); await thinking.waitFor();
  await page.waitForTimeout(1300);
  const live = await thinking.innerText();
  assert.match(live, /[·✢✳✶✻✽]/); assert.match(live, /[A-Z][a-z]+ing…/); assert.match(live, /\b\d+s\b/); assert.doesNotMatch(live, /\d\.\ds|token|思考中/i);
  const shimmer = await pane().locator('.thinking.live .thinking-label').evaluate(element => {
    const animation = element.getAnimations().find(item => item.animationName?.startsWith('think-shimmer'));
    const frames = animation?.effect.getKeyframes() || [];
    const position = frame => frame?.backgroundPosition ?? `${frame?.backgroundPositionX} ${frame?.backgroundPositionY}`;
    return { name: animation?.animationName, from: position(frames[0]), to: position(frames.at(-1)), size: getComputedStyle(element).backgroundSize, clip: getComputedStyle(element).backgroundClip };
  });
  assert.match(shimmer.name || '', /^think-shimmer/);
  assert.match(shimmer.from, /^100% 0(px)?$/); assert.match(shimmer.to, /^0% 0(px)?$/, 'The highlight sweeps from left to right across the verb.');
  assert.match(shimmer.size, /^300%/); assert.equal(shimmer.clip, 'text');
  await pane().locator('.ai-message.assistant').first().screenshot({ path: resolve(artifacts, 'ai-r7-thinking.png') });
  release();
  await pane().locator('.answer-body').waitFor();
  assert.match(await pane().locator('.thinking').first().innerText(), /^✻\s*Thought for \d+s$/);
  assert.equal(await pane().getByText(/tokens/).count(), 0);
  checks.push(`Thinking shows "${live.replace(/\s+/g, ' ').trim()}" with a Claude Code spinner, a left-to-right shimmer and whole seconds; afterwards "Thought for …s".`);

  // 6. With a conversation, the small model guesses the next question; the Tab / Enter hint shows only the first three times.
  await prompt.focus();
  await until(async () => await pane().locator('.prompt-ghost').count() > 0, 'A predicted question appears after the first answer.');
  assert.match(await pane().locator('.prompt-ghost').innerText(), /^测量假设说的是什么？/);
  assert.deepEqual(requests.filter(item => item.kind === 'predict')[0], { kind: 'predict', model: 'gpt-5.4-mini', reasoning: { effort: 'none' } });
  assert.equal(await pane().locator('.prompt-ghost kbd').count(), 2, 'The first suggestion explains Tab / Enter.');
  await pane().locator('.ai-composer').screenshot({ path: resolve(artifacts, 'ai-r7-prediction.png') });
  const hints = () => page.evaluate(() => localStorage.getItem('kaizhi.predictionHints.v1'));
  assert.equal(await hints(), '1');
  await page.evaluate(() => localStorage.setItem('kaizhi.predictionHints.v1', '3'));
  await prompt.fill('x'); await prompt.fill('');
  await until(async () => await pane().locator('.prompt-ghost').count() > 0, 'The suggestion returns after clearing the input.');
  assert.equal(await pane().locator('.prompt-ghost kbd').count(), 0, 'After three times the hint is gone; the suggestion stays.');
  assert.equal(await hints(), '3');
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
  checks.push('After the first answer the composer shows a predicted question from GPT-5.4 Mini (thinking off); the Tab / Enter hint appears only the first three times; Tab fills it in.');

  // A late reply cannot bring back a suggestion once the switch is off.
  holdPrediction = true;
  const beforeAnswer = predictionCount();
  await page.keyboard.press('Control+Enter');
  await pane().locator('.thinking.live').waitFor();
  release();
  await until(async () => await pane().locator('.answer-body').count() >= 2, 'The second answer arrives.');
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
