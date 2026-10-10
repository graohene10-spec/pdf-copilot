// Preserve the native host protocol while replacing Chrome Native Messaging with Tauri IPC.
async function openPort() {
  if (!globalThis.__TAURI_INTERNALS__) throw new Error('Codex 本机登录需要 Windows 桌面版。浏览器预览可使用 API 服务。');
  const { invoke, Channel } = await import('@tauri-apps/api/core');
  const messages = new Set(), disconnects = new Set();
  let closed = false, failure = '';
  const channel = new Channel();
  const disconnected = error => {
    if (closed) return;
    failure = String(error || 'Codex 小助手连接已断开。');
    for (const listener of disconnects) listener(failure);
  };
  channel.onmessage = message => {
    if (message.event === 'disconnect') disconnected(message.error);
    else for (const listener of messages) listener(message);
  };
  let sessionId;
  try { sessionId = await invoke('native_connect', { channel }); }
  catch (error) { throw new Error(error?.message || String(error)); }
  return {
    onMessage: { addListener: listener => messages.add(listener) },
    onDisconnect: { addListener: listener => { disconnects.add(listener); if (failure) listener(failure); } },
    postMessage(message) {
      if (closed) throw new Error('Codex 连接已关闭。');
      invoke('native_send', { sessionId, message }).catch(disconnected);
    },
    disconnect() {
      if (closed) return;
      closed = true; messages.clear(); disconnects.clear();
      invoke('native_disconnect', { sessionId }).catch(() => {});
    },
  };
}

export async function nativeRequest(type, signal) {
  signal?.throwIfAborted();
  const port = await openPort();
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Codex 小助手响应超时，请检查 Codex 安装和登录状态。')), 30000);
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); port.disconnect();
      if (error) reject(error); else resolve(value);
    }
    const abort = () => finish(signal.reason || new DOMException('已取消', 'AbortError'));
    port.onDisconnect.addListener(error => finish(new Error(error)));
    port.onMessage.addListener(msg => { if (msg.id === id) finish(msg.ok ? null : new Error(msg.error), msg.result); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    port.postMessage({ id, type });
  });
}
export const getNativeModels = signal => nativeRequest('models', signal);
export const getNativeStatus = signal => nativeRequest('status', signal);

export async function streamNative({ model, effort, messages, signal, onDelta, onReasoning, pdfTools = false, pdfVision = false, pdfLimits, onTool, extraInstructions = '' }) {
  signal?.throwIfAborted();
  const port = await openPort();
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let settled = false, received = false, toolQueue = Promise.resolve();
    const toolReplies = new Set();
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); port.disconnect();
      if (error) reject(error); else resolve();
    }
    const cancel = () => { try { port.postMessage({ id: crypto.randomUUID(), type: 'cancel', targetId: id }); } catch {} };
    const abort = () => { cancel(); finish(signal.reason || new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { cancel(); finish(new Error('对话超过 10 分钟，已停止。')); }, 10 * 60000);
    port.onDisconnect.addListener(error => finish(new Error(error)));
    port.onMessage.addListener(msg => {
      if (settled) return;
      if (toolReplies.has(msg.id) && msg.ok === false) { finish(new Error(msg.error || '小助手拒绝了阅读结果。')); return; }
      if (msg.id !== id) return;
      if (msg.event === 'delta') { received = true; onDelta?.(msg.text); }
      if (msg.event === 'reasoning') onReasoning?.(msg.text);
      if (msg.event === 'tool') {
        if (!pdfTools || !onTool || typeof msg.callId !== 'string') { finish(new Error('小助手返回了未启用的工具请求。')); return; }
        toolQueue = toolQueue.then(async () => {
          if (settled) return;
          let result;
          try { result = await onTool(msg.tool, msg.arguments); }
          catch (error) { signal?.throwIfAborted(); result = { error: error.message }; }
          if (settled || signal?.aborted) return;
          const { dataUrl, ...text } = result;
          const replyId = crypto.randomUUID(); toolReplies.add(replyId);
          port.postMessage({ id: replyId, type: 'tool-result', targetId: id, callId: msg.callId, text: JSON.stringify(text), images: dataUrl ? [dataUrl] : [] });
        }).catch(error => { if (!settled) finish(error); });
      }
      if (msg.event === 'done') toolQueue.then(() => finish());
      if (msg.event === 'error' || msg.ok === false) {
        const error = new Error(msg.error || 'Codex 请求失败。');
        if (pdfTools && !received && /PDF_TOOLS_UNAVAILABLE/.test(error.message)) error.code = 'PDF_TOOLS_UNAVAILABLE';
        finish(error);
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    const latest = messages.at(-1);
    port.postMessage({ id, type: 'chat', model, effort, text: latest.content + (extraInstructions ? '\n\n[工作台的文档格式与阅读说明]\n' + extraInstructions : ''),
      history: messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
      images: messages.flatMap(item => item.images || []), ...(pdfTools ? { pdfTools: true, pdfVision, ...(pdfLimits ? { pdfLimits } : {}) } : {}) });
  });
}
export const streamNativeDocument = options => streamNative({ ...options, pdfTools: true, pdfVision: options.tools.some(tool => tool.name === 'pdf_view') });
