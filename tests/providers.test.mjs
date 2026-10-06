import test from 'node:test';
import assert from 'node:assert/strict';
import { readSSE } from '../extension/providers/sse.js';
import { buildPayload, streamChat } from '../extension/providers/index.js';
import { apiOrigin, saveSettings, loadKey } from '../extension/common/settings.js';
import { validateContext } from '../extension/common/context.js';

function response(text, cuts = [1, 2, 5, 3, 7]) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      let offset = 0, index = 0;
      while (offset < bytes.length) { const size = cuts[index++ % cuts.length]; controller.enqueue(bytes.slice(offset, offset + size)); offset += size; }
      controller.close();
    },
  }), { status: 200 });
}
test('SSE handles multibyte Chinese, CRLF boundaries, comments and final unterminated frame', async () => {
  const out = [];
  for await (const event of readSSE(response(': keepalive\r\n\r\ndata: {"delta":"你好"}\r\n\r\ndata: first\ndata: second\n\ndata: [DONE]'))) out.push(event);
  assert.deepEqual(out, ['{"delta":"你好"}', 'first\nsecond', '[DONE]']);
});
test('Responses request is stateless and accepts inline images, no tool definitions', () => {
  const payload = buildPayload({ provider: 'openai', model: 'gpt-5.4-mini', effort: 'low', messages: [
    { role: 'user', content: '图是什么？', images: ['data:image/png;base64,YQ=='] }, { role: 'assistant', content: '图表。' },
  ] });
  assert.equal(payload.store, false); assert.equal(payload.tools, undefined);
  assert.deepEqual(payload.reasoning, { effort: 'low' });
  assert.equal(payload.input[0].content[1].image_url, 'data:image/png;base64,YQ==');
  assert.equal(payload.input[1].content[0].type, 'output_text');
});
test('DeepSeek uses actual effort parameters and blocks non-vision models', () => {
  const payload = buildPayload({ provider: 'deepseek', model: 'deepseek-flash', effort: 'none', messages: [{ role: 'user', content: '解释' }] });
  assert.deepEqual(payload.thinking, { type: 'disabled' }); assert.equal(payload.reasoning_effort, undefined);
  assert.throws(() => buildPayload({ provider: 'deepseek', model: 'deepseek-v4-pro', messages: [{ role: 'user', images: ['data:image/png;base64,YQ=='] }] }), /不支持图片/);
  assert.throws(() => buildPayload({ provider: 'deepseek', model: 'deepseek-flash', effort: 'medium', messages: [] }), /思考强度/);
});
test('OpenAI streaming reports text and requires terminal success, rejects truncated stream', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const options = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4-mini', apiKey: 'test-key', messages: [{ role: 'user', content: '问' }] };
  let output = '';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit');
    return response('data: {"type":"response.output_text.delta","delta":"回答"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n');
  };
  await streamChat({ ...options, onDelta: text => { output += text; } });
  assert.equal(output, '回答');
  globalThis.fetch = async () => response('data: {"type":"response.output_text.delta","delta":"半句"}\n\n');
  await assert.rejects(streamChat({ ...options, onDelta: () => {} }), /完成前断开/);
});
test('DeepSeek requires finish_reason and DONE; model errors are surfaced', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const options = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-key', messages: [{ role: 'user', content: '问' }], onDelta: () => {} };
  globalThis.fetch = async () => response('data: {"choices":[{"delta":{"content":"答"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  await streamChat(options);
  globalThis.fetch = async () => response('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n');
  await assert.rejects(streamChat(options), /未完整结束/);
});
test('HTTP error does not echo API key, abort reaches fetch', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const options = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4-mini', apiKey: 'sensitive-key', messages: [], onDelta: () => {} };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Bad sensitive-key' } }), { status: 401 });
  await assert.rejects(streamChat(options), error => !error.message.includes('sensitive-key') && error.message.includes('401'));
  const abort = new AbortController(); abort.abort(new DOMException('Cancelled', 'AbortError'));
  globalThis.fetch = async (url, init) => { init.signal.throwIfAborted(); };
  await assert.rejects(streamChat({ ...options, signal: abort.signal }), { name: 'AbortError' });
});
test('API credentials cannot be sent to insecure remote endpoint or URL userinfo', () => {
  assert.equal(apiOrigin('https://example.com/v1'), 'https://example.com/*');
  assert.equal(apiOrigin('http://localhost:1234/v1'), 'http://localhost:1234/*');
  assert.throws(() => apiOrigin('http://example.com/v1'), /HTTPS/);
  assert.throws(() => apiOrigin('https://user:password@example.com'), /密码/);
});
test('Keys default to session storage; opt-in persistent keys can be forgotten', async t => {
  const prior = globalThis.chrome; t.after(() => { globalThis.chrome = prior; });
  const stores = { local: {}, session: {} };
  const makeStore = name => ({ get: async key => ({ [key]: stores[name][key] }), set: async value => { Object.assign(stores[name], value); }, remove: async key => { delete stores[name][key]; } });
  globalThis.chrome = { storage: { local: makeStore('local'), session: makeStore('session') } };
  await saveSettings({ provider: 'openai', rememberKey: false, apiKey: 'must-not-copy' }, 'secret');
  assert.equal(stores.local['apiKey:openai'], undefined); assert.equal(stores.local.settings.apiKey, undefined);
  assert.equal(await loadKey('openai'), 'secret');
  await saveSettings({ provider: 'openai', rememberKey: true }, 'new-secret');
  assert.equal(stores.session['apiKey:openai'], undefined); assert.equal(stores.local['apiKey:openai'], 'new-secret');
  await saveSettings({ provider: 'openai', rememberKey: false }, '');
  assert.equal(await loadKey('openai'), '');
});
test('Attachment boundary rejects external image URLs and oversized text', () => {
  assert.throws(() => validateContext({ kind: 'image', dataUrl: 'https://example.com/image.png' }), /截图过大/);
  assert.throws(() => validateContext({ kind: 'text', text: 'a'.repeat(100001) }), /10 万/);
  const image = validateContext({ kind: 'image', dataUrl: 'data:image/png;base64,YQ==', source: { page: 3, tabId: 17 } });
  assert.equal(image.source.page, 3); assert.equal(image.source.tabId, 17);
});
