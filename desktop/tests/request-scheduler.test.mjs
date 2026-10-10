import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestScheduler } from '../src/ai/request-scheduler.mjs';
const request = (queue, owner, provider = 'openai') => {
  const controller = new AbortController(), states = [];
  const ticket = queue.acquire({ owner, provider, signal: controller.signal, onState: state => states.push(state) });
  return { controller, states, ...ticket };
};
test('one question per file; global queue starts oldest eligible job', async () => {
  const queue = new RequestScheduler({ concurrent: 1, codex: 1, queued: 2 });
  const a = request(queue, 'a'), b = request(queue, 'b'), c = request(queue, 'c');
  await a.started;
  assert.throws(() => request(queue, 'a'), /已有提问/);
  assert.deepEqual(queue.queue.summary(), { running: 1, queued: 2, limits: { concurrent: 1, codex: 1, queued: 2 } });
  assert.equal(b.states.at(-1).position, 1); assert.equal(c.states.at(-1).position, 2);
  a.release(); await b.started; assert.equal(c.states.at(-1).position, 1);
  b.release(); await c.started; c.release(); assert.equal(queue.jobs.size, 0);
});
test('saturated Codex capacity does not block an API job', async () => {
  const queue = new RequestScheduler({ concurrent: 2, codex: 1, queued: 2 });
  const a = request(queue, 'a', 'codex'), b = request(queue, 'b', 'codex'), c = request(queue, 'c');
  await Promise.all([a.started, c.started]);
  assert.equal(b.states.at(-1).status, 'queued');
  a.release(); await b.started; b.release(); c.release();
});
test('queued cancellation removes position immediately; running cancellation retains slot until cleanup', async () => {
  const queue = new RequestScheduler({ concurrent: 1, codex: 1, queued: 2 });
  const a = request(queue, 'a'), b = request(queue, 'b'), c = request(queue, 'c');
  b.controller.abort(); await assert.rejects(b.started, { name: 'AbortError' });
  assert.equal(c.states.at(-1).position, 1);
  a.controller.abort(); assert.equal(c.states.at(-1).status, 'queued');
  a.release(); await c.started; c.release(); b.release(); assert.equal(queue.jobs.size, 0);
});
test('full queue rejection leaves no orphan, and releasing twice cannot free another slot', async () => {
  const queue = new RequestScheduler({ concurrent: 1, codex: 1, queued: 0 });
  const a = request(queue, 'a'); assert.throws(() => request(queue, 'b'), /队列已满/);
  assert.equal(queue.jobs.size, 1); a.release(); a.release();
  const b = request(queue, 'b'); await b.started; assert.equal(queue.queue.summary().running, 1); b.release();
});
test('changing limits drains waiting jobs without canceling active questions or resetting progress callbacks', async () => {
  const queue = new RequestScheduler({ concurrent: 1, codex: 1, queued: 2 });
  const a = request(queue, 'a'), b = request(queue, 'b');
  queue.configure({ concurrent: 2, codex: 1, queued: 2 }); await b.started;
  assert.equal(a.states.length, 1);
  queue.configure({ concurrent: 1, codex: 1, queued: 0 }); assert.equal(queue.queue.summary().running, 2);
  a.release(); b.release();
});
