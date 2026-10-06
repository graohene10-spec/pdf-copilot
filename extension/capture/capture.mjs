import { rectangleSelector, cropImage } from '../reader/selection.mjs';
import { canvasCrop } from '../reader/geometry.mjs';

const $ = id => document.getElementById(id);
const snapshot = $('snapshot');
const surface = $('capture-surface');
let source = {};
let pending = null;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').style.color = error ? '#ce5050' : '';
}
function report(error) { status(error?.message || '操作失败，请重新截图。', true); }
function clearPreview() {
  pending = null;
  $('preview-image').removeAttribute('src');
  if ($('preview-dialog').open) $('preview-dialog').close();
}
const selector = rectangleSelector(surface, $('selection-box'), rect => {
  try {
    const box = surface.getBoundingClientRect();
    const pixelRect = canvasCrop(rect, box.width, box.height, snapshot.naturalWidth, snapshot.naturalHeight);
    pending = {
      kind: 'image', dataUrl: cropImage(snapshot, rect, box.width, box.height),
      title: `${source.name || '当前标签页'} · 可见区域截图`,
      source: { ...source, rect: { ...pixelRect, space: 'screenshot-pixels' } },
    };
    $('preview-image').src = pending.dataUrl;
    $('preview-dialog').showModal();
  } catch (error) { report(error); }
});
selector.setActive(true);

$('preview-cancel').addEventListener('click', clearPreview);
$('preview-dialog').addEventListener('cancel', clearPreview);
$('close').addEventListener('click', () => { clearPreview(); snapshot.removeAttribute('src'); window.close(); });
$('preview-send').addEventListener('click', () => {
  if (!pending) return;
  const request = { type: 'context:add', context: pending, target: $('target').value };
  // Keep this call in the click handler for the browser side panel user gesture.
  chrome.runtime.sendMessage(request).then(response => {
    if (!response?.ok) throw new Error(response?.error || '无法打开对话。请打开插件侧栏后再试。');
    clearPreview();
    snapshot.removeAttribute('src');
    surface.hidden = true;
    selector.setActive(false);
    status('选区已加入对话。整张截图已从本页面清除，可以关闭此页。');
  }).catch(report);
});
window.addEventListener('pagehide', () => { clearPreview(); snapshot.removeAttribute('src'); source = {}; });
window.addEventListener('keydown', event => { if (event.key === 'Escape') clearPreview(); });
chrome.storage.local.get('readerNightMode').then(stored => document.body.classList.toggle('night', !!stored.readerNightMode)).catch(report);

async function load() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) throw new Error('没有可读取的截图。请返回原 PDF，再点击插件的截图按钮。');
  const response = await chrome.runtime.sendMessage({ type: 'capture:get', id });
  if (!response?.ok || !response.dataUrl) throw new Error(response?.error || '截图已过期。请返回原 PDF 重新截图。');
  if (!/^data:image\/(png|jpeg);base64,/.test(response.dataUrl)) throw new Error('截图格式无效，请重新截图。');
  source = response.source || {};
  snapshot.src = response.dataUrl;
  await snapshot.decode();
  if (!snapshot.naturalWidth || !snapshot.naturalHeight) throw new Error('无法读取截图，请重试。');
  surface.hidden = false;
  status('在截图上拖动鼠标框选区域。发送前会显示预览。');
}
load().catch(report);
