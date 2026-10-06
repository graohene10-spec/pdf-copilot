import { loadSettings, loadKey, applyTheme } from '../common/settings.js';
import { contextText } from '../common/context.js';
import { PROVIDERS, getProvider, getModel, getNativeModels, registerNativeModels, streamChat } from '../providers/index.js';
import { EMBEDDED_MATH } from '../common/build-profile.js';
import { renderMessage } from './math.mjs';
import { createAnswer, appendAnswerText, appendReasoning, finishAnswer, progressLabel } from './progress.mjs';
import { matchingInboxContexts } from './inbox.mjs';
import { initializeChatUi } from './ui.mjs';
import { createDocumentClient } from './document-client.mjs';
import { streamDocumentChat, boundedHistory } from '../providers/document-chat.mjs';
import { contextEnabled, canProvidePage, needsCurrentPage } from '../common/page-context.mjs';
import { compactPageImage } from './page-image.mjs';

// Both distribution profiles stay self-contained; the lite profile never loads KaTeX.
const mathRenderer = EMBEDDED_MATH ? (await import('../vendor/katex/katex.mjs')).default : null;

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const quick = query.get('mode') === 'quick';
const sessions = new Map();
let tabId = quick ? Number(query.get('tab')) : -1;
let windowId = Number(query.get('window')) || (await chrome.windows.getCurrent()).id;
let currentSource = {};
let settings = await loadSettings();
const { nativeModels = [] } = await chrome.storage.local.get('nativeModels');
registerNativeModels(nativeModels);
let activeRequest;
let busy = false;
let sourceEpoch = 0;
applyTheme(settings.theme);
$('heading').textContent = quick ? '临时问答' : 'PDF Copilot';
$('quick').hidden = quick;
if (quick) $('mode-note').textContent = '关闭窗口即清空 · 与侧栏会话独立';
for (const provider of PROVIDERS) $('provider').add(new Option(provider.name, provider.id));
$('provider').value = settings.provider;
$('model').value = settings.model;
function session() {
  const key = tabId + ':' + (currentSource.documentKey || currentSource.url || '');
  if (!sessions.has(key)) {
    while (sessions.size >= 5) sessions.delete(sessions.keys().next().value);
    sessions.set(key, { messages: [], attachments: [] });
  }
  return sessions.get(key);
}
function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
await initializeChatUi(text => status(text, true));
const contextPreference = await chrome.storage.local.get('pdfContextEnabled');
$('pdf-context').checked = contextEnabled(contextPreference.pdfContextEnabled);
$('pdf-context').addEventListener('change', () => {
  updateContextHint();
  chrome.storage.local.set({ pdfContextEnabled: $('pdf-context').checked }).catch(error => status(error.message, true));
});
function updateContextHint() {
  $('pdf-context-control').hidden = !canProvidePage(currentSource);
  $('context-hint').textContent = !canProvidePage(currentSource) ? '可直接提问，或加入文字与截图。'
    : !$('pdf-context').checked ? '仅发送问题与手动附件'
    : session().attachments.length ? '发送所选附件' + (currentSource.enhanced ? ' · AI 可查阅相关页' : '')
    : currentSource.enhanced ? '发送时附当前 PDF 页 · AI 可查阅相关页' : '发送时附当前可见区域';
}
function setBusy(value) {
  busy = value;
  $('send').disabled = value; $('stop').hidden = !value;
  $('provider').disabled = $('model').disabled = $('effort').disabled = value;
  $('pdf-context').disabled = value;
}
function updateProgress(answer) {
  if (!answer.element) return;
  const label = progressLabel(answer);
  answer.element.setAttribute('aria-busy', String(Boolean(label)));
  let node = answer.element.querySelector('.answer-progress');
  if (!label) { node?.remove(); return; }
  if (!node) {
    node = document.createElement('div'); node.className = 'answer-progress';
    node.setAttribute('role', 'status'); answer.element.append(node);
  }
  node.dataset.state = answer.phase;
  if (node.textContent !== label) node.textContent = label;
}
function cancelActive() {
  const request = activeRequest;
  if (!request) return false;
  // Finish before aborting: a provider may deliver a queued callback after abort.
  finishAnswer(request.answer); request.answer.failed = true;
  if (!request.answer.content) request.answer.content = '回答已停止。';
  updateProgress(request.answer);
  request.controller.abort();
  if (request.frame) cancelAnimationFrame(request.frame);
  activeRequest = null; setBusy(false);
  return true;
}
function syncModels(useDefault = false) {
  const provider = getProvider($('provider').value);
  $('models').replaceChildren(...provider.models.map(item => new Option(item.name, item.id)));
  if (useDefault) $('model').value = provider.defaultModel || provider.models[0]?.id || '';
  const model = getModel(provider.id, $('model').value);
  const selected = $('effort').value || settings.effort;
  $('effort').replaceChildren(new Option('模型默认', ''));
  for (const effort of model?.efforts || []) $('effort').add(new Option(({ none: '不思考', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', minimal: '极低', ultra: '极高' })[effort] || effort, effort));
  $('effort').value = model?.efforts.includes(selected) ? selected : (model?.defaultEffort || '');
  $('refresh').hidden = provider.id !== 'codex';
  syncModelSummary();
}
function syncModelSummary() {
  const provider = getProvider($('provider').value);
  const effort = $('effort').selectedOptions[0]?.textContent || '模型默认';
  const text = provider.name + ' · ' + ($('model').value.trim() || '选择模型') + ' · 思考：' + effort;
  $('model-summary').textContent = text;
  $('model-options').querySelector('summary').title = text + '（点击调整）';
}
syncModels();
$('provider').addEventListener('change', () => syncModels(true));
$('model').addEventListener('change', () => syncModels());
$('effort').addEventListener('change', syncModelSummary);
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  try {
    const models = await getNativeModels();
    registerNativeModels(models);
    await chrome.storage.local.set({ nativeModels: models });
    syncModels(!$('model').value);
    status('已读取 ' + models.length + ' 个 Codex 模型。');
  } catch (error) { status(error.message + ' 请先安装 Windows 小助手。', true); }
  finally { $('refresh').disabled = false; }
});
$('settings').onclick = () => chrome.runtime.openOptionsPage();

async function sendAction(type) {
  const response = await chrome.runtime.sendMessage({ type, tabId, windowId });
  if (!response?.ok) status(type === 'capture:open'
    ? '截图未成功。请在 PDF 标签页按 Alt+Shift+S 重新调用；本地文件还需启用“允许访问文件网址”。'
    : response?.error || '操作失败。', true);
}
$('reader').onclick = () => sendAction('reader:open');
$('capture').onclick = () => sendAction('capture:open');
$('quick').onclick = () => sendAction('quick:open');
function sourceButton(source) {
  const button = document.createElement('button');
  button.className = 'citation';
  button.textContent = source.page ? '↗ ' + (source.pageLabel && source.pageLabel !== String(source.page) ? '页标签 ' + source.pageLabel + ' · ' : '') + 'PDF 第 ' + source.page + ' 页' : source.name || '来源';
  button.disabled = !source.page || !source.tabId;
  button.onclick = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'source:goto', source });
    if (!response?.ok) status(response?.error || '无法回跳。', true);
  };
  return button;
}
function renderSources(answer) {
  if (!answer.element) return;
  answer.element.querySelector('.document-sources')?.remove();
  if (!answer.sources?.length) return;
  const details = document.createElement('details'); details.className = 'document-sources';
  const summary = document.createElement('summary'); summary.textContent = '参考原文 · ' + new Set(answer.sources.map(item => item.page)).size + ' 页'; details.append(summary);
  for (const evidence of answer.sources) {
    const button = sourceButton(evidence.source); button.title = evidence.sourceId; details.append(button);
    const text = document.createElement('p'); text.className = 'evidence-text'; text.textContent = evidence.text; details.append(text);
  }
  answer.element.append(details);
}
function linkCitations(body, evidence) {
  const sources = new Map((evidence || []).map(item => [item.sourceId, item]));
  if (!sources.size) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT), nodes = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.message-code,.message-math,button')) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const pattern = /\[(S[a-zA-Z0-9]+-\d+)\]/g; let match, last = 0; const fragment = document.createDocumentFragment();
    while ((match = pattern.exec(node.textContent))) {
      const item = sources.get(match[1]); if (!item) continue;
      fragment.append(document.createTextNode(node.textContent.slice(last, match.index)));
      const button = sourceButton(item.source); button.classList.add('citation-inline'); button.textContent = '[' + (item.pageLabel && item.pageLabel !== String(item.page) ? item.pageLabel + ' / ' : '') + 'PDF ' + item.page + ']'; button.title = item.text;
      fragment.append(button); last = pattern.lastIndex;
    }
    if (last) { fragment.append(document.createTextNode(node.textContent.slice(last))); node.replaceWith(fragment); }
  }
}
function renderMessages() {
  const list = $('messages');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
  const entries = session().messages;
  if (!entries.length) {
    list.replaceChildren();
    const welcome = document.createElement('div');
    welcome.className = 'welcome';
    const title = document.createElement('h2'); title.textContent = '读到哪里，聊到哪里。';
    const note = document.createElement('p'); note.textContent = '直接提问，发送时会附上当前页面。也可选文或框选公式；增强模式下，AI 能按需查阅相关页。';
    welcome.append(title, note); list.append(welcome); return;
  }
  list.replaceChildren(...entries.map(item => {
    const card = document.createElement('article'); card.className = 'message ' + item.role + (item.failed ? ' error' : '');
    const label = document.createElement('div'); label.className = 'label'; label.textContent = item.role === 'user' ? '你' : '阅读助手';
    const copy = document.createElement('button'); copy.textContent = '复制'; copy.style.marginLeft = 'auto';
    copy.onclick = () => navigator.clipboard.writeText(item.content).catch(() => status('复制失败，请手动选择文字。', true));
    label.append(copy);
    const text = item.displayContent ?? item.content;
    const content = item.renderedText === text && item.bodyElement
      ? item.bodyElement : document.createElement('div');
    content.className = 'body';
    if (item.role === 'assistant' && progressLabel(item)) {
      content.textContent = text; item.renderedText = undefined;
    } else if (item.renderedText !== text) {
      renderMessage(content, text, mathRenderer); linkCitations(content, item.sources); item.renderedText = text;
    }
    card.append(label, content);
    item.element = card; item.bodyElement = content;
    for (const attachment of item.attachments || []) {
      if (attachment.automatic) {
        const details = document.createElement('details'); details.className = 'automatic-page';
        const summary = document.createElement('summary'); summary.textContent = '已附 · ' + attachment.title; details.append(summary);
        const image = document.createElement('img'); image.src = attachment.dataUrl; image.alt = attachment.title;
        details.append(image); if (attachment.source.page) details.append(sourceButton(attachment.source));
        card.append(details); continue;
      }
      if (attachment.kind === 'image') { const img = document.createElement('img'); img.src = attachment.dataUrl; img.alt = attachment.title; card.append(img); }
      card.append(sourceButton(attachment.source));
    }
    if (item.reasoning) {
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '思考过程';
      const text = document.createElement('pre'); text.textContent = item.reasoning; details.append(summary, text); card.append(details);
    }
    if (item.role === 'assistant') updateProgress(item);
    if (item.role === 'assistant') renderSources(item);
    return card;
  }));
  if (nearBottom || busy) list.scrollTop = list.scrollHeight;
}
function renderAttachments() {
  updateContextHint();
  $('attachments').replaceChildren(...session().attachments.map(attachment => {
    const card = document.createElement('div'); card.className = 'attachment';
    if (attachment.kind === 'image') { const img = document.createElement('img'); img.src = attachment.dataUrl; img.alt = attachment.title; card.append(img); }
    else { const snippet = document.createElement('div'); snippet.className = 'snippet'; snippet.textContent = attachment.text.slice(0, 160); card.append(snippet); }
    const row = document.createElement('div'); row.className = 'row';
    const name = document.createElement('span'); name.textContent = attachment.title;
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = '移除附件'; remove.disabled = busy;
    remove.onclick = () => { session().attachments = session().attachments.filter(item => item.id !== attachment.id); renderAttachments(); };
    row.append(name, remove); card.append(row); return card;
  }));
}
function updateAnswer(answer) {
  if (!answer.element?.isConnected) return;
  const list = $('messages');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
  answer.bodyElement.textContent = answer.content;
  answer.renderedText = undefined;
  updateProgress(answer);
  if (answer.reasoning) {
    let text = answer.element.querySelector('details pre');
    if (!text) {
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '思考过程';
      text = document.createElement('pre'); details.append(summary, text); answer.element.append(details);
    }
    text.textContent = answer.reasoning;
  }
  if (nearBottom) list.scrollTop = list.scrollHeight;
}
async function receiveInbox() {
  const requestedTab = tabId, state = session(), documentKey = currentSource.documentKey;
  const response = await chrome.runtime.sendMessage({ type: 'inbox:take', tabId: requestedTab, target: quick ? 'quick' : 'sidebar' });
  if (requestedTab !== tabId || session() !== state) return;
  const contexts = matchingInboxContexts(response?.contexts, requestedTab, documentKey);
  if (contexts.length) {
    state.attachments.push(...contexts);
    while (state.attachments.length > 8) state.attachments.shift();
    while (state.attachments.reduce((sum, item) => sum + (item.dataUrl?.length || 0), 0) > 8 * 1024 * 1024) state.attachments.shift();
    renderAttachments();
    status('附件已就绪，点击发送才会上传。');
  }
}
async function switchSource(id) {
  const epoch = ++sourceEpoch;
  const response = await chrome.runtime.sendMessage({ type: 'source:get', tabId: id });
  if (epoch !== sourceEpoch) return;
  const next = response?.tab || {};
  if (busy && (id !== tabId || (next.documentKey || next.url || '') !== (currentSource.documentKey || currentSource.url || ''))) {
    cancelActive(); status('切换文档，已停止上一条请求。');
  }
  tabId = id;
  currentSource = next;
  $('source-name').textContent = currentSource.title || '文档标签页 #' + tabId;
  $('source-name').title = $('source-name').textContent + ' · ' + $('mode-note').textContent;
  renderMessages(); renderAttachments(); await receiveInbox();
}
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'inbox:changed' && message.tabId === tabId && message.target === (quick ? 'quick' : 'sidebar')) switchSource(tabId).catch(error => status(error.message, true));
  if (message.type === 'source:document' && message.tabId === tabId) switchSource(tabId).catch(error => status(error.message, true));
  if (!quick && message.type === 'source:changed' && message.windowId === windowId) switchSource(message.tabId).catch(error => status(error.message, true));
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.pdfContextEnabled) {
    $('pdf-context').checked = contextEnabled(changes.pdfContextEnabled.newValue); updateContextHint();
  }
  if (area === 'local' && changes.settings) {
    settings = await loadSettings(); applyTheme(settings.theme);
    registerNativeModels((await chrome.storage.local.get('nativeModels')).nativeModels || []);
    if (!busy) { $('provider').value = settings.provider; $('model').value = settings.model; syncModels(); }
  }
});
if (!quick) {
  const source = await chrome.runtime.sendMessage({ type: 'source:get' });
  tabId = source?.tab?.id || -1;
  windowId = source?.tab?.windowId || windowId;
}
await switchSource(tabId);
if (query.has('error')) status('截图需要当前标签页授权；本地 PDF 还需在扩展详情启用“允许访问文件网址”。', true);
$('clear').onclick = () => {
  cancelActive(); sessions.delete(tabId + ':' + (currentSource.documentKey || currentSource.url || '')); renderMessages(); renderAttachments(); status('当前会话已清空。');
};
$('stop').onclick = () => {
  if (!cancelActive()) return;
  renderMessages(); renderAttachments(); status('已停止，部分回答不会作为后续上下文。');
};
$('prompt').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); $('composer').requestSubmit(); } });
$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const state = session();
  const prompt = $('prompt').value.trim();
  if (!prompt && !state.attachments.length) return;
  const provider = $('provider').value;
  const model = $('model').value.trim();
  if (!model) { status('请填写模型名；Codex 可以点击 ↻ 获取可用模型。', true); return; }
  const apiKey = provider === 'codex' ? '' : await loadKey(provider);
  if (busy) return;
  if (session() !== state) { status('文档已切换，请在当前文档重新发送。'); return; }
  if (provider !== 'codex' && !apiKey) { status('请先打开设置并填写 API Key。', true); return; }
  const baseUrl = settings.provider === provider ? settings.baseUrl : getProvider(provider).baseUrl;
  const source = { ...currentSource }, automaticContext = $('pdf-context').checked;
  const attachments = state.attachments.splice(0);
  const content = [prompt || '请解释提供的材料。', ...attachments.map(contextText)].join('\n\n');
  const user = { role: 'user', content, displayContent: prompt || '请解释提供的材料。', attachments, images: attachments.filter(item => item.kind === 'image').map(item => item.dataUrl) };
  const history = state.messages.filter(item => !item.failed).map(({ role, content, sources }) => ({ role, content: content + (sources?.length ? '\n[此前提供过的原文位置]\n' + JSON.stringify(sources.slice(0, 8).map(item => ({ sourceId: item.sourceId, page: item.page, pageLabel: item.pageLabel, text: item.text.slice(0, 400) }))) : '') }));
  const allImages = user.images;
  if (allImages.length > (provider === 'codex' ? 4 : 8) || allImages.reduce((sum, image) => sum + image.length, 0) > 8 * 1024 * 1024) {
    state.attachments = attachments; status('当前会话图片较多，请移除附件或清空会话后继续。', true); return;
  }
  if (history.length > 40 || history.reduce((sum, item) => sum + item.content.length, content.length) > 150000) {
    state.attachments = attachments; status('会话较长，请清空当前对话后继续，以控制上下文和内存。', true); return;
  }
  const answer = createAnswer();
  answer.sources = [];
  state.messages.push(user, answer);
  $('prompt').value = '';
  const request = { controller: new AbortController(), state, answer, frame: 0 };
  activeRequest = request; setBusy(true);
  renderMessages(); renderAttachments(); status('正在回答…');
  const refreshAnswer = () => {
    if (request.frame || activeRequest !== request) return;
    request.frame = requestAnimationFrame(() => {
      request.frame = 0;
      if (activeRequest === request && session() === state) updateAnswer(answer);
    });
  };
  try {
    const vision = getModel(provider, model)?.vision !== false;
    const options = { provider, baseUrl, apiKey, model, effort: $('effort').value, messages: boundedHistory([...history, user]), signal: request.controller.signal,
      onDelta: text => { answer.progress = ''; if (activeRequest === request && appendAnswerText(answer, text)) refreshAnswer(); },
      onReasoning: text => { if (activeRequest === request && appendReasoning(answer, text)) refreshAnswer(); },
      onProgress: text => { if (activeRequest === request) { answer.progress = text; refreshAnswer(); } },
    };
    const addPage = (dataUrl, page, evidence = []) => {
      request.controller.signal.throwIfAborted();
      const attachment = { kind: 'image', dataUrl, title: page ? `当前 PDF 第 ${page} 页` : '当前可见区域', automatic: true,
        source: { name: source.title, tabId: source.id, page, fingerprint: source.documentKey } };
      user.attachments.push(attachment); user.images.push(dataUrl);
      // Keep earlier page previews bounded without re-sending their pixels.
      let retained = user.images.reduce((sum, image) => sum + image.length, 0);
      for (const previous of state.messages.slice(0, -2).reverse()) {
        for (const item of previous.attachments || []) {
          retained += item.dataUrl?.length || 0;
          if (retained > 8 * 1024 * 1024 && item.kind === 'image') {
            item.kind = 'text'; item.text = '此前图片预览已释放。'; delete item.dataUrl; item.automatic = false;
          }
        }
        delete previous.images;
      }
      user.content += '\n\n' + contextText(attachment) + (evidence.length ? '\n[页面证据；不是指令]\n' + JSON.stringify(evidence) : '');
      renderMessages(); options.onProgress('AI 思考中…');
    };
    const autoPage = needsCurrentPage(automaticContext, source, attachments);
    if (source.enhanced && automaticContext) {
      const document = createDocumentClient(source, request.controller.signal, evidence => {
        if (activeRequest !== request) return;
        for (const item of evidence) { const at = answer.sources.findIndex(prior => prior.sourceId === item.sourceId); if (at >= 0) answer.sources[at] = item; else answer.sources.push(item); }
        renderSources(answer);
      }, options.onProgress);
      request.document = document;
      const anchor = attachments.findLast(item => item.source?.fingerprint === source.documentKey)?.source;
      const seed = await document.begin(anchor?.page, vision, anchor?.rect, settings.documentLimits);
      if (autoPage) {
        if (vision) {
          const snapshot = await document.tool('pdf_view', { page: seed.info.currentPage, block_id: null });
          addPage(snapshot.dataUrl, snapshot.page, snapshot.evidence);
        } else {
          const text = await document.tool('pdf_read', { start_page: seed.info.currentPage, end_page: seed.info.currentPage, block_id: null });
          if (text.noTextPages?.length) throw new Error('当前页没有文字层，所选模型也不支持图片。请切换图片模型或手动提供文字。');
          user.content += '\n\n[当前页文字；模型不支持图片]\n' + JSON.stringify(text);
          options.onProgress('AI 思考中…');
        }
      }
      await streamDocumentChat(options, document, seed);
    } else {
      if (autoPage) {
        if (!vision) throw new Error('所选模型不支持当前页图片。请切换图片模型、使用增强阅读器读取文字，或关闭自动上下文。');
        options.onProgress('正在准备当前可见页…');
        const snapshot = await chrome.runtime.sendMessage({ type: 'page:capture', tabId: source.id, expectedUrl: source.url });
        request.controller.signal.throwIfAborted();
        if (!snapshot?.ok) throw new Error(snapshot?.error || '无法读取当前页，请手动截图或改用增强阅读器。');
        addPage(await compactPageImage(snapshot.dataUrl, request.controller.signal));
      }
      await streamChat(options);
    }
    if (activeRequest === request) status('回答完成。');
  } catch (error) {
    answer.failed = true;
    const cancelled = request.controller.signal.aborted || error.name === 'AbortError';
    if (!answer.content) answer.content = cancelled ? '回答已停止。' : error.message;
    if (activeRequest === request) status(cancelled ? '已停止，部分回答不会作为后续上下文。' : error.message, !cancelled);
  } finally {
    request.document?.close();
    finishAnswer(answer); updateProgress(answer);
    if (request.frame) cancelAnimationFrame(request.frame);
    if (activeRequest === request) {
      activeRequest = null; setBusy(false); renderMessages(); renderAttachments();
    }
  }
});
addEventListener('pagehide', () => { cancelActive(); sessions.clear(); });
