import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockIPC } from '@tauri-apps/api/mocks';

test('a click takes the matching port during warm-up despite a separate idle status port', async () => {
  globalThis.window = globalThis;
  const channels = new Map(), sent = [];
  let opened = 0;
  mockIPC((command, args) => {
    if (command === 'native_connect') { channels.set(++opened, args.channel); return opened; }
    if (command === 'native_disconnect') return;
    assert.equal(command, 'native_send');
    const { message, sessionId } = args;
    sent.push({ ...message, sessionId });
    const deliver = data => queueMicrotask(() => channels.get(sessionId).onmessage({ id: message.id, ...data }));
    // Keep every warm acknowledgement pending until the real question finishes.
    if (message.type === 'status') deliver({ ok: true, result: {} });
    if (message.type === 'chat') { deliver({ event: 'delta', text: 'ok' }); deliver({ event: 'done' }); }
  });
  // Idle pool timers should not hold this isolated Node test process open.
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (...args) => original(...args).unref();
  try {
    const { warmNativeThread, getNativeStatus, streamNative, codexSpeed } = await import('../src/ai/native.mjs');
    assert.deepEqual(codexSpeed({model:'omitted',tier:'ultrafast',useSavedTier:true}, []), {tier:'ultrafast'});
    await Promise.all([warmNativeThread({model:'one'}), warmNativeThread({model:'one'})]);
    await warmNativeThread({model:'two',pdfTools:true,pdfVision:true});
    await getNativeStatus();
    function chat(model, options = {}) { return streamNative({ model, messages:[{role:'user',content:'x'}], ...options }); }
    await chat('one');
    await chat('two', {pdfTools:true,pdfVision:true});
    const opening = warmNativeThread({model:'three'});
    await Promise.all([opening, chat('three')]);
    for (const name of ['one','two','three']) {
      const warm = sent.filter(m => m.type === 'warm' && m.model === name);
      const question = sent.find(m => m.type === 'chat' && m.model === name);
      assert.equal(warm.length, 1);
      assert.equal(question.sessionId, warm[0].sessionId);
    }
    const abort = AbortSignal.abort();
    await assert.rejects(streamNative({model:'one',messages:[],signal:abort}), {name:'AbortError'});
    assert.equal(sent.filter(m => m.type === 'chat').length, 3);
    assert.ok(opened <= 4);
  } finally { globalThis.setTimeout = original; }
});
