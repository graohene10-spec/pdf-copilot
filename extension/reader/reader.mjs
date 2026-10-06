import * as pdfjs from '../vendor/pdfjs/pdf.mjs';
import { clamp, destinationPage, safeDocumentUrl, documentName, pdfRectangle } from './geometry.mjs';
import { cropImage } from './selection.mjs';
import { ContinuousPdfViewer } from './continuous.mjs';
import { DocumentService, renderDocumentImage } from './document-service.mjs';
import { requestDocumentAccess, documentOpenError } from './document-access.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');
const $ = id => document.getElementById(id);
const readerWindow = await chrome.windows?.getCurrent?.();
const readerTab = await chrome.tabs?.getCurrent?.();
const readingArea = $('reading-area');
let pdf = null;
let loadingTask = null;
let viewport = null;
let documentEpoch = 0;
let openRequestEpoch = 0;
let pageNumber = 1;
let scale = null;
let source = {};
let bookmarkPages = [];
let selectedText = '';
let selectedPages = null;
let capturing = false;
let pendingImage = null;
let resizeTimer = null;
let highlightTimer = null;
let documentService = null;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').style.color = error ? '#ce5050' : '';
}
function report(error) {
  if (error?.name === 'RenderingCancelledException' || error?.name === 'AbortException') return;
  status(error?.message || '操作失败，请重试。', true);
}
function updateControls() {
  const ready = !!pdf;
  for (const id of ['page-number', 'zoom-in', 'zoom-out', 'zoom-label', 'bookmark', 'capture-region']) $(id).disabled = !ready;
  $('previous').disabled = !ready || pageNumber <= 1;
  $('next').disabled = !ready || pageNumber >= pdf.numPages;
  $('page-number').value = pageNumber;
  $('page-number').max = ready ? pdf.numPages : 1;
  $('page-count').textContent = `/ ${ready ? pdf.numPages : 0}`;
  $('bookmark').textContent = bookmarkPages.includes(pageNumber) ? '★' : '☆';
  $('bookmark').title = bookmarkPages.includes(pageNumber) ? '取消当前页书签' : '收藏当前页';
  $('send-text').disabled = !selectedText;
}
function clearSelectedText() {
  selectedText = '';
  selectedPages = null;
  $('selection-count').textContent = '';
  $('send-text').disabled = true;
}
function clearSelection() {
  clearSelectedText();
  window.getSelection()?.removeAllRanges();
  viewer.clearOverlays();
  clearTimeout(highlightTimer);
}
function clearPreview() {
  pendingImage = null;
  $('preview-image').removeAttribute('src');
  if ($('preview-dialog').open) $('preview-dialog').close();
}

const viewer = new ContinuousPdfViewer({
  container: readingArea, pdfjs,
  onPageChange(number, displayScale) {
    pageNumber = number;
    viewport = viewer.active?.viewport || null;
    $('zoom-label').textContent = `${Math.round(displayScale * 100)}%`;
    updateControls();
    if (viewer.active?.ready) pageStatus(number);
    else status(`正在渲染第 ${number} 页…`);
  },
  onPageReady(view) {
    if (view.number !== pageNumber || !pdf) return;
    viewport = view.viewport;
    pageStatus(pageNumber);
  },
  onSelectionPending(view) { status(`正在完成第 ${view.number} 页渲染，完成后显示选区预览…`); },
  onSelect(view, rect) {
    if (!pdf) return;
    try {
      pendingImage = {
        kind: 'image', dataUrl: cropImage(view.canvas, rect, view.viewport.width, view.viewport.height),
        title: `${source.name} · 第 ${view.number} 页截图`,
        source: { ...source, page: view.number, rect: pdfRectangle(view.viewport, rect) },
      };
      $('preview-image').src = pendingImage.dataUrl;
      $('preview-dialog').showModal();
    } catch (error) { report(error); }
  },
  onDestination: destination => goToDestination(destination).catch(report),
  onError: report,
});

function pageStatus(number) {
  status(`第 ${number} / ${pdf.numPages} 页 · ${capturing ? '框选模式：在 PDF 上拖动鼠标，松开后显示预览' : '连续滚动 · 选中文字或点击“框选截图”'}`);
}

function setCapture(value) {
  capturing = value;
  clearSelection();
  viewer.capture(value);
  $('capture-region').setAttribute('aria-pressed', String(value));
  $('capture-region').textContent = value ? '退出框选' : '框选截图';
  if (value) status('在 PDF 上拖动鼠标框选区域；发送前会显示原色预览。');
}

