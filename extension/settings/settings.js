import { loadSettings, saveSettings, loadKey, applyTheme, apiOrigin } from '../common/settings.js';
import { PROVIDERS, getProvider, getModel, getNativeModels, getNativeStatus, registerNativeModels } from '../providers/index.js';
const $ = id => document.getElementById(id);
$('extension-version').textContent = 'v' + chrome.runtime.getManifest().version;
const shortcutLabels = [['open-sidebar', '打开 AI 侧栏'], ['quick-chat', '临时问答'], ['capture-region', '截图后框选'], ['open-reader', '增强阅读器']];
async function refreshShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    const shortcuts = new Map(commands.map(command => [command.name, command.shortcut || '']));
    const missing = [];
    $('shortcut-list').replaceChildren();
    for (const [name, label] of shortcutLabels) {
      const title = document.createElement('span'); title.textContent = label;
      const key = document.createElement('code'); key.dataset.command = name;
      key.textContent = shortcuts.get(name) || '未设置';
      if (!shortcuts.get(name)) missing.push(label);
      $('shortcut-list').append(title, key);
    }
    $('shortcut-status').textContent = missing.length
      ? `${missing.join('、')}的快捷键尚未启用。点击“设置浏览器快捷键”分配，再返回重新检查。`
      : '快捷键已启用。在 PDF 标签页按对应组合即可调用。';
    $('shortcut-status').classList.toggle('error', missing.length > 0);
  } catch {
    $('shortcut-status').textContent = '无法读取快捷键，请打开浏览器快捷键设置检查。';
    $('shortcut-status').classList.add('error');
  }
}
$('configure-shortcuts').onclick = () => {
  const address = (navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome') + '://extensions/shortcuts';
  chrome.tabs.create({ url: address }).catch(() => { $('shortcut-status').textContent = '请在浏览器地址栏打开 ' + address; });
};
$('refresh-shortcuts').onclick = refreshShortcuts;
window.addEventListener('focus', refreshShortcuts);
refreshShortcuts();
let settings = await loadSettings();
registerNativeModels((await chrome.storage.local.get('nativeModels')).nativeModels || []);
applyTheme(settings.theme);
for (const provider of PROVIDERS) $('provider').add(new Option(provider.name, provider.id));
$('provider').value = settings.provider;
$('model').value = settings.model;
$('base-url').value = settings.baseUrl;
$('remember').checked = settings.rememberKey;
$('key').value = await loadKey(settings.provider);
$('theme').value = settings.theme;
$('extension-id').textContent = chrome.runtime.id;
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function updateModels(defaultModel = false) {
  const provider = getProvider($('provider').value);
  $('api-fields').hidden = provider.id === 'codex'; $('base-url').required = provider.id !== 'codex';
  $('codex-fields').hidden = provider.id !== 'codex';
  $('models').replaceChildren(...provider.models.map(item => new Option(item.name, item.id)));
  if (defaultModel) $('model').value = provider.defaultModel || provider.models[0]?.id || '';
  const model = getModel(provider.id, $('model').value);
  const previous = $('effort').value || settings.effort;
  $('effort').replaceChildren(new Option('模型默认（不发送强度参数）', ''));
  for (const effort of model?.efforts || []) $('effort').add(new Option(({ none: '不思考', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', minimal: '极低', ultra: '极高' })[effort] || effort, effort));
  $('effort').value = model?.efforts.includes(previous) ? previous : (model?.defaultEffort || '');
  $('model-note').textContent = model ? (model.vision ? '此模型支持截图。' : '此模型仅接受文字。') : '自定义模型使用服务默认参数；图片与模型可用性由服务返回结果确认。';
}
updateModels();
$('provider').onchange = async () => {
  const provider = getProvider($('provider').value);
  $('base-url').value = provider.baseUrl;
  $('key').value = await loadKey(provider.id);
  $('remember').checked = Boolean((await chrome.storage.local.get('apiKey:' + provider.id))['apiKey:' + provider.id]);
  updateModels(true); status('');
};
$('model').onchange = () => updateModels();
$('theme').onchange = () => applyTheme($('theme').value);
$('copy-id').onclick = () => navigator.clipboard.writeText(chrome.runtime.id).then(() => status('已复制扩展 ID。'));
function codexStatus(text, error = false) {
  $('codex-status').textContent = text;
  $('codex-status').classList.toggle('error', error);
}
function codexDetail(text) {
  $('codex-error-details').hidden = !text;
  $('codex-error-raw').textContent = text || '';
}
function showCodexDiagnostics(state) {
  $('codex-diagnostics').hidden = false;
  $('codex-version').textContent = state.version || '无法识别';
  $('codex-path').textContent = state.path || '当前小助手未提供路径，请更新小助手';
  $('codex-compatible').textContent = state.compatible === false
    ? `不满足要求（需要 ${state.requiredVersion || '0.159.2'} 或更新版本）`
    : state.compatible === true ? '符合要求'
      : state.compatible === null ? '尚未确认（无法判断程序版本）' : '当前小助手未提供兼容性结果';
  $('codex-login').textContent = state.loggedIn === true
    ? `已登录${state.authType === 'chatgpt' ? ' · ChatGPT 账户' : state.authType === 'apiKey' ? ' · API Key' : ''}`
    : state.loggedIn === false ? '未检测到此 CLI 的登录' : '尚未确认';
  codexDetail(state.diagnostic);
}
function codexConnectionError(message) {
  if (/not found|specified native messaging host|host.*not.*registered/i.test(message)) {
    return '浏览器未找到 Windows 小助手。请运行安装程序，确认扩展 ID，然后关闭设置页并重新打开。';
  }
  if (/forbidden|not allowed|access.*denied/i.test(message)) {
    return '此扩展 ID 尚未获得小助手授权。复制本页的 ID，重新运行安装程序登记。';
  }
  if (/0\.159\.2|newer.*required|version.*required/i.test(message)) {
    return '登记的 Codex CLI 版本不满足要求。请升级 CLI 后重新运行安装程序；登录状态尚未检查。';
  }
  if (/exited|closed|disconnected|断开/i.test(message)) {
    return '小助手连接提前关闭。请更新或重新安装小助手，确认登记的 Codex CLI 路径，再重新检查。';
  }
  return '无法完成 Codex 连接检查。请确认 Windows 小助手和 Codex CLI 安装正常；详细原因见下方。';
}
$('test-codex').onclick = async () => {
  let checkedState = null;
  $('test-codex').disabled = true;
  codexStatus('正在检查 CLI 版本和连接…');
  codexDetail('');
  $('codex-diagnostics').hidden = true;
  $('codex-guidance').textContent = '检查不会发起模型推理，也不会读取或复制登录令牌。';
  try {
    const state = await getNativeStatus();
    checkedState = state;
    showCodexDiagnostics(state);
    if (state.compatible === false) {
      codexStatus('CLI 版本不兼容，需要升级后重新登记。', true);
      $('codex-guidance').textContent = `小助手目前使用上方显示的实际程序。请安装 Codex CLI ${state.requiredVersion || '0.159.2'} 或更新版本，再重新运行小助手安装程序，它会选择满足要求的最新版本。此时登录状态尚未检查，无需据此重新登录。`;
      return;
    }
    if (state.loggedIn === null || state.loggedIn === undefined) {
      codexStatus(state.compatible === true ? '已识别 CLI，但尚未确认登录与服务连接。' : '尚未确认 CLI 版本与登录状态。', true);
      $('codex-guidance').textContent = state.compatible === true
        ? '请根据诊断详情检查 CLI 运行、网络或管理配置。先解决连接问题，再检查登录；这条结果不能判断你是否已经登录。'
        : '请根据诊断详情确认登记的程序路径和 CLI 是否能运行。此结果不能判断版本过低或尚未登录；先解决程序或连接问题，再重新检查。';
      return;
    }
    if (!state.loggedIn) {
      codexStatus('版本与连接正常；此 CLI 尚未登录。', true);
      $('codex-guidance').textContent = state.path
        ? `请在 PowerShell 中使用上方同一个程序完成登录，然后重新检查：\n& '${state.path.replaceAll("'", "''")}' login`
        : '请在同一 Windows 用户下运行 codex login，然后重新检查。若电脑有多份 CLI，请使用小助手登记的那一个。';
      return;
    }
    codexStatus('已登录，正在读取可用模型…');
    const models = await getNativeModels();
    registerNativeModels(models); await chrome.storage.local.set({ nativeModels: models }); updateModels(!$('model').value || !getModel('codex', $('model').value));
    codexStatus(`已连接 · ${models.length} 个可用模型`);
    $('codex-guidance').textContent = '模型列表和思考强度来自本机 Codex。可以保存设置，然后回到 PDF 开始对话。';
  } catch (error) {
    codexStatus(checkedState?.loggedIn === true ? 'CLI 已登录，但读取模型列表失败。请查看诊断详情并重试。' : codexConnectionError(error.message || ''), true);
    codexDetail(error.message);
  }
  finally { $('test-codex').disabled = false; }
};
$('form').onsubmit = async event => {
  event.preventDefault();
  try {
    const provider = $('provider').value;
    // Request host permission directly inside the click/submit gesture.
    if (provider !== 'codex') {
      const origin = apiOrigin($('base-url').value.trim());
      if (!await chrome.permissions.request({ origins: [origin] })) throw new Error('需要授权此 API 地址，才能发送请求。');
    }
    settings = { provider, model: $('model').value.trim(), effort: $('effort').value,
      baseUrl: provider === 'codex' ? '' : $('base-url').value.trim().replace(/\/+$/, ''),
      theme: $('theme').value, rememberKey: provider !== 'codex' && $('remember').checked };
    await saveSettings(settings, provider === 'codex' ? '' : $('key').value.trim());
    status('已保存。可回到 PDF 打开侧栏。');
  } catch (error) { status(error.message, true); }
};
$('forget').onclick = async () => {
  const key = 'apiKey:' + $('provider').value;
  await Promise.all([chrome.storage.local.remove(key), chrome.storage.session.remove(key)]);
  $('key').value = ''; $('remember').checked = false; status('已清除当前服务的密钥。');
};
