export const MAX_IMAGE_LENGTH = 4 * 1024 * 1024;
export const MAX_INBOX_LENGTH = 6 * 1024 * 1024;

export function validateContext(value) {
  if (!value || !['text', 'image'].includes(value.kind)) throw new Error('不支持的附件类型。');
  const source = value.source || {};
  if (value.kind === 'text' && (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 100000)) {
    throw new Error('选文为空或超过 10 万字符，请缩小选择范围。');
  }
  if (value.kind === 'image' && (typeof value.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value.dataUrl) || value.dataUrl.length > MAX_IMAGE_LENGTH)) {
    throw new Error('截图过大或格式不支持，请缩小区域。');
  }
  return {
    id: value.id || crypto.randomUUID(), kind: value.kind,
    ...(value.kind === 'text' ? { text: value.text } : { dataUrl: value.dataUrl }),
    title: String(value.title || (value.kind === 'text' ? '选中文字' : '区域截图')).slice(0, 200),
    source: { name: String(source.name || '').slice(0, 200), url: typeof source.url === 'string' ? source.url.slice(0, 8192) : undefined,
      page: Number.isInteger(source.page) && source.page > 0 ? source.page : undefined,
      tabId: Number.isInteger(source.tabId) ? source.tabId : undefined,
      windowId: Number.isInteger(source.windowId) ? source.windowId : undefined,
      fingerprint: typeof source.fingerprint === 'string' ? source.fingerprint.slice(0, 200) : undefined, rect: source.rect },
  };
}

export function contextText(context) {
  const label = [context.source?.name || context.title, context.source?.page ? '第 ' + context.source.page + ' 页' : ''].filter(Boolean).join(' · ');
  return '[' + label + ']\n' + (context.kind === 'text' ? context.text : '附图：' + context.title);
}