async function sendContext(context) {
  // Send from the user click, so the background may open a browser side panel.
  const response = await chrome.runtime.sendMessage({ type: 'context:add', context, target: $('target').value, windowId: readerWindow?.id });
  if (!response?.ok) throw new Error(response?.error || '无法打开对话。请先点击插件图标打开侧栏，然后重试。');
  status('已加入对话。你可以继续阅读并选择其他内容。');
}

async function renderPage(number = pageNumber) {
  if (!pdf) return;
  clearSelection();
  return viewer.goToPage(number);
}

async function goToDestination(destination) {
  if (!pdf) return;
  const document = pdf;
  const number = await destinationPage(document, destination);
  if (document !== pdf) return;
  if (number) { await renderPage(number); }
  else status('此目录项没有可用的文档位置。');
}

function outlineTree(items) {
  const list = document.createElement('ul');
  for (const item of items) {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.title || '未命名目录';
    button.disabled = !item.dest;
    button.addEventListener('click', () => goToDestination(item.dest).catch(report));
    if (item.items?.length) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.append(button);
      details.append(summary, outlineTree(item.items));
      row.append(details);
    } else row.append(button);
    list.append(row);
  }
  return list;
}

function renderBookmarks() {
  $('bookmarks').replaceChildren();
  for (const page of bookmarkPages) {
    const row = document.createElement('div');
    row.className = 'bookmark-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `第 ${page} 页`;
    button.addEventListener('click', () => renderPage(page).catch(report));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-bookmark';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `删除第 ${page} 页书签`);
    remove.addEventListener('click', () => saveBookmarks(bookmarkPages.filter(value => value !== page)).catch(report));
    row.append(button, remove);
    $('bookmarks').append(row);
  }
  if (!bookmarkPages.length) {
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = '点击工具栏 ☆ 收藏当前页';
    $('bookmarks').append(hint);
  }
  updateControls();
}
async function saveBookmarks(pages) {
  if (!pdf) return;
  bookmarkPages = [...new Set(pages)].sort((a, b) => a - b);
  await chrome.storage.local.set({ [`bookmarks:${pdf.fingerprints[0]}`]: bookmarkPages });
  renderBookmarks();
}

async function openDocument(input, newSource) {
  const epoch = ++documentEpoch;
  documentService?.close(); documentService = null;
  clearPreview();
  setCapture(false);
  viewer.reset();
  const oldTask = loadingTask;
  pdf = null;
  viewport = null;
  bookmarkPages = [];
  updateControls();
  if (oldTask) await oldTask.destroy().catch(() => {});
  if (epoch !== documentEpoch) return;
  source = { ...newSource, windowId: readerWindow?.id };
  pageNumber = 1;
  scale = null;
  $('document-title').textContent = source.name;
  document.title = `${source.name} · PDF Copilot`;
  status('正在读取 PDF，文件不会整体上传…');
  const task = pdfjs.getDocument({
    ...input,
    cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'), cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
    wasmUrl: chrome.runtime.getURL('vendor/pdfjs/wasm/'),
    isEvalSupported: false,
    // Prefer range requests for remote documents and avoid fetching unseen pages.
    disableAutoFetch: true, disableStream: true, withCredentials: true,
  });
  loadingTask = task;
  let passwordCancelled = false;
  task.onPassword = (updatePassword, reason) => {
    const password = window.prompt(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? '密码不正确，请重新输入 PDF 密码：' : '请输入 PDF 密码：');
    if (password === null) { passwordCancelled = true; task.destroy().catch(() => {}); status('已取消打开加密 PDF。'); }
    else updatePassword(password);
  };
  try {
    const loaded = await task.promise;
    if (epoch !== documentEpoch) { await loaded.destroy(); return; }
    pdf = loaded;
    source.fingerprint = loaded.fingerprints[0];
    documentService = new DocumentService(loaded, source, () => pageNumber, (number, rect, signal) => renderDocumentImage(loaded, number, rect, signal), number => !viewer.views.has(number));
    chrome.runtime.sendMessage({ type: 'reader:document', tabId: readerTab?.id, windowId: readerWindow?.id }).catch(report);
    const key = `bookmarks:${loaded.fingerprints[0]}`;
    const [stored, outline] = await Promise.all([chrome.storage.local.get(key), loaded.getOutline()]);
    if (epoch !== documentEpoch) return;
    bookmarkPages = Array.isArray(stored[key]) ? stored[key].filter(page => Number.isInteger(page) && page >= 1 && page <= loaded.numPages) : [];
    renderBookmarks();
    $('outline').replaceChildren();
    if (outline?.length) $('outline').append(outlineTree(outline));
    else {
      const hint = document.createElement('p'); hint.className = 'muted'; hint.textContent = '此 PDF 没有内置目录'; $('outline').append(hint);
    }
    $('welcome').hidden = true;
    await viewer.setDocument(loaded);
  } catch (error) {
    if (epoch !== documentEpoch) return;
    documentService?.close(); documentService = null;
    pdf = null;
    updateControls();
    viewer.reset();
    $('welcome').hidden = false;
    if (passwordCancelled) status('已取消打开加密 PDF。');
    else status(documentOpenError(error, source), true);
  }
}

