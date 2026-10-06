import { validateContext, MAX_INBOX_LENGTH } from './common/context.js';

const captures = new Map();
let inboxTask = Promise.resolve();
const SERIAL = fn => {
  const next = inboxTask.then(fn, fn);
  inboxTask = next.catch(() => {});
  return next;
};
const page = path => chrome.runtime.getURL(path);
const isTrusted = sender => sender.id === chrome.runtime.id && sender.url?.startsWith(page(''));

async function activeTab() {
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
}
function openSidebar(tab) {
  return chrome.sidePanel.open({ windowId: tab.windowId });
}
async function openQuick(tab) {
  return SERIAL(async () => {
    const { quickWindows = {} } = await chrome.storage.session.get('quickWindows');
    const previous = quickWindows[tab.id];
    if (previous) {
      try { await chrome.windows.update(previous, { focused: true }); return; }
      catch { delete quickWindows[tab.id]; }
    }
    const win = await chrome.windows.create({
      url: page('chat/index.html?mode=quick&tab=' + tab.id + '&window=' + tab.windowId),
      type: 'popup', width: 510, height: 720, focused: true,
    });
    quickWindows[tab.id] = win.id;
    await chrome.storage.session.set({ quickWindows });
  });
}
async function openReader(tab, url) {
  const sourceUrl = url || tab?.url || '';
  // A viewer's extension URL must not be treated as a remote PDF.
  const allowed = /^(https?:|file:)/.test(sourceUrl);
  await chrome.tabs.create({ url: page('reader/index.html') + (allowed ? '?url=' + encodeURIComponent(sourceUrl) : '') });
}
async function capture(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const id = crypto.randomUUID();
  for (const [key, value] of captures) if (Date.now() - value.time > 60000) captures.delete(key);
  captures.set(id, { dataUrl, source: { name: tab.title || '当前标签页', url: tab.url, tabId: tab.id, windowId: tab.windowId }, time: Date.now() });
  try {
    await chrome.windows.create({ url: page('capture/index.html?id=' + id), type: 'popup', width: 1000, height: 760, focused: true });
  } catch (error) { captures.delete(id); throw error; }
}

