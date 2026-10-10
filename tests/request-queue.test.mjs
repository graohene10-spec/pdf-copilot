import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestQueue, normalizeRequestLimits } from '../extension/common/request-queue.mjs';
import { createRequestBroker } from '../extension/request-broker.mjs';
const job = (id, provider = 'deepseek', owner = 'owner-1') => ({ id, provider, owner, tabId: 1 });

test('global limits, provider fairness, bounded FIFO and cancellation', () => {
  const queue = new RequestQueue();
  assert.equal(queue.add(job('codex-1', 'codex')).status, 'running');
  assert.equal(queue.add(job('codex-2', 'codex')).position, 1);
  assert.equal(queue.add(job('api-1')).status, 'running');
  assert.equal(queue.add(job('api-2')).position, 2);
  queue.remove(item => item.id === 'api-1');
  assert.equal(queue.state('api-2', 'owner-1').status, 'running');
  assert.equal(queue.state('codex-2', 'owner-1').status, 'queued');
  queue.remove(item => item.id === 'codex-1');
  assert.equal(queue.state('codex-2', 'owner-1').status, 'running');
  for (let n = 0; n < 8; n++) assert.equal(queue.add(job('waiting-' + n)).position, n + 1);
  assert.throws(() => queue.add(job('full')), /队列已满/);
  queue.remove(item => item.id === 'waiting-0');
  queue.add(job('replacement'));
  queue.remove(item => item.id === 'api-2');
  assert.equal(queue.state('waiting-1', 'owner-1').status, 'running');
  assert.equal(queue.state('replacement', 'owner-1').position, 7);
});
test('decreasing a cap waits for live streams; higher caps drain; zero queue rejects', () => {
  const queue = new RequestQueue();
  queue.add(job('one')); queue.add(job('two')); queue.add(job('three'));
  queue.configure({ concurrent: 1, queued: 0 });
  assert.equal(queue.summary().running, 2);
  queue.remove(item => item.id === 'one');
  assert.equal(queue.state('three', 'owner-1').status, 'queued');
  assert.throws(() => queue.add(job('four')), /队列已满/);
  queue.remove(item => item.id === 'two');
  assert.equal(queue.state('three', 'owner-1').status, 'running');
  queue.configure({ concurrent: 4, codex: 2 });
  assert.equal(queue.add(job('codex-a', 'codex')).status, 'running');
  assert.equal(queue.add(job('codex-b', 'codex')).status, 'running');
  assert.equal(queue.add(job('codex-c', 'codex')).status, 'queued');
  assert.deepEqual(normalizeRequestLimits({ concurrent: -10, codex: 100, queued: NaN }), { concurrent: 1, codex: 2, queued: 8 });
});
test('broker serializes multiple windows, restores live jobs and reaps closed contexts', async () => {
  const session = {}, owners = new Set(['window-a', 'window-b', 'window-c']);
  const api = {
    storage: { session: { async get() { return structuredClone(session); }, async set(value) { Object.assign(session, structuredClone(value)); } }, local: { async get() { return { settings: { requestLimits: { concurrent: 1 } } }; } } },
    runtime: { getURL: path => 'chrome-extension://test/' + path, async getContexts() { return [...owners].map(documentId => ({ documentId })); }, async sendMessage() {} },
    tabs: { async get(id) { if (id !== 1) throw new Error('Tab closed'); return { id }; } },
  };
  const sender = documentId => ({ documentId, url: api.runtime.getURL('chat/index.html') });
  let time = 0, broker = createRequestBroker(api, () => time);
  const results = await Promise.all(['window-a', 'window-b', 'window-c'].map((owner, n) => broker.handle({ type: 'requests:acquire', ...job('request-' + n), id: 'request-' + n }, sender(owner))));
  assert.deepEqual(results.map(item => item.status), ['running', 'queued', 'queued']);
  broker = createRequestBroker(api, () => time);
  assert.equal((await broker.handle({ type: 'requests:poll', id: 'request-0' }, sender('window-a'))).status, 'running');
  await broker.handle({ type: 'requests:release', id: 'request-0' }, sender('window-b'));
  assert.equal(session.requestQueue.length, 3, 'another document cannot release the owner’s slot');
  owners.delete('window-a');
  time += 2500;
  assert.equal((await broker.handle({ type: 'requests:poll', id: 'request-1' }, sender('window-b'))).status, 'running');
  await broker.invalidateTab(1);
  assert.equal(session.requestQueue.length, 0);
  await assert.rejects(broker.handle({ type: 'requests:acquire', ...job('request-x'), tabId: 99 }, sender('window-b')), /Tab closed/);
  assert.equal(session.requestQueue.length, 0);
  await assert.rejects(broker.handle({ type: 'requests:acquire', ...job('request-x') }, { ...sender('window-b'), url: api.runtime.getURL('reader/index.html') }), /仅对话/);
  assert(!JSON.stringify(session).includes('data:image'));
});
test('Edge side panels without sender.documentId use a live, per-document identity', async () => {
  const stored = {}, live = new Set(['chat:instance-a', 'chat:instance-b']);
  const api = {
    storage: { session: { async get() { return structuredClone(stored); }, async set(value) { Object.assign(stored, structuredClone(value)); } }, local: { async get() { return { settings: { requestLimits: { concurrent: 1 } } }; } } },
    runtime: { getURL: path => 'chrome-extension://test/' + path, async getContexts() { return []; }, async sendMessage(message) {
      if (message.type === 'requests:owner-probe' && live.has(message.owner)) return { live: true, owner: message.owner };
    } },
    tabs: { async get() { return {}; } },
  };
  const sender = { url: api.runtime.getURL('chat/index.html') };
  let time = 0, broker = createRequestBroker(api, () => time);
  await broker.handle({ type: 'requests:acquire', ...job('request-a'), owner: 'chat:instance-a' }, sender);
  assert.equal((await broker.handle({ type: 'requests:acquire', ...job('request-b'), owner: 'chat:instance-b' }, sender)).status, 'queued');
  broker = createRequestBroker(api, () => time);
  assert.equal((await broker.handle({ type: 'requests:poll', id: 'request-b', owner: 'chat:instance-b' }, sender)).status, 'queued');
  live.delete('chat:instance-a');
  time += 2500;
  assert.equal((await broker.handle({ type: 'requests:poll', id: 'request-b', owner: 'chat:instance-b' }, sender)).status, 'running');
  await assert.rejects(broker.handle({ type: 'requests:poll', id: 'request-b' }, sender), /身份无效/);
});