async function openFile(file) {
  if (!file) return;
  const requestEpoch = ++openRequestEpoch;
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') throw new Error('请选择 PDF 文件。');
  if (file.size > 256 * 1024 * 1024) throw new Error('初版支持最多 256 MiB 的本地 PDF。请拆分文件后再打开。');
  const data = new Uint8Array(await file.arrayBuffer());
  if (requestEpoch !== openRequestEpoch) return;
  await openDocument({ data }, { name: file.name });
}

async function openUrl(value) {
  const requestEpoch = ++openRequestEpoch;
  let url;
  try { url = await requestDocumentAccess(value); }
  catch (error) {
    if (requestEpoch !== openRequestEpoch) return;
    throw error;
  }
  if (requestEpoch !== openRequestEpoch) return;
  await openDocument({ url: url.href }, { url: url.href, name: documentName(url.href) });
}

$('open-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', () => { const file = $('file-input').files[0]; $('file-input').value = ''; openFile(file).catch(report); });
$('previous').addEventListener('click', () => renderPage(pageNumber - 1).catch(report));
$('next').addEventListener('click', () => renderPage(pageNumber + 1).catch(report));
$('page-number').addEventListener('change', () => renderPage(Number($('page-number').value)).catch(report));
$('zoom-in').addEventListener('click', () => { scale = clamp((viewport?.scale || viewer.displayScale || 1) * 1.2, 0.25, 4); clearSelection(); viewer.zoom(scale).catch(report); });
$('zoom-out').addEventListener('click', () => { scale = clamp((viewport?.scale || viewer.displayScale || 1) / 1.2, 0.25, 4); clearSelection(); viewer.zoom(scale).catch(report); });
$('zoom-label').addEventListener('click', () => { scale = null; clearSelection(); viewer.zoom(null).catch(report); });
$('nav-toggle').addEventListener('click', () => { $('navigation').hidden = !$('navigation').hidden; if (pdf && scale === null) { clearSelection(); viewer.zoom(null).catch(report); } });
$('bookmark').addEventListener('click', () => saveBookmarks(bookmarkPages.includes(pageNumber) ? bookmarkPages.filter(page => page !== pageNumber) : [...bookmarkPages, pageNumber]).catch(report));
$('night').addEventListener('click', () => {
  const value = !document.body.classList.contains('night');
  document.body.classList.toggle('night', value);
  $('night').setAttribute('aria-pressed', String(value));
  chrome.storage.local.set({ readerNightMode: value }).catch(report);
});
$('sidebar').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'sidebar:open', windowId: readerWindow?.id }).then(response => { if (!response?.ok) throw new Error(response?.error || '请点击插件图标打开侧栏。'); }).catch(report));
$('quick').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'quick:open' }).catch(report));
$('capture-region').addEventListener('click', () => setCapture(!capturing));
$('send-text').addEventListener('click', () => {
  if (!selectedText || !selectedPages) return;
  const pages = selectedPages.start === selectedPages.end ? selectedPages.start : `${selectedPages.start}–${selectedPages.end}`;
  const text = selectedPages.start === selectedPages.end ? selectedText : `[以下选文来自第 ${pages} 页]\n${selectedText}`;
  sendContext({ kind: 'text', text, title: `${source.name} · 第 ${pages} 页选文`, source: { ...source, page: selectedPages.start, endPage: selectedPages.end } }).catch(report);
});
$('preview-cancel').addEventListener('click', clearPreview);
$('preview-dialog').addEventListener('cancel', clearPreview);
$('preview-send').addEventListener('click', () => {
  if (!pendingImage) return;
  const context = pendingImage;
  sendContext(context).then(() => { clearPreview(); setCapture(false); }).catch(report);
});
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (capturing) return;
  if (!selection?.rangeCount) { clearSelectedText(); return; }
  const range = selection.getRangeAt(0);
  const owner = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('.textLayer')?.closest('.page-slot');
  const startPage = owner(range.startContainer), endPage = owner(range.endContainer);
  if (!startPage || !endPage || !viewer.stack.contains(startPage) || !viewer.stack.contains(endPage)) { clearSelectedText(); return; }
  selectedText = selection.toString().trim().slice(0, 32_000);
  selectedPages = { start: Number(startPage.dataset.page), end: Number(endPage.dataset.page) };
  $('selection-count').textContent = selectedText ? `已选 ${selectedText.length} 字` : '';
  $('send-text').disabled = !selectedText;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { clearPreview(); setCapture(false); return; }
  if (!pdf || event.ctrlKey || event.altKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || $('preview-dialog').open) return;
  if (['PageDown', 'PageUp'].includes(event.key)) {
    event.preventDefault();
    renderPage(pageNumber + (event.key === 'PageDown' ? 1 : -1)).catch(report);
  }
});
readingArea.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
readingArea.addEventListener('drop', event => { event.preventDefault(); openFile(event.dataTransfer.files[0]).catch(report); });
window.addEventListener('resize', () => { clearTimeout(resizeTimer); if (pdf && scale === null) resizeTimer = setTimeout(() => { clearSelection(); viewer.zoom(null).catch(report); }, 150); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || message.tabId !== readerTab?.id) return;
  if (message.type === 'reader:info') { respond({ ok: true, source, documentKey: pdf?.fingerprints[0], currentPage: pageNumber }); return; }
  if (message.type === 'reader:query') {
    const service = documentService;
    const run = async () => {
      if (!service || message.documentKey !== pdf?.fingerprints[0]) throw new Error('文档已切换，请在当前 PDF 重新提问。');
      const { operation, sessionId, args = {} } = message;
      if (operation === 'end') return service.end(sessionId);
      let result;
      if (operation === 'begin') result = await service.begin(sessionId, args.anchor, args.vision, args.rect);
      else if (operation === 'tool') result = await service.tool(sessionId, message.tool, args);
      else throw new Error('不支持的 PDF 操作。');
      if (service !== documentService) throw new Error('文档已切换。');
      return result;
    };
    run().then(result => respond({ ok: true, result })).catch(error => respond({ ok: false, error: error.name === 'AbortError' ? 'PDF 读取已停止。' : error.message }));
    return true;
  }
  if (message.type !== 'reader:goto') return;
  if (!pdf) { respond({ ok: false, error: '文档尚未打开' }); return; }
  if (message.documentKey && message.documentKey !== pdf.fingerprints[0]) { respond({ ok: false, error: '该引用属于另一份文档，请重新打开原 PDF。' }); return; }
  const gotoEpoch = documentEpoch, gotoDocument = pdf;
  renderPage(Number(message.page)).then(view => {
    if (documentEpoch !== gotoEpoch || pdf !== gotoDocument) throw new Error('文档已切换，请重新点击原文引用。');
    if (!view?.ready) throw new Error('目标页仍在载入，请重试。');
    const rect = message.rect;
    if (rect && rect.space === 'pdf-points' && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      const [x1, y1] = view.viewport.convertToViewportPoint(rect.x, rect.y);
      const [x2, y2] = view.viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
      Object.assign(view.overlay.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` });
      view.overlay.hidden = false;
      view.overlay.scrollIntoView({ block: 'center', behavior: 'smooth' });
      highlightTimer = setTimeout(() => view.selector.clear(), 4000);
    }
    respond({ ok: true });
  }).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
window.addEventListener('pagehide', () => {
  ++documentEpoch; ++openRequestEpoch;
  documentService?.close(); documentService = null;
  viewer.reset(); loadingTask?.destroy().catch(() => {});
  clearPreview();
});

chrome.storage.local.get('readerNightMode').then(stored => {
  document.body.classList.toggle('night', !!stored.readerNightMode);
  $('night').setAttribute('aria-pressed', String(!!stored.readerNightMode));
}).catch(report);
const requestedUrl = new URLSearchParams(location.search).get('url');
if (requestedUrl) {
  try {
    const url = safeDocumentUrl(requestedUrl);
    $('url-prompt').hidden = false;
    $('url-label').textContent = `即将读取：${url.protocol === 'file:' ? documentName(url.href) : url.hostname + url.pathname}`;
    if (url.protocol === 'file:') {
      $('open-url').textContent = '授权本地文件读取并打开 PDF';
      $('url-access-note').textContent = '需要开启“允许访问文件网址”并授权本地文件读取。也可点击顶部“打开 PDF”选择文件，无需这些权限。';
    }
    $('open-url').addEventListener('click', () => openUrl(url.href).catch(report));
  } catch (error) { report(error); }
}
