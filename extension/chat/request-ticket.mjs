// Model streams remain in the chat document; the service worker only grants slots.
const owner = 'chat:' + crypto.randomUUID();
let alive = true;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (alive && message.type === 'requests:owner-probe' && message.owner === owner) respond({ live: true, owner });
});
addEventListener('pagehide', () => { alive = false; });
export async function acquireRequest({ id, tabId, provider, signal, onState, onSummary, onLost }) {
  let released = false, polling = false, timer, settle, reject, ready = false;
  const started = new Promise((resolve, fail) => { settle = resolve; reject = fail; });
  // Capture may fail before the caller starts waiting for the slot.
  started.catch(() => {});
  const clean = () => { clearInterval(timer); chrome.runtime.onMessage.removeListener(changed); signal.removeEventListener('abort', aborted); };
  const release = () => {
    if (released) return;
    released = true; clean();
    if (!ready) reject(new DOMException('提问已停止。', 'AbortError'));
    chrome.runtime.sendMessage({ type: 'requests:release', id, owner }).catch(() => {});
  };
  const fail = error => { if (released) return; reject(error); release(); if (ready) onLost(error); };
  const update = response => {
    if (released) return;
    if (!response?.ok) { fail(new Error(response?.error || '无法调度提问。')); return; }
    onSummary(response.summary);
    if (response.status === 'missing') { fail(new Error('原文档或对话已关闭，提问已停止。')); return; }
    if (ready && response.status === 'queued') return;
    onState(response);
    if (response.status === 'running' && !ready) { ready = true; settle(); }
  };
  const poll = async () => {
    if (released || polling) return;
    polling = true;
    try { update(await chrome.runtime.sendMessage({ type: 'requests:poll', id, owner })); }
    catch (error) { fail(error); }
    finally { polling = false; }
  };
  const changed = message => { if (message.type === 'requests:changed') poll(); };
  const aborted = () => release();
  chrome.runtime.onMessage.addListener(changed);
  signal.addEventListener('abort', aborted, { once: true });
  try {
    signal.throwIfAborted();
    const response = await chrome.runtime.sendMessage({ type: 'requests:acquire', id, tabId, provider, owner });
    if (released) chrome.runtime.sendMessage({ type: 'requests:release', id, owner }).catch(() => {});
    signal.throwIfAborted();
    if (!response?.ok) throw new Error(response?.error || '无法调度提问。');
    update(response);
    // Reap closed owners and recover missed broadcasts or worker restarts.
    if (!released) timer = setInterval(poll, 2500);
    return { started, release };
  } catch (error) { fail(error); throw error; }
}
