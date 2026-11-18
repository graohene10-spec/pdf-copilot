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
    get alive() { return !closed && !failure; },
    /** 用完放回池子前清掉上一位留下的监听。 */
    reset() { messages.clear(); disconnects.clear(); },
    onMessage: { addListener: listener => messages.add(listener), removeListener: listener => messages.delete(listener) },
    onDisconnect: { addListener: listener => { disconnects.add(listener); if (failure) listener(failure); }, removeListener: listener => disconnects.delete(listener) },
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

// 小助手（以及它背后的 codex app-server）冷启动要好几秒：用完的连接留着复用，空闲 20 分钟才关。
// 小助手一次只跑一段对话，所以并发的请求各拿一条连接。
const IDLE_MS = 20 * 60000, MAX_IDLE = 3, MAX_PORTS = 4;
const idle = [];
const counted = new WeakSet();
let livePorts = 0;
function forget(port) {
  if (counted.delete(port)) livePorts--;
  port.disconnect();
}
const pendingWarm = new Map();
const threadKey = (model, tools, vision) => JSON.stringify([model || '', !!tools, !!tools && !!vision]);
async function acquire(key = '') {
  for (;;) {
    let index = idle.findLastIndex(entry => entry.key === key);
    if (index < 0 && key) index = idle.findLastIndex(entry => !entry.key);
    if (index < 0 && idle.length && livePorts >= MAX_PORTS) index = 0;
    if (index < 0) break;
    const [entry] = idle.splice(index, 1);
    clearTimeout(entry.timer);
    if (entry.port.alive) return entry.port;
    forget(entry.port);
  }
  livePorts++;
  try { const port = await openPort(); counted.add(port); return port; }
  catch (error) { livePorts--; throw error; }
}
/** 请求顺利结束：连接放回池子；出过错或已断开就关掉，下次重新起。 */
function release(port, healthy, key = '') {
  port.reset();
  if (!healthy || !port.alive) { forget(port); return; }
  if (idle.length >= MAX_IDLE) {
    if (!key) { forget(port); return; }
    const free = idle.findIndex(entry => !entry.key || entry.key === key);
    const [old] = idle.splice(free < 0 ? 0 : free, 1);
    clearTimeout(old.timer); forget(old.port);
  }
  const entry = { port, key, timer: 0 };
  entry.timer = setTimeout(() => { const index = idle.indexOf(entry); if (index >= 0) idle.splice(index, 1); forget(port); }, IDLE_MS);
  idle.push(entry);
}
/** 提前把小助手和 Codex 拉起来（读一次登录状态），第一次提问就不用等冷启动。 */
let warming;
export function warmNative() {
  if (!globalThis.__TAURI_INTERNALS__ || idle.length) return warming || Promise.resolve();
  warming ||= nativeRequest('status').catch(() => {}).finally(() => { warming = undefined; });
  return warming;
}

/** 一条连接被对话占用后，池子里要是空了，就在后台再备一条热的：
 *  预判问题、翻译和正式提问各占一条连接，不让谁临时等小助手冷启动。 */
function spare() {
  if (idle.length || warming || livePorts >= MAX_PORTS) return;
  setTimeout(() => { if (!idle.length && livePorts < MAX_PORTS) void warmNative(); }, 300);
}

export async function nativeRequest(type, signal, extra = {}) {
  signal?.throwIfAborted();
  const port = await acquire();
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Codex 小助手响应超时，请检查 Codex 安装和登录状态。')), 30000);
    function finish(error, value, healthy = false) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); release(port, healthy);
      if (error) reject(error); else resolve(value);
    }
    const abort = () => finish(signal.reason || new DOMException('已取消', 'AbortError'));
    port.onDisconnect.addListener(error => finish(new Error(error)));
    port.onMessage.addListener(msg => { if (msg.id === id) finish(msg.ok ? null : new Error(msg.error), msg.result, true); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    port.postMessage({ id, type, ...extra });
  });
}
export const getNativeModels = signal => nativeRequest('models', signal);
/**
 * 提前把下一段会话建好。建会话时 Codex 要读模型清单、连上服务，一次快速解释 13 秒里有 10 秒花在这上面；
 * 选中文字时就先建，真正提问时只剩等模型出字。小助手那边同一种会话已经备着就什么都不做，所以多叫几次没关系。
 * 预热消息带独立的请求 ID。发出后即可把同一连接交给对话，助手会接手正在准备的会话。
 */
export function warmNativeThread({ model = '', pdfTools = false, pdfVision = false } = {}) {
  if (!globalThis.__TAURI_INTERNALS__) return Promise.resolve();
  const key = threadKey(model, pdfTools, pdfVision);
  if (!pendingWarm.has(key)) {
    const opening = acquire(key).then(port => {
      try {
        port.postMessage({ id: crypto.randomUUID(), type: 'warm', model, ...(pdfTools ? { pdfTools: true, pdfVision } : {}) });
        release(port, true, key);
      } catch (error) { release(port, false); throw error; }
    }).catch(() => {}).finally(() => pendingWarm.delete(key));
    pendingWarm.set(key, opening);
  }
  return pendingWarm.get(key);
}
export const getNativeStatus = signal => nativeRequest('status', signal);

/**
 * Codex 的速度档：每个模型自己列出有哪些档（priority 快速、ultrafast 超快……），选的那一档这个模型没有就退回标准。
 * 返回要随请求发给小助手的字段：模型列了档位就发档位 id（标准发 default——有的模型默认就是快速档，不说清楚会多耗额度）；
 * 旧版 Codex 不列档位，照旧只发 fast 开关。
 */
