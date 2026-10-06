import test from 'node:test';
import assert from 'node:assert/strict';
import { requestDocumentAccess, documentOpenError } from '../extension/reader/document-access.mjs';

function browser({ fileAccess = true, host = false, granted = true } = {}) {
  const requested = [];
  return { requested, extension: { isAllowedFileSchemeAccess: async () => fileAccess }, permissions: {
    contains: async () => host,
    request: async value => { requested.push(value); return granted; },
  } };
}
test('file URL switch alone still requires optional file host permission', async () => {
  const api = browser();
  const url = await requestDocumentAccess('file:///C:/papers/local%20file%23.pdf', api);
  assert.equal(url.protocol, 'file:'); assert.deepEqual(api.requested, [{ origins: ['file:///*'] }]);
});
test('disabled file access and refused grants explain the permission-free file picker', async () => {
  const disabled = browser({ fileAccess: false });
  await assert.rejects(requestDocumentAccess('file:///C:/paper.pdf', disabled), /允许访问文件网址/);
  assert.equal(disabled.requested.length, 0);
  const refused = browser({ granted: false });
  await assert.rejects(requestDocumentAccess('file:///C:/paper.pdf', refused), /打开 PDF.*无需/);
});
test('existing host grants are reused and remote grants stay scoped to their host', async () => {
  const existing = browser({ host: true }); await requestDocumentAccess('file:///C:/paper.pdf', existing); assert.deepEqual(existing.requested, []);
  const api = browser(); await requestDocumentAccess('https://papers.example/paper.pdf', api);
  assert.deepEqual(api.requested, [{ origins: ['https://papers.example/*'] }]);
  await assert.rejects(requestDocumentAccess('javascript:alert(1)', api), /只支持/);
});
test('local missing-file errors do not suggest downloading a remote link', () => {
  const local = documentOpenError({ status: 0, message: 'Unexpected server response (0)' }, { url: 'file:///C:/missing.pdf' });
  assert.match(local, /文件仍存在/); assert(!local.includes('远程'));
  assert.match(documentOpenError(new Error('HTTP 404.'), { url: 'https://example.com/missing.pdf' }), /远程链接/);
  assert(!documentOpenError(new Error('Invalid PDF structure.'), {}).includes('远程'));
});
