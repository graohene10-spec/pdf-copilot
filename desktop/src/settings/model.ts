import { normalizeBackground, backgroundErrors, type BackgroundImage } from './background.ts'
import { defaultQuickPrompts, normalizeQuickPrompts, quickPromptErrors, defaultCaptureQuestions, normalizeCaptureQuestions, captureQuestionErrors, type QuickPrompt, type QuickPrompts } from './quick-prompts.ts'

export type ShortcutAction = 'import' | 'search' | 'find' | 'fullscreen' | 'settings' | 'sidebar' | 'ai' | 'outline' | 'capture' | 'fitWidth' | 'zoomOut' | 'zoomIn' | 'previousPage' | 'nextPage' | 'aiSend' | 'aiStop' | 'nextTab' | 'previousTab' | 'closeTab' | 'split'
export type ThemePreference = 'system' | 'light' | 'dark'
export type BackdropPreset = 'mist' | 'dawn' | 'mint' | 'lavender' | 'graphite' | 'paper'
/* 字体：只列常见的中文字体。选中却未安装时，按顺序退回系统字体。 */
const SYSTEM_SANS = "'Segoe UI Variable Text', 'Segoe UI', -apple-system, 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif"
export type FontChoice = { id: string; label: string; families: string[]; stack: string }
const font = (id: string, label: string, families: string[], fallback = SYSTEM_SANS): FontChoice => ({ id, label, families, stack: [...families.map(name => `'${name}'`), fallback].join(', ') })
export const UI_FONTS: FontChoice[] = [
  { id: 'system', label: '系统默认', families: [], stack: SYSTEM_SANS },
  font('harmony', 'HarmonyOS Sans', ['HarmonyOS Sans SC', 'HarmonyOS Sans']),
  font('misans', 'MiSans', ['MiSans', 'MiSans VF']),
  font('source-han-sans', '思源黑体', ['Source Han Sans SC', 'Noto Sans CJK SC', 'Noto Sans SC', '思源黑体']),
  font('yahei', '微软雅黑', ['Microsoft YaHei UI', 'Microsoft YaHei']),
  font('pingfang', '苹方', ['PingFang SC']),
]
const SERIF = "'Times New Roman', serif"
export const READING_FONTS: FontChoice[] = [
  // 西文用 Anthropic Serif（未安装时用随应用附带的 Source Serif 4），中文仍走系统黑体，读起来与 Claude 一致。
  { id: 'anthropic', label: 'Anthropic Serif（西文衬线，中文黑体）', families: [], stack: `'Anthropic Serif', 'Tiempos Text', 'Source Serif 4 Variable', Georgia, ${SYSTEM_SANS}` },
  { id: 'ui', label: '跟随界面字体', families: [], stack: '' },
  font('source-han-serif', '思源宋体', ['Source Han Serif SC', 'Noto Serif CJK SC', 'Noto Serif SC', '思源宋体'], SERIF),
  font('wenkai', '霞鹜文楷', ['LXGW WenKai', 'LXGW WenKai Screen', '霞鹜文楷'], SYSTEM_SANS),
  font('songti', '宋体', ['Songti SC', 'SimSun', 'STSong', 'NSimSun'], SERIF),
  font('kaiti', '楷体', ['KaiTi', 'STKaiti', 'Kaiti SC'], SERIF),
  font('fangsong', '仿宋', ['FangSong', 'STFangsong'], SERIF),
  font('harmony', 'HarmonyOS Sans', ['HarmonyOS Sans SC', 'HarmonyOS Sans']),
  font('source-han-sans', '思源黑体', ['Source Han Sans SC', 'Noto Sans CJK SC', 'Noto Sans SC', '思源黑体']),
]
export const BACKDROPS: { id: BackdropPreset; label: string }[] = [
  { id: 'mist', label: '晨雾' }, { id: 'dawn', label: '暮光' }, { id: 'mint', label: '薄荷' },
  { id: 'lavender', label: '薰衣草' }, { id: 'graphite', label: '石墨' }, { id: 'paper', label: '素白' },
]
export interface AppPreferences {
  version: 3
  appearance: { theme: ThemePreference; libraryView: 'grid' | 'list'; glassTransparency: number; glassBlur: number; backdrop: BackdropPreset; background: BackgroundImage | null; gallery: BackgroundImage[]; uiFont: string; readingFont: string }
  pdf: { initialZoom: 'fit-width' | number; zoomStep: number; fitOnPanelOverflow: boolean; openAssistantOnCapture: boolean; quickAskOnCapture: boolean }
  markdown: { fontSize: number; contentWidth: number }
  assistant: { quickPrompts: QuickPrompts; captureQuestions: QuickPrompt[] }
  shortcuts: Record<ShortcutAction, string>
}
export type AppearancePreferences = AppPreferences['appearance']

