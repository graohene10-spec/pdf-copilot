// Shared policy for the composer and the capture broker. No extra host grants.
export const contextEnabled = value => value !== false;
export function canProvidePage(source) {
  if (source?.enhanced && source.documentKey) return true;
  try { return ['http:', 'https:', 'file:'].includes(new URL(source?.url).protocol); }
  catch { return false; }
}
export function needsCurrentPage(enabled, source, attachments) {
  return enabled && canProvidePage(source) && attachments.length === 0;
}

export async function captureVisiblePage(tab, expectedUrl, browser = chrome) {
  if (!canProvidePage({ url: tab?.url }) || tab.url !== expectedUrl) throw new Error('来源页面已切换，请重新发送。');
  await browser.tabs.update(tab.id, { active: true });
  const before = await browser.tabs.get(tab.id);
  if (!before.active || before.url !== expectedUrl || before.windowId !== tab.windowId) throw new Error('来源页面已切换，请重新发送。');
  let dataUrl;
  try { dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 }); }
  catch { throw new Error('无法读取当前可见页。请返回 PDF 点击扩展图标或使用快捷键重新打开对话；本地文件需启用“允许访问文件网址”。也可改用增强阅读器。'); }
  const after = await browser.tabs.get(tab.id);
  if (!after.active || after.url !== expectedUrl || after.windowId !== tab.windowId) throw new Error('截图期间页面已切换，请重新发送。');
  return { ok: true, dataUrl };
}