async function enqueue(context, tabId, target) {
  return SERIAL(async () => {
    const { inbox = [] } = await chrome.storage.session.get('inbox');
    const fresh = inbox.filter(item => Date.now() - item.time < 5 * 60000);
    fresh.push({ context, tabId, target, time: Date.now() });
    while (JSON.stringify(fresh).length > MAX_INBOX_LENGTH || fresh.length > 20) fresh.shift();
    await chrome.storage.session.set({ inbox: fresh });
    chrome.runtime.sendMessage({ type: 'inbox:changed', tabId, target }).catch(() => {});
  });
}
async function takeInbox(tabId, target) {
  return SERIAL(async () => {
    const { inbox = [] } = await chrome.storage.session.get('inbox');
    const take = inbox.filter(item => item.tabId === tabId && item.target === target && Date.now() - item.time < 5 * 60000);
    await chrome.storage.session.set({ inbox: inbox.filter(item => !(item.tabId === tabId && item.target === target) && Date.now() - item.time < 5 * 60000) });
    return take.map(item => item.context);
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ask-selection', title: '发送选文到 PDF Copilot', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'capture', title: '截图并框选 → PDF Copilot', contexts: ['page', 'selection'] });
    chrome.contextMenus.create({ id: 'reader', title: '用 PDF Copilot 阅读当前 PDF', contexts: ['page', 'link'] });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ask-selection') {
    const opening = openSidebar(tab); // Keep the browser user gesture.
    Promise.all([opening, enqueue(validateContext({ kind: 'text', text: info.selectionText, title: 'PDF 选文',
      source: { name: tab.title, url: tab.url, tabId: tab.id } }), tab.id, 'sidebar')]).catch(console.warn);
  } else if (info.menuItemId === 'capture') capture(tab).catch(console.warn);
  else if (info.menuItemId === 'reader') openReader(tab, info.linkUrl).catch(console.warn);
});
chrome.commands.onCommand.addListener(async (command, commandTab) => {
  if (command === 'open-sidebar' && commandTab?.windowId != null) {
    // Open before any asynchronous lookup, while the key press is a user gesture.
    return openSidebar(commandTab).catch(console.warn);
  }
  // Prefer the browser-provided PDF tab over a later active-window query.
  const tab = commandTab?.id ? commandTab : await activeTab();
  if (!tab) return;
  try {
    if (command === 'open-sidebar') await openSidebar(tab);
    if (command === 'quick-chat') await openQuick(tab);
    if (command === 'capture-region') await capture(tab);
    if (command === 'open-reader') await openReader(tab);
  } catch (error) {
    if (command === 'capture-region') await chrome.tabs.create({ url: page('chat/index.html?error=capture') });
    else console.warn(error);
  }
});
chrome.windows.onRemoved.addListener(windowId => {
  SERIAL(async () => {
    const { quickWindows = {} } = await chrome.storage.session.get('quickWindows');
    for (const [key, value] of Object.entries(quickWindows)) if (value === windowId) delete quickWindows[key];
    await chrome.storage.session.set({ quickWindows });
  });
});
chrome.tabs.onRemoved.addListener(tabId => {
  SERIAL(async () => {
    const { inbox = [] } = await chrome.storage.session.get('inbox');
    await chrome.storage.session.set({ inbox: inbox.filter(item => item.tabId !== tabId) });
  });
});
chrome.tabs.onActivated.addListener(info => {
  chrome.runtime.sendMessage({ type: 'source:changed', tabId: info.tabId, windowId: info.windowId }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!isTrusted(sender)) return false;
  const needsSidebar = message.type === 'sidebar:open' ||
    (message.type === 'context:add' && (message.target || message.context?.target) !== 'quick');
  const gestureWindow = message.windowId || message.context?.source?.windowId || sender.tab?.windowId;
  const opening = needsSidebar && gestureWindow ? chrome.sidePanel.open({ windowId: gestureWindow }) : null;
  opening?.catch(() => {}); // Await below after validation; suppress premature unhandled rejection.
  const run = async () => {
    const tab = message.tabId > 0 ? await chrome.tabs.get(message.tabId) : (sender.tab || await activeTab());
    switch (message.type) {
      case 'source:get': {
        let info;
        if (tab?.url?.startsWith(page('reader/'))) {
          try { info = await chrome.runtime.sendMessage({ type: 'reader:info', tabId: tab.id }); } catch {}
        }
        return { ok: true, tab: tab && { id: tab.id, windowId: tab.windowId, title: info?.source?.name || tab.title, url: tab.url, documentKey: info?.documentKey } };
      }
      case 'reader:document':
        chrome.runtime.sendMessage({ type: 'source:document', tabId: tab.id, windowId: tab.windowId }).catch(() => {});
        return { ok: true };
      case 'sidebar:open': await (opening || openSidebar(tab)); return { ok: true };
      case 'quick:open': await openQuick(tab); return { ok: true };
      case 'reader:open': await openReader(tab, message.url); return { ok: true };
      case 'capture:open': await capture(tab); return { ok: true };
      case 'capture:get': {
        const value = captures.get(message.id);
        captures.delete(message.id);
        if (!value || Date.now() - value.time > 60000) throw new Error('截图已过期，请重新截取。');
        return { ok: true, dataUrl: value.dataUrl, source: value.source };
      }
      case 'context:add': {
        const context = validateContext(message.context);
        const sourceTabId = context.source.tabId || tab.id;
        context.source.tabId = sourceTabId;
        const sourceTab = await chrome.tabs.get(sourceTabId);
        const target = (message.target || message.context.target) === 'quick' ? 'quick' : 'sidebar';
        if (target === 'sidebar') await (opening || openSidebar(sourceTab));
        else await openQuick(sourceTab);
        await enqueue(context, sourceTabId, target);
        return { ok: true };
      }
      case 'inbox:take': return { ok: true, contexts: await takeInbox(message.tabId, message.target || 'sidebar') };
      case 'source:goto': {
        const targetTab = await chrome.tabs.get(message.source.tabId);
        if (!targetTab.url?.startsWith(page('reader/'))) throw new Error('只有增强阅读器附件支持页码回跳。');
        await chrome.tabs.update(targetTab.id, { active: true });
        await chrome.windows.update(targetTab.windowId, { focused: true });
        const info = await chrome.runtime.sendMessage({ type: 'reader:info', tabId: targetTab.id });
        if (message.source.fingerprint && info?.documentKey !== message.source.fingerprint) throw new Error('原标签页已打开另一份 PDF，请重新打开原文件。');
        const result = await chrome.runtime.sendMessage({ type: 'reader:goto', tabId: targetTab.id, documentKey: message.source.fingerprint || info?.documentKey, page: message.source.page, rect: message.source.rect });
        if (!result?.ok) throw new Error(result?.error || '原阅读页没有响应。');
        return { ok: true };
      }
      default: throw new Error('未知操作。');
    }
  };
  run().then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
