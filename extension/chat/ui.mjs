// Chat-only presentation preferences never modify model settings or requests.
import { animateOut, prefersReducedMotion } from '../common/motion.mjs';

const DEFAULT_FONT_SIZE = 17;
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 24;
const FONT_KEY = 'chatFontSize';
const normalizeFontSize = value => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(value))) : DEFAULT_FONT_SIZE;

/**
 * Animate a native <details> open/closed.
 *
 * The panel body uses the .collapsible grid trick, which cannot animate while
 * the element is display:none, so `open` is applied first and the collapsed
 * attribute flipped on the next frame. Closing waits for the transition before
 * clearing `open`. Without JS the details still opens instantly, as before.
 */
function animateDisclosure(details) {
  const body = details.querySelector('.options-body');
  if (!body) return;
  const summary = details.querySelector('summary');
  let animating = false;

  const finish = () => { animating = false; };

  summary.addEventListener('click', event => {
    event.preventDefault();
    if (animating) return;

    if (details.open) {
      if (prefersReducedMotion()) { details.open = false; body.dataset.collapsed = 'true'; return; }
      animating = true;
      body.dataset.collapsed = 'true';
      const done = () => {
        body.removeEventListener('transitionend', onEnd);
        clearTimeout(timer);
        details.open = false;
        finish();
      };
      const onEnd = e => { if (e.target === body && e.propertyName === 'grid-template-rows') done(); };
      const timer = setTimeout(done, 320);
      body.addEventListener('transitionend', onEnd);
      return;
    }

    details.open = true;
    if (prefersReducedMotion()) { body.dataset.collapsed = 'false'; return; }
    animating = true;
    body.dataset.collapsed = 'true';
    void body.offsetHeight; // commit the collapsed start state
    body.dataset.collapsed = 'false';
    setTimeout(finish, 220);
  });
}

export async function initializeChatUi(reportError) {
  const $ = id => document.getElementById(id);
  const menu = $('chat-menu');
  const menuPopover = menu.querySelector('.menu-actions');
  const closeMenu = () => {
    if (!menu.open) return;
    // animateOut removes .is-leaving itself; `open` only flips once done, so
    // the panel stays painted for the duration of the exit animation.
    animateOut(menuPopover, () => { menu.open = false; });
  };
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
  animateDisclosure($('model-options'));
}
