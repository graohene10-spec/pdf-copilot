import test from 'node:test';
import assert from 'node:assert/strict';

test('sidebar commands preserve the gesture and reader commands retain the originating PDF tab', async () => {
  const previous = globalThis.chrome;
  const listen = { addListener() {} };
  const opened = [];
  const panels = [];
  let commandListener, queries = 0;
  globalThis.chrome = {
    runtime: { id: 'fixture', getURL: path => 'chrome-extension://fixture/' + path, onInstalled: listen, onMessage: listen },
    contextMenus: { onClicked: listen },
    commands: { onCommand: { addListener(fn) { commandListener = fn; } } },
    sidePanel: { open(options) { panels.push(options); return Promise.resolve(); } },
    windows: { onRemoved: listen },
    tabs: {
      onRemoved: listen, onActivated: listen,
      async query() { queries++; return [{ id: 999, url: 'https://example.com/unrelated' }]; },
      async create(options) { opened.push(options.url); },
    },
  };
  try {
    await import('../extension/background.js?command-regression');
    const opening = commandListener('open-sidebar', { id: 123, windowId: 456 });
    assert.deepEqual(panels, [{ windowId: 456 }], 'sidebar opens synchronously in the shortcut window');
    assert.equal(queries, 0, 'the user gesture must not be lost to an asynchronous tab query');
    await opening;
    for (const url of ['https://example.com/paper.pdf#page=3', 'file:///C:/papers/sample.pdf']) {
      await commandListener('open-reader', { id: 123, windowId: 456, url });
      assert.equal(new URL(opened.at(-1)).searchParams.get('url'), url);
    }
    assert.equal(queries, 0, 'the source tab must not be replaced by a later active tab');
    await commandListener('open-reader');
    assert.equal(queries, 1, 'older browsers without a command tab retain the fallback');
    assert.equal(new URL(opened.at(-1)).searchParams.get('url'), 'https://example.com/unrelated');
    globalThis.chrome.sidePanel.open = () => Promise.reject(new Error('Synthetic panel rejection'));
    const previousWarn = console.warn;
    const warnings = [];
    console.warn = error => warnings.push(error.message);
    try { await commandListener('open-sidebar', { id: 123, windowId: 456 }); }
    finally { console.warn = previousWarn; }
    assert.deepEqual(warnings, ['Synthetic panel rejection']);
    assert.equal(opened.length, 3, 'a sidebar failure must not open an unrelated capture error page');
  } finally {
    if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous;
  }
});