export const SETTINGS_KEY = 'app.preferences.v1'
export const SHORTCUTS: { action: ShortcutAction; label: string }[] = [
  { action: 'import', label: '导入文档' }, { action: 'search', label: '搜索文档' },
  { action: 'find', label: '文档内搜索' }, { action: 'fullscreen', label: '进入 / 退出全屏' },
  { action: 'settings', label: '打开设置' }, { action: 'sidebar', label: '显示 / 隐藏侧栏' },
  { action: 'ai', label: '显示 / 隐藏 AI 助手' }, { action: 'outline', label: '显示 / 隐藏目录' },
  { action: 'capture', label: '框选 PDF 区域' },
  { action: 'fitWidth', label: '适应宽度' }, { action: 'zoomOut', label: '缩小' },
  { action: 'zoomIn', label: '放大' }, { action: 'previousPage', label: '上一页' },
  { action: 'nextPage', label: '下一页' }, { action: 'aiSend', label: '发送 AI 问题' },
  { action: 'aiStop', label: '停止 AI 回答' },
  { action: 'nextTab', label: '下一个文件标签' }, { action: 'previousTab', label: '上一个文件标签' }, { action: 'closeTab', label: '关闭当前文件标签' },
  { action: 'split', label: '并排阅读' },
]
export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutAction, string>> = Object.freeze({
  import: 'Ctrl+KeyO', search: 'Ctrl+KeyK', settings: 'Ctrl+Comma', sidebar: 'Ctrl+KeyB',
  find: 'Ctrl+KeyF', fullscreen: 'F11',
  ai: 'Ctrl+Shift+Digit7', outline: 'Ctrl+Shift+KeyO', capture: 'Alt+Shift+KeyS', fitWidth: 'Ctrl+Digit0',
  zoomOut: 'Ctrl+WheelDown', zoomIn: 'Ctrl+WheelUp', previousPage: 'Alt+ArrowUp', nextPage: 'Alt+ArrowDown',
  aiSend: 'Ctrl+Enter', aiStop: 'Ctrl+Shift+Enter',
  nextTab: 'Ctrl+Tab', previousTab: 'Ctrl+Shift+Tab', closeTab: 'Ctrl+KeyW', split: 'Ctrl+Backslash',
})
const LEGACY_GLASS: Record<string, number> = { clear: 85, balanced: 70, rich: 30, solid: 0 }
export const MAX_GALLERY = 6
export function defaultPreferences(): AppPreferences {
  return { version: 3, appearance: { theme: 'system', libraryView: 'grid', glassTransparency: 70, glassBlur: 50, backdrop: 'mist', background: null, gallery: [], uiFont: 'system', readingFont: 'anthropic' },
    pdf: { initialZoom: 'fit-width', zoomStep: 15, fitOnPanelOverflow: true, openAssistantOnCapture: true, quickAskOnCapture: true },
    markdown: { fontSize: 17, contentWidth: 840 }, assistant: { quickPrompts: defaultQuickPrompts(), captureQuestions: defaultCaptureQuestions() }, shortcuts: { ...DEFAULT_SHORTCUTS } }
}
const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Meta']
const aliases: Record<string, string> = { control: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta' }
const labels: Record<string, string> = { Comma: ',', Period: '.', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Slash: '/', Backslash: '\\', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down', WheelUp: '滚轮向上', WheelDown: '滚轮向下' }
const reserved = new Set([
  'Ctrl+KeyT', 'Ctrl+KeyN', 'Ctrl+KeyL', 'Ctrl+KeyR', 'Ctrl+KeyP', 'Ctrl+KeyS', 'Ctrl+KeyH', 'Ctrl+KeyD', 'Ctrl+KeyJ',
  'Ctrl+Shift+KeyT', 'Ctrl+Shift+KeyN', 'Ctrl+Shift+KeyW', 'Ctrl+Shift+KeyI', 'Ctrl+Shift+KeyJ', 'Ctrl+Shift+KeyB', 'Ctrl+Shift+Delete',
  'Ctrl+PageUp', 'Ctrl+PageDown', 'Ctrl+F4', 'Alt+F4', 'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Home',
  'Meta+KeyL', 'Meta+KeyD',
])
function keyCode(value: string): string | null {
  if (/^[a-z]$/i.test(value)) return `Key${value.toUpperCase()}`
  if (/^[0-9]$/.test(value)) return `Digit${value}`
  if (/^Key[A-Z]$|^Digit[0-9]$|^F(?:[1-9]|1[0-2])$/.test(value)) return value
  if (Object.hasOwn(labels, value)) return value
  const alias = Object.entries(labels).find(([, label]) => label === value)?.[0]
  return alias || null
}
export function normalizeShortcut(value: unknown): string | null {
  if (value === '') return ''
  if (value === 'F11') return 'F11'
  if (typeof value !== 'string' || value.length > 80) return null
  const parts = value.split('+').map(part => part.trim())
  if (parts.length < 2 || parts.some(part => !part)) return null
  const code = keyCode(parts.pop()!)
  if (!code) return null
  const modifiers = parts.map(part => aliases[part.toLowerCase()])
  if (modifiers.some(part => !part) || new Set(modifiers).size !== modifiers.length) return null
  if (!modifiers.some(part => ['Ctrl', 'Alt', 'Meta'].includes(part))) return null
  const binding = [...modifierOrder.filter(part => modifiers.includes(part)), code].join('+')
  return reserved.has(binding) ? null : binding
}
export function shortcutLabel(value: string): string {
  if (!value) return '已禁用'
  return value.split('+').map(part => part.startsWith('Key') ? part.slice(3) : part.startsWith('Digit') ? part.slice(5) : labels[part] || part).join(' + ')
}
export function shortcutConflicts(bindings: Record<ShortcutAction, string>): { binding: string; actions: ShortcutAction[] }[] {
  const seen = new Map<string, ShortcutAction[]>()
  for (const { action } of SHORTCUTS) {
    const binding = normalizeShortcut(bindings[action])
    if (binding) seen.set(binding, [...(seen.get(binding) || []), action])
  }
  return [...seen.entries()].filter(([, actions]) => actions.length > 1).map(([binding, actions]) => ({ binding, actions }))
}
function range(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback
}
function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {} }
export function normalizePreferences(value: unknown, legacyTheme?: string | null): AppPreferences {
  const defaults = defaultPreferences(), input = record(value)
  const appearance = record(input.appearance), pdf = record(input.pdf), markdown = record(input.markdown), shortcuts = record(input.shortcuts)
  defaults.assistant.quickPrompts = normalizeQuickPrompts(record(input.assistant).quickPrompts)
  defaults.assistant.captureQuestions = normalizeCaptureQuestions(record(input.assistant).captureQuestions)
  const theme = appearance.theme || legacyTheme
  defaults.appearance.theme = ['system', 'light', 'dark'].includes(theme) ? theme : defaults.appearance.theme
  defaults.appearance.libraryView = ['grid', 'list'].includes(appearance.libraryView) ? appearance.libraryView : defaults.appearance.libraryView
  const legacyGlass = typeof appearance.glass === 'string' && Object.hasOwn(LEGACY_GLASS, appearance.glass) ? LEGACY_GLASS[appearance.glass] : defaults.appearance.glassTransparency
  defaults.appearance.glassTransparency = range(appearance.glassTransparency, 0, 100, legacyGlass)
  defaults.appearance.glassBlur = range(appearance.glassBlur, 0, 100, 50)
  defaults.appearance.backdrop = BACKDROPS.some(item => item.id === appearance.backdrop) ? appearance.backdrop : defaults.appearance.backdrop
  defaults.appearance.background = normalizeBackground(appearance.background)
  // Uploaded images stay in a small gallery; the selected one is always part of it.
  const gallery: BackgroundImage[] = []
  for (const item of [...(Array.isArray(appearance.gallery) ? appearance.gallery : []), defaults.appearance.background]) {
    const image = normalizeBackground(item)
    if (image && !gallery.some(entry => entry.dataUrl === image.dataUrl) && gallery.length < MAX_GALLERY) gallery.push(image)
  }
  defaults.appearance.gallery = gallery
  defaults.appearance.uiFont = UI_FONTS.some(item => item.id === appearance.uiFont) ? appearance.uiFont : 'system'
  defaults.appearance.readingFont = READING_FONTS.some(item => item.id === appearance.readingFont) ? appearance.readingFont : 'anthropic'
  defaults.pdf.initialZoom = pdf.initialZoom === 'fit-width' || pdf.initialZoom === undefined ? 'fit-width' : range(pdf.initialZoom, 25, 400, 100)
  defaults.pdf.zoomStep = range(pdf.zoomStep, 5, 50, defaults.pdf.zoomStep)
  defaults.pdf.fitOnPanelOverflow = typeof pdf.fitOnPanelOverflow === 'boolean' ? pdf.fitOnPanelOverflow : defaults.pdf.fitOnPanelOverflow
  defaults.pdf.openAssistantOnCapture = typeof pdf.openAssistantOnCapture === 'boolean' ? pdf.openAssistantOnCapture : true
  // 版本 3 起框选后默认弹出快捷提问；旧版本里的「关闭」是当时的默认值，升级时改为开启。
  const legacyQuickAsk = input.version === undefined || input.version === 1 || input.version === 2
  defaults.pdf.quickAskOnCapture = typeof pdf.quickAskOnCapture === 'boolean' && !legacyQuickAsk ? pdf.quickAskOnCapture : true
  defaults.markdown.fontSize = range(markdown.fontSize, 13, 28, defaults.markdown.fontSize)
  defaults.markdown.contentWidth = range(markdown.contentWidth, 600, 1400, defaults.markdown.contentWidth)
  for (const { action } of SHORTCUTS) defaults.shortcuts[action] = normalizeShortcut(shortcuts[action]) ?? defaults.shortcuts[action]
  // Upgrade the old default pair; individually customized keys remain intact.
  if ((input.version === undefined || input.version === 1) && shortcuts.zoomIn === 'Ctrl+Equal' && shortcuts.zoomOut === 'Ctrl+Minus') {
    defaults.shortcuts.zoomIn = DEFAULT_SHORTCUTS.zoomIn
    defaults.shortcuts.zoomOut = DEFAULT_SHORTCUTS.zoomOut
  }
  for (const { action } of SHORTCUTS) if (!['zoomIn', 'zoomOut'].includes(action) && /Wheel(?:Up|Down)$/.test(defaults.shortcuts[action])) defaults.shortcuts[action] = DEFAULT_SHORTCUTS[action]
  if (shortcutConflicts(defaults.shortcuts).length) defaults.shortcuts = { ...DEFAULT_SHORTCUTS }
  return defaults
}
export function preferenceErrors(value: AppPreferences): string[] {
  const errors: string[] = []
  if (!['system', 'light', 'dark'].includes(value.appearance.theme)) errors.push('请选择有效外观。')
  if (!['grid', 'list'].includes(value.appearance.libraryView)) errors.push('请选择有效文档视图。')
  if (!BACKDROPS.some(item => item.id === value.appearance.backdrop)) errors.push('请选择有效底板。')
  if (!Array.isArray(value.appearance.gallery) || value.appearance.gallery.length > MAX_GALLERY) errors.push(`图库最多保存 ${MAX_GALLERY} 张图片。`)
  else for (const image of value.appearance.gallery) errors.push(...backgroundErrors(image))
  if (!UI_FONTS.some(item => item.id === value.appearance.uiFont)) errors.push('请选择有效界面字体。')
  if (!READING_FONTS.some(item => item.id === value.appearance.readingFont)) errors.push('请选择有效阅读字体。')
  const check = (name: string, number: number, min: number, max: number) => { if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) errors.push(`${name}须为 ${min}–${max} 的整数。`) }
  check('玻璃透明度', value.appearance.glassTransparency, 0, 100)
  check('模糊程度', value.appearance.glassBlur, 0, 100)
  errors.push(...backgroundErrors(value.appearance.background))
  errors.push(...quickPromptErrors(value.assistant?.quickPrompts))
  errors.push(...captureQuestionErrors(value.assistant?.captureQuestions))
  if (value.pdf.initialZoom !== 'fit-width') check('PDF 初始缩放', value.pdf.initialZoom, 25, 400)
  check('缩放步长', value.pdf.zoomStep, 5, 50)
  check('Markdown 字号', value.markdown.fontSize, 13, 28)
  check('Markdown 内容宽度', value.markdown.contentWidth, 600, 1400)
  if (typeof value.pdf.fitOnPanelOverflow !== 'boolean') errors.push('自动适应选项无效。')
  if (typeof value.pdf.openAssistantOnCapture !== 'boolean') errors.push('框选提问选项无效。')
  if (typeof value.pdf.quickAskOnCapture !== 'boolean') errors.push('框选快捷提问选项无效。')
  for (const { action, label } of SHORTCUTS) {
    if (normalizeShortcut(value.shortcuts[action]) === null) errors.push(`${label}：请选择 F11 或带 Ctrl、Alt、Meta 的按键组合，并避开浏览器保留快捷键。`)
    if (!['zoomIn', 'zoomOut'].includes(action) && /Wheel(?:Up|Down)$/.test(value.shortcuts[action])) errors.push(`${label}：滚轮组合只用于放大和缩小。`)
  }
  for (const conflict of shortcutConflicts(value.shortcuts)) errors.push(`${shortcutLabel(conflict.binding)} 已同时用于 ${conflict.actions.map(action => SHORTCUTS.find(item => item.action === action)?.label).join('、')}。`)
  return errors
}

