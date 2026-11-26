// 用真模型把学习对话走一遍：设定 → 摸底 → 路线图 → 带读，记下每一轮的回答、状态和用量。
// 用法：KZ_KEY=<DeepSeek key> [KZ_TURNS=14] [KZ_WRONG=2] node scripts/learning-trial.mjs
// 浏览器预览的数据在 IndexedDB 里，碰不到已安装的正式版。
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const key = process.env.KZ_KEY; if (!key) throw new Error('需要 KZ_KEY');
const maxTurns = Number(process.env.KZ_TURNS) || 14, wrongAt = Number(process.env.KZ_WRONG) || 2;
const artifacts = resolve('artifacts');
const DOC = `# 数列极限入门

## 1 数列

数列是按自然数编号排成一列的数：$a_1, a_2, a_3, \\dots$，记作 $\\{a_n\\}$。例如 $a_n = \\frac{1}{n}$ 给出 $1, \\frac12, \\frac13, \\dots$。

## 2 "越来越近"还不够

直觉上，$\\frac1n$ 随 $n$ 增大越来越接近 $0$。但"越来越接近"这句话不够用：$\\frac1n$ 也越来越接近 $-1$（距离从 $2$ 降到接近 $1$），可它的极限显然不是 $-1$。我们要的是**想多近就能多近**。

## 3 误差带

取一个正数 $\\varepsilon$ 当作允许的误差。以 $L$ 为中心、半宽 $\\varepsilon$ 的区间 $(L-\\varepsilon, L+\\varepsilon)$ 叫做 $L$ 的 $\\varepsilon$ 误差带。$a_n$ 落在带内，就是 $|a_n - L| < \\varepsilon$。

## 4 从某一项起

只有个别项落在带内不算数。我们要求：存在一个编号 $N$，使得 $N$ 之后的**所有**项都落在带内。$N$ 可以依赖于 $\\varepsilon$：误差带越窄，通常要等得越久。

## 5 极限的定义

称 $L$ 是 $\\{a_n\\}$ 的极限，如果对**任意** $\\varepsilon > 0$，都**存在**正整数 $N$，使得当 $n > N$ 时 $|a_n - L| < \\varepsilon$。记作 $\\lim_{n\\to\\infty} a_n = L$。

注意两个量词的顺序：先任给 $\\varepsilon$，再去找 $N$。反过来（先定 $N$ 再对所有 $\\varepsilon$ 成立）就要求 $N$ 之后的项全都等于 $L$，那是另一回事。

## 6 例：$\\frac1n \\to 0$

任给 $\\varepsilon > 0$。要 $|\\frac1n - 0| < \\varepsilon$，只需 $n > \\frac1\\varepsilon$。取 $N$ 为不小于 $\\frac1\\varepsilon$ 的整数，则 $n > N$ 时 $\\frac1n < \\frac1N \\le \\varepsilon$。

## 7 极限唯一

若 $L \\ne L'$ 都是极限，取 $\\varepsilon = \\frac{|L - L'|}{2}$。两条误差带不相交，而 $N$ 足够大之后的项要同时落在两条带里，矛盾。所以极限至多一个。
`;
const log = [], errors = [];
let server, browser;
try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ server: { host: '127.0.0.1', port: 1498, strictPort: true, watch: null }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:1498');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name: '数列极限入门.md', mimeType: 'text/markdown', buffer: Buffer.from(DOC) }]);
  await page.locator('.markdown-paper').filter({ hasText: '数列极限入门' }).waitFor();
  // 默认服务商就是 DeepSeek；只把 key 交给这次会话（浏览器预览里 key 只在内存里）。
  await page.evaluate(async ({ key, model }) => { const { loadAiSettings, saveAiSettings } = await import('/src/ai/settings.mjs'); await saveAiSettings({ ...loadAiSettings(), provider: 'deepseek', ...(model ? { model } : {}) }, key); }, { key, model: process.env.KZ_MODEL || '' });
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  const pane = page.locator('.ai-pane:visible').first();

  // 应用自己的状态：和页面用的是同一个模块实例。
  const snapshot = () => page.evaluate(async () => {
    const { chatState } = await import('/src/ai/workspace.ts'), { library } = await import('/src/sdk/index.ts');
    const doc = (await library.list())[0], state = chatState(doc.id);
    return { busy: Boolean(state.request), status: state.status, learning: JSON.parse(JSON.stringify(state.learning || null)), messages: state.messages.map(m => ({ id: m.id, role: m.role, auto: m.auto, failed: m.failed, content: m.content, learn: m.learn, usage: m.usage, sources: m.sources.length, ms: (m.finishedAt || 0) - (m.startedAt || 0) })) };
  });
  const idle = async () => { for (let i = 0; i < 1500; i++) { await page.waitForTimeout(200); if (!(await snapshot()).busy) { await page.waitForTimeout(400); if (!(await snapshot()).busy) return; } } throw new Error('一直在回答'); };

  await pane.getByRole('button', { name: '学习这一段', exact: true }).click();
  await pane.getByLabel('目标：自己写', { exact: true }).fill('');
  await pane.getByRole('button', { name: '开始', exact: true }).click();
  let checks = 0;
  for (let turn = 0; turn < maxTurns; turn++) {
    await idle();
    const now = await snapshot(), last = now.messages.at(-1);
    log.push({ turn, phase: now.learning?.phase, current: now.learning?.current, status: now.status, answer: last?.content, usage: last?.usage, sources: last?.sources, ms: last?.ms, failed: last?.failed });
    if (process.env.KZ_SHOTS) await pane.screenshot({ path: resolve(artifacts, `learning-turn-${turn}.png`) });
    if (now.status || last?.failed || now.learning?.phase === 'done') break;
    const accept = pane.getByRole('button', { name: '就这样开始', exact: true });
    if (now.learning?.phase === 'plan' && await accept.count()) { await accept.click(); continue; }
    const cards = pane.locator('.quiz:not(.done)'), total = await cards.count();
    if (!total) { log.push({ turn, note: '没有待答的题，停下' }); break; }
    const quizzes = [...last.content.matchAll(/```learn-quiz\s*([\s\S]*?)```/gi)].map(match => JSON.parse(match[1]));
    for (let at = 0; at < total; at++) {
    const card = cards.nth(at), quiz = quizzes[quizzes.length - total + at];
    const open = card.locator('.quiz-open'); if (await open.count()) await open.click();
    if (quiz.options) {
      const isCheck = quiz.kind === 'check'; if (isCheck) checks++;
      // 第 wrongAt 道检查题故意答错，看助手会不会停下来修。
      const wrong = isCheck && checks === wrongAt, index = wrong ? quiz.options.findIndex((_, i) => !quiz.answer.includes(i)) : quiz.answer[0];
      for (const i of wrong ? [index] : quiz.answer) await card.locator('.quiz-option').nth(await card.locator('.quiz-option').evaluateAll((nodes, text) => nodes.findIndex(node => node.textContent.trim() === text.trim()), await page.evaluate(async source => { const { renderMarkdown } = await import('/src/ai/render.ts'); const div = document.createElement('div'); div.innerHTML = renderMarkdown(source); return div.textContent; }, quiz.options[i]))).click();
      await card.getByLabel('我的想法', { exact: true }).fill(wrong ? '我觉得只要有无穷多项落在误差带里就算收敛了。' : '按定义推的，应该是这个。');
      await card.getByRole('radio', { name: wrong ? '比较确定' : '确定', exact: true }).click();
    } else await card.getByLabel('回答', { exact: true }).fill('我想弄明白为什么是先给 ε 再找 N，以及 N 为什么可以依赖 ε。学过高中数列，没学过严格定义。');
    if (total === 1) await card.getByRole('button', { name: '提交', exact: true }).click();
    }
    if (total > 1) {
      if (process.env.KZ_SHOTS) await pane.locator('.ai-messages').evaluate(node => { node.scrollTop = 0; });
      if (process.env.KZ_SHOTS) await pane.screenshot({ path: resolve(artifacts, `learning-probe.png`) });
      await pane.getByRole('button', { name: '一起提交', exact: true }).click();
    }
  }
  await idle().catch(() => {});
  if (process.env.KZ_UI) {
    // 大纲调整：勾两个节点，选一种现成的安排，看助手改不改大纲；再把大纲挪到屏幕左边，看对话记录和文档库。
    const outline = page.locator('.outline'), rows = outline.locator('.outline-nodes li');
    const plan = async () => (await snapshot()).learning?.plan?.nodes.map(node => `${node.id}${node.pace ? ':' + node.pace : ''}`);
    const before = await plan();
    // 右键给一个节点安排。
    await rows.nth(2).click({ button: 'right' }); await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(artifacts, 'learning-menu.png') });
    await page.getByRole('menuitem', { name: '讲快一点' }).or(page.getByRole('button', { name: '讲快一点', exact: true })).first().click();
    // 调整模式：把最后一个拖到第二个前面，删掉倒数第二个。
    await outline.getByRole('button', { name: '调整', exact: true }).click(); await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(artifacts, 'learning-adjust.png') });
    const last = await rows.last().boundingBox(), second = await rows.nth(1).boundingBox();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2); await page.mouse.down();
    for (let step = 1; step <= 12; step++) await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2 + (second.y + 4 - last.y - last.height / 2) * step / 12);
    await page.mouse.up(); await page.waitForTimeout(300);
    await outline.locator('.outline-remove').last().click({ force: true }); await page.waitForTimeout(200);
    await outline.getByRole('button', { name: '完成', exact: true }).click();
    const edited = await plan();
    // 底下的输入框：交给助手改。
    await outline.getByLabel('想怎么改大纲', { exact: true }).fill('把前两个节点合成一个');
    await outline.getByRole('button', { name: '发给助手', exact: true }).click(); await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(artifacts, 'learning-revising.png') });
    await idle();
    log.push({ adjust: { before, edited, after: await plan(), reply: (await snapshot()).messages.at(-1)?.content.slice(0, 200) } });
    await outline.getByRole('button', { name: '移到屏幕左边', exact: true }).click(); await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(artifacts, 'learning-left.png') });
    await page.getByRole('button', { name: /学习进度/ }).first().click(); await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(artifacts, 'learning-board.png') });
    await page.getByText('文档库', { exact: true }).first().click(); await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(artifacts, 'learning-library.png') });
    console.log(JSON.stringify(log.at(-1), null, 1));
  }
  const end = await snapshot();
  if (!process.env.KZ_UI) await page.screenshot({ path: resolve(artifacts, 'learning-trial.png') });
  if (!process.env.KZ_UI) await pane.screenshot({ path: resolve(artifacts, 'learning-trial-pane.png') });
  const turns = end.messages.filter(m => m.role === 'assistant');
  const sum = key => turns.reduce((total, m) => total + (m.usage?.[key] || 0), 0);
  const report = { requests: turns.length, autoFollowUps: end.messages.filter(m => m.auto).map(m => m.content), input: sum('input'), output: sum('output'), reasoning: sum('reasoning'), seconds: Math.round(turns.reduce((t, m) => t + m.ms, 0) / 1000), learning: end.learning, errors, log, messages: end.messages };
  await writeFile(resolve(artifacts, 'learning-trial.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ requests: report.requests, input: report.input, output: report.output, reasoning: report.reasoning, seconds: report.seconds, phase: end.learning?.phase, progress: end.learning && Object.fromEntries(Object.entries(end.learning.progress).map(([id, p]) => [id, p.passed])), auto: report.autoFollowUps, status: end.status, errors }, null, 1));
} finally { await browser?.close(); await server?.close(); }
