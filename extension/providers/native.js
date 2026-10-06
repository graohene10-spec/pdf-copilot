export function nativeRequest(type, signal) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative('com.pdfcopilot.codex');
    const id = crypto.randomUUID();
    const timer = setTimeout(() => finish(new Error('Codex 小助手响应超时，请检查安装和 Codex 路径。')), 30000);
    let settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      port.disconnect();
      if (error) reject(error); else resolve(value);
    }
    const abort = () => finish(signal.reason || new DOMException('已取消', 'AbortError'));
    port.onDisconnect.addListener(() => finish(new Error(chrome.runtime.lastError?.message || 'Windows 小助手连接已断开。')));
    port.onMessage.addListener(msg => { if (msg.id === id) finish(msg.ok ? null : new Error(msg.error), msg.result); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    port.postMessage({ id, type });
  });
}
export const getNativeModels = signal => nativeRequest('models', signal);
export const getNativeStatus = signal => nativeRequest('status', signal);

export function streamNative({ model, effort, messages, signal, onDelta, onReasoning }) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative('com.pdfcopilot.codex');
    const id = crypto.randomUUID();
    let settled = false;
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      port.disconnect();
      if (error) reject(error); else resolve();
    }
    const abort = () => {
      try { port.postMessage({ id: crypto.randomUUID(), type: 'cancel', targetId: id }); } catch {}
      finish(signal.reason || new DOMException('已取消', 'AbortError'));
    };
    const timer = setTimeout(() => { try { port.postMessage({ id: crypto.randomUUID(), type: 'cancel', targetId: id }); } catch {} finish(new Error('对话超过 10 分钟，已停止。')); }, 10 * 60000);
    port.onDisconnect.addListener(() => finish(new Error(chrome.runtime.lastError?.message || 'Codex 小助手断开了连接。')));
    port.onMessage.addListener(msg => {
      if (msg.id !== id) return;
      if (msg.event === 'delta') onDelta(msg.text);
      if (msg.event === 'reasoning') onReasoning?.(msg.text);
      if (msg.event === 'done') finish();
      if (msg.event === 'error' || msg.ok === false) finish(new Error(msg.error || 'Codex 请求失败。'));
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    const latest = messages.at(-1);
    port.postMessage({ id, type: 'chat', model, effort, text: latest.content,
      history: messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
      images: messages.flatMap(item => item.images || []) });
  });
}
