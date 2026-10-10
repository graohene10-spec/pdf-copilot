import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceIdentity } from '../extension/common/source-identity.mjs';
test('PDF page fragments share a conversation while distinct documents stay isolated', () => {
  for (const url of ['https://example.com/a.pdf', 'file:///C:/papers/a.pdf']) {
    assert.equal(sourceIdentity({ url: url + '#page=1' }), sourceIdentity({ url: url + '#page=42' }));
    assert.notEqual(sourceIdentity({ url }), sourceIdentity({ url: url.replace('a.pdf', 'b.pdf') }));
  }
  assert.equal(sourceIdentity({ url: 'chrome-extension://test/reader/index.html', documentKey: 'fingerprint-1' }), 'fingerprint-1');
  assert.notEqual(sourceIdentity({ documentKey: 'fingerprint-1' }), sourceIdentity({ documentKey: 'fingerprint-2' }));
});
