import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeHttpFetch } from '../src/ai/native-http.mjs';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(start) {
  const calls = [];
  let channel;
  class Channel { constructor() { channel = this; } }
  const fetch = createNativeHttpFetch((command, args) => {
    calls.push({ command, args });
    return command === 'http_start' ? start?.(args) : Promise.resolve();
  }, Channel);
  return { fetch, calls, event: event => channel.onmessage(event) };
}

test('native HTTP reconstructs standard Response metadata and incremental bytes', async () => {
  const transport = fixture();
  const response = transport.fetch('https://example.test/v1/responses?api-version=smoke', { method: 'POST', body: '{"model":"test"}', headers: { Authorization: 'Bearer synthetic' } });
  transport.event({ type: 'headers', status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']] });
  const value = await response;
  assert.equal(value.status, 200); assert.equal(value.headers.get('content-type'), 'text/event-stream');
  const reader = value.body.getReader();
  const first = reader.read();
  transport.event({ type: 'chunk', data: [...new TextEncoder().encode('data: 部分')] });
  assert.equal(new TextDecoder().decode((await first).value), 'data: 部分');
  const second = reader.read();
  transport.event({ type: 'chunk', data: [...new TextEncoder().encode('回答\n\n')] });
  assert.equal(new TextDecoder().decode((await second).value), '回答\n\n');
  transport.event({ type: 'end' }); assert.equal((await reader.read()).done, true);
  assert.equal(transport.calls.filter(call => call.command === 'http_cancel').length, 0);
  assert.ok(transport.calls[0].args.url.includes('?api-version=smoke'));
});

test('abort during a pending native read requests real cancellation and rejects that read', async () => {
  const transport = fixture(), controller = new AbortController();
  const response = transport.fetch('http://127.0.0.1:7777/v1/responses', { method: 'POST', body: '{}', signal: controller.signal });
  transport.event({ type: 'headers', status: 200 });
  const reader = (await response).body.getReader();
  const pending = reader.read();
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  await flush();
  assert.equal(transport.calls.filter(call => call.command === 'http_cancel').length, 1);
  assert.equal(transport.calls[1].args.id, transport.calls[0].args.id);
  transport.event({ type: 'chunk', data: [65] });
  transport.event({ type: 'end' }); // Late channel frames do not revive an aborted response.
});

test('abort cannot overtake native registration or leave an orphaned request', async () => {
  let register;
  const transport = fixture(() => new Promise(resolve => { register = resolve; })), controller = new AbortController();
  const response = transport.fetch('https://example.test/stream', { signal: controller.signal });
  controller.abort();
  await assert.rejects(response, error => error.name === 'AbortError');
  await flush();
  assert.equal(transport.calls.length, 1, 'Cancel must wait until the native start is registered');
  register(); await flush();
  assert.equal(transport.calls[1].command, 'http_cancel');
  assert.equal(transport.calls[1].args.id, transport.calls[0].args.id);
});

test('canceling the reader also drops the native response without an AbortSignal', async () => {
  const transport = fixture();
  const response = transport.fetch('https://example.test/stream');
  transport.event({ type: 'headers', status: 200 });
  const reader = (await response).body.getReader();
  await reader.cancel();
  assert.equal(transport.calls[1].command, 'http_cancel');
  transport.event({ type: 'chunk', data: [65] });
});

test('pre-aborted requests do not start native work and native errors remain readable', async () => {
  const transport = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(transport.fetch('https://example.test/stream', { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(transport.calls.length, 0);
  const network = fixture();
  const response = network.fetch('https://example.test/stream');
  network.event({ type: 'error', message: 'Synthetic network failure' });
  await assert.rejects(response, /Synthetic network failure/);
});

test('native start failures and bodyless HTTP statuses preserve fetch semantics', async () => {
  const failed = fixture(() => Promise.reject('Synthetic IPC failure'));
  await assert.rejects(failed.fetch('https://example.test/stream'), /Synthetic IPC failure/);
  const empty = fixture();
  const response = empty.fetch('https://example.test/metadata');
  empty.event({ type: 'headers', status: 204 });
  const value = await response;
  assert.equal(value.body, null); assert.equal(value.ok, true);
  empty.event({ type: 'end' });
});

test('bounded requests and invalid native chunks cannot allocate unbounded stream state', async () => {
  const transport = fixture();
  await assert.rejects(transport.fetch('https://example.test/stream', { method: 'GET', body: '{}' }), /GET/);
  await assert.rejects(transport.fetch('https://example.test/stream', { method: 'POST', body: '字'.repeat(6 * 1024 * 1024) }), /16 MiB/);
  assert.equal(transport.calls.length, 0);
  const response = transport.fetch('https://example.test/stream');
  transport.event({ type: 'headers', status: 200 });
  const reader = (await response).body.getReader(), pending = reader.read();
  transport.event({ type: 'chunk', data: Array(65537).fill(65) });
  await assert.rejects(pending, /过大/);
  await flush();
  assert.equal(transport.calls.at(-1).command, 'http_cancel');
});
