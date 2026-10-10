import { normalizeBackground, backgroundErrors, type BackgroundImage } from './background.ts'

export type ShortcutAction = 'import' | 'search' | 'settings' | 'sidebar' | 'ai' | 'outline' | 'capture' | 'fitWidth' | 'zoomOut' | 'zoomIn' | 'previousPage' | 'nextPage' | 'aiSend' | 'aiStop' | 'nextTab' | 'previousTab' | 'closeTab'
export type ThemePreference = 'system' | 'light' | 'dark'
export interface AppPreferences {
  version: 1
  appearance: { theme: ThemePreference; libraryView: 'grid' | 'list'; glassTransparency: number; background: BackgroundImage | null }
  pdf: { initialZoom: 'fit-width' | number; zoomStep: number; fitOnPanelOverflow: boolean; openAssistantOnCapture: boolean }
  markdown: { fontSize: number; contentWidth: number }
  shortcuts: Record<ShortcutAction, string>
}
export type AppearancePreferences = AppPreferences['appearance']

export const SETTINGS_KEY = 'app.preferences.v1'
export const SHORTCUTS: { action: ShortcutAction; label: string }[] = [
  { action: 'import', label: '导入文档' }, { action: 'search', label: '搜索文档' },
  { action: 'settings', label: '打开设置' }, { action: 'sidebar', label: '显示 / 隐藏侧栏' },
  { action: 'ai', label: '显示 / 隐藏 AI 助手' }, { action: 'outline', label: '显示 / 隐藏目录' },
  { action: 'capture', label: '框选 PDF 区域' },
  { action: 'fitWidth', label: '适应宽度' }, { action: 'zoomOut', label: '缩小' },
  { action: 'zoomIn', label: '放大' }, { action: 'previousPage', label: '上一页' },
  { action: 'nextPage', label: '下一页' }, { action: 'aiSend', label: '发送 AI 问题' },
  { action: 'aiStop', label: '停止 AI 回答' },
  { action: 'nextTab', label: '下一个文件标签' }, { action: 'previousTab', label: '上一个文件标签' }, { action: 'closeTab', label: '关闭当前文件标签' },
]
export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutAction, string>> = Object.freeze({
  import: 'Ctrl+KeyO', search: 'Ctrl+KeyK', settings: 'Ctrl+Comma', sidebar: 'Ctrl+KeyB',
  ai: 'Ctrl+Shift+Digit7', outline: 'Ctrl+Shift+KeyO', capture: 'Alt+Shift+KeyS', fitWidth: 'Ctrl+Digit0',
  zoomOut: 'Ctrl+Minus', zoomIn: 'Ctrl+Equal', previousPage: 'Alt+ArrowUp', nextPage: 'Alt+ArrowDown',
  aiSend: 'Ctrl+Enter', aiStop: 'Ctrl+Shift+Enter',
  nextTab: 'Ctrl+Tab', previousTab: 'Ctrl+Shift+Tab', closeTab: 'Ctrl+KeyW',
})
const LEGACY_GLASS: Record<string, number> = { clear: 85, balanced: 70, rich: 30, solid: 0 }
export function defaultPreferences(): AppPreferences {
  return { version: 1, appearance: { theme: 'system', libraryView: 'grid', glassTransparency: 70, background: null },
    pdf: { initialZoom: 'fit-width', zoomStep: 15, fitOnPanelOverflow: true, openAssistantOnCapture: true },
    markdown: { fontSize: 17, contentWidth: 840 }, shortcuts: { ...DEFAULT_SHORTCUTS } }
}
const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Meta']
const aliases: Record<string, string> = { control: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta' }
const labels: Record<string, string> = { Comma: ',', Period: '.', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Slash: '/', Backslash: '\\', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down' }
const reserved = new Set([
  'Ctrl+KeyT', 'Ctrl+KeyN', 'Ctrl+KeyL', 'Ctrl+KeyR', 'Ctrl+KeyF', 'Ctrl+KeyP', 'Ctrl+KeyS', 'Ctrl+KeyH', 'Ctrl+KeyD', 'Ctrl+KeyJ',
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
  const theme = appearance.theme || legacyTheme
  defaults.appearance.theme = ['system', 'light', 'dark'].includes(theme) ? theme : defaults.appearance.theme
  defaults.appearance.libraryView = ['grid', 'list'].includes(appearance.libraryView) ? appearance.libraryView : defaults.appearance.libraryView
  const legacyGlass = typeof appearance.glass === 'string' && Object.hasOwn(LEGACY_GLASS, appearance.glass) ? LEGACY_GLASS[appearance.glass] : defaults.appearance.glassTransparency
  defaults.appearance.glassTransparency = range(appearance.glassTransparency, 0, 100, legacyGlass)
  defaults.appearance.background = normalizeBackground(appearance.background)
  defaults.pdf.initialZoom = pdf.initialZoom === 'fit-width' || pdf.initialZoom === undefined ? 'fit-width' : range(pdf.initialZoom, 25, 400, 100)
  defaults.pdf.zoomStep = range(pdf.zoomStep, 5, 50, defaults.pdf.zoomStep)
  defaults.pdf.fitOnPanelOverflow = typeof pdf.fitOnPanelOverflow === 'boolean' ? pdf.fitOnPanelOverflow : defaults.pdf.fitOnPanelOverflow
  defaults.pdf.openAssistantOnCapture = typeof pdf.openAssistantOnCapture === 'boolean' ? pdf.openAssistantOnCapture : true
  defaults.markdown.fontSize = range(markdown.fontSize, 13, 28, defaults.markdown.fontSize)
  defaults.markdown.contentWidth = range(markdown.contentWidth, 600, 1400, defaults.markdown.contentWidth)
  for (const { action } of SHORTCUTS) defaults.shortcuts[action] = normalizeShortcut(shortcuts[action]) ?? defaults.shortcuts[action]
  if (shortcutConflicts(defaults.shortcuts).length) defaults.shortcuts = { ...DEFAULT_SHORTCUTS }
  return defaults
}
export function preferenceErrors(value: AppPreferences): string[] {
  const errors: string[] = []
  if (!['system', 'light', 'dark'].includes(value.appearance.theme)) errors.push('请选择有效外观。')
  if (!['grid', 'list'].includes(value.appearance.libraryView)) errors.push('请选择有效文档视图。')
  const check = (name: string, number: number, min: number, max: number) => { if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) errors.push(`${name}须为 ${min}–${max} 的整数。`) }
  check('玻璃透明度', value.appearance.glassTransparency, 0, 100)
  errors.push(...backgroundErrors(value.appearance.background))
  if (value.pdf.initialZoom !== 'fit-width') check('PDF 初始缩放', value.pdf.initialZoom, 25, 400)
  check('缩放步长', value.pdf.zoomStep, 5, 50)
  check('Markdown 字号', value.markdown.fontSize, 13, 28)
  check('Markdown 内容宽度', value.markdown.contentWidth, 600, 1400)
  if (typeof value.pdf.fitOnPanelOverflow !== 'boolean') errors.push('自动适应选项无效。')
  if (typeof value.pdf.openAssistantOnCapture !== 'boolean') errors.push('框选提问选项无效。')
  for (const { action, label } of SHORTCUTS) if (normalizeShortcut(value.shortcuts[action]) === null) errors.push(`${label}：请选择带 Ctrl、Alt 或 Meta 的按键组合，并避开浏览器保留快捷键。`)
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
  if (editable && !['import', 'search', 'settings', 'nextTab', 'previousTab', 'closeTab'].includes(action)) return null
  return action
}
