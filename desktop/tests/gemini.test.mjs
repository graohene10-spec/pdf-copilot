import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload, getProvider, streamTurn } from '../src/ai/providers.mjs';

const sse = events => new Response(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
const tool = { name: 'pdf_search', description: 'search', parameters: { type: 'object', properties: {} } };

test('gemini: OpenAI-compatible endpoint, reasoning_effort only', async () => {
  const provider = getProvider('gemini');
  assert.equal(provider.protocol, 'chat');
  const payload = buildPayload({ provider: 'gemini', model: 'gemini-4-argon', effort: 'medium', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(payload.reasoning_effort, 'medium');
  assert.equal(payload.thinking, undefined, 'the DeepSeek-style thinking switch is not sent');
  assert.throws(() => buildPayload({ provider: 'gemini', model: 'gemini-4-argon', effort: 'none', messages: [{ role: 'user', content: 'hi' }] }), /思考强度/);

  const original = globalThis.fetch; let url = '', auth = '';
  try {
    globalThis.fetch = async (target, options) => { url = String(target); auth = options.headers.Authorization; return sse([{ choices: [{ delta: { content: '你好' }, finish_reason: 'stop' }] }, '[DONE]']); };
    const result = await streamTurn({ provider: 'gemini', baseUrl: provider.baseUrl, apiKey: 'k', model: 'gemini-4-argon', effort: 'low', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(auth, 'Bearer k');
    assert.equal(result.message.content, '你好');
  } finally { globalThis.fetch = original; }
});

test('gemini: the thought signature on a tool call is kept for the next round', async () => {
  const original = globalThis.fetch;
  try {
    const signature = { google: { thought_signature: 'sig-1' } };
    globalThis.fetch = async () => sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'pdf_search', arguments: '{"query":' }, extra_content: signature }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ]);
    const result = await streamTurn({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'k', model: 'gemini-4-argon', effort: 'low', tools: [tool], messages: [{ role: 'user', content: 'hi' }] });
    assert.deepEqual(result.calls, [{ id: 'call_1', name: 'pdf_search', arguments: '{"query":"x"}' }]);
    assert.deepEqual(result.message.tool_calls[0].extra_content, signature);
  } finally { globalThis.fetch = original; }
});
