// Chat-only presentation preferences never modify model settings or requests.
const DEFAULT_FONT_SIZE = 17;
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 24;
const FONT_KEY = 'chatFontSize';
const normalizeFontSize = value => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(value))) : DEFAULT_FONT_SIZE;

export async function initializeChatUi(reportError) {
  const $ = id => document.getElementById(id);
  const menu = $('chat-menu');
  const closeMenu = () => { menu.open = false; };
  let fontSize = DEFAULT_FONT_SIZE;
  let pendingFontSize = null;
  let saving = false;

  function applyFontSize(value) {
    fontSize = normalizeFontSize(value);
    const list = $('messages');
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
    document.documentElement.style.setProperty('--chat-font-size', fontSize + 'px');
    $('font-reset').textContent = String(fontSize);
    $('font-reset').setAttribute('aria-label', '回复字号 ' + fontSize + '，点击恢复默认 17');
    $('font-reset').title = '当前字号 ' + fontSize + '，点击恢复默认 17';
    $('font-smaller').disabled = fontSize === MIN_FONT_SIZE;
    $('font-larger').disabled = fontSize === MAX_FONT_SIZE;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }

  async function savePendingFontSize() {
    // Coalesce repeated clicks while saving; stale storage events cannot undo
    // the current local choice. Other chat windows receive the saved value.
    if (saving) return;
    saving = true;
    try {
      while (pendingFontSize !== null) {
        const value = pendingFontSize;
        pendingFontSize = null;
        await chrome.storage.local.set({ [FONT_KEY]: value });
      }
    } catch {
      pendingFontSize = null;
      reportError('字号已调整，但未能保存偏好，请重试。');
    } finally {
      saving = false;
    }
  }

  function changeFontSize(value) {
    applyFontSize(value);
    pendingFontSize = fontSize;
    void savePendingFontSize();
  }

  applyFontSize((await chrome.storage.local.get(FONT_KEY))[FONT_KEY]);
  $('font-smaller').onclick = () => changeFontSize(fontSize - 1);
  $('font-larger').onclick = () => changeFontSize(fontSize + 1);
  $('font-reset').onclick = () => changeFontSize(DEFAULT_FONT_SIZE);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[FONT_KEY] && !saving) applyFontSize(changes[FONT_KEY].newValue);
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('button')) closeMenu();
  });
  document.addEventListener('pointerdown', event => {
    if (menu.open && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      closeMenu(); menu.querySelector('summary').focus(); event.preventDefault();
    }
  });
}