type KeyEvent = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'> & Partial<Pick<KeyboardEvent, 'isComposing' | 'keyCode' | 'target' | 'defaultPrevented' | 'getModifierState'>>
export function shortcutFromEvent(event: KeyEvent): string | null {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return null
  const code = keyCode(event.code || event.key)
  if (!code) return null
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean)
  return normalizeShortcut([...modifiers, code].join('+'))
}
function elementTarget(event: KeyEvent): Element | null {
  if (typeof Element === 'undefined') return null
  if (event.target instanceof Element) return event.target
  return event.target instanceof Node ? event.target.parentElement : null
}
export function matchShortcut(event: KeyEvent, preferences: AppPreferences, options: { scope?: 'global' | 'ai' } = {}): ShortcutAction | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return null
  const element = elementTarget(event)
  if (element?.closest('[data-shortcut-capture],[role="dialog"],[role="alertdialog"]')) return null
  const binding = shortcutFromEvent(event)
  if (!binding) return null
  const action = SHORTCUTS.find(item => preferences.shortcuts[item.action] === binding)?.action
  if (!action) return null
  const ai = action === 'aiSend' || action === 'aiStop'
  if (options.scope === 'ai') return ai ? action : null
  if (ai) return null
  const editable = element?.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"]')
  if (editable && !['import', 'search', 'find', 'fullscreen', 'settings', 'nextTab', 'previousTab', 'closeTab'].includes(action)) return null
  return action
}

type WheelInput = Pick<WheelEvent, 'deltaY' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'> & Partial<Pick<WheelEvent, 'target' | 'defaultPrevented'>>
export function shortcutFromWheelEvent(event: WheelInput): string | null {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return null
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean)
  return normalizeShortcut([...modifiers, event.deltaY < 0 ? 'WheelUp' : 'WheelDown'].join('+'))
}
export function matchWheelShortcut(event: WheelInput, preferences: AppPreferences): 'zoomIn' | 'zoomOut' | null {
  if (event.defaultPrevented) return null
  const element = typeof Element !== 'undefined' && event.target instanceof Element ? event.target : null
  if (element?.closest('input,textarea,select,[contenteditable],[role="dialog"],[role="alertdialog"],[data-shortcut-capture]')) return null
  const binding = shortcutFromWheelEvent(event)
  if (!binding) return null
  return (['zoomIn', 'zoomOut'] as const).find(action => preferences.shortcuts[action] === binding) || null
}
