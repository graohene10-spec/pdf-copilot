import test from 'node:test';
import assert from 'node:assert/strict';
import { TextIndex, textBlocks } from '../extension/reader/text-index.mjs';
import { DocumentService } from '../extension/reader/document-service.mjs';
import { validateToolCall, toolsForVision } from '../extension/common/document-tools.mjs';
import { boundedHistory, streamDocumentChat } from '../extension/providers/document-chat.mjs';
import { streamNativeDocument } from '../extension/providers/native.js';

const item = (text, x, y) => ({ str: text, transform: [10, 0, 0, 10, x, y], width: text.length * 5, height: 10 });
const fixture = (count = 10) => ({
  numPages: count,
  getPageLabels: async () => Array.from({ length: count }, (_, i) => i === 0 ? 'i' : String(i)),
  getOutline: async () => [{ title: 'Definitions', dest: [1] }],
  getPage: async page => ({ getViewport: () => ({ width: 500 }), getTextContent: async () => ({ items: page === 5 ? [] : [item(page === 2 ? 'The coupling constant is defined by equation (6.23).' : 'Page ' + page + ' discussion of the approximation.', 40, 600), item('Next paragraph states the assumptions.', 40, 560)] }) }),
});
test('text reconstruction separates columns and preserves equation numbers and geometry', () => {
  const items = [];
  for (let i = 0; i < 6; i++) { items.push(item('Left ' + i, 30, 600 - i * 12)); items.push(item('Right ' + i, 280, 600 - i * 12)); }
  const blocks = textBlocks({ items }, 7, 500);
  assert(blocks[0].text.includes('Left 5')); assert(!blocks[0].text.includes('Right'));
  assert(blocks[1].text.includes('Right')); assert.equal(blocks[0].rect.space, 'pdf-points');
  const index = new TextIndex(); index.add(7, blocks);
  index.add(2, [{ blockId: 'p2-b0', text: '式 (6.23) 定义耦合常数', rect: {} }]);
  assert.equal(index.search('(6.23)')[0].page, 2); assert.equal(index.search('耦合常数')[0].page, 2);
});
test('document service finds earlier definitions, tracks physical pages and limits image reads', async () => {
  const images = [];
  const service = new DocumentService(fixture(), { name: 'Synthetic' }, () => 8, async page => { images.push(page); return 'data:image/jpeg;base64,YQ=='; });
  const seed = await service.begin('session-123', 8, true);
  assert.equal(seed.seed.evidence[0].page, 8); assert.equal(seed.seed.evidence[0].pageLabel, '7');
  const search = await service.tool('session-123', 'pdf_search', { query: '(6.23)', start_page: null, end_page: null, next_page: null });
  assert.equal(search.evidence[0].page, 2); assert.equal(search.complete, true);
  const read = await service.tool('session-123', 'pdf_read', { start_page: 2, block_id: search.evidence[0].blockId });
  assert(read.evidence.some(item => item.text.includes('assumptions')));
  assert.equal(read.evidence[0].sourceId, search.evidence[0].sourceId);
  assert.deepEqual((await service.tool('session-123', 'pdf_read', { start_page: 5 })).noTextPages, [5]);
  await service.tool('session-123', 'pdf_view', { page: 2, block_id: null });
  await service.tool('session-123', 'pdf_view', { page: 5, block_id: null });
  await assert.rejects(service.tool('session-123', 'pdf_view', { page: 8 }), /上限/);
  assert.deepEqual(images, [2, 5]); service.close();
  await assert.rejects(service.tool('session-123', 'pdf_info', {}), /结束/);
});
test('cancellation during extraction cannot return data from a closed document', async () => {
  let finish; const pdf = fixture(); pdf.getPage = async () => ({ getViewport: () => ({ width: 500 }), getTextContent: () => new Promise(resolve => { finish = resolve; }) });
  const service = new DocumentService(pdf, {}, () => 1, async () => '');
  const pending = service.begin('session-456', 1, false);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  service.close(); finish({ items: [item('must not return', 40, 600)] });
  await assert.rejects(pending, /切换|关闭|abort/i); assert.equal(service.index.pages.size, 0);
});
test('screenshot seed follows its nearby paragraphs and lazy text cleanup avoids rendered pages', async () => {
  const pdf = fixture(2), cleaned = [];
  pdf.getPage = async page => ({ getViewport: () => ({ width: 500 }), cleanup: () => cleaned.push(page), getTextContent: async () => ({ items: Array.from({ length: 12 }, (_, i) => item('Paragraph ' + i, 40, 700 - i * 45)) }) });
  const service = new DocumentService(pdf, {}, () => 2, async () => '', page => page === 1);
  const seed = await service.begin('nearby-1234', 1, false, { space: 'pdf-points', x: 40, y: 240, width: 120, height: 20 });
  assert(seed.seed.evidence.some(item => item.text.includes('Paragraph 10')));
  assert(!seed.seed.evidence.some(item => item.text.includes('Paragraph 0')));
  assert.deepEqual(cleaned, [1]);
  await service.tool('nearby-1234', 'pdf_read', { start_page: 2 }); assert.deepEqual(cleaned, [1]); service.close();
});
test('large-document searches report partial coverage and continue without claiming absence', async () => {
  const service = new DocumentService(fixture(300), {}, () => 280, async () => '');
  await service.begin('coverage-1234', 280, false);
  const result = await service.tool('coverage-1234', 'pdf_search', { query: 'nonexistentword', start_page: 1, end_page: 300, next_page: null });
  assert.equal(result.complete, false); assert.equal(result.next_page, 121); assert.deepEqual(result.evidence, []);
  const next = await service.tool('coverage-1234', 'pdf_search', { query: '(6.23)', start_page: 1, end_page: 300, next_page: result.next_page });
  assert.equal(next.complete, false); assert.equal(next.next_page, 241); assert(next.evidence.some(item => item.page === 2)); service.close();
});
test('tool arguments cannot read arbitrary files or unlimited pages; old images do not re-upload', () => {
  assert.throws(() => validateToolCall('pdf_read', { start_page: 1, end_page: 9 }, 20), /最多/);
  assert.throws(() => validateToolCall('pdf_read', { start_page: 1, path: 'secret' }, 20), /未知/);
  assert.throws(() => validateToolCall('pdf_read', { start_page: 1, constructor: 'secret' }, 20), /未知/);
  assert.throws(() => validateToolCall('shell', {}, 20), /不支持/);
  assert.throws(() => validateToolCall('pdf_view', { page: 99 }, 20), /超出/);
  assert(!toolsForVision(false).some(tool => tool.name === 'pdf_view'));
  const messages = boundedHistory([{ role: 'user', content: 'prior', images: ['old'] }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'new', images: ['new'] }]);
  assert.equal(messages[0].images, undefined); assert.deepEqual(messages.at(-1).images, ['new']);
});
function sse(events, done = false) { return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'Content-Type': 'text/event-stream' } }); }
const options = { model: 'gpt-5.4-mini', provider: 'openai', effort: 'low', baseUrl: 'https://api.openai.com/v1', apiKey: 'synthetic', messages: [{ role: 'user', content: 'Find definition' }] };
test('OpenAI tool loop returns only requested evidence and preserves encrypted reasoning', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; }); const requests = [], calls = []; let answer = '';
  globalThis.fetch = async (_, request) => {
    requests.push(JSON.parse(request.body));
    if (requests.length === 1) return sse([{ type: 'response.completed', response: { status: 'completed', output: [{ type: 'reasoning', id: 'reason', encrypted_content: 'opaque' }, { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'pdf_search', arguments: JSON.stringify({ query: '(6.23)', start_page: null, end_page: null, next_page: null }) }] } }]);
    return sse([{ type: 'response.output_text.delta', delta: 'Definition [Stest-1]' }, { type: 'response.completed', response: { status: 'completed', output: [] } }]);
  };
  await streamDocumentChat({ ...options, onDelta: value => { answer += value; } }, { tool: async (name, args) => { calls.push({ name, args }); return { evidence: [{ sourceId: 'Stest-1', page: 2, text: 'Only necessary definition' }] }; } }, { info: { pages: 800 }, seed: { evidence: [] } });
  assert.equal(calls[0].name, 'pdf_search'); assert.equal(requests.length, 2); assert.equal(requests[1].store, false);
  assert(requests[1].input.some(item => item.encrypted_content === 'opaque'));
  assert(requests[1].input.some(item => item.type === 'function_call_output' && item.call_id === 'call1'));
  assert(answer.includes('[Stest-1]')); assert(!JSON.stringify(requests).includes('file:///'));
});
test('DeepSeek assembles streamed tool arguments and replays reasoning_content', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; }); const requests = [];
  globalThis.fetch = async (_, request) => {
    requests.push(JSON.parse(request.body));
    if (requests.length === 1) return sse([
      { choices: [{ delta: { reasoning_content: 'provider-reasoning', tool_calls: [{ index: 0, id: 'd1', function: { name: 'pdf_read', arguments: '{"start_page":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '2,"end_page":null,"block_id":null}' } }] }, finish_reason: 'tool_calls' }] },
    ], true);
    return sse([{ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }], true);
  };
  await streamDocumentChat({ ...options, provider: 'deepseek', model: 'deepseek-flash', effort: 'high', baseUrl: 'https://api.deepseek.com', onDelta: () => {} }, { tool: async () => ({ evidence: [] }) }, { info: { pages: 4 }, seed: {} });
  assert.equal(requests[1].messages.find(msg => msg.tool_calls)?.reasoning_content, 'provider-reasoning');
  assert.equal(requests[1].messages.find(msg => msg.role === 'tool').tool_call_id, 'd1');
});
test('an API without tools falls back to a bounded plan, expands search hits and attaches requested images', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; }); const requests = [], calls = []; let answer = '';
  globalThis.fetch = async (_, request) => {
    requests.push(JSON.parse(request.body));
    if (requests.length === 1) return new Response(JSON.stringify({ error: { message: 'tools are not supported' } }), { status: 400 });
    const delta = requests.length === 2 ? JSON.stringify({ queries: ['definition', '../secret'], pages: [9999], views: [2, 2, 3, 4] }) : 'Fallback answer [Splan-1]';
    return sse([{ type: 'response.output_text.delta', delta }, { type: 'response.completed', response: { status: 'completed', output: [] } }]);
  };
  await streamDocumentChat({ ...options, onDelta: text => { answer += text; } }, { tool: async (name, args) => {
    calls.push({ name, args }); return { evidence: [{ sourceId: 'Splan-1', page: 2, blockId: 'p2-b0', text: 'Definition and assumptions' }], ...(name === 'pdf_view' ? { dataUrl: 'data:image/jpeg;base64,YQ==' } : {}) };
  } }, { info: { pages: 4 }, seed: {} });
  assert.equal(requests.length, 3); assert.equal(calls.filter(call => call.name === 'pdf_view').length, 2);
  assert(calls.some(call => call.name === 'pdf_read' && call.args.block_id === 'p2-b0'));
  assert(!calls.some(call => call.args.start_page === 9999)); assert(!answer.includes('queries')); assert(answer.includes('Splan-1'));
  assert(JSON.stringify(requests.at(-1)).includes('data:image/jpeg')); assert.equal(requests.at(-1).tools, undefined);
});
function fakeNative(t, handle) {
  const original = globalThis.chrome; t.after(() => { globalThis.chrome = original; }); let connections = 0;
  globalThis.chrome = { runtime: { connectNative: () => {
    const number = ++connections; let receive;
    return { onMessage: { addListener: listener => { receive = listener; } }, onDisconnect: { addListener: () => {} }, disconnect: () => {}, postMessage: message => queueMicrotask(() => handle(message, value => receive(value), number)) };
  } } };
}
test('Codex browser adapter returns tool evidence on the active port before completing', async t => {
  let chatId, reply, answer = '';
  fakeNative(t, (message, emit) => {
    if (message.type === 'chat') { chatId = message.id; assert.equal(message.pdfTools, true); emit({ id: chatId, event: 'tool', callId: 'opaque-call', tool: 'pdf_read', arguments: { start_page: 2 } }); }
    if (message.type === 'tool-result') { reply = message; emit({ id: chatId, event: 'delta', text: 'Answer [Snative-1]' }); emit({ id: chatId, event: 'done' }); }
  });
  await streamNativeDocument({ model: 'fixture', effort: 'low', messages: [{ role: 'user', content: 'Question' }], tools: toolsForVision(false), onTool: async () => ({ evidence: [{ sourceId: 'Snative-1', page: 2, text: 'Evidence' }] }), onDelta: text => { answer += text; } });
  assert.equal(reply.targetId, chatId); assert.equal(reply.callId, 'opaque-call'); assert.equal(JSON.parse(reply.text).evidence[0].page, 2); assert(answer.includes('Snative-1'));
});
test('an older native helper falls back without sending unknown fields to the plan and answer', async t => {
  const messages = [], calls = []; let answer = '';
  fakeNative(t, (message, emit, connection) => {
    if (message.type !== 'chat') return; messages.push(message);
    if (connection === 1) { emit({ id: message.id, ok: false, error: 'Unsupported request field: pdfTools' }); return; }
    assert.equal(message.pdfTools, undefined);
    emit({ id: message.id, event: 'delta', text: connection === 2 ? '{"queries":["definition"],"pages":[],"views":[]}' : 'Compatible answer [Sold-1]' });
    emit({ id: message.id, event: 'done' });
  });
  await streamDocumentChat({ ...options, provider: 'codex', model: 'fixture', onDelta: text => { answer += text; } }, { tool: async (name, args) => { calls.push({ name, args }); return { evidence: [{ sourceId: 'Sold-1', page: 2, blockId: 'p2-b0', text: 'Earlier definition' }] }; } }, { info: { pages: 10 }, seed: {} });
  assert.equal(messages.length, 3); assert.equal(calls[0].name, 'pdf_search'); assert.equal(calls[1].name, 'pdf_read'); assert(messages[2].text.includes('Earlier definition')); assert.equal(answer, 'Compatible answer [Sold-1]');
});
