import test from 'node:test';
import assert from 'node:assert/strict';
import { contextEnabled, canProvidePage, needsCurrentPage, captureVisiblePage } from '../extension/common/page-context.mjs';

test('automatic page context defaults on, preserves explicit off and respects manual attachments', () => {
  assert.equal(contextEnabled(undefined), true); assert.equal(contextEnabled(false), false);
  const source = { enhanced: true, documentKey: 'local' };
  assert(needsCurrentPage(true, source, []));
  assert(!needsCurrentPage(false, source, []));
  assert(!needsCurrentPage(true, source, [{ kind: 'image' }]));
  assert(!needsCurrentPage(true, source, [{ kind: 'text' }]));
  assert(canProvidePage({ url: 'file:///C:/sample.pdf' }));
  assert(!canProvidePage({ url: 'edge://extensions' }));
});

const fixture = () => {
  let captures = 0;
  const tab = { id: 2, windowId: 1, url: 'https://example.test/a.pdf', active: true };
  const browser = { tabs: { update: async () => {}, get: async () => ({ ...tab }), captureVisibleTab: async () => { captures++; return 'data:image/jpeg;base64,YQ=='; } } };
  return { tab, browser, captures: () => captures };
};
test('visible page capture binds both sides of the snapshot to the requested source', async () => {
  const f = fixture(); assert((await captureVisiblePage(f.tab, f.tab.url, f.browser)).dataUrl);
  assert.equal(f.captures(), 1);
  await assert.rejects(captureVisiblePage(f.tab, 'https://example.test/other.pdf', f.browser), /切换/);
  assert.equal(f.captures(), 1);
  f.browser.tabs.captureVisibleTab = async () => { f.tab.active = false; return 'data:image/jpeg;base64,YQ=='; };
  await assert.rejects(captureVisiblePage(f.tab, f.tab.url, f.browser), /切换/);
});
test('missing native screenshot permission fails clearly instead of silently sending no page', async () => {
  const f = fixture(); f.browser.tabs.captureVisibleTab = async () => { throw new Error('permission denied'); };
  await assert.rejects(captureVisiblePage(f.tab, f.tab.url, f.browser), /扩展图标.*增强阅读器/);
});