// 本机模型清单（含每个模型的速度档），读到模型时由 providers.mjs 记下来。
let knownModels = [];
export function rememberNativeModels(models) { knownModels = Array.isArray(models) ? models : []; }
export function codexSpeed(settings, models = knownModels) {
  const listed = models?.find(item => item.id === settings.model);
  // A temporary partial inventory can omit a previously selected model.
  // Let the server resolve the stored tier on protocols that advertise tiers.
  if (!listed && settings.tier && settings.useSavedTier) return { tier: settings.tier };
  const tiers = listed?.tiers || [];
  if (!tiers.length) return settings.fast ? { fast: true } : {};
  const want = settings.tier || (settings.fast ? 'priority' : '');
  return { tier: want && tiers.some(item => item.id === want) ? want : 'default' };
}
// ---- 耗时记录：每次提问各阶段花了多久（只有数字、模型名和引擎版本，不含任何文档内容），留最近 12 次，设置里能看、能复制。 ----
const TIMINGS_KEY = 'ai.codexTimings.v1';
export function codexTimings() { try { const list = JSON.parse(localStorage.getItem(TIMINGS_KEY) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } }
function recordTiming(entry) { try { localStorage.setItem(TIMINGS_KEY, JSON.stringify([entry, ...codexTimings()].slice(0, 12))); } catch { /* 存不下就算了 */ } }

export async function streamNative({ model, effort, fast = false, tier = '', useSavedTier = false, messages, signal, onDelta, onReasoning, pdfTools = false, pdfVision = false, pdfLimits, onTool, extraInstructions = '' }) {
  signal?.throwIfAborted();
  const key = threadKey(model, pdfTools, pdfVision);
  const began = performance.now(), waitedWarm = pendingWarm.has(key);
  let firstAt = 0, answerAt = 0;
  if (pendingWarm.has(key)) await pendingWarm.get(key);
  signal?.throwIfAborted();
  const port = await acquire(key);
  const gotPort = performance.now();
  const speed = codexSpeed({ model, fast, tier, useSavedTier });
  spare();
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let settled = false, received = false, toolQueue = Promise.resolve();
    const toolReplies = new Set();
    function finish(error, healthy = false) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (healthy) release(port, true, key);
      else if (cancelled) settle();
      else release(port, false);
      if (error) reject(error); else resolve();
    }
    // 停止回答后，等小助手确认那段对话收尾了再复用这条连接；几秒内没回音就关掉重来。
    let cancelled = false;
    function settle() {
      port.reset();
      let over = false;
      const end = healthy => { if (over) return; over = true; clearTimeout(wait); release(port, healthy); };
      const wait = setTimeout(() => end(false), 5000);
      port.onMessage.addListener(msg => { if (msg.id === id && (msg.event === 'done' || msg.event === 'error')) end(msg.event === 'done'); });
      port.onDisconnect.addListener(() => end(false));
    }
    const cancel = () => { cancelled = true; try { port.postMessage({ id: crypto.randomUUID(), type: 'cancel', targetId: id }); } catch {} };
    const abort = () => { cancel(); finish(signal.reason || new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { cancel(); finish(new Error('对话超过 10 分钟，已停止。')); }, 10 * 60000);
    port.onDisconnect.addListener(error => finish(new Error(error)));
    port.onMessage.addListener(msg => {
      if (settled) return;
      if (toolReplies.has(msg.id) && msg.ok === false) { finish(new Error(msg.error || '小助手拒绝了阅读结果。')); return; }
      if (msg.id !== id) return;
      if (msg.event === 'delta') { received = true; firstAt ||= performance.now(); answerAt ||= performance.now(); onDelta?.(msg.text); }
      if (msg.event === 'reasoning') { firstAt ||= performance.now(); onReasoning?.(msg.text); }
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
      if (msg.event === 'done') {
        const ms = value => Math.round(value);
        recordTiming({ at: Date.now(), model: model || '', effort: effort || '', speed: speed.tier || (speed.fast ? 'fast' : ''), tools: Boolean(pdfTools), waitedWarm,
          portMs: ms(gotPort - began), firstMs: firstAt ? ms(firstAt - began) : -1, answerMs: answerAt ? ms(answerAt - began) : -1, totalMs: ms(performance.now() - began), bridge: msg.timing || null });
        toolQueue.then(() => finish(null, true));
      }
      if (msg.event === 'error' || msg.ok === false) {
        const error = new Error(msg.error || 'Codex 请求失败。');
        if (pdfTools && !received && /PDF_TOOLS_UNAVAILABLE/.test(error.message)) error.code = 'PDF_TOOLS_UNAVAILABLE';
        finish(error);
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    const latest = messages.at(-1);
    port.postMessage({ id, type: 'chat', model, effort, ...speed, text: latest.content + (extraInstructions ? '\n\n[工作台的文档格式与阅读说明]\n' + extraInstructions : ''),
      history: messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
      images: messages.flatMap(item => item.images || []), ...(pdfTools ? { pdfTools: true, pdfVision, ...(pdfLimits ? { pdfLimits } : {}) } : {}) });
  });
}
export const streamNativeDocument = options => streamNative({ ...options, pdfTools: true, pdfVision: options.tools.some(tool => tool.name === 'pdf_view') });
