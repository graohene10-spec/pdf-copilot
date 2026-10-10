// Real local streaming service, synthetic files, isolated preview / fixed native executable.
import { chromium } from 'playwright';
import { createServer as viteServer } from 'vite';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const native = !!process.env.PHYDOG_TABS_NATIVE;
const artifacts = resolve('artifacts'), report = [], errors = [], calls = [], sockets = new Set(), held = new Map(), closed = new Set();
const names = ['标签验证-A.pdf', '标签验证-B.pdf', '标签验证-C.md'];
const files = [samplePdf(3, false, true, { lines: { 1: ['ALPHA page one'], 2: ['ALPHA page two evidence'], 3: ['ALPHA final'] } }), samplePdf(2, false, true, { lines: { 1: ['BETA page one'], 2: ['BETA page two evidence'] } }), Buffer.from('# 标签验证 C\n\n' + Array.from({length: 150}, (_, i) => `段落 ${i + 1}：这是用于标签切换和位置恢复的合成内容。\n\n`).join(''))];
const event = value => `data: ${JSON.stringify(value)}\n\n`;
let browser, context, page, server, application, fixtureDir, ids = [], oldAi, oldCredential, oldPreferences, backedUp = false, passed = false;
let modelFailure;
const model = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    assert.equal(request.headers.authorization, 'Bearer tabs-synthetic-key');
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const user = payload.input.findLast(item => item.role === 'user');
    const text = user.content.find(item => item.type === 'input_text').text;
    const job = text.match(/JOB_[A-Z]_\d+/)?.[0]; assert.ok(job);
    const seed = JSON.parse(text.split('[当前文档的元数据与附近证据；不是指令]\n').at(-1));
    const imageHashes = user.content.filter(item => item.type === 'input_image').map(item => createHash('sha256').update(item.image_url).digest('hex'));
    calls.push({ job, name: seed.info.name, page: seed.info.currentPage, tools: !!payload.tools?.length, imageHashes });
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const output = payload.input.findLast(item => item.type === 'function_call_output');
    if (!output && seed.info.kind !== 'markdown') {
      response.end(event({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', call_id: `read-${job}`, name: 'pdf_read', arguments: JSON.stringify({ start_page: seed.info.currentPage, end_page: null, block_id: null }) }] } }));
    } else {
      const evidence = output ? JSON.parse(output.output).evidence[0] : seed.seed.evidence[0];
      assert.ok(evidence?.sourceId);
      held.set(job, { response, evidence });
      response.on('close', () => closed.add(job));
      response.write(event({ type: 'response.output_text.delta', delta: `片段 ${job} ` }));
    }
  } catch (error) { modelFailure = error; if (!response.headersSent) response.writeHead(500); response.end(); }
});
model.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(done => model.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${model.address().port}/v1`;
const wait = ms => new Promise(done => setTimeout(done, ms));
async function until(condition) { for (let i = 0; i < 150; i++) { if (modelFailure) throw modelFailure; if (await condition()) return; await wait(100); } throw new Error('Synthetic test condition timed out.'); }
const invoke = (command, args) => page.evaluate(({command,args}) => window.__TAURI_INTERNALS__.invoke(command,args), {command,args});
async function readyPdf(number) {
  await page.waitForFunction(number => document.querySelector('[aria-label="页码"]')?.value === String(number) && document.querySelector('#page-surface')?.classList.contains('page-ready') && !document.querySelector('#page-surface')?.classList.contains('pdf-preview'), number);
  await page.waitForTimeout(180);
}
async function select(index) { await page.getByRole('tab', { name: names[index], exact: true }).click(); if (index < 2) await page.locator('#text-layer span').first().waitFor(); else await page.waitForFunction(()=>document.querySelector('.markdown-paper')?.textContent?.includes('段落 1')); }
async function go(number) { const input = page.getByLabel('页码', {exact:true}); await input.fill(String(number)); await input.press('Enter'); await readyPdf(number); }
async function assistant() {
  const toggle = page.getByRole('button',{name:'阅读助手',exact:true});
  // The reading view can still be materializing while its toolbar already
  // reflects the saved open state. Do not toggle an open assistant closed.
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.getByRole('textbox',{name:'向 AI 提问'}).waitFor();
}
async function ask(job) { await assistant(); await page.getByRole('textbox',{name:'向 AI 提问'}).fill(job); await page.getByRole('button',{name:'发送 ↑',exact:true}).click(); }
async function capture() {
  const toggle = page.getByTitle('框选公式或图表作为 AI 上下文', { exact: true });
  if (!(await toggle.getAttribute('class'))?.split(' ').includes('active')) await toggle.click();
  const paper = await page.locator('#page-surface').boundingBox(), scroll = await page.locator('.pdf-scroll').boundingBox();
  const x = Math.max(paper.x, scroll.x) + 35, y = Math.max(paper.y, scroll.y) + 55;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 120, y + 60); await page.mouse.up();
  const preview = page.locator('.ai-selection-context img'); await preview.waitFor();
  return createHash('sha256').update(await preview.getAttribute('src')).digest('hex');
}
async function assertCaptureConsumed() {
  await page.locator('.ai-selection-context').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.ai-message img').count(), 0, 'Sent screenshots do not occupy conversation space');
}
async function concurrency(value) {
  await page.getByRole('button',{name:'更改',exact:true}).click();
  await page.locator('summary').filter({hasText:'多文件提问'}).click();
  await page.getByLabel('同时运行的提问',{exact:true}).fill(String(value));
  await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();
}
function finish(job) { const entry = held.get(job); assert.ok(entry); entry.response.write(event({type:'response.output_text.delta',delta:`完成 ${job} [${entry.evidence.sourceId}]`})); entry.response.end(event({type:'response.completed',response:{status:'completed',output:[]}})); }

try {
  await mkdir(artifacts,{recursive:true});
  if (native) {
    const { productName } = JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
    const executable = resolve('release',`${productName}-portable`,`${productName}.exe`);
    application = spawn(executable,[],{cwd:resolve(executable,'..'),windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-address=127.0.0.1 --remote-debugging-port=9231'}});
    await until(async () => { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9231'); return true; } catch { return false; } });
    await until(() => { page = browser.contexts().flatMap(item=>item.pages()).find(item=>/tauri\.localhost/.test(item.url())); return !!page; });
    await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__ && !!document.querySelector('.library-heading'));
    oldAi = await page.evaluate(()=>localStorage.getItem('paperdesk.ai.settings.v1'));
    oldCredential = await invoke('get_credential',{provider:'openai'});
    oldPreferences = await invoke('get_setting',{key:'app.preferences.v1'});
    backedUp = true;
    // Keep synthetic tests independent of a user's custom per-question budgets.
    await page.evaluate(()=>localStorage.removeItem('paperdesk.ai.settings.v1'));
    fixtureDir = resolve(artifacts,`tabs-fixtures-${randomUUID()}`); await mkdir(fixtureDir);
    const paths = names.map(name=>resolve(fixtureDir,name)); await Promise.all(paths.map((path,index)=>writeFile(path,files[index])));
    const documents = await invoke('import_documents',{paths}); ids = documents.map(item=>item.id);
    await page.reload();
    for (const name of names) { await page.getByRole('button',{name:`打开 ${name}`,exact:true}).click(); await page.getByRole('button',{name:'文档库',exact:true}).click(); }
    await select(0);
  } else {
    server = await viteServer({server:{host:'127.0.0.1',port:1461,strictPort:true,watch:{ignored:['**/src-tauri/**','**/artifacts/**']}}}); await server.listen();
    browser = await chromium.launch({channel:'msedge',headless:true}); context = await browser.newContext({viewport:{width:1400,height:900}}); page = await context.newPage();
    await page.goto('http://127.0.0.1:1461');
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button',{name:'加入文档',exact:true}).click();
    await (await chooser).setFiles(names.map((name,index)=>({name,mimeType:index<2?'application/pdf':'text/markdown',buffer:files[index]})));
  }
  page.on('pageerror', error=>errors.push(error.message));
  await readyPdf(1); assert.equal(await page.getByRole('tab').count(),3);
  await page.getByTitle('适应宽度',{exact:true}).click(); await readyPdf(1);
  if (native && oldPreferences && JSON.parse(oldPreferences).pdf?.openAssistantOnCapture === false) {
    await page.getByRole('button',{name:'打开设置',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'阅读',exact:true}).click();
    await page.getByLabel('PDF 框选后自动打开阅读助手',{exact:true}).check();
    await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();
  }
  await page.getByRole('button',{name:'文档库',exact:true}).click();
  await page.getByRole('button',{name:`打开 ${names[0]}`,exact:true}).click(); await readyPdf(1);
  assert.equal(await page.getByRole('tab').count(),3);
  assert.ok(await page.locator('.app-topbar').evaluate(el=>el.getBoundingClientRect().height<=49));
  report.push('Multi-import / reopening deduplicates tabs; tab strip reuses compact 48px header');

  // Ordinary selection stays quiet and exposes a single action near the range.
  await page.locator('#text-layer span').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  assert.equal(await page.locator('.ai-pane').count(),0);
  await page.getByRole('button',{name:'用所选文字向 AI 提问',exact:true}).click();
  await page.getByRole('textbox',{name:'向 AI 提问'}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='向 AI 提问');
  await page.getByTitle('清除选区',{exact:true}).click();
  await page.getByRole('button',{name:'关闭阅读助手',exact:true}).click();
  await page.getByTitle('框选公式或图表作为 AI 上下文',{exact:true}).click();
  const bounds = await page.locator('#page-surface').boundingBox();
  await page.mouse.move(bounds.x+30,bounds.y+40); await page.mouse.down(); await page.mouse.move(bounds.x+160,bounds.y+100); await page.mouse.up();
  await page.locator('.ai-selection-context img').waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='向 AI 提问');
  assert.equal(calls.length,0);
  await page.getByTitle('清除选区',{exact:true}).click();
  report.push('Text selection never auto-opens; one click carries text and focuses composer; PDF capture auto-opens with no automatic model request');

  await page.getByRole('button',{name:'更改',exact:true}).click();
  await page.getByLabel('服务商',{exact:true}).selectOption('openai');
  await page.getByLabel('API 地址',{exact:true}).fill(baseUrl);
  await page.getByLabel('API Key',{exact:true}).fill('tabs-synthetic-key');
  await page.getByLabel('模型',{exact:true}).fill('tabs-mock-model');
  await page.locator('summary').filter({hasText:'多文件提问'}).click();
  await page.getByLabel('同时运行的提问',{exact:true}).fill('1');
  await page.getByLabel('最多等待的提问',{exact:true}).fill('1');
  await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();

  await go(2); await page.getByTitle('放大',{exact:true}).click(); await readyPdf(2);
  const aScale = await page.locator('.reader-zoom').innerText();
  await page.locator('.pdf-scroll').evaluate(el=>el.scrollTop+=110); await page.waitForTimeout(100);
  const aFraction = await page.locator('.pdf-scroll').evaluate(el=>{const slot=document.querySelector('#page-surface');return (el.scrollTop-slot.offsetTop)/slot.offsetHeight;});
  const aCapture = await capture();
  await ask('JOB_A_1'); await until(()=>held.has('JOB_A_1'));
  await assertCaptureConsumed();
  assert.ok(calls.find(call => call.job === 'JOB_A_1').imageHashes.includes(aCapture), 'Clearing preview must preserve the original screenshot in the model request');
  await page.getByRole('textbox',{name:'向 AI 提问'}).fill('A 的未发送草稿');
  await select(1); await readyPdf(1); await go(2); const bCapture = await capture(); await ask('JOB_B_1');
  await page.locator('.ai-status').filter({hasText:'队列第 1 位'}).waitFor();
  await assertCaptureConsumed();
  await go(1); // queued question must keep its original page 2 snapshot.
  await select(2); await ask('JOB_C_1');
  await page.locator('.ai-status').filter({hasText:'队列已满'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'向 AI 提问'}).inputValue(),'JOB_C_1');
  assert.equal(calls.filter(call=>call.job==='JOB_B_1').length,0);
  assert.equal(calls.filter(call=>call.job==='JOB_C_1').length,0);
  assert.equal(await page.locator('.answer-body').count(),0);
  await select(0); await readyPdf(2);
  assert.equal(await page.locator('.reader-zoom').innerText(),aScale);
  const returnedFraction = await page.locator('.pdf-scroll').evaluate(el=>{const slot=document.querySelector('#page-surface');return (el.scrollTop-slot.offsetTop)/slot.offsetHeight;});
  assert.ok(Math.abs(returnedFraction-aFraction)<.01);
  assert.equal(await page.getByRole('textbox',{name:'向 AI 提问'}).inputValue(),'A 的未发送草稿');
  await page.locator('.answer-body').filter({hasText:'片段 JOB_A_1'}).waitFor();
  await page.screenshot({path:resolve(artifacts,`${native?'native-':''}tabs-ui-multiple.png`),animations:'disabled'});
  await page.getByRole('button',{name:'关闭阅读助手',exact:true}).click();
  assert.equal(closed.has('JOB_A_1'),false);
  await page.getByRole('button',{name:'文档库',exact:true}).click();
  finish('JOB_A_1'); await until(()=>held.has('JOB_B_1'));
  assert.equal(calls.find(call=>call.job==='JOB_A_1').name,names[0]);
  assert.equal(calls.find(call=>call.job==='JOB_B_1').name,names[1]);
  assert.equal(calls.find(call=>call.job==='JOB_B_1').page,2);
  assert.ok(calls.find(call => call.job === 'JOB_B_1').imageHashes.includes(bCapture), 'Queued capture keeps original image after its preview disappears and the reader changes page');
  await select(0); await readyPdf(2); await assistant();
  await page.locator('.answer-body').filter({hasText:'完成 JOB_A_1'}).waitFor();
  assert.equal(await page.locator('.answer-body').filter({hasText:'JOB_B_1'}).count(),0);
  await page.locator('.inline-citation').first().click(); await readyPdf(2);
  report.push('Background stream / document tools survive switching and hidden assistant; page/zoom/fraction/draft/citations stay with origin; queue snapshot and full-queue retry validated');

  await select(2); await ask('JOB_C_1'); await page.locator('.ai-status').filter({hasText:'队列第 1 位'}).waitFor();
  await page.getByRole('button',{name:`关闭 ${names[1]} 标签`,exact:true}).click();
  await until(()=>closed.has('JOB_B_1') && held.has('JOB_C_1'));
  finish('JOB_C_1'); await page.locator('.ai-status').filter({hasText:'回答完成'}).waitFor();
  assert.equal(await page.locator('.answer-body').filter({hasText:'JOB_B_1'}).count(),0);
  await page.locator('.markdown-scroll').evaluate(el=>el.scrollTop=el.scrollHeight*.55); await page.waitForTimeout(120);
  await page.getByRole('button',{name:'查看源码',exact:true}).click(); await page.waitForTimeout(180);
  const mdTop = await page.locator('.markdown-scroll').evaluate(el=>el.scrollTop);
  await select(0); await readyPdf(2); await select(2);
  assert.ok(await page.getByRole('button',{name:'阅读视图',exact:true}).isVisible());
  assert.ok(Math.abs(await page.locator('.markdown-scroll').evaluate(el=>el.scrollTop)-mdTop)<3);
  report.push('Closing a running background tab closes real HTTP stream, frees next slot, and cannot cross-write; Markdown source mode and scroll restored');

  await concurrency(2);
  await select(0); await readyPdf(2); await ask('JOB_A_3'); await until(()=>held.has('JOB_A_3'));
  await select(2); await ask('JOB_C_3'); await until(()=>held.has('JOB_C_3'));
  assert.equal(closed.has('JOB_A_3'),false); assert.equal(closed.has('JOB_C_3'),false);
  await page.getByRole('button',{name:'文档库',exact:true}).click();
  await page.getByRole('button',{name:`打开 ${names[1]}`,exact:true}).click(); await readyPdf(1); await ask('JOB_B_3');
  await page.locator('.ai-status').filter({hasText:'队列第 1 位'}).waitFor();
  await page.locator('.task-summary').filter({hasText:'2 运行'}).waitFor();
  assert.equal(calls.some(call=>call.job==='JOB_B_3'),false);
  finish('JOB_C_3'); await until(()=>held.has('JOB_B_3'));
  assert.equal(closed.has('JOB_A_3'),false);
  finish('JOB_A_3'); finish('JOB_B_3');
  await page.locator('.ai-status').filter({hasText:'回答完成'}).waitFor();
  assert.equal(await page.locator('.answer-body').filter({hasText:'JOB_A_3'}).count(),0);
  assert.equal(await page.locator('.answer-body').filter({hasText:'JOB_C_3'}).count(),0);
  report.push('Two real simultaneous document streams remain independent; third waits and starts when either finishes; completion cannot reset another file’s composer');
  await concurrency(1);

  // Queued close owns no PDF worker or network request and frees capacity immediately.
  await select(0); await ask('JOB_A_2'); await until(()=>held.has('JOB_A_2'));
  await select(2); await ask('JOB_C_2'); await page.locator('.ai-status').filter({hasText:'队列第 1 位'}).waitFor();
  await page.getByRole('button',{name:`关闭 ${names[2]} 标签`,exact:true}).click(); await select(0); await readyPdf(2);
  finish('JOB_A_2'); await page.locator('.ai-status').filter({hasText:'回答完成'}).waitFor();
  assert.equal(calls.some(call=>call.job==='JOB_C_2'),false);
  await page.getByRole('button',{name:'文档库',exact:true}).click(); await page.getByRole('button',{name:`打开 ${names[2]}`,exact:true}).click(); await assistant();
  assert.equal(await page.locator('.ai-message').count(),0);
  // DOM dispatch avoids browser-owned Ctrl+W in the preview while exercising the app handler.
  if (native) await page.keyboard.press('Control+Tab');
  else await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',ctrlKey:true,bubbles:true,cancelable:true})));
  await readyPdf(2); assert.equal(await page.getByRole('tab',{name:names[0],exact:true}).getAttribute('aria-selected'),'true');
  if (native) await page.keyboard.press('Control+w');
  else await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',ctrlKey:true,bubbles:true,cancelable:true})));
  assert.equal(await page.getByRole('tab').count(),2);
  report.push('Closing queued tab sends no model request; reopening starts fresh chat; next-tab / close-tab shortcuts select adjacent document');
  if (!native) await page.setViewportSize({width:1000,height:740});
  assert.ok(await page.locator('.app-topbar').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  assert.deepEqual(errors,[]); assert.equal(modelFailure,undefined);
  await page.screenshot({path:resolve(artifacts,`${native?'native-':''}tabs-ui.png`),animations:'disabled'});
  passed = true;
  console.log(JSON.stringify({passed,native,report,requests:calls.length,errors},null,2));
} finally {
  if (page && !page.isClosed()) {
    for (const name of names) { const close = page.getByRole('button',{name:`关闭 ${name} 标签`,exact:true}); if (await close.count()) await close.click().catch(()=>{}); }
    if (native && backedUp) {
      await wait(400);
      await page.evaluate(value=>{if(value===null)localStorage.removeItem('paperdesk.ai.settings.v1');else localStorage.setItem('paperdesk.ai.settings.v1',value);},oldAi);
      await invoke('set_credential',{provider:'openai',key:oldCredential||''});
      await invoke('set_setting',{key:'app.preferences.v1',value:oldPreferences||''});
      for (const id of ids) await invoke('remove_document',{id});
    }
  }
  await mkdir(artifacts,{recursive:true});
  await writeFile(resolve(artifacts,`${native?'native-':''}tabs-ui.json`),JSON.stringify({passed,native,report,requests:calls.length,errors},null,2));
  await context?.close(); await browser?.close(); application?.kill(); await server?.close();
  for (const socket of sockets) socket.destroy(); await new Promise(done=>model.close(done));
  if (fixtureDir) { for(const name of names) await unlink(resolve(fixtureDir,name)); await rmdir(fixtureDir); }
}
