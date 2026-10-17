import test from 'node:test';
import assert from 'node:assert/strict';
import { retainReaderEntries, READER_CACHE_BYTES } from '../src/reader/cache-policy.mjs';
const entry = (id, mib = 1) => ({ id, size: mib * 1024 * 1024 });

test('reader cache touches the active file and evicts only the least recent inactive file', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => entry(id));
  assert.deepEqual(retainReaderEntries([a, b, c], 'a'), [b, c, a]);
  assert.deepEqual(retainReaderEntries([b, c, a, d], 'd'), [c, a, d]);
  assert.deepEqual(retainReaderEntries([a, b], 'missing'), []);
});

test('large documents reduce retained readers and byte budget always preserves the active file', () => {
  const a = entry('a', 40), b = entry('b', 30), c = entry('c', 30);
  assert.deepEqual(retainReaderEntries([a, b, c], 'a'), [c, a]);
  assert.deepEqual(retainReaderEntries([a, b, c], 'c'), [b, c]);
  const huge = entry('huge', 140);
  assert.ok(huge.size > READER_CACHE_BYTES);
  assert.deepEqual(retainReaderEntries([a, b, huge], 'huge'), [huge]);
});

test('side-by-side panes stay cached while off-screen files are evicted first', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => entry(id));
  assert.deepEqual(retainReaderEntries([a, b, c, d], 'd', ['a']), [a, c, d]);
  const big = entry('big', 60), other = entry('other', 50), side = entry('side', 50);
  // Both visible files exceed the byte budget together; neither is evicted.
  assert.deepEqual(retainReaderEntries([other, side, big], 'big', ['side']), [side, big]);
});
