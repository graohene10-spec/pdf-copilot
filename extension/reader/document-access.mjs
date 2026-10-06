import { safeDocumentUrl } from './geometry.mjs';

// File-scheme access is a browser switch, not an optional host permission.
// Both are required for XHR from the extension page to a file:/// PDF.
export async function requestDocumentAccess(value, browser = chrome) {
  const url = safeDocumentUrl(value);
  const local = url.protocol === 'file:';
  if (local && !await browser.extension.isAllowedFileSchemeAccess()) {
    throw new Error('请在扩展详情中开启“允许访问文件网址”，或点击“打开 PDF”选择文件。');
  }
  const origins = [local ? 'file:///*' : `${url.protocol}//${url.hostname}/*`];
  if (!await browser.permissions.contains({ origins })) {
    const granted = await browser.permissions.request({ origins });
    if (!granted) throw new Error(local
      ? '没有取得本地文件的读取权限。可以点击“打开 PDF”选择文件，无需文件网址权限。'
      : '没有取得该网站的读取权限。可以选择已下载的本地 PDF。');
  }
  return url;
}

export function documentOpenError(error, source) {
  let protocol;
  try { protocol = new URL(source?.url).protocol; } catch {}
  if (protocol === 'file:' && (error?.status === 0 || /Unexpected server response \(0\)|network error|failed to fetch/i.test(error?.message || ''))) {
    return '无法读取本地 PDF。请确认文件仍存在、没有被移动，且扩展已获准读取本地文件；也可点击“打开 PDF”重新选择。';
  }
  const message = String(error?.message || '读取失败').replace(/[。.!?]+$/u, '');
  return `无法打开 PDF：${message}。` + (['http:', 'https:'].includes(protocol) ? '远程链接可先下载，再选择本地文件。' : '请确认所选文件是有效 PDF。');
}
